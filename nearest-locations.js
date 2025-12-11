<script async defer
  src="https://maps.googleapis.com/maps/api/js?key=AIzaSyBh_TeVoplznorINcTO5QAAi1kgBwtd7jk&libraries=places&callback=initETSNearest">
</script>
function initETSNearest() {
  // Ensure we run after Webflow binds its handlers
  (window.Webflow = window.Webflow || []).push(function () {
    document.addEventListener('DOMContentLoaded', function () {
      // ===== CONFIG =====
      var NETLIFY_FN = '/.netlify/functions/nearest-locations'; // full URL if on another domain
      var USE_US_ONLY = true;

      // ===== ELEMENTS =====
      var form = document.getElementById('email-form');
      var input = document.getElementById('search-nearest-ets-location');
      var submitBtn = form ? form.querySelector('input[type="submit"]') : null;
      var container = document.querySelector('.locations-listing-main-box');
      var closestTrigger = document.querySelector('.view-all-lovcations'); // text inside the link

      // If Webflow injected success/fail panels, we keep them hidden since we aren't submitting
      var wfDone = form ? form.parentElement.querySelector('.w-form-done') : null;
      var wfFail = form ? form.parentElement.querySelector('.w-form-fail') : null;
      if (wfDone) wfDone.style.display = 'none';
      if (wfFail) wfFail.style.display = 'none';

      // HARD-STOP Webflow submission:
      // 1) Convert the submit to a normal button so the form cannot submit.
      if (submitBtn && submitBtn.type && submitBtn.type.toLowerCase() === 'submit') {
        submitBtn.type = 'button';
      }
      // 2) Kill any lingering submit paths
      if (form) {
        form.setAttribute('action', 'javascript:void(0)');
        form.setAttribute('novalidate', 'novalidate');

        // Belt & suspenders: block any submit events that still fire
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        });
      }

      // Prevent Enter from submitting the form
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (submitBtn) submitBtn.click();
          }
        });
      }

      // ===== STATE =====
      var chosen = null; // {lat,lng} when a user selects a place or uses geolocation

      // ===== PLACES AUTOCOMPLETE =====
      if (window.google && google.maps && google.maps.places && input) {
        var acOptions = {
          types: ['geocode'],
          fields: ['geometry','address_components','formatted_address','place_id']
        };
        if (USE_US_ONLY) acOptions.componentRestrictions = { country: ['us'] };

        var autocomplete = new google.maps.places.Autocomplete(input, acOptions);
        autocomplete.addListener('place_changed', function () {
          var place = autocomplete.getPlace();
          if (place && place.geometry && place.geometry.location) {
            if (USE_US_ONLY) {
              var isUS = (place.address_components || []).some(function (c) {
                return c.types.indexOf('country') > -1 && c.short_name === 'US';
              });
              if (!isUS) {
                chosen = null;
                console.warn('Please choose a location in the United States.');
                return;
              }
            }
            chosen = {
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng()
            };
          } else {
            chosen = null;
          }
        });
      } else {
        console.warn('Google Places not available — check your script tag & API key.');
      }

      // ===== CLICK HANDLERS =====
      if (submitBtn) {
        submitBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          runSearch();
        });
      }

      if (closestTrigger && closestTrigger.parentElement) {
        // The parent <a> wraps the text block
        closestTrigger.parentElement.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          getBrowserLocation()
            .then(function (coords) { runSearch({ coords: coords }); })
            .catch(function () { runSearch(); });
        });
      }

      // ===== MAIN SEARCH =====
      function runSearch(opts) {
        opts = opts || {};
        var query = input && input.value ? input.value.trim() : '';
        var coords = opts.coords || chosen;

        var originalBtnText = submitBtn ? submitBtn.value : 'Search';
        setLoading(true);

        var payload = coords
          ? { lat: coords.lat, lng: coords.lng, limit: 3 }
          : { q: query, limit: 3 };

        fetch(NETLIFY_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(function (res) {
            return res.json().then(function (j) { return { ok: res.ok, data: j }; });
          })
          .then(function (r) {
            if (!r.ok) throw new Error(r.data && r.data.error ? r.data.error : 'Search failed');
            applyResultsToDom(r.data.items || []);
            if (input) input.value = '';
            chosen = null;
          })
          .catch(function (err) {
            console.error(err);
            // Optional: surface a toast/inline message
          })
          .finally(function () {
            setLoading(false, originalBtnText);
          });
      }

      // ===== LOADING UI =====
      function setLoading(isLoading, resetText) {
        if (!submitBtn || !container) return;
        if (isLoading) {
          submitBtn.value = 'Searching...';
          submitBtn.disabled = true;
          container.style.transition = 'opacity 180ms ease';
          container.style.opacity = '0.3';
        } else {
          submitBtn.value = resetText || 'Search';
          submitBtn.disabled = false;
          container.style.opacity = '1';
        }
      }

      // ===== DOM PATCHING =====
      function applyResultsToDom(items) {
        var primaryData = items[0];
        var secondData  = items[1];
        var thirdData   = items[2];

        var primary = document.querySelector('.top-location-card');
        var seconds = toArray(document.querySelectorAll('.secondary-locations .location-content-sec'));

        if (primary && primaryData) updatePrimaryCard(primary, primaryData);
        if (seconds[0] && secondData) updateSecondaryCard(seconds[0], secondData);
        if (seconds[1] && thirdData)  updateSecondaryCard(seconds[1], thirdData);
      }

      function updatePrimaryCard(card, data) {
        // image
        var img = card.querySelector('.location-thumbnail-wrapper img.location-thumbnail');
        if (img && data.image) {
          img.src = data.image;
          img.srcset = '';
          img.sizes = '';
          img.alt = data.name || 'Location';
        }

        // title
        var titleEl = card.querySelector('h3');
        if (titleEl) titleEl.textContent = data.name || '';

        // distance
        var distWrap = card.querySelector('.distance-in-miles-wrapper');
        if (distWrap) {
          distWrap.classList.remove('d-none');
          var t1 = distWrap.querySelector('.text-size-regular');
          if (t1) t1.textContent = data.distanceText || '';
        }

        // ETA
        var etaWrap = card.querySelector('.estimated-drie-time-wrapper');
        if (etaWrap) {
          if (data.durationText) {
            etaWrap.classList.remove('d-none');
            var t2 = etaWrap.querySelector('.text-size-regular');
            if (t2) t2.textContent = data.durationText;
          } else {
            etaWrap.classList.add('d-none');
          }
        }

        // buttons
        var btns = toArray(card.querySelectorAll('.button'));
        btns.forEach(function (a) {
          var label = (a.textContent || '').toLowerCase();
          if (label.indexOf('book') > -1)   a.href = data.bookUrl || '#';
          if (label.indexOf('detail') > -1) a.href = data.detailsUrl || '#';
        });
      }

      function updateSecondaryCard(card, data) {
        var titleEl = card.querySelector('h3');
        if (titleEl) titleEl.textContent = data.name || '';

        var distWrap = card.querySelector('.distance-in-miles-wrapper');
        if (distWrap) {
          distWrap.classList.remove('d-none');
          var t1 = distWrap.querySelector('.text-size-regular');
          if (t1) t1.textContent = data.distanceText || '';
        }

        var etaWrap = card.querySelector('.estimated-drie-time-wrapper');
        if (etaWrap) {
          if (data.durationText) {
            etaWrap.classList.remove('d-none');
            var t2 = etaWrap.querySelector('.text-size-regular');
            if (t2) t2.textContent = data.durationText;
          } else {
            etaWrap.classList.add('d-none');
          }
        }

        var detailsBtn = card.querySelector('.button');
        if (detailsBtn) detailsBtn.href = data.detailsUrl || '#';
      }

      // ===== UTILS =====
      function toArray(nodeList) { return Array.prototype.slice.call(nodeList || []); }
      function getBrowserLocation() {
        return new Promise(function (resolve, reject) {
          if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
          navigator.geolocation.getCurrentPosition(
            function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
            function (err) { reject(err); },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
          );
        });
      }

      // Optional debug helper in console
      window.__ETS_nearestSearch = function () { 
        if (submitBtn) submitBtn.click(); 
      };
    });
  });
}