function initETSNearest() {
  console.log("[ETS] Google Maps loaded, initializing…");

  // Run after Webflow finished wiring up forms
  (window.Webflow = window.Webflow || []).push(function () {
    console.log("[ETS] Webflow ready. Preparing DOM…");

    document.addEventListener("DOMContentLoaded", function () {
      console.log("[ETS] DOMContentLoaded fired.");

      // ===== CONFIG =====
      var NETLIFY_FN = "/.netlify/functions/nearest-locations"; // adjust if needed
      var USE_US_ONLY = true;

      // ===== SELECTORS / ELEMENTS =====
      var form = document.getElementById("email-form");
      var input = document.getElementById("search-nearest-ets-location");
      var container = document.querySelector(".locations-listing-main-box");
      var closestTrigger = document.querySelector(".view-all-lovcations");

      if (!form || !input || !container) {
        console.error("[ETS] Missing key elements:", { form: !!form, input: !!input, container: !!container });
        return;
      }
      console.log("[ETS] Elements found.");

      // 1) Kill Webflow handlers by cloning & replacing the form
      var formParent = form.parentNode;
      var fresh = form.cloneNode(true); // deep clone keeps inner markup
      formParent.replaceChild(fresh, form);
      form = fresh;
      form.setAttribute("data-wf-ignore", "true");      // tell Webflow to leave it alone
      form.setAttribute("action", "javascript:void(0)"); // neuter HTML submit
      form.setAttribute("method", "dialog");             // (non-submitting method for good measure)
      form.setAttribute("novalidate", "novalidate");
      console.log("[ETS] Replaced form node to remove Webflow bindings.");

      // 2) Convert submit input to a plain button (no submit semantics)
      var submitBtn = form.querySelector('input[type="submit"], button[type="submit"], .w-button');
      if (!submitBtn) {
        console.error("[ETS] Submit button not found inside form.");
        return;
      }
      if (submitBtn.tagName === "INPUT" && submitBtn.type.toLowerCase() === "submit") {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = submitBtn.className;
        btn.textContent = submitBtn.value || "Search";
        submitBtn.parentNode.replaceChild(btn, submitBtn);
        submitBtn = btn;
        console.log("[ETS] Converted input[type=submit] → <button type=button>.");
      } else {
        // ensure it's not submit
        submitBtn.type = "button";
        console.log("[ETS] Forced button type=button.");
      }

      // 3) Block any submit that still gets through (belt & suspenders)
      form.addEventListener("submit", function (e) {
        console.log("[ETS] Preventing submit event.");
        e.preventDefault();
        e.stopPropagation();
        return false;
      }, true); // capture

      // 4) Prevent Enter key from submitting
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          console.log("[ETS] Enter pressed → running search (no submit).");
          e.preventDefault();
          submitBtn.click();
        }
      });

      // Hide Webflow success/fail panes if present
      var wfDone = form.parentElement.querySelector(".w-form-done");
      var wfFail = form.parentElement.querySelector(".w-form-fail");
      if (wfDone) wfDone.style.display = "none";
      if (wfFail) wfFail.style.display = "none";

      // ===== STATE =====
      var chosen = null; // { lat, lng }

      // ===== PLACES AUTOCOMPLETE =====
      if (window.google && google.maps && google.maps.places) {
        var acOptions = {
          types: ["geocode"],
          fields: ["geometry", "address_components", "formatted_address", "place_id"]
        };
        if (USE_US_ONLY) acOptions.componentRestrictions = { country: ["us"] };

        var ac = new google.maps.places.Autocomplete(input, acOptions);
        ac.addListener("place_changed", function () {
          var place = ac.getPlace();
          console.log("[ETS] Place changed:", place && place.formatted_address);
          if (place && place.geometry && place.geometry.location) {
            if (USE_US_ONLY) {
              var isUS = (place.address_components || []).some(function (c) {
                return c.types.indexOf("country") > -1 && c.short_name === "US";
              });
              if (!isUS) {
                chosen = null;
                console.warn("[ETS] Non-US place selected. Ignoring.");
                return;
              }
            }
            chosen = {
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng()
            };
            console.log("[ETS] Chosen coords:", chosen);
          } else {
            chosen = null;
          }
        });
        console.log("[ETS] Places Autocomplete initialized.");
      } else {
        console.error("[ETS] Google Places not available. Check API key / script tag.");
      }

      // Optional: “Find My Closest Location” → use geolocation
      if (closestTrigger && closestTrigger.parentElement) {
        closestTrigger.parentElement.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          console.log("[ETS] Closest link clicked. Requesting browser location…");
          getBrowserLocation()
            .then(function (coords) {
              console.log("[ETS] Geolocation success:", coords);
              runSearch({ coords: coords });
            })
            .catch(function (err) {
              console.warn("[ETS] Geolocation failed:", err);
              runSearch({});
            });
        });
      }

      // Search button click
      submitBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log("[ETS] Search button clicked.");
        runSearch({});
      });

      // ===== MAIN SEARCH =====
      function runSearch(opts) {
        opts = opts || {};
        var q = (input && input.value ? input.value.trim() : "");
        var coords = opts.coords || chosen;

        var payload = coords ? { lat: coords.lat, lng: coords.lng, limit: 3 }
                             : { q: q, limit: 3 };

        console.log("[ETS] Payload →", payload);

        setLoading(true);

        fetch(NETLIFY_FN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
          .then(function (res) {
            console.log("[ETS] Response status:", res.status);
            return res.json().then(function (j) { return { ok: res.ok, data: j }; });
          })
          .then(function (r) {
            console.log("[ETS] Response body:", r.data);
            if (!r.ok) throw new Error(r.data && r.data.error ? r.data.error : "Search failed");
            applyResultsToDom(r.data.items || []);
            if (input) input.value = "";
            chosen = null;
          })
          .catch(function (err) {
            console.error("[ETS] ERROR:", err);
            // TODO: show toast/inline error if you have a component
          })
          .finally(function () {
            setLoading(false);
          });
      }

      // ===== LOADING UI =====
      var originalBtnText = (submitBtn && (submitBtn.textContent || submitBtn.value)) || "Search";
      function setLoading(isLoading) {
        if (!submitBtn || !container) return;
        if (isLoading) {
          if ("value" in submitBtn) submitBtn.value = "Searching...";
          submitBtn.textContent = "Searching...";
          submitBtn.disabled = true;
          container.style.transition = "opacity 180ms ease";
          container.style.opacity = "0.3";
        } else {
          if ("value" in submitBtn) submitBtn.value = originalBtnText;
          submitBtn.textContent = originalBtnText;
          submitBtn.disabled = false;
          container.style.opacity = "1";
        }
      }

      // ===== DOM PATCHING =====
      function applyResultsToDom(items) {
        console.log("[ETS] Applying results to DOM. Count:", items.length);
        var primaryData = items[0];
        var secondData  = items[1];
        var thirdData   = items[2];

        var primary = document.querySelector(".top-location-card");
        var seconds = toArray(document.querySelectorAll(".secondary-locations .location-content-sec"));

        if (primary && primaryData) updatePrimaryCard(primary, primaryData);
        if (seconds[0] && secondData) updateSecondaryCard(seconds[0], secondData);
        if (seconds[1] && thirdData)  updateSecondaryCard(seconds[1], thirdData);
      }

      function updatePrimaryCard(card, data) {
        console.log("[ETS] Update primary:", data);

        var img = card.querySelector(".location-thumbnail-wrapper img.location-thumbnail");
        if (img && data.image) {
          img.src = data.image;
          img.srcset = "";
          img.sizes = "";
          img.alt = data.name || "Location";
        }

        var titleEl = card.querySelector("h3");
        if (titleEl) titleEl.textContent = data.name || "";

        var distWrap = card.querySelector(".distance-in-miles-wrapper");
        if (distWrap) {
          distWrap.classList.remove("d-none");
          var t1 = distWrap.querySelector(".text-size-regular");
          if (t1) t1.textContent = data.distanceText || "";
        }

        var etaWrap = card.querySelector(".estimated-drie-time-wrapper");
        if (etaWrap) {
          if (data.durationText) {
            etaWrap.classList.remove("d-none");
            var t2 = etaWrap.querySelector(".text-size-regular");
            if (t2) t2.textContent = data.durationText;
          } else {
            etaWrap.classList.add("d-none");
          }
        }

        var btns = toArray(card.querySelectorAll(".button"));
        btns.forEach(function (a) {
          var label = (a.textContent || "").toLowerCase();
          if (label.indexOf("book") > -1)   a.href = data.bookUrl || "#";
          if (label.indexOf("detail") > -1) a.href = data.detailsUrl || "#";
        });
      }

      function updateSecondaryCard(card, data) {
        console.log("[ETS] Update secondary:", data);

        var titleEl = card.querySelector("h3");
        if (titleEl) titleEl.textContent = data.name || "";

        var distWrap = card.querySelector(".distance-in-miles-wrapper");
        if (distWrap) {
          distWrap.classList.remove("d-none");
          var t1 = distWrap.querySelector(".text-size-regular");
          if (t1) t1.textContent = data.distanceText || "";
        }

        var etaWrap = card.querySelector(".estimated-drie-time-wrapper");
        if (etaWrap) {
          if (data.durationText) {
            etaWrap.classList.remove("d-none");
            var t2 = etaWrap.querySelector(".text-size-regular");
            if (t2) t2.textContent = data.durationText;
          } else {
            etaWrap.classList.add("d-none");
          }
        }

        var detailsBtn = card.querySelector(".button");
        if (detailsBtn) detailsBtn.href = data.detailsUrl || "#";
      }

      // ===== UTILS =====
      function toArray(nl) { return Array.prototype.slice.call(nl || []); }
      function getBrowserLocation() {
        return new Promise(function (resolve, reject) {
          if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
          navigator.geolocation.getCurrentPosition(
            function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
            reject,
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
          );
        });
      }

      console.log("[ETS] Initialization complete. Try typing a ZIP — you should see Places suggestions. Then click Search and watch the console.");
    });
  });
}