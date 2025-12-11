function initETSNearest() {
  console.log("[ETS] initETSNearest start");

  // ---------- SELECTORS (scoped to your updated form) ----------
  const form       = document.getElementById("search-form-ets");
  const input      = document.getElementById("search-nearest-ets-location");
  const button     = form ? form.querySelector(".w-button") : null;
  const resultsBox = document.querySelector(".locations-listing-main-box");
  const netlifyUrl = "https://etsperformance.netlify.app/.netlify/functions/nearest-locations"; // full URL if cross-origin

  if (!form || !input || !button) {
    console.error("[ETS] Missing node(s)", { form: !!form, input: !!input, button: !!button });
    return;
  }
  console.log("[ETS] Nodes bound OK");

  // ---------- Block any form submission ----------
  form.addEventListener("submit", function(e){
    console.warn("[ETS] submit prevented");
    e.preventDefault();
    e.stopPropagation();
    return false;
  });
  form.setAttribute("action", "javascript:void(0)");
  form.setAttribute("novalidate", "novalidate");

  // ---------- Places Autocomplete (US only) ----------
  let autocomplete = null;
  if (window.google && google.maps && google.maps.places) {
    autocomplete = new google.maps.places.Autocomplete(input, {
      types: ["geocode"],
      componentRestrictions: { country: "us" }
    });
    console.log("[ETS] Places Autocomplete initialized (US)");
    // we’ll call the Netlify API on click, not on place_changed
  } else {
    console.error("[ETS] google.maps.places not available — check script tag & API key");
  }

  // ---------- Loading UI ----------
  const originalBtnText = button.textContent || "Search";
  function setLoading(isLoading){
    if (!resultsBox) return;
    if (isLoading) {
      button.disabled = true;
      button.textContent = "Searching...";
      resultsBox.style.transition = "opacity 180ms ease";
      resultsBox.style.opacity = "0.3";
    } else {
      button.disabled = false;
      button.textContent = originalBtnText;
      resultsBox.style.opacity = "1";
    }
  }

  // ---------- DOM patchers ----------
  function applyResultsToDom(items){
    console.log("[ETS] applyResultsToDom", items);
    const primary = document.querySelector(".top-location-card");
    const seconds = Array.prototype.slice.call(document.querySelectorAll(".secondary-locations .location-content-sec"));

    if (primary && items[0]) updatePrimaryCard(primary, items[0]);
    if (seconds[0] && items[1]) updateSecondaryCard(seconds[0], items[1]);
    if (seconds[1] && items[2]) updateSecondaryCard(seconds[1], items[2]);
  }

  function updatePrimaryCard(card, data){
    // image
    const img = card.querySelector(".location-thumbnail-wrapper img.location-thumbnail");
    if (img && data.image) { img.src = data.image; img.srcset=""; img.sizes=""; img.alt = data.name || "Location"; }
    // title
    const h = card.querySelector("h3"); if (h) h.textContent = data.name || "";
    // distance
    const distWrap = card.querySelector(".distance-in-miles-wrapper");
    if (distWrap){ distWrap.classList.remove("d-none"); const t=distWrap.querySelector(".text-size-regular"); if (t) t.textContent = data.distanceText || ""; }
    // ETA
    const etaWrap = card.querySelector(".estimated-drie-time-wrapper");
    if (etaWrap){
      if (data.durationText){ etaWrap.classList.remove("d-none"); const t2=etaWrap.querySelector(".text-size-regular"); if (t2) t2.textContent = data.durationText; }
      else { etaWrap.classList.add("d-none"); }
    }
    // buttons
    const btns = Array.prototype.slice.call(card.querySelectorAll(".button"));
    btns.forEach(function(a){
      const label = (a.textContent || "").toLowerCase();
      if (label.indexOf("book")   > -1) a.href = data.bookUrl || "#";
      if (label.indexOf("detail") > -1) a.href = data.detailsUrl || "#";
    });
  }

  function updateSecondaryCard(card, data){
    const h = card.querySelector("h3"); if (h) h.textContent = data.name || "";
    const distWrap = card.querySelector(".distance-in-miles-wrapper");
    if (distWrap){ distWrap.classList.remove("d-none"); const t=distWrap.querySelector(".text-size-regular"); if (t) t.textContent = data.distanceText || ""; }
    const etaWrap = card.querySelector(".estimated-drie-time-wrapper");
    if (etaWrap){
      if (data.durationText){ etaWrap.classList.remove("d-none"); const t2=etaWrap.querySelector(".text-size-regular"); if (t2) t2.textContent = data.durationText; }
      else { etaWrap.classList.add("d-none"); }
    }
    const detailsBtn = card.querySelector(".button"); if (detailsBtn) detailsBtn.href = data.detailsUrl || "#";
  }

  // ---------- Click handler (your approach) ----------
  function handleSearchButtonClick(e){
    e.preventDefault();
    e.stopPropagation();

    const query = (input.value || "").trim();
    if (!query) {
      console.warn("[ETS] Empty query");
      return;
    }

    const payload = { q: query, limit: 3 };
    console.log("[ETS] payload →", payload);

    setLoading(true);
    fetch(netlifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(function(res){
      console.log("[ETS] status:", res.status);
      return res.json().then(function(j){ return { ok: res.ok, data: j }; });
    })
    .then(function(r){
      console.log("[ETS] body:", r.data);
      if (!r.ok) throw new Error(r.data && r.data.error ? r.data.error : "Search failed");
      applyResultsToDom(r.data.items || []);
      input.value = "";
    })
    .catch(function(err){
      console.error("[ETS] ERROR:", err);
    })
    .finally(function(){
      setLoading(false);
    });
  }

  // attach listeners
  button.addEventListener("click", handleSearchButtonClick);
  input.addEventListener("keydown", function(e){
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchButtonClick(e);
    }
  });

  console.log("[ETS] wired: prevent submit, autocomplete (US), click handler.");
}