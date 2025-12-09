const GOOGLE_API_KEY = 'AIzaSyBh_TeVoplznorINcTO5QAAi1kgBwtd7jk';
const MAPBOX_ACCESS_TOKEN = 'sk.eyJ1IjoiYW1pcnNhbmRpbGEiLCJhIjoiY21peWNrcGVxMGRhdjNkcXpqdGlmejF0dCJ9.zHIMCJiHzwLoD3lfzpyQqA';

  function initETSLocationFinder() {
    const locationsContainer = document.querySelector('.locations-ets.w-dyn-items');
    if (!locationsContainer) return;

    // --- GLOBALS ------------------------------------------------------
    let map = null;
    let userLocationMarker = null;
    let lastUserLngLat = null; // { lng, lat }
    let activeLocationId = null;
    let activePopup = null;

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

    if (!locations.length) return;

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
        if (loc.itemWrapper) {
          locationsContainer.appendChild(loc.itemWrapper);
        } else {
          locationsContainer.appendChild(loc.cardEl);
        }
      });
    }

    // --- 4) Mapbox initialization -------------------------------------

    if (typeof mapboxgl !== 'undefined') {
      mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

      const mapContainer = document.querySelector('.ets-locations-map-wrapper .locations-map');

      if (mapContainer) {
        map = new mapboxgl.Map({
          container: mapContainer,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [-98.5795, 39.8283], // rough center of US
          zoom: 3
        });

        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

        map.on('load', () => {
          // Fit bounds to all locations
          if (locations.length) {
            let bounds = null;

            locations.forEach((loc, idx) => {
              const coord = [loc.lng, loc.lat];
              if (idx === 0) {
                bounds = new mapboxgl.LngLatBounds(coord, coord);
              } else {
                bounds.extend(coord);
              }
            });

            if (bounds) {
              map.fitBounds(bounds, { padding: 60, maxZoom: 10 });
            }
          }

          // Add markers & popups
          createMarkersAndPopups();
        });
      }
    }

    // --- 5) Selection / syncing (cards <-> markers) -------------------

    function selectLocation(locationId, options = {}) {
      const loc = locations.find(l => l.id === locationId);
      if (!loc || !map) return;

      const { skipFlyTo = false, skipPopup = false, bringToTop = false, scrollToCard = false } = options;

      // Clear previous active state
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

      // Active card highlight
      loc.cardEl.classList.add('is-active');

      // Active marker highlight
      if (loc.marker && loc.marker.getElement()) {
        loc.marker.getElement().classList.add('is-active');
      }

      // Bring selected card to top of list if desired (for marker clicks)
      if (bringToTop && loc.itemWrapper && locationsContainer) {
        locationsContainer.insertBefore(loc.itemWrapper, locationsContainer.firstChild);
      }

      // Popups
      if (!skipPopup && loc.marker && loc.marker.getPopup()) {
        if (activePopup && activePopup.isOpen()) {
          activePopup.remove();
        }
        activePopup = loc.marker.getPopup();
        activePopup.addTo(map);
      }

      // Fly to marker
      if (!skipFlyTo) {
        map.flyTo({
          center: [loc.lng, loc.lat],
          zoom: 11,
          speed: 1.4,
          curve: 1.4,
          essential: true
        });
      }

      // Scroll card into view when selected from map
      if (scrollToCard) {
        loc.cardEl.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }

    function createMarkersAndPopups() {
      if (!map) return;

      locations.forEach(loc => {
        const markerEl = document.createElement('button');
        markerEl.className = 'ets-map-marker';
        markerEl.type = 'button';
        markerEl.setAttribute('aria-label', loc.name || 'Location');

        const popupHtml = `
          <div class="ets-popup">
            <div class="ets-popup-title">${loc.name || ''}</div>
            <div class="ets-popup-address">${loc.address || ''}</div>
            <div class="ets-popup-meta">
              ${loc.distanceText ? `<span class="ets-popup-pill">${loc.distanceText}</span>` : ''}
              ${loc.durationText ? `<span class="ets-popup-pill">${loc.durationText}</span>` : ''}
            </div>
          </div>
        `;

        const popup = new mapboxgl.Popup({
          offset: 24,
          closeButton: true,
          closeOnClick: true
        }).setHTML(popupHtml);

        const marker = new mapboxgl.Marker(markerEl)
          .setLngLat([loc.lng, loc.lat])
          .setPopup(popup)
          .addTo(map);

        loc.marker = marker;

        // Marker click -> select location, bring card to top, scroll into view
        markerEl.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          selectLocation(loc.id, {
            skipFlyTo: false,
            skipPopup: false,
            bringToTop: true,
            scrollToCard: true
          });
        });
      });

      // Card clicks -> fly to marker and open popup, but keep list order
      locations.forEach(loc => {
        loc.cardEl.style.cursor = 'pointer';
        loc.cardEl.addEventListener('click', () => {
          selectLocation(loc.id, {
            skipFlyTo: false,
            skipPopup: false,
            bringToTop: false,
            scrollToCard: false
          });
        });
      });
    }

    // --- 6) Distance Matrix & user location integration ---------------

    const MAX_DESTINATIONS_PER_REQUEST = 25;
    const distanceService = new google.maps.DistanceMatrixService();

    async function calculateAndApplyDistances(originLatLng) {
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

              if (loc.distanceTextEl) {
                loc.distanceTextEl.textContent = distanceText;
              }
              if (loc.durationTextEl) {
                loc.durationTextEl.textContent = durationText;
              }

              showDistanceForLocation(loc);
            } else {
              loc.distanceValueMeters = Number.POSITIVE_INFINITY;
              if (loc.distanceWrapper) loc.distanceWrapper.classList.add('d-none');
              if (loc.durationWrapper) loc.durationWrapper.classList.add('d-none');
            }
          });
        });

        sortLocationsByDistance();

        // After sorting, if we have user location + map, show nearest nicely
        if (map && lastUserLngLat && locations.length) {
          const nearest = locations[0];

          const bounds = new mapboxgl.LngLatBounds();
          bounds.extend([lastUserLngLat.lng, lastUserLngLat.lat]);
          bounds.extend([nearest.lng, nearest.lat]);

          map.fitBounds(bounds, { padding: 80, maxZoom: 11 });

          // Mark nearest as active but avoid double flyTo
          selectLocation(nearest.id, {
            skipFlyTo: true,
            skipPopup: false,
            bringToTop: false,
            scrollToCard: false
          });
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

        userLocationMarker = new mapboxgl.Marker(el)
          .setLngLat([lng, lat])
          .addTo(map);
      } else {
        userLocationMarker.setLngLat([lng, lat]);
      }
    }

    function handleGeolocationSuccess(position) {
      const { latitude, longitude } = position.coords;

      updateUserLocationMarker(latitude, longitude);

      const originLatLng = new google.maps.LatLng(latitude, longitude);
      calculateAndApplyDistances(originLatLng);
    }

    function handleGeolocationError(error) {
      console.warn('Geolocation error:', error);
      hideDistanceUI();
    }

    function tryGeolocateAndCalculate() {
      if (!('geolocation' in navigator)) {
        hideDistanceUI();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        handleGeolocationSuccess,
        handleGeolocationError,
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 300000
        }
      );
    }

    // Ask for location ON LOAD
    if ('geolocation' in navigator) {
      tryGeolocateAndCalculate();
    } else {
      hideDistanceUI();
    }

    // "Use current location" click
    const useCurrentLocationRow = document.querySelector(
      '.find_ets-location-searchbox .flex.align-center.gap-6.margin-top-tiny'
    );
    if (useCurrentLocationRow && 'geolocation' in navigator) {
      useCurrentLocationRow.style.cursor = 'pointer';
      useCurrentLocationRow.addEventListener('click', () => {
        tryGeolocateAndCalculate();
      });
    }

    // --- 7) Places autocomplete + Search button handler ---------------

    const searchInput = document.getElementById('location-or-zipcode');
    const searchForm = document.getElementById('email-form');
    const searchButton = document.querySelector('.form-find-gym .w-button');

    let autocomplete = null;
    if (searchInput && google.maps.places) {
      autocomplete = new google.maps.places.Autocomplete(searchInput, {
        types: ['geocode'],
        componentRestrictions: { country: 'us' }
      });
      // We keep suggestions just for UX; we trigger geocoding on Search click.
    }

    const geocoder = new google.maps.Geocoder();

    function geocodeAndCalculateFromQuery(query) {
      geocoder.geocode(
        {
          address: query,
          componentRestrictions: { country: 'US' }
        },
        (results, status) => {
          if (status === 'OK' && results[0] && results[0].geometry && results[0].geometry.location) {
            const location = results[0].geometry.location;
            const userLat = location.lat();
            const userLng = location.lng();

            updateUserLocationMarker(userLat, userLng);
            calculateAndApplyDistances(location);
          } else {
            console.warn('Geocoding failed:', status);
          }
        }
      );
    }

    if (searchForm) {
      // Disable Webflow default submission
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

      geocodeAndCalculateFromQuery(query);
    }

    if (searchButton) {
      searchButton.addEventListener('click', handleSearchButtonClick);
    }

    if (searchInput) {
      // Optional: Enter key triggers search without form submit
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSearchButtonClick(e);
        }
      });
    }
  }