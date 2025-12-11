(function(){
  var NETLIFY_FN = '/.netlify/functions/nearest-locations'; // set full URL if cross-domain
  var USE_US_ONLY = true;
  var MAX_RETRIES = 20;     // try for ~2s to find DOM
  var RETRY_MS    = 100;

  // Exposed global callback from Google script
  window.initETSNearest = function () {
    console.log('[ETS] Google Maps loaded, initializing...');
    // Run after Webflow, but don't wait for DOMContentLoaded (it may have fired already)
    (window.Webflow = window.Webflow || []).push(function () {
      console.log('[ETS] Webflow ready. Preparing DOM…');
      tryInit(0);
    });
  };

  function tryInit(attempt){
    var form = document.getElementById('email-form');
    var input = document.getElementById('search-nearest-ets-location');
    var container = document.querySelector('.locations-listing-main-box');

    if (!form || !input || !container) {
      if (attempt < MAX_RETRIES) {
        if (attempt === 0) console.warn('[ETS] Waiting for DOM nodes…');
        return setTimeout(function(){ tryInit(attempt+1); }, RETRY_MS);
      }
      console.error('[ETS] Required elements not found after retries.', {form: !!form, input: !!input, container: !!container});
      return;
    }
    boot(form, input, container);
  }

  function boot(form, input, container){
    console.log('[ETS] Elements found. Booting…');

    // Remove Webflow handlers: clone & replace form
    var parent = form.parentNode;
    var fresh = form.cloneNode(true);
    parent.replaceChild(fresh, form);
    form = fresh;
    form.setAttribute('data-wf-ignore','true');
    form.setAttribute('action','javascript:void(0)');
    form.setAttribute('method','dialog');
    form.setAttribute('novalidate','novalidate');
    console.log('[ETS] Form cloned & marked data-wf-ignore.');

    // Convert submit to plain button
    var submitBtn = form.querySelector('input[type="submit"], button[type="submit"], .w-button');
    if (!submitBtn) {
      console.error('[ETS] Submit button not found.');
      return;
    }
    if (submitBtn.tagName === 'INPUT' && submitBtn.type.toLowerCase() === 'submit') {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = submitBtn.className;
      btn.textContent = submitBtn.value || 'Search';
      submitBtn.parentNode.replaceChild(btn, submitBtn);
      submitBtn = btn;
      console.log('[ETS] Converted input[type=submit] → <button type=button>.');
    } else {
      submitBtn.type = 'button';
      console.log('[ETS] Forced button type=button.');
    }

    // Block submit events (belt & suspenders)
    form.addEventListener('submit', function(e){
      console.log('[ETS] Preventing submit event.');
      e.preventDefault(); e.stopPropagation(); return false;
    }, true);

    // Block Enter submit (but trigger click)
    input.addEventListener('keydown', function(e){
      if (e.key === 'Enter') {
        e.preventDefault();
        console.log('[ETS] Enter pressed → trigger search.');
        submitBtn.click();
      }
    });

    // Hide Webflow success/fail panels (we never submit)
    var wfDone = form.parentElement.querySelector('.w-form-done');
    var wfFail = form.parentElement.querySelector('.w-form-fail');
    if (wfDone) wfDone.style.display = 'none';
    if (wfFail) wfFail.style.display = 'none';

    // Places Autocomplete
    var chosen = null;
    if (window.google && google.maps && google.maps.places) {
      var acOptions = {
        types: ['geocode'],
        fields: ['geometry','address_components','formatted_address','place_id']
      };
      if (USE_US_ONLY) acOptions.componentRestrictions = { country: ['us'] };

      var ac = new google.maps.places.Autocomplete(input, acOptions);
      ac.addListener('place_changed', function(){
        var place = ac.getPlace();
        console.log('[ETS] place_changed:', place && place.formatted_address);
        if (place && place.geometry && place.geometry.location) {
          if (USE_US_ONLY) {
            var isUS = (place.address_components || []).some(function(c){
              return c.types.indexOf('country')>-1 && c.short_name==='US';
            });
            if (!isUS) {
              chosen = null;
              console.warn('[ETS] Non-US selection ignored.');
              return;
            }
          }
          chosen = {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng()
          };
          console.log('[ETS] coords set:', chosen);
        } else {
          chosen = null;
        }
      });
      console.log('[ETS] Places Autocomplete initialized.');
    } else {
      console.error('[ETS] Google Places not available. Check script tag & key.');
    }

    // Search button handler
    submitBtn.addEventListener('click', function(e){
      e.preventDefault(); e.stopPropagation();
      console.log('[ETS] Search click.');
      runSearch();
    });

    // Optional: “Find My Closest Location” link (if present)
    var closestTrigger = document.querySelector('.view-all-lovcations');
    if (closestTrigger && closestTrigger.parentElement) {
      closestTrigger.parentElement.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        console.log('[ETS] Closest link clicked — requesting geolocation…');
        getBrowserLocation()
          .then(function(coords){ console.log('[ETS] Geolocation success:', coords); runSearch({coords:coords}); })
          .catch(function(err){ console.warn('[ETS] Geolocation failed:', err); runSearch(); });
      });
    }

    // Loading UI
    var originalText = (submitBtn && (submitBtn.textContent || submitBtn.value)) || 'Search';
    function setLoading(isLoading){
      if (!submitBtn || !container) return;
      if (isLoading) {
        if ('value' in submitBtn) submitBtn.value = 'Searching...';
        submitBtn.textContent = 'Searching...';
        submitBtn.disabled = true;
        container.style.transition = 'opacity 180ms ease';
        container.style.opacity = '0.3';
      } else {
        if ('value' in submitBtn) submitBtn.value = originalText;
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        container.style.opacity = '1';
      }
    }

    // Main search (calls Netlify, patches DOM)
    function runSearch(opts){
      opts = opts || {};
      var q = (input && input.value ? input.value.trim() : '');
      var coords = opts.coords || chosen;
      var payload = coords ? { lat: coords.lat, lng: coords.lng, limit: 3 }
                           : { q: q, limit: 3 };
      console.log('[ETS] Payload →', payload);

      setLoading(true);
      fetch(NETLIFY_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(function(res){
        console.log('[ETS] Response status:', res.status);
        return res.json().then(function(j){ return {ok:res.ok, data:j}; });
      })
      .then(function(r){
        console.log('[ETS] Response body:', r.data);
        if (!r.ok) throw new Error(r.data && r.data.error ? r.data.error : 'Search failed');
        applyResultsToDom(r.data.items || []);
        if (input) input.value = '';
        chosen = null;
      })
      .catch(function(err){
        console.error('[ETS] ERROR:', err);
      })
      .finally(function(){
        setLoading(false);
      });
    }

    // DOM patching
    function applyResultsToDom(items){
      console.log('[ETS] Patching DOM with', items.length, 'items.');
      var primary = document.querySelector('.top-location-card');
      var seconds = [].slice.call(document.querySelectorAll('.secondary-locations .location-content-sec'));

      if (primary && items[0]) updatePrimaryCard(primary, items[0]);
      if (seconds[0] && items[1]) updateSecondaryCard(seconds[0], items[1]);
      if (seconds[1] && items[2]) updateSecondaryCard(seconds[1], items[2]);
    }

    function updatePrimaryCard(card, data){
      console.log('[ETS] Primary →', data);
      var img = card.querySelector('.location-thumbnail-wrapper img.location-thumbnail');
      if (img && data.image) { img.src = data.image; img.srcset=''; img.sizes=''; img.alt = data.name || 'Location'; }
      var h = card.querySelector('h3'); if (h) h.textContent = data.name || '';
      var distWrap = card.querySelector('.distance-in-miles-wrapper');
      if (distWrap){ distWrap.classList.remove('d-none'); var t=distWrap.querySelector('.text-size-regular'); if (t) t.textContent = data.distanceText || ''; }
      var etaWrap = card.querySelector('.estimated-drie-time-wrapper');
      if (etaWrap){ if (data.durationText){ etaWrap.classList.remove('d-none'); var t2=etaWrap.querySelector('.text-size-regular'); if (t2) t2.textContent = data.durationText; } else { etaWrap.classList.add('d-none'); } }
      var btns = [].slice.call(card.querySelectorAll('.button'));
      btns.forEach(function(a){
        var label = (a.textContent || '').toLowerCase();
        if (label.indexOf('book')>-1)   a.href = data.bookUrl || '#';
        if (label.indexOf('detail')>-1) a.href = data.detailsUrl || '#';
      });
    }

    function updateSecondaryCard(card, data){
      console.log('[ETS] Secondary →', data);
      var h = card.querySelector('h3'); if (h) h.textContent = data.name || '';
      var distWrap = card.querySelector('.distance-in-miles-wrapper');
      if (distWrap){ distWrap.classList.remove('d-none'); var t=distWrap.querySelector('.text-size-regular'); if (t) t.textContent = data.distanceText || ''; }
      var etaWrap = card.querySelector('.estimated-drie-time-wrapper');
      if (etaWrap){ if (data.durationText){ etaWrap.classList.remove('d-none'); var t2=etaWrap.querySelector('.text-size-regular'); if (t2) t2.textContent = data.durationText; } else { etaWrap.classList.add('d-none'); } }
      var detailsBtn = card.querySelector('.button'); if (detailsBtn) detailsBtn.href = data.detailsUrl || '#';
    }

    function getBrowserLocation(){
      return new Promise(function(resolve,reject){
        if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
        navigator.geolocation.getCurrentPosition(
          function(p){ resolve({lat:p.coords.latitude, lng:p.coords.longitude}); },
          reject,
          { enableHighAccuracy:false, timeout:8000, maximumAge:600000 }
        );
      });
    }

    console.log('[ETS] Initialization complete. Type a ZIP and click Search. You should see autocomplete & logs for click → payload → response.');
  }
})();