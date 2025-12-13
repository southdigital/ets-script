(function () {
  // --- NEW CODE ONLY: waits for Google Places without touching existing callback ---
  function whenGooglePlacesReady(cb, opts) {
    opts = opts || {};
    const timeoutMs = opts.timeoutMs ?? 15000;
    const intervalMs = opts.intervalMs ?? 100;

    const start = Date.now();
    const timer = setInterval(() => {
      const ready = !!(
        window.google &&
        google.maps &&
        google.maps.places &&
        google.maps.places.Autocomplete
      );
      if (ready) {
        clearInterval(timer);
        cb();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        console.error(
          "[ETS-POPUP] Google Places not ready within timeout. Check script load / key restrictions."
        );
      }
    }, intervalMs);
  }

  // --- Your popup init (wrapped) ---
  window.initETSPopupNearest = function () {
    console.log("[ETS-POPUP] init");

    const NETLIFY_URL =
      "https://etsperformance.netlify.app/.netlify/functions/nearest-locations";
    const LIMIT = 5;

    const form = document.getElementById("find-loc-form-popup");
    const input = document.getElementById("user-city-popup");
    const submitBtn = form?.querySelector('a.primary-btn');
    const useCurrentBtn = document.querySelector(
      ".use-current-location-popup-btn"
    );
    const listContainer = document.querySelector(
      ".secondary-locations.locations-popup .w-dyn-items"
    );

    if (!form || !input || !submitBtn || !listContainer) {
      console.error("[ETS-POPUP] Missing required DOM nodes", {
        form: !!form,
        input: !!input,
        submitBtn: !!submitBtn,
        listContainer: !!listContainer,
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
    const originalBtnText =
      "value" in submitBtn && submitBtn.value ? submitBtn.value : "Search";

    function setLoading(on) {
      isLoading = !!on;
      submitBtn.disabled = on;
      if ("value" in submitBtn)
        submitBtn.value = on ? "Searching..." : originalBtnText;
      listContainer.style.opacity = on ? "0.35" : "1";
      listContainer.style.transition = "opacity 180ms ease";
    }

    function locationDeniedAlert() {
      alert("We can't access your location, please type your zipcode or city.");
    }

    // Template item cloning (keeps Webflow structure)
    const templateItem =
      listContainer.querySelector(".w-dyn-item") ||
      listContainer.querySelector("[role='listitem']");
    if (!templateItem) {
      console.error("[ETS-POPUP] No template list item found in list container");
      return;
    }

    // ----------------------------
    // IMPORTANT CHANGE:
    // Do NOT call API on autocomplete selection.
    // Only call API on Search button click (or Use current location click).
    // We'll store a pending selection here:
    // ----------------------------
    let pendingSelection = {
      source: "text", // "text" | "coords"
      q: "",
      lat: null,
      lng: null,
    };

    // If user types after selecting a place, treat as text again
    input.addEventListener("input", () => {
      pendingSelection = {
        source: "text",
        q: input.value,
        lat: null,
        lng: null,
      };
    });

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

        // Title
        const title = node.querySelector("h3");
        if (title) title.textContent = data?.name || "";

        // Address text
        const addressText = node.querySelector(
          ".directions-link .text-size-regular"
        );
        if (addressText)
          addressText.textContent = data?.address || data?.addressText || "";

        // Directions link
        const directionsLink = node.querySelector(".directions-link");
        if (directionsLink) {
          if (data?.lat != null && data?.lng != null) {
            directionsLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
              data.lat + "," + data.lng
            )}`;
          } else if (data?.address) {
            directionsLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
              data.address
            )}`;
          } else {
            directionsLink.href = "#";
          }
        }

        // Distance + time (remove d-none and fill text)
        const distanceWrap = node.querySelector(".estimated-distance-in-miles");
        const distanceTextEl = node.querySelector(".distance-text");
        if (distanceTextEl) distanceTextEl.textContent = data?.distanceText || "";
        if (distanceWrap) distanceWrap.classList.remove("d-none");

        const driveWrap = node.querySelector(".estimated-drie-time-wrapper");
        const driveTextEl = node.querySelector(".estimated-drive-time-text");
        if (driveTextEl) driveTextEl.textContent = data?.durationText || "";
        if (driveWrap) driveWrap.classList.remove("d-none");

        // Book button (keep existing behavior + add new data attributes)
        const bookBtn = Array.from(node.querySelectorAll("a")).find((a) =>
          (a.textContent || "").toLowerCase().includes("book")
        );

        if (bookBtn) {
          // Keep href if you still want it (optional)
          bookBtn.href = data?.bookUrl || data?.bookingUrl || "#";

          // NEW: attach iframe fields from API response
          // (API returns: bookingFormIframeId, calendarIframeId, calendarIframeSrc)
          bookBtn.setAttribute(
            "data-booking-form-iframe-id",
            data?.bookingFormIframeId || ""
          );
          bookBtn.setAttribute(
            "data-calendar-iframe-id",
            data?.calendarIframeId || ""
          );
          bookBtn.setAttribute(
            "data-calendar-iframe-src",
            data?.calendarIframeSrc || ""
          );
        }

        listContainer.appendChild(node);
      });
    }

    async function fetchNearest(payload) {
      const res = await fetch(NETLIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Request failed");
      return json.items || [];
    }

    async function runSearchFromPending() {
      if (isLoading) return;

      // Only run from button click (or current location click)
      if (pendingSelection.source === "coords") {
        if (pendingSelection.lat == null || pendingSelection.lng == null) return;
        setLoading(true);
        try {
          const items = await fetchNearest({
            lat: pendingSelection.lat,
            lng: pendingSelection.lng,
            limit: LIMIT,
          });
          renderLocations(items);
        } catch (err) {
          console.error("[ETS-POPUP] coord search error", err);
        } finally {
          setLoading(false);
        }
        return;
      }

      // Text search
      const query = (pendingSelection.q || input.value || "").trim();
      if (!query) return;

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

    // Search button (ONLY place we call API for typed/selected address)
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Ensure pending text mirrors input if user never triggered input event
      if (pendingSelection.source === "text") pendingSelection.q = input.value;
      runSearchFromPending();
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
      componentRestrictions: { country: "us" },
    });

    // IMPORTANT CHANGE:
    // Do NOT call API here. Just store the coords for later.
    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      const loc = place?.geometry?.location;

      if (loc) {
        pendingSelection = {
          source: "coords",
          q: input.value,
          lat: loc.lat(),
          lng: loc.lng(),
        };
      } else {
        pendingSelection = {
          source: "text",
          q: input.value,
          lat: null,
          lng: null,
        };
      }
    });

    // US-only check for current location
    async function isUSLocation(lat, lng) {
      if (!google?.maps?.Geocoder) return true;
      const geocoder = new google.maps.Geocoder();
      return new Promise((resolve) => {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          if (status !== "OK" || !results?.[0]) return resolve(false);
          const country = results[0].address_components?.find((c) =>
            (c.types || []).includes("country")
          );
          resolve((country?.short_name || "").toUpperCase() === "US");
        });
      });
    }

    // Use current location click (still allowed to call API immediately)
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
            alert(
              "Current location search is available for US locations only. Please enter a US ZIP code or city."
            );
            return;
          }

          // Set pending coords and run immediately
          pendingSelection = { source: "coords", q: "", lat, lng };
          runSearchFromPending();
        },
        () => locationDeniedAlert(),
        { timeout: 15000, maximumAge: 0, enableHighAccuracy: false }
      );
    });

    console.log("[ETS-POPUP] ready");
  };

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


  (function () {
    // Root wrapper for the whole location finder popup
    const ROOT_SELECTOR = ".loc-finder-popup-wrapper";

    // Step wrappers you want to toggle
    const STEP1_SELECTOR = ".find-your-nearby-gym";
    const STEP2_SELECTOR = ".book-eval-popup.location-finder"; // form step
    const STEP3_SELECTOR = ".book-eval-calendar"; // calendar step (optional)

    // Buttons (the ones inside each location card)
    const BOOK_BTN_SELECTOR = ".locations-ets a.primary-btn";

    // Iframes in your DOM
    const BOOKING_IFRAME_ID = "bookingFormIframe";
    const CAL_IFRAME_ID = "calendarIframe";

    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    const step1 = root.querySelector(STEP1_SELECTOR);
    const step2 = root.querySelector(STEP2_SELECTOR);
    const step3 = root.querySelector(STEP3_SELECTOR);

    const bookingIframe = root.querySelector("#" + BOOKING_IFRAME_ID);
    const calendarIframe = root.querySelector("#" + CAL_IFRAME_ID);

    function showStep2HideStep1() {
      if (step1) step1.classList.add("d-none");
      if (step2) step2.classList.remove("d-none");
      // Leave step3 hidden unless you explicitly show it later
    }

    function embedBookingForm(formId) {
      if (!bookingIframe || !formId) return;

      // LeadConnector form widget src
      const formSrc = "https://api.leadconnectorhq.com/widget/form/" + encodeURIComponent(formId);

      bookingIframe.src = formSrc;

      // These attributes help the form_embed.js widget initialize consistently
      const inlineId = "inline-" + formId;
      bookingIframe.id = inlineId;

      bookingIframe.setAttribute("data-layout", "{'id':'INLINE'}");
      bookingIframe.setAttribute("data-trigger-type", "alwaysShow");
      bookingIframe.setAttribute("data-activation-type", "alwaysActivated");
      bookingIframe.setAttribute("data-deactivation-type", "neverDeactivate");
      bookingIframe.setAttribute("data-layout-iframe-id", inlineId);
      bookingIframe.setAttribute("data-form-id", formId);
      bookingIframe.setAttribute("title", "Evaluation Form");
    }

    function embedCalendar(calSrc, calId) {
      if (!calendarIframe || !calSrc) return;

      calendarIframe.src = calSrc;
      if (calId) calendarIframe.id = calId;
    }

    // Click on "Book eval" inside location cards
    document.addEventListener("click", function (e) {
      const btn = e.target.closest(BOOK_BTN_SELECTOR);
      if (!btn) return;

      // Ensure it's part of THIS popup instance (important if you have multiple on page)
      if (!root.contains(btn)) return;

      e.preventDefault();

      const formId = btn.getAttribute("data-booking-form-iframe-id") || "";
      const calId  = btn.getAttribute("data-calendar-iframe-id") || "";
      const calSrc = btn.getAttribute("data-calendar-iframe-src") || "";

      // Embed iframes
      embedBookingForm(formId);
      embedCalendar(calSrc, calId);

      // Toggle UI: hide step 1, show step 2
      showStep2HideStep1();
    });
  })();