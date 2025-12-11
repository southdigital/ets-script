document.addEventListener('DOMContentLoaded', function () {
  // ===== CONFIG =====
  var NETLIFY_FN = 'https://etsperformance.netlify.app/.netlify/functions/nearest-locations'; // or full URL
  var USE_US_ONLY = true; // US-only Places suggestions

  // ===== ELEMENTS =====
  var form = document.getElementById('email-form');
  var input = document.getElementById('search-nearest-ets-location');
  var submitBtn = form ? form.querySelector('input[type="submit"]') : null;
  var container = document.querySelector('.locations-listing-main-box');
  var closestTrigger = document.querySelector('.view-all-lovcations'); // "Find My Closest Location" text

  // Holds coords if user picked from Places or used geolocation
  var chosen = null;

  // ===== LISTENERS =====
  if (form) {
    // Prevent actual form submit
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      runSearch();
    });
  }
  if (submitBtn) {
    // Also intercept the button click
    submitBtn.addEventListener('click', function (e) {
      e.preventDefault();
      runSearch();
    });
  }
  if (closestTrigger && closestTrigger.parentElement) {
    // Geolocate when clicking "Find My Closest Location"
    closestTrigger.parentElement.addEventListener('click', function (e) {
      e.preventDefault();
      getBrowserLocation()
        .then(function (coords) { runSearch({ coords: coords }); })
        .catch(function () { runSearch(); }); // fallback to typed query
    });
  }

  // ===== PLACES AUTOCOMPLETE (if Google loaded) =====
  if (window.google && google.maps && google.maps.places && input) {
    var acOptions = {
      types: ['geocode'],
      fields: ['geometry','address_components','formatted_address','place_id']
    };
    if (USE_US_ONLY) acOptions.componentRestrictions = { country: ['us'] };

    var ac = new google.maps.places.Autocomplete(input, acOptions);
    ac.addListener('place_changed', function () {
      var place = ac.getPlace();
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
  }

  // ===== MAIN SEARCH FLOW =====
  function runSearch(opts) {
    opts = opts || {};
    var query = (input && input.value ? input.value.trim() : '');
    var coords = opts.coords || chosen;

    // Loading UI
    var originalBtnText = submitBtn ? submitBtn.value : 'Search';
    setLoading(true);

    var payload = coords ? { lat: coords.lat, lng: coords.lng, limit: 3 }
                         : { q: query, limit: 3 };

    fetch(NETLIFY_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json().then(function (j){ return { ok: res.ok, data: j }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data && r.data.error ? r.data.error : 'Search failed');
        applyResultsToDom(r.data.items || []);
        if (input) input.value = '';
        chosen = null;
      })
      .catch(function (err) {
        console.error(err);
        // you can show a toast here if you have one
      })
      .finally(function () {
        setLoading(false, originalBtnText);
      });
  }

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
    // Image (primary card has an image)
    var img = card.querySelector('.location-thumbnail-wrapper img.location-thumbnail');
    if (img && data.image) {
      img.src = data.image;
      img.srcset = ''; // avoid stale responsive candidates
      img.sizes = '';
      img.alt = data.name || 'Location';
    }

    // Title
    var titleEl = card.querySelector('h3');
    if (titleEl) titleEl.textContent = data.name || '';

    // Distance
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

    // Buttons
    var btns = toArray(card.querySelectorAll('.button'));
    btns.forEach(function (a) {
      var label = (a.textContent || '').toLowerCase();
      if (label.indexOf('book') > -1)   a.href = data.bookUrl || '#';
      if (label.indexOf('detail') > -1) a.href = data.detailsUrl || '#';
    });
  }

  function updateSecondaryCard(card, data) {
    // Title only (no image in secondary cards)
    var titleEl = card.querySelector('h3');
    if (titleEl) titleEl.textContent = data.name || '';

    // Distance
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

    // Details button
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
});