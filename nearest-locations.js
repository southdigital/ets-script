function initETSNearest() {
  console.log("[ETS] initETSNearest called");

  // --- SELECTORS (this page) ---
  const searchInput = document.getElementById("search-nearest-ets-location"); // your input id on this page
  const searchForm  = document.getElementById("email-form");                  // same id you shared
  const searchButton = document.querySelector("#email-form .w-button");       // the Webflow button inside the form
  const resultsBox  = document.querySelector(".locations-listing-main-box");  // fade during search

  if (!searchInput || !searchForm || !searchButton) {
    console.error("[ETS] Missing nodes", { searchInput: !!searchInput, searchForm: !!searchForm, searchButton: !!searchButton });
    return;
  }

  // --- HARD-STOP SUBMISSION (match your working approach, but tougher) ---
  // 1) prevent submit (capture) so Webflow can't intercept
  searchForm.addEventListener("submit", function(e) {
    console.warn("[ETS] submit prevented (capture)");
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  }, true);

  // 2) prevent submit (bubble) as well
  searchForm.addEventListener("submit", function(e) {
    console.warn("[ETS] submit prevented (bubble)");
    e.preventDefault();
    e.stopPropagation();
    return false;
  });

  // 3) kill default action just in case
  searchForm.setAttribute("action", "javascript:void(0)");
  searchForm.setAttribute("novalidate", "novalidate");

  // 4) if the submit is actually an <input type="submit">, convert it to a plain button (no submit semantics)
  if (searchButton.tagName === "INPUT" && searchButton.type.toLowerCase() === "submit") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = searchButton.className;
    btn.textContent = searchButton.value || "Search";
    searchButton.parentNode.replaceChild(btn, searchButton);
    console.log("[ETS] Converted input[type=submit] → <button type=button>");
  }
  // re-query (in case we replaced it)
  const searchBtn = document.querySelector("#email-form .w-button");

  // --- Places Autocomplete (US-only), like your working code ---
  let autocomplete = null;
  if (searchInput && google.maps && google.maps.places) {
    autocomplete = new google.maps.places.Autocomplete(searchInput, {
      types: ["geocode"],
      componentRestrictions: { country: "us" }
    });
    console.log("[ETS] Places Autocomplete initialized (US-only).");
    // We trigger the API call on click, not on place_changed (matching your pattern)
  } else {
    console.error("[ETS] google.maps.places not available—check script tag & key.");
  }

  // --- Netlify endpoint config ---
  const NETLIFY_FN = "/.netlify/functions/nearest-locations"; // full URL if cross-origin

  // --- UI helpers ---
  const originalBtnText = (searchBtn && (searchBtn.textContent || searchBtn.value)) || "Search";
  function setLoading(isLoading) {
    if (!searchBtn || !resultsBox) return;
    if (isLoading) {
      if ("value" in searchBtn) searchBtn.value = "Searching...";
      searchBtn.textContent = "Searching...";
      searchBtn.disabled = true;
      resultsBox.style.transition = "opacity 180ms ease";
      resultsBox.style.opacity = "0.3";
    } else {
      if ("value" in searchBtn) searchBtn.value = originalBtnText;
      searchBtn.textContent = originalBtnText;
      searchBtn.disabled = false;
      resultsBox.style.opacity = "1";
    }
  }

  // --- Card patchers (same shape as server returns) ---
  function applyResultsToDom(items) {
    console.log("[ETS] applyResultsToDom", items);

    const primary = document.querySelector(".top-location-card");
    const seconds = Array.prototype.slice.call(document.querySelectorAll(".secondary-locations .location-content-sec"));

    if (primary && items[0]) updatePrimaryCard(primary, items[0]);
    if (seconds[0] && items[1]) updateSecondaryCard(seconds[0], items[1]);
    if (seconds[1] && items[2]) updateSecondaryCard(seconds[1], items[2]);
  }

  function updatePrimaryCard(card, data) {
    // image
    const img = card.querySelector(".location-thumbnail-wrapper img.location-thumbnail");
    if (img && data.image) { img.src = data.image; img.srcset = ""; img.sizes = ""; img.alt = data.name || "Location"; }
    // title
    const h = card.querySelector("h3"); if (h) h.textContent = data.name || "";
    // distance
    const distWrap = card.querySelector(".distance-in-miles-wrapper");
    if (distWrap) { distWrap.classList.remove("d-none"); const t = distWrap.querySelector(".text-size-regular"); if (t) t.textContent = data.distanceText || ""; }
    // ETA
    const etaWrap = card.querySelector(".estimated-drie-time-wrapper");
    if (etaWrap) {
      if (data.durationText) { etaWrap.classList.remove("d-none"); const t2 = etaWrap.querySelector(".text-size-regular"); if (t2) t2.textContent = data.durationText; }
      else { etaWrap.classList.add("d-none"); }
    }
    // buttons
    const btns = Array.prototype.slice.call(card.querySelectorAll(".button"));
    btns.forEach(function(a){
      const label = (a.textContent || "").toLowerCase();
      if (label.indexOf("book") > -1)   a.href = data.bookUrl || "#";
      if (label.indexOf("detail") > -1) a.href = data.detailsUrl || "#";
    });
  }

  function updateSecondaryCard(card, data) {
    const h = card.querySelector("h3"); if (h) h.textContent = data.name || "";
    const distWrap = card.querySelector(".distance-in-miles-wrapper");
    if (distWrap) { distWrap.classList.remove("d-none"); const t = distWrap.querySelector(".text-size-regular"); if (t) t.textContent = data.distanceText || ""; }
    const etaWrap = card.querySelector(".estimated-drie-time-wrapper");
    if (etaWrap) {
      if (data.durationText) { etaWrap.classList.remove("d-none"); const t2 = etaWrap.querySelector(".text-size-regular"); if (t2) t2.textContent = data.durationText; }
      else { etaWrap.classList.add("d-none"); }
    }
    const detailsBtn = card.querySelector(".button"); if (detailsBtn) detailsBtn.href = data.detailsUrl || "#";
  }

  // --- Click handler (your pattern, but calls Netlify) ---
  function handleSearchButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!searchInput) return;

    const query = searchInput.value.trim();
    if (!query) { console.warn("[ETS] Empty search"); return; }

    const payload = { q: query, limit: 3 };
    console.log("[ETS] payload →", payload);

    setLoading(true);
    fetch(NETLIFY_FN, {
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
      searchInput.value = "";
    })
    .catch(function(err){
      console.error("[ETS] ERROR:", err);
    })
    .finally(function(){
      setLoading(false);
    });
  }

  // Attach listeners (exactly like your working code)
  if (searchForm) {
    searchForm.addEventListener("submit", function(e){
      e.preventDefault();
      return false;
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener("click", handleSearchButtonClick);
  }

  if (searchInput) {
    searchInput.addEventListener("keydown", function(e){
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearchButtonClick(e);
      }
    });
  }

  console.log("[ETS] wired: prevent submit, autocomplete, click handler.");
}