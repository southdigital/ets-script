(function () {
  // ============================================================
  // LOCATION FINDER POPUP (Scoped to .loc-finder-popup-wrapper)
  // No conflicts with other popups on the page.
  // ============================================================

  const ROOT_SELECTOR = ".loc-finder-popup-wrapper";

  // Search UI selectors (inside location finder popup)
  const FORM_SELECTOR = "#find-loc-form-popup";
  const INPUT_SELECTOR = "#user-city-popup";
  const SEARCH_BTN_SELECTOR = "a.primary-btn";
  const USE_CURRENT_SELECTOR = ".use-current-location-popup-btn";
  const LIST_CONTAINER_SELECTOR = ".secondary-locations.locations-popup .w-dyn-items";

  // Step toggles (inside location finder popup)
  const STEP1_SELECTOR = ".find-your-nearby-gym";
  const STEP2_SELECTOR = ".book-eval-popup.location-finder";
  const STEP3_SELECTOR = ".loc-finder-popup-wrapper .book-eval-calendar";

  // Book buttons inside rendered location cards (inside location finder popup)
  const BOOK_BTN_SELECTOR = ".locations-ets a.book-eval-loc-popup";

  // Iframes inside location finder popup (IMPORTANT: scoped via root)
  const BOOKING_IFRAME_SELECTOR = "#bookingFormIframe";
  const CAL_IFRAME_SELECTOR = "#calendarIframe";

  // API config
  const NETLIFY_URL =
    "https://etsperformance.netlify.app/.netlify/functions/nearest-locations";
  const LIMIT = 5;

  // --- waits for Google Places without relying on global callback ---
  function whenGooglePlacesReady(cb, opts) {
    opts = opts || {};
    const timeoutMs = opts.timeoutMs ?? 20000;
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
          "[LOC-FINDER] Google Places not ready in time. Check script load/key restrictions."
        );
      }
    }, intervalMs);
  }

  function boot() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    // Prevent double init (Webflow can re-run embeds)
    if (root.dataset.locFinderInit === "1") return;
    root.dataset.locFinderInit = "1";

    const form = root.querySelector(FORM_SELECTOR);
    const input = root.querySelector(INPUT_SELECTOR);
    const submitBtn = form ? form.querySelector(SEARCH_BTN_SELECTOR) : null;

    const useCurrentBtn = root.querySelector(USE_CURRENT_SELECTOR);
    const listContainer = root.querySelector(LIST_CONTAINER_SELECTOR);

    const step1 = root.querySelector(STEP1_SELECTOR);
    const step2 = root.querySelector(STEP2_SELECTOR);
    const step3 = root.querySelector(STEP3_SELECTOR);

    const bookingIframe = root.querySelector(BOOKING_IFRAME_SELECTOR);
    const calendarIframe = root.querySelector(CAL_IFRAME_SELECTOR);

    if (!form || !input || !submitBtn || !listContainer) {
      console.error("[LOC-FINDER] Missing required DOM nodes", {
        form: !!form,
        input: !!input,
        submitBtn: !!submitBtn,
        listContainer: !!listContainer,
      });
      return;
    }

    // Prevent native submit
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
    form.setAttribute("action", "javascript:void(0)");
    form.setAttribute("novalidate", "novalidate");

    // Loading UI
    let isLoading = false;
    const originalBtnText = (submitBtn.textContent || "").trim() || "Search";

    function setLoading(on) {
      isLoading = !!on;

      if (on) {
        submitBtn.classList.add("is-loading");
        submitBtn.setAttribute("aria-disabled", "true");
        submitBtn.style.pointerEvents = "none";
        submitBtn.textContent = "Searching...";
      } else {
        submitBtn.classList.remove("is-loading");
        submitBtn.removeAttribute("aria-disabled");
        submitBtn.style.pointerEvents = "";
        submitBtn.textContent = originalBtnText;
      }

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
      console.error("[LOC-FINDER] No template list item found in list container");
      return;
    }

    // Do NOT call API on autocomplete selection.
    // Only call API on Search click or Use current location click.
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
        empty.innerHTML =
          '<div class="text-size-regular text-color-inverse">No nearby locations found.</div>';
        listContainer.appendChild(empty);
        return;
      }

      slice.forEach((data) => {
        const node = templateItem.cloneNode(true);

        // Title
        const title = node.querySelector("h3");
        if (title) title.textContent = data?.name || "";

        // Address text
        const addressText = node.querySelector(".directions-link .text-size-regular");
        if (addressText) addressText.textContent = data?.address || data?.addressText || "";

        // Directions link
        const directionsLink = node.querySelector(".directions-link");
        if (directionsLink) {
          if (data?.lat != null && data?.lng != null) {
            directionsLink.href =
              "https://www.google.com/maps/dir/?api=1&destination=" +
              encodeURIComponent(data.lat + "," + data.lng);
          } else if (data?.address) {
            directionsLink.href =
              "https://www.google.com/maps/dir/?api=1&destination=" +
              encodeURIComponent(data.address);
          } else {
            directionsLink.href = "#";
          }
        }

        // Distance + time
        const distanceWrap = node.querySelector(".estimated-distance-in-miles");
        const distanceTextEl = node.querySelector(".distance-text");
        if (distanceTextEl) distanceTextEl.textContent = data?.distanceText || "";
        if (distanceWrap) distanceWrap.classList.remove("d-none");

        const driveWrap = node.querySelector(".estimated-drie-time-wrapper");
        const driveTextEl = node.querySelector(".estimated-drive-time-text");
        if (driveTextEl) driveTextEl.textContent = data?.durationText || "";
        if (driveWrap) driveWrap.classList.remove("d-none");

        // Book button + iframe fields
        const bookBtn = node.querySelector("a.book-eval-loc-popup") ||
          Array.from(node.querySelectorAll("a")).find((a) =>
            (a.textContent || "").toLowerCase().includes("book")
          );

        if (bookBtn) {
          bookBtn.href = data?.bookUrl || data?.bookingUrl || "#";
          bookBtn.setAttribute("data-booking-form-iframe-id", data?.bookingFormIframeId || "");
          bookBtn.setAttribute("data-calendar-iframe-id", data?.calendarIframeId || "");
          bookBtn.setAttribute("data-calendar-iframe-src", data?.calendarIframeSrc || "");
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

      // Coords search
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
          console.error("[LOC-FINDER] coord search error", err);
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
        console.error("[LOC-FINDER] text search error", err);
      } finally {
        setLoading(false);
      }
    }

    // Search click
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (pendingSelection.source === "text") pendingSelection.q = input.value;
      runSearchFromPending();
    });

    // Ignore Enter
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

    let currentLocInFlight = false;

    useCurrentBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (currentLocInFlight) return;
      currentLocInFlight = true;

      if (!navigator.geolocation) {
        currentLocInFlight = false;
        locationDeniedAlert();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            const okUS = await isUSLocation(lat, lng);
            if (!okUS) {
              alert(
                "Current location search is available for US locations only. Please enter a US ZIP code or city."
              );
              return;
            }

            pendingSelection = { source: "coords", q: "", lat, lng };
            await runSearchFromPending();
          } finally {
            currentLocInFlight = false;
          }
        },
        () => {
          currentLocInFlight = false;
          locationDeniedAlert();
        },
        { timeout: 15000, maximumAge: 0, enableHighAccuracy: false }
      );
    });

    // -----------------------------
    // Step helpers (scoped)
    // -----------------------------
    function showStep(step) {
      // Step1 visible by default, step2/3 hidden by d-none in your markup
      if (step1) step1.classList.toggle("d-none", step !== 1);
      if (step2) step2.classList.toggle("d-none", step !== 2);
      if (step3) step3.classList.toggle("d-none", step !== 3);
    }

    function embedBookingForm(formId) {
      if (!bookingIframe || !formId) return;

      const formSrc =
        "https://api.leadconnectorhq.com/widget/form/" + encodeURIComponent(formId);

      bookingIframe.src = formSrc;

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

    // -----------------------------
    // Book button click (scoped)
    // -----------------------------
    document.addEventListener("click", function (e) {
      const btn = e.target.closest(BOOK_BTN_SELECTOR);
      if (!btn) return;

      // Must be inside THIS popup root
      if (!root.contains(btn)) return;

      e.preventDefault();

      const formId = btn.getAttribute("data-booking-form-iframe-id") || "";
      const calId  = btn.getAttribute("data-calendar-iframe-id") || "";
      const calSrc = btn.getAttribute("data-calendar-iframe-src") || "";

      // Require at least formId + calSrc to proceed
      if (!formId || !calSrc) return;

      embedBookingForm(formId);
      embedCalendar(calSrc, calId);

      // Move to booking step
      showStep(2);
    });

    // -----------------------------
    // Submission tracking (scoped)
    // -----------------------------
    let fired = false;

    window.addEventListener("message", function (event) {
      const data = event.data;

      // Ignore iframe resizer chatter
      if (typeof data === "string" && data.startsWith("[iFrameSizer]")) return;

      // LeadConnector submission event
      if (Array.isArray(data) && data[0] === "set-sticky-contacts") {
        if (fired) return;

        // Only react if THIS popup's booking iframe is active
        if (!bookingIframe || !bookingIframe.src) return;

        fired = true;
        console.log("[LOC-FINDER] ✅ form submitted (scoped)");

        const popup = document.querySelector(".loc-finder-popup-wrapper");
        if (!popup) return;
        if (window.getComputedStyle(popup).display === "none") return;

        showStep(3);
      }
    });

    // If user returns to step 1, allow submission again later
    // (Optional but helps if popup is re-used without reload)
    const obs = new MutationObserver(() => {
      const step1Visible = step1 && !step1.classList.contains("d-none");
      if (step1Visible) fired = false;
    });
    if (step1) obs.observe(step1, { attributes: true, attributeFilter: ["class"] });

    console.log("[LOC-FINDER] ready");
  }

  function start() {
    whenGooglePlacesReady(boot, { timeoutMs: 20000, intervalMs: 100 });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();