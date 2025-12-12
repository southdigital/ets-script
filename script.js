const GOOGLE_API_KEY = 'AIzaSyBh_TeVoplznorINcTO5QAAi1kgBwtd7jk';
const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiYW1pcnNhbmRpbGEiLCJhIjoiY21kOHBkYm1hMDMzcjJsc2JocHpwb3ZiNiJ9._lhcLY6YHkyrVLy4Iy_5rQ';

function initETSLocationFinder() {
  const locationsContainer = document.querySelector('.locations-ets.w-dyn-items');
  if (!locationsContainer) {
    console.warn('No .locations-ets.w-dyn-items container found');
    return;
  }

  // --- GLOBALS ------------------------------------------------------
  let hasDoneInitialCameraMove = false;
  let map = null;
  let userLocationMarker = null;
  let lastUserLngLat = null;
  let activeLocationId = null;
  let activePopup = null;
  let lastGeolocateWasUserAction = false;

  // --- 1) Build locations array from DOM -----------------------------
  const locationCardEls = locationsContainer.querySelectorAll('.location-item');

  const locations = Array.from(locationCardEls).map((cardEl, index) => {
    const lat = parseFloat(cardEl.getAttribute('data-lat'));
    const lng = parseFloat(cardEl.getAttribute('data-lng'));

    const itemWrapper = cardEl.closest('.w-dyn-item') || cardEl;

    const distanceWrapper = cardEl.querySelector('.distance-in-miles-wrapper');
    const distanceTextEl = cardEl.querySelector('.distance-text');

    const durationWrapper = cardEl.querySelector('.estimated-drie-time-wrapper');
    const durationTextEl = cardEl.querySelector('.estimated-drive-time-text');

    const nameEl = cardEl.querySelector('h3');
    const addressEl = cardEl.querySelector('.location-address-wrapper .text-size-regular');

    return {
      id: index,
      lat,
      lng,
      name: nameEl ? nameEl.textContent.trim() : '',
      address: addressEl ? addressEl.textContent.trim() : '',
      cardEl,
      itemWrapper,
      distanceWrapper,
      distanceTextEl,
      durationWrapper,
      durationTextEl,
      distanceValueMeters: null,
      distanceText: null,
      durationText: null,
      marker: null
    };
  });

  if (!locations.length) {
    console.warn('No .location-item elements found');
    return;
  }

  // --- 2) Distance UI helpers ---------------------------------------
  function hideDistanceUI() {
    locations.forEach(loc => {
      if (loc.distanceWrapper) loc.distanceWrapper.classList.add('d-none');
      if (loc.durationWrapper) loc.durationWrapper.classList.add('d-none');
    });
  }

  function showDistanceForLocation(loc) {
    if (loc.distanceWrapper) loc.distanceWrapper.classList.remove('d-none');
    if (loc.durationWrapper) loc.durationWrapper.classList.remove('d-none');
  }

  // --- 3) Sorting DOM by distance -----------------------------------
  function sortLocationsByDistance() {
    if (!locationsContainer) return;

    locations.sort((a, b) => {
      const da = typeof a.distanceValueMeters === 'number' ? a.distanceValueMeters : Number.POSITIVE_INFINITY;
      const db = typeof b.distanceValueMeters === 'number' ? b.distanceValueMeters : Number.POSITIVE_INFINITY;
      return da - db;
    });

    locations.forEach(loc => {
      if (loc.itemWrapper) locationsContainer.appendChild(loc.itemWrapper);
      else locationsContainer.appendChild(loc.cardEl);
    });
  }

  function bringCardToTop(loc) {
    if (!locationsContainer || !loc.itemWrapper) return;

    locationsContainer.insertBefore(loc.itemWrapper, locationsContainer.firstChild);

    const idx = locations.indexOf(loc);
    if (idx > 0) {
      locations.splice(idx, 1);
      locations.unshift(loc);
    }
  }

  // --- 3b) Center on area with most gyms ----------------------------
  function centerMapOnDensestArea() {
    if (!map || !locations.length) return;

    const cellSize = 1;
    const grid = new Map();

    locations.forEach(loc => {
      if (!loc.lat || !loc.lng) return;
      const cellLat = Math.floor(loc.lat / cellSize);
      const cellLng = Math.floor(loc.lng / cellSize);
      const key = cellLat + ',' + cellLng;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(loc);
    });

    let bestCellLocations = null;
    let bestCount = 0;

    grid.forEach(cellLocs => {
      if (cellLocs.length > bestCount) {
        bestCount = cellLocs.length;
        bestCellLocations = cellLocs;
      }
    });

    const targetLocs = bestCellLocations && bestCellLocations.length ? bestCellLocations : locations;

    let bounds = null;
    targetLocs.forEach(loc => {
      if (!loc.lat || !loc.lng) return;
      const coord = [loc.lng, loc.lat];
      if (!bounds) bounds = new mapboxgl.LngLatBounds(coord, coord);
      else bounds.extend(coord);
    });

    if (bounds) {
      map.fitBounds(bounds, {
        padding: 60,
        maxZoom: 6,
        duration: hasDoneInitialCameraMove ? 0 : 2500
      });
      hasDoneInitialCameraMove = true;
    }
  }

  // --- 4) Popup HTML -------------------------------------------------
  // (Keep your original popup HTML if you want; I kept it minimal here.)
  function buildPopupHTML(loc) {
    const distanceLine = loc.distanceText ? `<div class="distance-text">${loc.distanceText}</div>` : '';
    const durationLine = loc.durationText ? `<div class="estimated-drive-time-text">${loc.durationText}</div>` : '';

    return `
      <div class="location-item map-popup">
        <div class="text-size-large text-color-inverse text-weight-bold">${loc.name || ''}</div>
        <div class="text-size-regular text-color-inverse margin-top-6">${loc.address || ''}</div>
        <div class="margin-top-6">${distanceLine}${durationLine}</div>
      </div>
    `;
  }

  function selectLocation(locationId, options) {
    const opts = Object.assign(
      {
        flyTo: true,
        openPopup: true,
        scrollToCard: false,
        bringToTop: false,
        setCardActive: true,
        setMarkerActive: true
      },
      options || {}
    );

    const loc = locations.find(l => l.id === locationId);
    if (!loc || !map) return;

    if (activeLocationId !== null && activeLocationId !== locationId) {
      const prev = locations.find(l => l.id === activeLocationId);
      if (prev) {
        prev.cardEl.classList.remove('is-active');
        if (prev.marker && prev.marker.getElement()) {
          prev.marker.getElement().classList.remove('is-active');
        }
      }
    }

    activeLocationId = locationId;

    if (opts.setCardActive) loc.cardEl.classList.add('is-active');
    else loc.cardEl.classList.remove('is-active');

    if (loc.marker && loc.marker.getElement()) {
      if (opts.setMarkerActive) loc.marker.getElement().classList.add('is-active');
      else loc.marker.getElement().classList.remove('is-active');
    }

    if (opts.bringToTop) bringCardToTop(loc);

    if (loc.marker && loc.marker.getPopup()) {
      loc.marker.getPopup().setHTML(buildPopupHTML(loc));
    }

    if (opts.flyTo && loc.lat && loc.lng) {
      map.flyTo({
        center: [loc.lng, loc.lat],
        zoom: 11,
        speed: 1.4,
        curve: 1.4,
        essential: true
      });
    }

    if (opts.openPopup && loc.marker && loc.marker.getPopup()) {
      if (activePopup && activePopup.isOpen()) activePopup.remove();
      activePopup = loc.marker.getPopup();
      activePopup.addTo(map);
    }

    if (opts.scrollToCard) {
      loc.cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function createMarkersAndWireCards() {
    if (!map) return;

    locations.forEach(loc => {
      if (!loc.lng || !loc.lat) return;

      const markerEl = document.createElement('img');
      markerEl.src =
        'https://cdn.prod.website-files.com/68f9dd01a660a09f46b08cb1/692e9fb0f13b7e4c83995eba_high-res-logo-ets-p-3200.png';
      markerEl.className = 'ets-map-marker';
      markerEl.alt = loc.name || 'Location';

      const popup = new mapboxgl.Popup({
        offset: 24,
        closeButton: true,
        closeOnClick: true
      }).setHTML(buildPopupHTML(loc));

      const marker = new mapboxgl.Marker(markerEl)
        .setLngLat([loc.lng, loc.lat])
        .setPopup(popup)
        .addTo(map);

      loc.marker = marker;

      markerEl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        selectLocation(loc.id, {
          flyTo: true,
          openPopup: true,
          scrollToCard: false,
          bringToTop: true,
          setCardActive: false,
          setMarkerActive: true
        });
      });
    });

    locations.forEach(loc => {
      loc.cardEl.style.cursor = 'default';
    });
  }

  // --- 5) Distance Matrix & user location integration ---------------
  const MAX_DESTINATIONS_PER_REQUEST = 25;
  const distanceService = new google.maps.DistanceMatrixService();

  async function calculateAndApplyDistances(originLatLng, options) {
    const opts = Object.assign(
      {
        autoSelectNearest: true,
        fitMapToUserAndNearest: true
      },
      options || {}
    );

    if (!locations.length) return;

    const promises = [];

    for (let i = 0; i < locations.length; i += MAX_DESTINATIONS_PER_REQUEST) {
      const chunk = locations.slice(i, i + MAX_DESTINATIONS_PER_REQUEST);
      const destinations = chunk.map(loc => new google.maps.LatLng(loc.lat, loc.lng));

      const p = new Promise((resolve, reject) => {
        distanceService.getDistanceMatrix(
          {
            origins: [originLatLng],
            destinations,
            travelMode: google.maps.TravelMode.DRIVING,
            unitSystem: google.maps.UnitSystem.IMPERIAL
          },
          (response, status) => {
            if (status !== 'OK') {
              reject(status);
              return;
            }
            resolve({ response, chunkStartIndex: i });
          }
        );
      });

      promises.push(p);
    }

    try {
      const resultsArray = await Promise.all(promises);

      resultsArray.forEach(({ response, chunkStartIndex }) => {
        const elements = response.rows[0].elements;

        elements.forEach((el, idx) => {
          const loc = locations[chunkStartIndex + idx];
          if (!loc) return;

          if (el.status === 'OK') {
            const distanceText = el.distance.text;
            const durationText = el.duration.text;

            loc.distanceValueMeters = el.distance.value;
            loc.distanceText = distanceText;
            loc.durationText = durationText;

            if (loc.distanceTextEl) loc.distanceTextEl.textContent = distanceText;
            if (loc.durationTextEl) loc.durationTextEl.textContent = durationText;

            showDistanceForLocation(loc);

            if (loc.marker && loc.marker.getPopup()) {
              loc.marker.getPopup().setHTML(buildPopupHTML(loc));
            }
          } else {
            loc.distanceValueMeters = Number.POSITIVE_INFINITY;
            if (loc.distanceWrapper) loc.distanceWrapper.classList.add('d-none');
            if (loc.durationWrapper) loc.durationWrapper.classList.add('d-none');
          }
        });
      });

      sortLocationsByDistance();

      if (map && lastUserLngLat && locations.length && opts.fitMapToUserAndNearest) {
        const nearest = locations[0];
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([lastUserLngLat.lng, lastUserLngLat.lat]);
        bounds.extend([nearest.lng, nearest.lat]);

        map.fitBounds(bounds, { padding: 40, maxZoom: 11 });

        if (opts.autoSelectNearest) {
          selectLocation(nearest.id, {
            flyTo: false,
            openPopup: true,
            scrollToCard: false,
            bringToTop: false,
            setCardActive: true,
            setMarkerActive: true
          });
        }
      }
    } catch (err) {
      console.error('Distance Matrix error:', err);
      hideDistanceUI();
    }
  }

  function updateUserLocationMarker(lat, lng) {
    lastUserLngLat = { lat, lng };
    if (!map) return;

    if (!userLocationMarker) {
      const el = document.createElement('div');
      el.className = 'ets-user-marker';

      userLocationMarker = new mapboxgl.Marker(el).setLngLat([lng, lat]).addTo(map);
    } else {
      userLocationMarker.setLngLat([lng, lat]);
    }
  }

  function isInUSA(lat, lng) {
    const inLower48 = lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66;
    const inAlaska = lat >= 51 && lat <= 72 && lng >= -170 && lng <= -129;
    const inHawaii = lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154;
    return inLower48 || inAlaska || inHawaii;
  }

  function handleGeolocationSuccess(position) {
    const { latitude, longitude } = position.coords;

    if (lastGeolocateWasUserAction && !isInUSA(latitude, longitude)) {
      alert(
        'It looks like you are currently outside the United States. To find an ETS Gym, please enter a U.S. city or ZIP code in the search bar.'
      );
      lastGeolocateWasUserAction = false;
      return;
    }

    // map may not exist yet; marker update will no-op until map exists
    updateUserLocationMarker(latitude, longitude);

    const originLatLng = new google.maps.LatLng(latitude, longitude);

    calculateAndApplyDistances(originLatLng, {
      autoSelectNearest: true,
      fitMapToUserAndNearest: lastGeolocateWasUserAction
    });

    if (lastGeolocateWasUserAction) {
      alert('Showing ETS locations near your current location.');
    }

    lastGeolocateWasUserAction = false;
  }

  function handleGeolocationError(error) {
    console.warn('Geolocation error:', error);
    hideDistanceUI();

    if (error && error.code === error.PERMISSION_DENIED && lastGeolocateWasUserAction) {
      alert(
        'We are unable to access your location. To find an ETS Gym near you, please turn on location services or manually enter your location in the search bar.'
      );
    }

    lastGeolocateWasUserAction = false;
  }

  function tryGeolocateAndCalculate(fromUserAction) {
    if (!('geolocation' in navigator)) {
      hideDistanceUI();
      if (fromUserAction) {
        alert(
          'We are unable to access your location. To find an ETS Gym near you, please turn on location services or manually enter your location in the search bar.'
        );
      }
      return;
    }

    lastGeolocateWasUserAction = !!fromUserAction;

    navigator.geolocation.getCurrentPosition(handleGeolocationSuccess, handleGeolocationError, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 300000
    });
  }

  // --- 6) Places + Search -------------------------------------------
  const searchInput = document.getElementById('location-or-zipcode');
  const searchForm = document.getElementById('email-form');
  const searchButton = document.querySelector('.form-find-gym .w-button');

  let autocomplete = null;
  if (searchInput && google.maps.places) {
    autocomplete = new google.maps.places.Autocomplete(searchInput, {
      types: ['geocode'],
      componentRestrictions: { country: 'us' }
    });
  }

  const geocoder = new google.maps.Geocoder();

  function getQueryFromUrl() {
    const url = new URL(window.location.href);
    return (url.searchParams.get('q') || '').trim();
  }

  function geocodeQuery(query) {
    return new Promise((resolve, reject) => {
      geocoder.geocode({ address: query, componentRestrictions: { country: 'US' } }, (results, status) => {
        if (status === 'OK' && results?.[0]?.geometry?.location) {
          const loc = results[0].geometry.location;
          resolve({ gLocation: loc, lat: loc.lat(), lng: loc.lng() });
        } else {
          reject(status);
        }
      });
    });
  }

  function geocodeAndCalculateFromQuery(query, opts) {
    const options = Object.assign(
      {
        // when user clicks Search on this page: fly to searched area
        flyTo: true,
        flyZoom: 6
      },
      opts || {}
    );

    geocoder.geocode({ address: query, componentRestrictions: { country: 'US' } }, (results, status) => {
      if (status === 'OK' && results[0]?.geometry?.location) {
        const location = results[0].geometry.location;
        const userLat = location.lat();
        const userLng = location.lng();

        updateUserLocationMarker(userLat, userLng);

        // ONLY flyTo when requested
        if (map && options.flyTo) {
          map.flyTo({
            center: [userLng, userLat],
            zoom: options.flyZoom,
            speed: 1.4,
            curve: 1.4,
            essential: true
          });
        }

        calculateAndApplyDistances(location, {
          autoSelectNearest: false,
          fitMapToUserAndNearest: false
        });
      } else {
        console.warn('Geocoding failed:', status);
      }
    });
  }

  if (searchForm) {
    searchForm.addEventListener('submit', e => {
      e.preventDefault();
      return false;
    });
  }

  function handleSearchButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!searchInput) return;
    const query = searchInput.value.trim();
    if (!query) return;

    geocodeAndCalculateFromQuery(query, { flyTo: true, flyZoom: 6 });
  }

  if (searchButton) searchButton.addEventListener('click', handleSearchButtonClick);

  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearchButtonClick(e);
      }
    });
  }

  // --- 7) Map init (IMPORTANT: centered by URL query if present) -----
  function initMapWithCenter(centerLngLat, initialZoom, animateToZoom) {
    if (!window.mapboxgl) {
      console.error('Mapbox GL JS not found');
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const mapContainer = document.getElementById('heatmap');
    if (!mapContainer) {
      console.warn('Map container #heatmap not found');
      return;
    }

    map = new mapboxgl.Map({
      container: 'heatmap',
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [centerLngLat.lng, centerLngLat.lat],
      zoom: initialZoom
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      createMarkersAndWireCards();

      // ✅ Only runs when you passed animateToZoom (i.e., URL query case)
      if (typeof animateToZoom === 'number') {
        map.easeTo({
          center: [centerLngLat.lng, centerLngLat.lat],
          zoom: animateToZoom,
          duration: 900,
          essential: true,
          offset: [0, 30] // optional subtle settle
        });
      }
    });
  }


  // --- 8) Bootstrapping logic ---------------------------------------
  (async function bootstrap() {
    const urlQuery = getQueryFromUrl();

    // Geolocate on load (same as your old behavior)
    if ('geolocation' in navigator) {
      tryGeolocateAndCalculate(false);
    } else {
      hideDistanceUI();
    }

    // Wire "Use current location"
    const useCurrentLocationRow = document.querySelector(
      '.find_ets-location-searchbox .flex.align-center.gap-6.margin-top-tiny'
    );
    if (useCurrentLocationRow && 'geolocation' in navigator) {
      useCurrentLocationRow.style.cursor = 'pointer';
      useCurrentLocationRow.addEventListener('click', () => {
        tryGeolocateAndCalculate(true);
      });
    }

    // CASE A: URL has q -> geocode first -> init map already centered -> run distances (no flyTo)
    if (urlQuery) {
      try {
        if (searchInput) searchInput.value = urlQuery;

        const { gLocation, lat, lng } = await geocodeQuery(urlQuery);

        initMapWithCenter({ lat, lng }, 5.2, 6); // start a bit zoomed out, ease to final zoom

        // Once map exists, show user marker too
        updateUserLocationMarker(lat, lng);

        // Do the same “search process” but without flying (map already centered)
        calculateAndApplyDistances(gLocation, {
          autoSelectNearest: false,
          fitMapToUserAndNearest: false
        });

        hasDoneInitialCameraMove = true; // skip densest-area animation
        return;
      } catch (err) {
        console.warn('URL query geocode failed, falling back to default map:', err);
        // fall through
      }
    }

    // CASE B: No URL query -> behave as before
    initMapWithCenter({ lng: -98.5795, lat: 39.8283 }, 3);

    // keep your "densest area" first-load behavior
    map.on('load', () => {
      centerMapOnDensestArea();
    });
  })();
}