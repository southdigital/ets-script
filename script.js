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
  let lastGeolocateWasUserAction = false; // track "Use current location" clicks

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
      if (loc.itemWrapper) {
        locationsContainer.appendChild(loc.itemWrapper);
      } else {
        locationsContainer.appendChild(loc.cardEl);
      }
    });
  }

  function bringCardToTop(loc) {
    if (!locationsContainer || !loc.itemWrapper) return;

    // Move DOM
    locationsContainer.insertBefore(loc.itemWrapper, locationsContainer.firstChild);

    // Keep JS array consistent
    const idx = locations.indexOf(loc);
    if (idx > 0) {
      locations.splice(idx, 1);
      locations.unshift(loc);
    }
  }

  // --- 3b) Center on area with most gyms ----------------------------

  function centerMapOnDensestArea() {
    if (!map || !locations.length) return;

    // Bucket locations into a 1-degree lat/lng grid and pick the densest cell
    const cellSize = 1; // degrees
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

    // Prefer densest cluster; fallback to all locations
    const targetLocs = bestCellLocations && bestCellLocations.length ? bestCellLocations : locations;

    let bounds = null;
    targetLocs.forEach(loc => {
      if (!loc.lat || !loc.lng) return;
      const coord = [loc.lng, loc.lat];
      if (!bounds) {
        bounds = new mapboxgl.LngLatBounds(coord, coord);
      } else {
        bounds.extend(coord);
      }
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

  // --- 4) Mapbox initialization -------------------------------------

  if (!window.mapboxgl) {
    console.error('Mapbox GL JS not found');
  } else {
    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const mapContainer = document.getElementById('heatmap');
    if (!mapContainer) {
      console.warn('Map container #heatmap not found');
    } else {
      map = new mapboxgl.Map({
        container: 'heatmap',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [-98.5795, 39.8283],
        zoom: 3
      });

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

      map.on('load', function () {
        // First load: center on area that has the most gyms
        centerMapOnDensestArea();
        createMarkersAndWireCards();
      });
    }
  }

  // --- 5) Selection / syncing (markers -> cards) --------------------

  // function buildPopupHTML(loc) {
  //   return `
  //     <div class="ets-popup">
  //       <div class="ets-popup-title">${loc.name || ''}</div>
  //       <div class="ets-popup-address">${loc.address || ''}</div>
  //       <div class="ets-popup-meta">
  //         ${loc.distanceText ? `<span class="ets-popup-pill">${loc.distanceText}</span>` : ''}
  //         ${loc.durationText ? `<span class="ets-popup-pill">${loc.durationText}</span>` : ''}
  //       </div>
  //     </div>
  //   `;
  // }

  function buildPopupHTML(loc) {
    return `
      <div class="location-item map-popup">
        <div class="flex map-popup-header">
          <div class="logo-wrapper-location card-image-wrapper-2">
            <img
              src="https://cdn.prod.website-files.com/68f9dd01a660a09f46b08cb1/68fb200cedc665fc0b63ccce_ets-logo.avif"
              loading="lazy"
              alt=""
              class="map-card-image"
            >
          </div>
          <div class="text-size-large text-color-inverse text-weight-bold">
            ${loc.name || ''}
          </div>
        </div>

        <div class="flex gap-small margin-top-6">

          <div class="d-none distance-in-miles-wrapper popup">
            <div class="w-embed">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9.16732 8.25011V14.1668C9.16732 14.6668 9.50065 15.0001 10.0007 15.0001C10.5007 15.0001 10.834 14.6668 10.834 14.1668V8.25011C12.584 7.75011 13.6673 6.00011 13.2507 4.16677C12.834 2.33344 10.9173 1.33344 9.16732 1.75011C7.41732 2.16677 6.33398 4.00011 6.75065 5.83344C7.08398 7.00011 8.00065 7.91677 9.16732 8.25011ZM13.6673 10.6668C13.2507 10.5001 12.7507 10.6668 12.584 11.1668C12.4173 11.5834 12.584 12.0834 13.084 12.2501C14.334 12.7501 15.084 13.5001 15.084 14.2501C15.084 15.4168 13.0007 16.7501 10.084 16.7501C7.16732 16.7501 5.08398 15.4168 5.08398 14.2501C5.08398 13.5001 5.83398 12.7501 7.08398 12.2501C7.50065 12.0834 7.75065 11.5834 7.58398 11.1668C7.41732 10.7501 6.91732 10.5001 6.50065 10.6668C4.50065 11.4168 3.33398 12.7501 3.33398 14.1668C3.33398 16.5001 6.25065 18.3334 10.0007 18.3334C13.7507 18.3334 16.6673 16.5001 16.6673 14.1668C16.6673 12.7501 15.5007 11.4168 13.6673 10.6668Z" fill="#3FA54D"></path>
              </svg>
            </div>
            <div class="text-size-regular distance-text">
              ${loc.distanceText || ''}
            </div>
          </div>

          <div class="estimated-drie-time-wrapper d-none">
            <div class="flex center w-embed">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16.5013 7.58333L15.3346 4.16667C15.0013 3.16667 14.0013 2.5 13.0013 2.5H7.0013C6.0013 2.5 5.0013 3.16667 4.66797 4.25L3.5013 7.58333C2.41797 7.91667 1.66797 8.83333 1.66797 10V13.3333C1.66797 14.4167 2.33464 15.3333 3.33464 15.6667V16.6667C3.33464 17.1667 3.66797 17.5 4.16797 17.5C4.66797 17.5 5.0013 17.1667 5.0013 16.6667V15.8333H15.0013V16.6667C15.0013 17.1667 15.3346 17.5 15.8346 17.5C16.3346 17.5 16.668 17.1667 16.668 16.6667V15.6667C17.668 15.3333 18.3346 14.4167 18.3346 13.3333V10C18.3346 8.83333 17.5846 7.91667 16.5013 7.58333Z" fill="#696FE3"></path>
              </svg>
            </div>
            <div class="text-size-regular estimated-drive-time-text">
              ${loc.durationText || ''}
            </div>
          </div>

        </div>

        <div class="text-size-regular text-color-inverse margin-top-6">
          ${loc.address || ''}
        </div>
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
        setCardActive: true,   // control whether card gets "is-active"
        setMarkerActive: true  // control whether marker gets "is-active"
      },
      options || {}
    );

    const loc = locations.find(l => l.id === locationId);
    if (!loc || !map) return;

    // Clear previous active visuals
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

    // Card & marker "active" styles
    if (opts.setCardActive) {
      loc.cardEl.classList.add('is-active');
    } else {
      // Ensure we don't leave stray active state on this card
      loc.cardEl.classList.remove('is-active');
    }

    if (loc.marker && loc.marker.getElement()) {
      if (opts.setMarkerActive) {
        loc.marker.getElement().classList.add('is-active');
      } else {
        loc.marker.getElement().classList.remove('is-active');
      }
    }

    // Bring card to top in list if requested
    if (opts.bringToTop) {
      bringCardToTop(loc);
    }

    // Update popup content to latest distance/time
    if (loc.marker && loc.marker.getPopup()) {
      loc.marker.getPopup().setHTML(buildPopupHTML(loc));
    }

    // Fly map to this location (center it)
    if (opts.flyTo && loc.lat && loc.lng) {
      map.flyTo({
        center: [loc.lng, loc.lat],
        zoom: 11,
        speed: 1.4,
        curve: 1.4,
        essential: true
      });
    }

    // Open popup
    if (opts.openPopup && loc.marker && loc.marker.getPopup()) {
      if (activePopup && activePopup.isOpen()) {
        activePopup.remove();
      }
      activePopup = loc.marker.getPopup();
      activePopup.addTo(map);
    }

    // We NEVER pass scrollToCard: true anywhere, but keeping it for future
    if (opts.scrollToCard) {
      loc.cardEl.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }

  function createMarkersAndWireCards() {
    if (!map) return;

    locations.forEach(loc => {
      if (!loc.lng || !loc.lat) return;

      const markerEl = document.createElement('img');
      markerEl.src = 'https://cdn.prod.website-files.com/68f9dd01a660a09f46b08cb1/692e9fb0f13b7e4c83995eba_high-res-logo-ets-p-3200.png';   // <-- your logo file here
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

      // MARKER CLICK:
      // - fly to the gym (center map)
      // - bring that card to top of the list
      // - DO NOT scroll the page
      // - DO NOT mark card as "active"
      markerEl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        selectLocation(loc.id, {
          flyTo: true,
          openPopup: true,
          scrollToCard: false,
          bringToTop: true,
          setCardActive: false,  // <-- card is moved but not styled as active
          setMarkerActive: true
        });
      });
    });

    // REMOVE CARD CLICK: no click handlers, no scroll
    locations.forEach(loc => {
      loc.cardEl.style.cursor = 'default';
    });
  }

  // --- 6) Distance Matrix & user location integration ---------------

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

            if (loc.distanceTextEl) {
              loc.distanceTextEl.textContent = distanceText;
            }
            if (loc.durationTextEl) {
              loc.durationTextEl.textContent = durationText;
            }

            showDistanceForLocation(loc);

            // Update popup with latest distance/time
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

      // Keep sorting as-is: nearest on top by distance
      sortLocationsByDistance();

      if (map && lastUserLngLat && locations.length && opts.fitMapToUserAndNearest) {
        const nearest = locations[0];
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([lastUserLngLat.lng, lastUserLngLat.lat]);
        bounds.extend([nearest.lng, nearest.lat]);

        map.fitBounds(bounds, { padding: 40, maxZoom: 11 });

        if (opts.autoSelectNearest) {
          selectLocation(nearest.id, {
            flyTo: false,        // fitBounds already moved camera
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

      userLocationMarker = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      userLocationMarker.setLngLat([lng, lat]);
    }
  }

  // Rough US bounding boxes (contiguous US + AK + HI)
  function isInUSA(lat, lng) {
    const inLower48 = lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66;
    const inAlaska = lat >= 51 && lat <= 72 && lng >= -170 && lng <= -129;
    const inHawaii = lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154;
    return inLower48 || inAlaska || inHawaii;
  }

  function handleGeolocationSuccess(position) {
    const { latitude, longitude } = position.coords;

    // If user explicitly clicked "Use current location" but is outside US
    if (lastGeolocateWasUserAction && !isInUSA(latitude, longitude)) {
      alert(
        'It looks like you are currently outside the United States. To find an ETS Gym, please enter a U.S. city or ZIP code in the search bar.'
      );
      lastGeolocateWasUserAction = false;
      return;
    }

    updateUserLocationMarker(latitude, longitude);

    const originLatLng = new google.maps.LatLng(latitude, longitude);

    // For auto-on-load geolocation: keep map centered on "most gyms"
    // For explicit "Use current location": center between user + nearest
    calculateAndApplyDistances(originLatLng, {
      autoSelectNearest: true,
      fitMapToUserAndNearest: lastGeolocateWasUserAction
    });

    // Success notification ONLY when user tapped "Use current location"
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

  // Ask for location ON LOAD (distance + sorting), but don't move map
  if ('geolocation' in navigator) {
    tryGeolocateAndCalculate(false);
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
      tryGeolocateAndCalculate(true);
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
    // We trigger geocoding on Search click, not on place_changed
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

          // For manual search: fly to the searched area and center it
          if (map) {
            map.flyTo({
              center: [userLng, userLat],
              zoom: 6,
              speed: 1.4,
              curve: 1.4,
              essential: true
            });
          }

          // Recalculate distances & sort, but do NOT auto-select / popup
          calculateAndApplyDistances(location, {
            autoSelectNearest: false,
            fitMapToUserAndNearest: false
          });
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
    // Enter key triggers search without form submit
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearchButtonClick(e);
      }
    });
  }
}
