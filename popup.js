(function () {
  // --- NEW CODE ONLY: waits for Google Places without touching existing callback ---
  function whenGooglePlacesReady(cb, opts) {
    opts = opts || {};
    const timeoutMs = opts.timeoutMs ?? 15000;
    const intervalMs = opts.intervalMs ?? 100;

    const start = Date.now();
    const timer = setInterval(() => {
      const ready = !!(window.google && google.maps && google.maps.places && google.maps.places.Autocomplete);
      if (ready) {
        clearInterval(timer);
        cb();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        console.error("[ETS-POPUP] Google Places not ready within timeout. Check script load / key restrictions.");
      }
    }, intervalMs);
  }

  // --- Your popup init (wrapped) ---
  function initETSPopupNearest() {
    console.log("[ETS-POPUP] init");

    const NETLIFY_URL = "https://etsperformance.netlify.app/.netlify/functions/nearest-locations";
    const LIMIT = 5;

    const form = document.getElementById("find-loc-form-popup");
    const input = document.getElementById("user-city-popup");
    const submitBtn = form?.querySelector('input[type="submit"], .w-button');
    const useCurrentBtn = document.querySelector(".use-current-location-popup-btn");
    const listContainer = document.querySelector(".secondary-locations.locations-popup .w-dyn-items");

    if (!form || !input || !submitBtn || !listContainer) {
      console.error("[ETS-POPUP] Missing required DOM nodes", {
        form: !!form, input: !!input, submitBtn: !!submitBtn, listContainer: !!listContainer
      });
      return;
    }

    // Prevent form submit
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
    form.setAttribute("action", "javascript:void(0)");
    form.setAttribute("novalidate", "novalidate");

    // Loading UI
    let isLoading = false;
    const originalBtnText = ("value" in submitBtn && submitBtn.value) ? submitBtn.value : "Search";

    function setLoading(on) {
      isLoading = !!on;
      submitBtn.disabled = on;
      if ("value" in submitBtn) submitBtn.value = on ? "Searching..." : originalBtnText;
      listContainer.style.opacity = on ? "0.35" : "1";
      listContainer.style.transition = "opacity 180ms ease";
    }

    function locationDeniedAlert() {
      alert("We can't access your location, please type your zipcode or city.");
    }

    // Template item cloning (keeps Webflow structure)
    const templateItem = listContainer.querySelector(".w-dyn-item") || listContainer.querySelector("[role='listitem']");
    if (!templateItem) {
      console.error("[ETS-POPUP] No template list item found in list container");
      return;
    }

    function renderLocations(items = []) {
      listContainer.innerHTML = "";

      const slice = items.slice(0, LIMIT);
      if (!slice.length) {
        const empty = document.createElement("div");
        empty.className = "w-dyn-empty";
        empty.innerHTML = `<div class="text-size-regular text-color-inverse">No nearby locations found.</div>`;
        listContainer.appendChild(empty);
        return;
      }

      slice.forEach((data) => {
        const node = templateItem.cloneNode(true);

        const title = node.querySelector("h3");
        if (title) title.textContent = data?.name || "";

        const addressText = node.querySelector(".directions-link .text-size-regular");
        if (addressText) addressText.textContent = data?.address || data?.addressText || "";

        const directionsLink = node.querySelector(".directions-link");
        if (directionsLink) {
          if (data?.lat != null && data?.lng != null) {
            directionsLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
              data.lat + "," + data.lng
            )}`;
          } else if (data?.address) {
            directionsLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.address)}`;
          } else {
            directionsLink.href = "#";
          }
        }

        const bookBtn = Array.from(node.querySelectorAll("a")).find((a) =>
          (a.textContent || "").toLowerCase().includes("book")
        );
        if (bookBtn) bookBtn.href = data?.bookUrl || data?.bookingUrl || "#";

        listContainer.appendChild(node);
      });
    }

    async function fetchNearest(payload) {
      const res = await fetch(NETLIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Request failed");
      return json.items || [];
    }

    async function searchByText(q) {
      const query = (q || "").trim();
      if (!query || isLoading) return;
      setLoading(true);
      try {
        const items = await fetchNearest({ q: query, limit: LIMIT });
        renderLocations(items);
      } catch (err) {
        console.error("[ETS-POPUP] text search error", err);
      } finally {
        setLoading(false);
      }
    }

    async function searchByCoords(lat, lng) {
      setLoading(true);
      try {
        const items = await fetchNearest({ lat, lng, limit: LIMIT });
        renderLocations(items);
      } catch (err) {
        console.error("[ETS-POPUP] coord search error", err);
      } finally {
        setLoading(false);
      }
    }

    // Search button
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      searchByText(input.value);
    });

    // Ignore Enter if desired
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Google Places Autocomplete (US only)
    const autocomplete = new google.maps.places.Autocomplete(input, {
      types: ["geocode"],
      componentRestrictions: { country: "us" }
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      const loc = place?.geometry?.location;
      if (loc) {
        searchByCoords(loc.lat(), loc.lng());
      } else {
        searchByText(input.value);
      }
    });

    // US-only check for current location
    async function isUSLocation(lat, lng) {
      // With Google loaded, we can safely geocode
      if (!google?.maps?.Geocoder) return true;
      const geocoder = new google.maps.Geocoder();
      return new Promise((resolve) => {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          if (status !== "OK" || !results?.[0]) return resolve(false);
          const country = results[0].address_components?.find((c) => (c.types || []).includes("country"));
          resolve((country?.short_name || "").toUpperCase() === "US");
        });
      });
    }

    // Use current location click
    useCurrentBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!navigator.geolocation) {
        locationDeniedAlert();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          const okUS = await isUSLocation(lat, lng);
          if (!okUS) {
            alert("Current location search is available for US locations only. Please enter a US ZIP code or city.");
            return;
          }

          searchByCoords(lat, lng);
        },
        () => locationDeniedAlert(),
        { timeout: 15000, maximumAge: 0, enableHighAccuracy: false }
      );
    });

    console.log("[ETS-POPUP] ready");
  }

  // Prevent double init (in case Webflow swaps content / code runs twice)
  let didInit = false;

  function safeInit() {
    if (didInit) return;
    didInit = true;
    initETSPopupNearest();
  }

  // Run after DOM is ready AND Places is ready
  function boot() {
    whenGooglePlacesReady(safeInit, { timeoutMs: 20000, intervalMs: 100 });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
