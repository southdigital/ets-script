(function () {
  // ============================================================
  // LOCATION FINDER POPUP (Scoped to .loc-finder-popup-wrapper)
  // No conflicts with other popups on the page.
  // ============================================================

  const ROOT_SELECTOR = ".loc-finder-popup-wrapper";
  const DETAILS_BTN_SELECTOR = "a.link-location-popup";

  // Search UI selectors (inside location finder popup)
  const FORM_SELECTOR = "#find-loc-form-popup";
  const INPUT_SELECTOR = "#user-city-popup";
  const SEARCH_BTN_SELECTOR = ".primary-btn";
  const USE_CURRENT_SELECTOR = ".use-current-location-popup-btn";
  const LIST_CONTAINER_SELECTOR =
    ".secondary-locations.locations-popup .w-dyn-items";

  // Step toggles (inside location finder popup)
  const STEP1_SELECTOR = ".find-your-nearby-gym";
  const STEP2_SELECTOR = ".book-eval-popup.location-finder";
  const STEP3_SELECTOR = ".book-eval-calendar";

  // Book button class (no parent dependency — matched via closest in click handler)
  const BOOK_BTN_CLASS = ".book-eval-loc-popup";

  // Focusable selector used to pick a fallback focus target
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

  // API config
  const NETLIFY_URL =
    "https://etsperformance.netlify.app/.netlify/functions/nearest-locations";
  const LIMIT = 3;

  // --- waits for Google Places without relying on global callback ---
  function whenGooglePlacesReady(cb, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 20000;
    var intervalMs = opts.intervalMs != null ? opts.intervalMs : 100;

    var start = Date.now();
    var timer = setInterval(function () {
      var ready = !!(
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

  // --- Resolve an iframe by trying multiple IDs inside a root element ---
  function findIframe(root, ids) {
    for (var i = 0; i < ids.length; i++) {
      var el = root.querySelector("#" + ids[i]);
      if (el) return el;
    }
    for (var j = 0; j < ids.length; j++) {
      var el2 = document.querySelector("#" + ids[j]);
      if (el2) return el2;
    }
    return null;
  }

  // ============================================================
  // A11Y: Focus management helpers
  // ============================================================

  function findStepHeading(stepEl) {
    if (!stepEl) return null;

    var labelId = stepEl.getAttribute("aria-labelledby");
    if (labelId) {
      var labelled = document.getElementById(labelId);
      if (labelled) return labelled;
    }

    return stepEl.querySelector("h1, h2, h3, h4, h5, h6");
  }

  function getFocusable(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE)).filter(function (el) {
      if (el.closest(".d-none")) return false;
      if (el.offsetParent === null && el.tagName !== "IFRAME") return false;
      return true;
    });
  }

  // Move focus into a step — prefer heading, fall back to first focusable.
  // Uses requestAnimationFrame so focus happens *after* the browser has applied
  // the class change that reveals the step (otherwise .d-none blocks focus).
  function focusStep(stepEl) {
    if (!stepEl) return;

    requestAnimationFrame(function () {
      var heading = findStepHeading(stepEl);

      if (heading) {
        if (!heading.hasAttribute("tabindex")) {
          heading.setAttribute("tabindex", "-1");
        }
        try {
          heading.focus({ preventScroll: false });
          return;
        } catch (e) {}
      }

      var focusable = getFocusable(stepEl);
      if (focusable.length) {
        focusable[0].focus();
        return;
      }

      if (!stepEl.hasAttribute("tabindex")) {
        stepEl.setAttribute("tabindex", "-1");
      }
      try {
        stepEl.focus();
      } catch (e) {}
    });
  }

  function boot() {
    var root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    if (root.dataset.locFinderInit === "1") return;
    root.dataset.locFinderInit = "1";

    var form = root.querySelector(FORM_SELECTOR);
    var input = root.querySelector(INPUT_SELECTOR);
    var submitBtn = form ? form.querySelector(SEARCH_BTN_SELECTOR) : null;

    var useCurrentBtn = root.querySelector(USE_CURRENT_SELECTOR);
    var listContainer = root.querySelector(LIST_CONTAINER_SELECTOR);

    var step1 = root.querySelector(STEP1_SELECTOR);
    var step2 = root.querySelector(STEP2_SELECTOR);
    var step3 = root.querySelector(STEP3_SELECTOR);

    var bookingIframe = findIframe(root, [
      "bookingFormIframe",
      "bookingFormIframe-home",
    ]);
    var calendarIframe = findIframe(root, [
      "calendarIframe",
      "calendarIframe-home",
      "etscalendarIframe",
    ]);

    console.log("[LOC-FINDER] bookingIframe found:", !!bookingIframe, bookingIframe?.id);
    console.log("[LOC-FINDER] calendarIframe found:", !!calendarIframe, calendarIframe?.id);

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
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
    form.setAttribute("action", "javascript:void(0)");
    form.setAttribute("novalidate", "novalidate");

    var isLoading = false;
    var originalBtnText = (submitBtn.textContent || "").trim() || "Search";

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

    var templateItem =
      listContainer.querySelector(".w-dyn-item") ||
      listContainer.querySelector("[role='listitem']");

    if (!templateItem) {
      console.error("[LOC-FINDER] No template list item found in list container");
      return;
    }

    var templateClone = templateItem.cloneNode(true);

    var pendingSelection = {
      source: "text",
      q: "",
      lat: null,
      lng: null,
    };

    input.addEventListener("input", function () {
      pendingSelection = {
        source: "text",
        q: input.value,
        lat: null,
        lng: null,
      };
    });

    function renderLocations(items) {
      items = items || [];
      listContainer.innerHTML = "";

      var slice = items.slice(0, LIMIT);

      if (!slice.length) {
        var empty = document.createElement("div");
        empty.className = "w-dyn-empty";
        empty.innerHTML =
          '<div class="text-size-regular text-color-inverse">No nearby locations found.</div>';
        listContainer.appendChild(empty);
        return;
      }

      slice.forEach(function (data) {
        var node = templateClone.cloneNode(true);

        var title = node.querySelector("h3");
        if (title) title.textContent = data.name || "";

        var addressText = node.querySelector(
          ".directions-link .text-size-regular"
        );
        if (addressText)
          addressText.textContent = data.address || data.addressText || "";

        var directionsLink = node.querySelector(".directions-link");
        if (directionsLink) {
          if (data.lat != null && data.lng != null) {
            directionsLink.href =
              "https://www.google.com/maps/dir/?api=1&destination=" +
              encodeURIComponent(data.lat + "," + data.lng);
          } else if (data.address) {
            directionsLink.href =
              "https://www.google.com/maps/dir/?api=1&destination=" +
              encodeURIComponent(data.address);
          } else {
            directionsLink.href = "#";
          }
        }

        var distanceWrap = node.querySelector(".estimated-distance-in-miles");
        var distanceTextEl = node.querySelector(".distance-text");
        if (distanceTextEl)
          distanceTextEl.textContent = data.distanceText || "";
        if (distanceWrap) distanceWrap.classList.remove("d-none");

        var driveWrap = node.querySelector(".estimated-drie-time-wrapper");
        var driveTextEl = node.querySelector(".estimated-drive-time-text");
        if (driveTextEl) driveTextEl.textContent = data.durationText || "";
        if (driveWrap) driveWrap.classList.remove("d-none");

        var bookBtn =
          node.querySelector(BOOK_BTN_CLASS) ||
          Array.from(node.querySelectorAll("button")).find(function (el) {
            return (el.textContent || "").toLowerCase().includes("book");
          }) ||
          Array.from(node.querySelectorAll("a")).find(function (el) {
            return (el.textContent || "").toLowerCase().includes("book");
          });

        if (bookBtn) {
          bookBtn.setAttribute(
            "data-booking-form-iframe-id",
            data.calendarIframeId || ""
          );
          bookBtn.setAttribute(
            "data-calendar-iframe-id",
            data.bookingFormIframeId || ""
          );
          bookBtn.setAttribute(
            "data-calendar-iframe-src",
            data.calendarIframeSrc || ""
          );

          if (!data.calendarIframeId || !data.bookingFormIframeId) {
            bookBtn.classList.add("d-none");
          } else {
            bookBtn.classList.remove("d-none");
          }

          bookBtn.setAttribute("aria-label", "Book Evaluation - " + (data.name || ""));
        }

        var detailsBtn =
          node.querySelector(DETAILS_BTN_SELECTOR) ||
          Array.from(node.querySelectorAll("button")).find(function (el) {
            return (el.textContent || "").toLowerCase().includes("view details");
          }) ||
          Array.from(node.querySelectorAll("a")).find(function (el) {
            return (el.textContent || "").toLowerCase().includes("view details");
          });

        if (detailsBtn) {
          var detailsHref =
            data.detailsUrl || data.detailsHref || data.locationDetailsUrl || "";
          var slug = data.slug || data.locationSlug || "";
          var fallback = slug ? "/locations/" + slug : "#";

          detailsBtn.href = detailsHref || fallback;
          detailsBtn.setAttribute("aria-label", "View details of " + (data.name || ""));
        }

        listContainer.appendChild(node);
      });
    }

    async function fetchNearest(payload) {
      var res = await fetch(NETLIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      var json = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(json.error || "Request failed");
      return json.items || [];
    }

    async function runSearchFromPending() {
      if (isLoading) return;

      if (pendingSelection.source === "coords") {
        if (pendingSelection.lat == null || pendingSelection.lng == null) return;

        setLoading(true);
        try {
          var items = await fetchNearest({
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

      var query = (pendingSelection.q || input.value || "").trim();
      if (!query) return;

      setLoading(true);
      try {
        var items = await fetchNearest({ q: query, limit: LIMIT });
        renderLocations(items);
      } catch (err) {
        console.error("[LOC-FINDER] text search error", err);
      } finally {
        setLoading(false);
      }
    }

    submitBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      if (pendingSelection.source === "text")
        pendingSelection.q = input.value;
      runSearchFromPending();
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    var autocomplete = new google.maps.places.Autocomplete(input, {
      types: ["geocode"],
      componentRestrictions: { country: "us" },
    });

    autocomplete.addListener("place_changed", function () {
      var place = autocomplete.getPlace();
      var loc = place && place.geometry ? place.geometry.location : null;

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

    async function isUSLocation(lat, lng) {
      if (!(google && google.maps && google.maps.Geocoder)) return true;
      var geocoder = new google.maps.Geocoder();
      return new Promise(function (resolve) {
        geocoder.geocode(
          { location: { lat: lat, lng: lng } },
          function (results, status) {
            if (status !== "OK" || !results || !results[0]) return resolve(false);
            var country = (results[0].address_components || []).find(function (c) {
              return (c.types || []).includes("country");
            });
            resolve(((country && country.short_name) || "").toUpperCase() === "US");
          }
        );
      });
    }

    var currentLocInFlight = false;

    function triggerCurrentLocation() {
      if (currentLocInFlight) return;
      currentLocInFlight = true;

      if (!navigator.geolocation) {
        currentLocInFlight = false;
        locationDeniedAlert();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async function (pos) {
          try {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;

            var okUS = await isUSLocation(lat, lng);
            if (!okUS) {
              alert(
                "Current location search is available for US locations only. Please enter a US ZIP code or city."
              );
              return;
            }

            pendingSelection = {
              source: "coords",
              q: "",
              lat: lat,
              lng: lng,
            };
            await runSearchFromPending();
          } finally {
            currentLocInFlight = false;
          }
        },
        function () {
          currentLocInFlight = false;
          locationDeniedAlert();
        },
        { timeout: 15000, maximumAge: 0, enableHighAccuracy: false }
      );
    }

    if (useCurrentBtn) {
      useCurrentBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        triggerCurrentLocation();
      });

      // A11Y: Keyboard support for the role="button" div
      useCurrentBtn.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          triggerCurrentLocation();
        }
      });
    }

    // -----------------------------------------
    // Step helpers
    // A11Y: After toggling visibility, move focus into the newly visible step
    // so screen reader users hear the new context and keyboard users continue
    // their flow there.
    // -----------------------------------------
    function showStep(step) {
      if (step1) step1.classList.toggle("d-none", step !== 1);
      if (step2) step2.classList.toggle("d-none", step !== 2);
      if (step3) step3.classList.toggle("d-none", step !== 3);

      var active = step === 1 ? step1 : step === 2 ? step2 : step3;
      focusStep(active);
    }

    function embedBookingForm(formId) {
      if (!bookingIframe || !formId) {
        console.warn("[LOC-FINDER] embedBookingForm skipped — missing iframe or formId", {
          iframe: !!bookingIframe,
          formId: formId,
        });
        return;
      }

      var formSrc =
        "https://api.leadconnectorhq.com/widget/form/" +
        encodeURIComponent(formId);

      console.log("[LOC-FINDER] Setting bookingIframe.src:", formSrc);

      bookingIframe.src = formSrc;

      var inlineId = "inline-" + formId;
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
      if (!calendarIframe || !calSrc) {
        console.warn("[LOC-FINDER] embedCalendar skipped — missing iframe or calSrc", {
          iframe: !!calendarIframe,
          calSrc: calSrc,
        });
        return;
      }

      console.log("[LOC-FINDER] Setting calendarIframe.src:", calSrc);

      calendarIframe.src = calSrc;
      if (calId) calendarIframe.id = calId;
    }

    // Book button click (delegated, scoped)
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(BOOK_BTN_CLASS);
      if (!btn) return;

      var btnRoot = btn.closest(ROOT_SELECTOR);
      if (!btnRoot) return;

      e.preventDefault();

      var formId = btn.getAttribute("data-booking-form-iframe-id") || "";
      var calId = btn.getAttribute("data-calendar-iframe-id") || "";
      var calSrc = btn.getAttribute("data-calendar-iframe-src") || "";

      console.log("[LOC-FINDER] Book btn clicked:", { formId: formId, calId: calId, calSrc: calSrc });

      if (!formId || !calSrc) {
        console.warn("[LOC-FINDER] Missing formId or calSrc — cannot embed", {
          formId: formId,
          calSrc: calSrc,
        });
        return;
      }

      embedBookingForm(formId);
      embedCalendar(calSrc, calId);

      showStep(2);
    });

    // Submission tracking (LeadConnector)
    var fired = false;

    window.addEventListener("message", function (event) {
      var data = event.data;

      if (typeof data === "string" && data.startsWith("[iFrameSizer]")) return;

      if (Array.isArray(data) && data[0] === "set-sticky-contacts") {
        if (fired) return;
        if (!bookingIframe || !bookingIframe.src) return;

        fired = true;
        console.log("[LOC-FINDER] form submitted");

        var popup = document.querySelector(ROOT_SELECTOR);
        if (!popup) return;
        if (window.getComputedStyle(popup).display === "none") return;

        showStep(3);
      }
    });

    if (step1) {
      var obs = new MutationObserver(function () {
        var step1Visible = !step1.classList.contains("d-none");
        if (step1Visible) fired = false;
      });
      obs.observe(step1, { attributes: true, attributeFilter: ["class"] });
    }

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

// ============================================================
// Go Back Button — handles click AND keyboard (Enter/Space)
// A11Y: The back button is a role="button" div, not a native <button>,
// so it needs explicit keyboard handling. Also moves focus to step 1's
// heading so screen reader users know they've returned.
// ============================================================
document.addEventListener("DOMContentLoaded", function () {
  var BACK_BTN_SELECTOR = ".go-backto-loc-listings";
  var FOCUSABLE_FALLBACK =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

  function focusStepHeading(stepEl) {
    if (!stepEl) return;

    requestAnimationFrame(function () {
      var labelId = stepEl.getAttribute("aria-labelledby");
      var target = null;

      if (labelId) {
        target = document.getElementById(labelId);
      }
      if (!target) {
        target = stepEl.querySelector("h1, h2, h3, h4, h5, h6");
      }

      if (target) {
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
        }
        try {
          target.focus({ preventScroll: false });
          return;
        } catch (e) {}
      }

      var focusable = Array.from(stepEl.querySelectorAll(FOCUSABLE_FALLBACK)).filter(
        function (el) {
          if (el.closest(".d-none")) return false;
          if (el.offsetParent === null && el.tagName !== "IFRAME") return false;
          return true;
        }
      );
      if (focusable.length) focusable[0].focus();
    });
  }

  function handleGoBack(backBtn) {
    var root = backBtn.closest(".loc-finder-popup-wrapper");
    if (!root) return;

    var step1 = root.querySelector(".find-your-nearby-gym");
    var step2 = root.querySelector(".book-eval-popup.location-finder");

    if (step1) step1.classList.remove("d-none");
    if (step2) step2.classList.add("d-none");

    focusStepHeading(step1);
  }

  // Click handler
  document.addEventListener("click", function (e) {
    var backBtn = e.target.closest(BACK_BTN_SELECTOR);
    if (!backBtn) return;

    e.preventDefault();
    handleGoBack(backBtn);
  });

  // A11Y: Keyboard handler — Enter/Space on a role="button" div
  // Must run in capture phase to beat the global popup script's close handler
  // which also listens for Enter/Space on elements matching .close-popup-loc-finder
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;

    var backBtn = e.target.closest(BACK_BTN_SELECTOR);
    if (!backBtn) return;

    e.preventDefault();
    e.stopPropagation();
    handleGoBack(backBtn);
  }, true); // capture = true
});