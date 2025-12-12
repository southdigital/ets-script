function initETSNearest() {
  console.log("[ETS] initETSNearest start");

  // ---------- SELECTORS ----------
  const form       = document.getElementById("search-form-ets");
  const input      = document.getElementById("search-nearest-ets-location");
  const button     = form ? form.querySelector("#search-form-ets .w-button") : null; // scoped to form
  const resultsBox = document.querySelector(".locations-listing-main-box");
  const netlifyUrl = "https://etsperformance.netlify.app/.netlify/functions/nearest-locations";

  if (!form || !input || !button) {
    console.error("[ETS] Missing node(s)", { form: !!form, input: !!input, button: !!button });
    return;
  }
  console.log("[ETS] Nodes bound OK");

  // ---------- Prevent any form submit ----------
  form.addEventListener("submit", function(e){
    console.warn("[ETS] submit prevented");
    e.preventDefault();
    e.stopPropagation();
    return false;
  });
  form.setAttribute("action", "javascript:void(0)");
  form.setAttribute("novalidate", "novalidate");

  // ---------- Places Autocomplete (US only) ----------
  if (window.google && google.maps && google.maps.places) {
    new google.maps.places.Autocomplete(input, {
      types: ["geocode"],
      componentRestrictions: { country: "us" }
    });
    console.log("[ETS] Places Autocomplete initialized (US)");
  } else {
    console.error("[ETS] google.maps.places not available — check script tag & API key");
  }

  // ---------- Robust label helpers ----------
  const originalHTML = button.innerHTML; // preserves any spans/icons
  const originalValue = ("value" in button) ? button.value : null;
  const ORIGINAL_TEXT = (button.textContent || button.innerText || "Search").trim();

  function setBtnLabel(el, label) {
    // Handle input/anchor/button uniformly
    if ("value" in el) el.value = label;
    el.textContent = label;
    el.innerHTML = label; // override any inner spans that might hide text
    el.setAttribute("aria-busy", "true");
  }
  function restoreBtnLabel(el) {
    if ("value" in el && originalValue !== null) el.value = ORIGINAL_TEXT;
    el.innerHTML = originalHTML; // restore original structure (icons/spans)
    el.removeAttribute("aria-busy");
  }

  // ---------- Loading UI ----------
  let isLoading = false;
  function setLoading(on) {
    isLoading = !!on;
    if (on) {
      button.disabled = true;
      setBtnLabel(button, "Searching...");
      if (resultsBox) {
        resultsBox.style.transition = "opacity 180ms ease";
        resultsBox.style.opacity = "0.3";
      }
    } else {
      button.disabled = false;
      restoreBtnLabel(button);
      if (resultsBox) resultsBox.style.opacity = "1";
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
    const img = card.querySelector(".location-thumbnail-wrapper img.location-thumbnail");
    if (img && data.image) { img.src = data.image; img.srcset=""; img.sizes=""; img.alt = data.name || "Location"; }
    const h = card.querySelector("h3"); if (h) h.textContent = data.name || "";
    const distWrap = card.querySelector(".distance-in-miles-wrapper");
    if (distWrap){ distWrap.classList.remove("d-none"); const t=distWrap.querySelector(".text-size-regular"); if (t) t.textContent = data.distanceText || ""; }
    const etaWrap = card.querySelector(".estimated-drie-time-wrapper");
    if (etaWrap){
      if (data.durationText){ etaWrap.classList.remove("d-none"); const t2=etaWrap.querySelector(".text-size-regular"); if (t2) t2.textContent = data.durationText; }
      else { etaWrap.classList.add("d-none"); }
    }
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

  // ---------- Click handler (click-only; disable immediately) ----------
  async function handleClick(e){
    e.preventDefault();
    e.stopPropagation();
    if (isLoading) { console.log("[ETS] click ignored (in-flight)"); return; }

    setLoading(true); // disable + show Searching… immediately

    try {
      const query = (input.value || "").trim();
      if (!query) {
        console.warn("[ETS] Empty query");
        return; // finally {} will restore
      }

      const payload = { q: query, limit: 3 };
      console.log("[ETS] payload →", payload);

      const res = await fetch(netlifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      console.log("[ETS] status:", res.status);

      const j = await res.json();
      console.log("[ETS] body:", j);

      if (!res.ok) throw new Error(j && j.error ? j.error : "Search failed");

      applyResultsToDom(j.items || []);
      input.value = "";
    } catch (err) {
      console.error("[ETS] ERROR:", err);
    } finally {
      setLoading(false); // always restore label + enable
    }
  }

  // click-only mode
  button.addEventListener("click", handleClick);

  // ignore Enter entirely (click-only as requested)
  input.addEventListener("keydown", function(e){
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      console.log("[ETS] Enter ignored (click-only).");
    }
  });

  console.log("[ETS] wired: click-only, immediate disable, Searching… label.");
}


// Find nearest Locations on Load
(function(){
  const NETLIFY_URL = "https://etsperformance.netlify.app/.netlify/functions/nearest-locations";

  function boot(){
    console.log("[ETS-AUTO] boot() start", { readyState: document.readyState, href: location.href });

    if (!("geolocation" in navigator)) {
      console.warn("[ETS-AUTO] geolocation not supported");
      return;
    }

    // Secure context check (geolocation requires https)
    console.log("[ETS-AUTO] isSecureContext:", window.isSecureContext);

    setLoading(true);

    let finished = false;
    const watchdog = setTimeout(() => {
      if (!finished) {
        console.error("[ETS-AUTO] watchdog: geolocation callbacks never fired. Likely blocked / insecure context / OS location off.");
        setLoading(false);
      }
    }, 20000);

    console.log("[ETS-AUTO] calling getCurrentPosition…");

    navigator.geolocation.getCurrentPosition(
      async function onSuccess(pos){
        finished = true;
        clearTimeout(watchdog);

        console.log("[ETS-AUTO] geolocation success");
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        console.log("[ETS-AUTO] coords:", { lat, lng });

        try {
          console.log("[ETS-AUTO] fetch ->", NETLIFY_URL);

          const res = await fetch(NETLIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lng, limit: 3 })
          });

          console.log("[ETS-AUTO] fetch status:", res.status);

          const text = await res.text();
          console.log("[ETS-AUTO] raw body:", text);

          const data = JSON.parse(text);
          console.log("[ETS-AUTO] parsed body:", data);

          if (!res.ok) throw new Error(data?.error || "Nearest lookup failed");

          applyResultsToDom(data.items || []);
        } catch (err) {
          console.error("[ETS-AUTO] ERROR:", err);
        } finally {
          setLoading(false);
        }
      },
      function onError(err){
        finished = true;
        clearTimeout(watchdog);

        console.warn("[ETS-AUTO] geolocation error callback fired:", err);
        // err.code: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
        console.warn("[ETS-AUTO] error details:", {
          code: err && err.code,
          message: err && err.message
        });

        setLoading(false); // do nothing else
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 0
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  function setLoading(isLoading){
    const box = document.querySelector(".locations-listing-main-box");
    if (!box) return;
    box.style.transition = "opacity 180ms ease";
    box.style.opacity = isLoading ? "0.3" : "1";
  }

  function showEl(el){
    if (!el) return;
    el.classList.remove("d-none");
    el.removeAttribute("hidden");
    el.style.display = "";
  }
  function hideEl(el){
    if (!el) return;
    el.classList.add("d-none");
  }
  function ensureText(el, selector, text){
    if (!el) return;
    const t = el.querySelector(selector);
    if (t) t.textContent = text || "";
  }

  function applyResultsToDom(items){
    console.log("[ETS-AUTO] applyResultsToDom items:", items);

    const primary = document.querySelector(".top-location-card");
    const seconds = Array.from(document.querySelectorAll(".secondary-locations .location-content-sec"));

    if (primary && items[0]) patchCard(primary, items[0], true);
    if (seconds[0] && items[1]) patchCard(seconds[0], items[1], false);
    if (seconds[1] && items[2]) patchCard(seconds[1], items[2], false);
  }

  function patchCard(card, data, isPrimary){
    const h = card.querySelector("h3");
    if (h) h.textContent = data.name || "";

    const distWrap = card.querySelector(".distance-in-miles-wrapper");
    if (data.distanceText) { showEl(distWrap); ensureText(distWrap, ".text-size-regular", data.distanceText); }
    else { hideEl(distWrap); }

    const etaWrap = card.querySelector(".estimated-drie-time-wrapper");
    if (data.durationText) { showEl(etaWrap); ensureText(etaWrap, ".text-size-regular", data.durationText); }
    else { hideEl(etaWrap); }

    if (isPrimary) {
      const img = card.querySelector(".location-thumbnail-wrapper img.location-thumbnail");
      if (img && data.image) { img.src = data.image; img.srcset=""; img.sizes=""; img.alt = data.name || "Location"; }
      const btns = card.querySelectorAll(".button, .button-7");
      btns.forEach(a => {
        const label = (a.textContent || "").toLowerCase();
        if (label.includes("book")) a.href = data.bookUrl || "#";
        if (label.includes("detail")) a.href = data.detailsUrl || "#";
      });
    } else {
      const detailsBtn = card.querySelector(".button, .button-7");
      if (detailsBtn) detailsBtn.href = data.detailsUrl || "#";
    }
  }
})();