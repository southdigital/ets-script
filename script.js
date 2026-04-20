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

  // A11Y: Live region for announcing result counts / state changes to screen readers.
  // We create this once and reuse. It's visually hidden but read by AT.
  let liveRegion = document.getElementById('ets-live-region');
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'ets-live-region';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
    document.body.appendChild(liveRegion);
  }

  function announce(message) {
    // Clear then set — some screen readers ignore identical consecutive values.
    liveRegion.textContent = '';
    // Tiny timeout so AT reliably picks up the change.
    setTimeout(() => { liveRegion.textContent = message; }, 50);
  }

  // A11Y: Set role + label on the map container. This is requirement #1.
  const mapContainerEl = document.getElementById('heatmap');
  if (mapContainerEl) {
    mapContainerEl.setAttribute('role', 'application');
    mapContainerEl.setAttribute('aria-label', 'Find your nearest ETS location');
    // A11Y: Give the map a tabindex so keyboard users can reach Mapbox's built-in
    // keyboard controls (arrow keys to pan, +/- to zoom — these ship with Mapbox GL).
    if (!mapContainerEl.hasAttribute('tabindex')) {
      mapContainerEl.setAttribute('tabindex', '0');
    }
  }

  // A11Y: Inject a "Skip map" link (requirement #4). Placed immediately before
  // the map container. Visually hidden until focused — standard skip-link pattern.
  if (mapContainerEl && !document.getElementById('ets-skip-map')) {
    // Ensure the list container has an id we can target.
    if (!locationsContainer.id) {
      locationsContainer.id = 'ets-locations-list';
    }

    const skipLink = document.createElement('a');
    skipLink.id = 'ets-skip-map';
    skipLink.href = '#' + locationsContainer.id;
    skipLink.textContent = 'Skip map and jump to location list';
    skipLink.style.cssText = [
      'position:absolute',
      'left:-9999px',
      'top:auto',
      'width:1px',
      'height:1px',
      'overflow:hidden',
      'z-index:9999',
      'background:#000',
      'color:#fff',
      'padding:10px 16px',
      'border-radius:4px',
      'text-decoration:none',
      'font-weight:600'
    ].join(';');
    skipLink.addEventListener('focus', () => {
      skipLink.style.left = '16px';
      skipLink.style.top = '16px';
      skipLink.style.width = 'auto';
      skipLink.style.height = 'auto';
    });
    skipLink.addEventListener('blur', () => {
      skipLink.style.left = '-9999px';
      skipLink.style.top = 'auto';
      skipLink.style.width = '1px';
      skipLink.style.height = '1px';
    });
    // A11Y: When activated, move focus into the list's first card for keyboard users.
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      const firstVisibleCard = locationsContainer.querySelector(
        '.location-item:not([style*="display: none"])'
      );
      if (firstVisibleCard) {
        if (!firstVisibleCard.hasAttribute('tabindex')) {
          firstVisibleCard.setAttribute('tabindex', '-1');
        }
        firstVisibleCard.focus();
        firstVisibleCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        locationsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    mapContainerEl.parentNode.insertBefore(skipLink, mapContainerEl);
  }

  // A11Y: Label the list region so screen reader users understand its purpose.
  locationsContainer.setAttribute('role', 'region');
  locationsContainer.setAttribute('aria-label', 'ETS locations list');

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

    // A11Y: Make each card keyboard-focusable and operable. Cards act as
    // interactive elements that select the location on the map.
    cardEl.setAttribute('tabindex', '0');
    cardEl.setAttribute('role', 'button');
    const accessibleName = nameEl ? nameEl.textContent.trim() : `Location ${index + 1}`;
    const addressText = addressEl ? addressEl.textContent.trim() : '';
    cardEl.setAttribute(
      'aria-label',
      addressText ? `${accessibleName}, ${addressText}. Show on map.` : `${accessibleName}. Show on map.`
    );

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

  // --- Haversine helpers + show/hide locations -------------------
  const TOP_NEAREST_COUNT = 3;

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function setLocationVisibility(loc, isVisible) {
    const wrapper = loc.itemWrapper || loc.cardEl;

    if (wrapper) {
      wrapper.classList.toggle('d-none', !isVisible);
      wrapper.style.display = isVisible ? '' : 'none';
      // A11Y: Hide from AT when visually hidden so screen readers don't read
      // offscreen results as if they were present.
      wrapper.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }

    if (loc.marker && loc.marker.getElement()) {
      const el = loc.marker.getElement();
      el.style.display = isVisible ? '' : 'none';
      // A11Y: Remove from tab order when hidden.
      if (isVisible) {
        el.removeAttribute('aria-hidden');
        el.setAttribute('tabindex', '0');
      } else {
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('tabindex', '-1');
      }
    }
  }

  function showOnlyLocationsById(allowedIdsSet) {
    locations.forEach(loc => {
      setLocationVisibility(loc, allowedIdsSet.has(loc.id));
    });
  }

  function resetAllLocationVisibility() {
    locations.forEach(loc => setLocationVisibility(loc, true));
  }

  // --- Distance UI helpers ---------------------------------------
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

  // --- Sorting DOM by distance -----------------------------------
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

  // --- Center on densest area ----------------------------
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

  // --- Popup HTML -------------------------------------------------
  function buildPopupHTML(loc) {
    const distanceClass = loc.distanceText
      ? 'distance-in-miles-wrapper popup'
      : 'distance-in-miles-wrapper popup d-none';
    const durationClass = loc.durationText
      ? 'estimated-drie-time-wrapper popup'
      : 'estimated-drie-time-wrapper popup d-none';

    return `
      <div class="location-item map-popup" role="dialog" aria-label="${(loc.name || 'Location').replace(/"/g, '&quot;')} details">
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
          <div class="${distanceClass}">
            <div class="w-embed" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9.16732 8.25011V14.1668C9.16732 14.6668 9.50065 15.0001 10.0007 15.0001C10.5007 15.0001 10.834 14.6668 10.834 14.1668V8.25011C12.584 7.75011 13.6673 6.00011 13.2507 4.16677C12.834 2.33344 10.9173 1.33344 9.16732 1.75011C7.41732 2.16677 6.33398 4.00011 6.75065 5.83344C7.08398 7.00011 8.00065 7.91677 9.16732 8.25011ZM13.6673 10.6668C13.2507 10.5001 12.7507 10.6668 12.584 11.1668C12.4173 11.5834 12.584 12.0834 13.084 12.2501C14.334 12.7501 15.084 13.5001 15.084 14.2501C15.084 15.4168 13.0007 16.7501 10.084 16.7501C7.16732 16.7501 5.08398 15.4168 5.08398 14.2501C5.08398 13.5001 5.83398 12.7501 7.08398 12.2501C7.50065 12.0834 7.75065 11.5834 7.58398 11.1668C7.41732 10.7501 6.91732 10.5001 6.50065 10.6668C4.50065 11.4168 3.33398 12.7501 3.33398 14.1668C3.33398 16.5001 6.25065 18.3334 10.0007 18.3334C13.7507 18.3334 16.6673 16.5001 16.6673 14.1668C16.6673 12.7501 15.5007 11.4168 13.6673 10.6668Z" fill="#3FA54D"></path>
              </svg>
            </div>
            <div class="text-size-regular distance-text">
              ${loc.distanceText ? `<span class="visually-hidden">Distance: </span>${loc.distanceText}` : ''}
            </div>
          </div>

          <div class="${durationClass}">
            <div class="flex center w-embed" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16.5013 7.58333L15.3346 4.16667C15.0013 3.16667 14.0013 2.5 13.0013 2.5H7.0013C6.0013 2.5 5.0013 3.16667 4.66797 4.25L3.5013 7.58333C2.41797 7.91667 1.66797 8.83333 1.66797 10V13.3333C1.66797 14.4167 2.33464 15.3333 3.33464 15.6667V16.6667C3.33464 17.1667 3.66797 17.5 4.16797 17.5C4.66797 17.5 5.0013 17.1667 5.0013 16.6667V15.8333H15.0013V16.6667C15.0013 17.1667 15.3346 17.5 15.8346 17.5C16.3346 17.5 16.668 17.1667 16.668 16.6667V15.6667C17.668 15.3333 18.3346 14.4167 18.3346 13.3333V10C18.3346 8.83333 17.5846 7.91667 16.5013 7.58333ZM6.2513 4.75C6.33464 4.41667 6.66797 4.16667 7.0013 4.16667H12.918C13.2513 4.16667 13.5846 4.41667 13.668 4.75L14.668 7.5H5.33464L6.2513 4.75ZM5.83464 12.5C5.33464 12.5 5.0013 12.1667 5.0013 11.6667C5.0013 11.1667 5.33464 10.8333 5.83464 10.8333C6.33464 10.8333 6.66797 11.1667 6.66797 11.6667C6.66797 12.1667 6.33464 12.5 5.83464 12.5ZM10.8346 12.5H9.16797C8.66797 12.5 8.33464 12.1667 8.33464 11.6667C8.33464 11.1667 8.66797 10.8333 9.16797 10.8333H10.8346C11.3346 10.8333 11.668 11.1667 11.668 11.6667C11.668 12.1667 11.3346 12.5 10.8346 12.5ZM14.168 12.5C13.668 12.5 13.3346 12.1667 13.3346 11.6667C13.3346 11.1667 13.668 10.8333 14.168 10.8333C14.668 10.8333 15.0013 11.1667 15.0013 11.6667C15.0013 12.1667 14.668 12.5 14.168 12.5Z" fill="#696FE3"></path>
              </svg>
            </div>
            <div class="text-size-regular estimated-drive-time-text">
              ${loc.durationText ? `<span class="visually-hidden">Drive time: </span>${loc.durationText}` : ''}
            </div>
          </div>
        </div>

        <div class="text-size-regular text-color-inverse margin-top-6">
          ${loc.address || ''}
        </div>
      </div>
    `;
  }

  function clearActiveLocation() {
    if (activeLocationId === null) return;
    const prev = locations.find(l => l.id === activeLocationId);
    if (!prev) return;

    prev.cardEl.classList.remove('is-active');
    prev.cardEl.setAttribute('aria-pressed', 'false'); // A11Y

    if (prev.marker && prev.marker.getElement()) {
      const el = prev.marker.getElement();
      el.classList.remove('is-active');
      el.setAttribute('aria-expanded', 'false'); // A11Y
    }

    activeLocationId = null;
    if (activePopup && activePopup.isOpen()) activePopup.remove();
    activePopup = null;
  }

  function selectLocation(locationId, options) {
    const opts = Object.assign(
      {
        flyTo: true,
        openPopup: true,
        scrollToCard: false,
        bringToTop: false,
        setCardActive: true,
        setMarkerActive: true,
        returnFocusTo: null // A11Y: where to return focus after popup closes
      },
      options || {}
    );

    const loc = locations.find(l => l.id === locationId);
    if (!loc || !map) return;

    if (activeLocationId !== null && activeLocationId !== locationId) {
      const prev = locations.find(l => l.id === activeLocationId);
      if (prev) {
        prev.cardEl.classList.remove('is-active');
        prev.cardEl.setAttribute('aria-pressed', 'false');
        if (prev.marker && prev.marker.getElement()) {
          const el = prev.marker.getElement();
          el.classList.remove('is-active');
          el.setAttribute('aria-expanded', 'false');
        }
      }
    }

    activeLocationId = locationId;

    if (opts.setCardActive) {
      loc.cardEl.classList.add('is-active');
      loc.cardEl.setAttribute('aria-pressed', 'true');
    } else {
      loc.cardEl.classList.remove('is-active');
      loc.cardEl.setAttribute('aria-pressed', 'false');
    }

    if (loc.marker && loc.marker.getElement()) {
      const el = loc.marker.getElement();
      if (opts.setMarkerActive) {
        el.classList.add('is-active');
        el.setAttribute('aria-expanded', 'true');
      } else {
        el.classList.remove('is-active');
        el.setAttribute('aria-expanded', 'false');
      }
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

      // A11Y: Announce selection to AT users.
      const parts = [`${loc.name || 'Location'} selected.`];
      if (loc.address) parts.push(loc.address + '.');
      if (loc.distanceText) parts.push(`Distance ${loc.distanceText}.`);
      announce(parts.join(' '));
    }

    if (opts.scrollToCard) {
      loc.cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function createMarkersAndWireCards() {
    if (!map) return;

    locations.forEach(loc => {
      if (!loc.lng || !loc.lat) return;

      // A11Y: Use a <button> instead of <img> so the marker is natively
      // focusable, operable by Enter/Space, and has the right semantics.
      // The logo image becomes a decorative child with empty alt.
      const markerEl = document.createElement('button');
      markerEl.type = 'button';
      markerEl.className = 'ets-map-marker';
      markerEl.setAttribute(
        'aria-label',
        loc.address ? `${loc.name || 'ETS location'}, ${loc.address}. Press Enter to view details.` : (loc.name || 'ETS location')
      );
      markerEl.setAttribute('aria-expanded', 'false');
      markerEl.setAttribute('aria-haspopup', 'dialog');
      // Reset default button styling so it still visually matches the original pin.
      markerEl.style.background = 'transparent';
      markerEl.style.border = '0';
      markerEl.style.padding = '0';
      markerEl.style.cursor = 'pointer';

      const markerImg = document.createElement('img');
      markerImg.src =
        'https://cdn.prod.website-files.com/68f9dd01a660a09f46b08cb1/692e9fb0f13b7e4c83995eba_high-res-logo-ets-p-3200.png';
      markerImg.alt = ''; // Decorative — the button's aria-label carries the name.
      markerImg.setAttribute('aria-hidden', 'true');
      markerImg.draggable = false;
      markerImg.style.pointerEvents = 'none'; // Let the button own click/focus.
      markerImg.style.display = 'block';
      markerImg.style.width = '100%';
      markerImg.style.height = '100%';
      markerEl.appendChild(markerImg);

      const popup = new mapboxgl.Popup({
        offset: 24,
        closeButton: true,
        closeOnClick: true
      }).setHTML(buildPopupHTML(loc));

      popup.on('close', () => {
        if (activeLocationId === loc.id) {
          // A11Y: Return focus to the marker that opened the popup, so keyboard
          // users aren't stranded at the top of the page.
          clearActiveLocation();
          if (markerEl && typeof markerEl.focus === 'function') {
            markerEl.focus();
          }
        }
      });

      const marker = new mapboxgl.Marker(markerEl)
        .setLngLat([loc.lng, loc.lat])
        .setPopup(popup)
        .addTo(map);

      loc.marker = marker;

      // Click handler (mouse + Enter/Space on a <button> fire click natively).
      markerEl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        selectLocation(loc.id, {
          flyTo: true,
          openPopup: true,
          scrollToCard: false,
          bringToTop: true,
          setCardActive: true,
          setMarkerActive: true
        });
      });

      // A11Y: Escape closes the popup and returns focus to the marker.
      markerEl.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && activePopup && activePopup.isOpen()) {
          activePopup.remove();
          markerEl.focus();
        }
      });
    });

    // A11Y: Wire card keyboard + click activation. Cards are now role="button"
    // with tabindex=0, so we handle Enter/Space and click.
    locations.forEach(loc => {
      loc.cardEl.style.cursor = 'pointer';
      loc.cardEl.setAttribute('aria-pressed', 'false');

      const activate = (e) => {
        e.preventDefault();
        selectLocation(loc.id, {
          flyTo: true,
          openPopup: true,
          scrollToCard: false,
          bringToTop: false,
          setCardActive: true,
          setMarkerActive: true
        });
      };

      loc.cardEl.addEventListener('click', activate);
      loc.cardEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          activate(e);
        }
      });
    });
  }

  // --- Places + Search -------------------------------------------
  const searchInput = document.getElementById('location-or-zipcode');
  const searchForm = document.getElementById('email-form');
  const searchButton = document.querySelector('.form-find-gym .w-button');

  // A11Y: Make sure the search input has a visible/programmatic label.
  // If the markup doesn't already have a <label for="location-or-zipcode">,
  // fall back to aria-label so AT users know what the field is for.
  if (searchInput) {
    const hasLabel = !!document.querySelector('label[for="location-or-zipcode"]');
    if (!hasLabel && !searchInput.hasAttribute('aria-label')) {
      searchInput.setAttribute('aria-label', 'Enter a city or ZIP code to find ETS locations');
    }
    searchInput.setAttribute('autocomplete', 'postal-code');
    searchInput.setAttribute('inputmode', 'search');
  }

  let isSearchingUI = false;
  let originalSearchButtonLabel = null;

  function setSearchButtonLabel(text) {
    if (!searchButton) return;
    if (originalSearchButtonLabel === null) {
      if ('value' in searchButton && typeof searchButton.value === 'string' && searchButton.value) {
        originalSearchButtonLabel = searchButton.value;
      } else {
        originalSearchButtonLabel = searchButton.textContent;
      }
    }
    if ('value' in searchButton && typeof searchButton.value === 'string') {
      searchButton.value = text;
    } else {
      searchButton.textContent = text;
    }
  }

  function restoreSearchButtonLabel() {
    if (!searchButton) return;
    if (originalSearchButtonLabel === null) return;
    if ('value' in searchButton && typeof searchButton.value === 'string') {
      searchButton.value = originalSearchButtonLabel;
    } else {
      searchButton.textContent = originalSearchButtonLabel;
    }
  }

  function setSearchingUIState(isOn) {
    if (isSearchingUI === isOn) return;
    isSearchingUI = isOn;

    if (isOn) setSearchButtonLabel('Searching...'); // A11Y: fixed typo "seraching"
    else restoreSearchButtonLabel();

    // A11Y: Communicate busy state to AT.
    if (searchButton) {
      searchButton.setAttribute('aria-busy', isOn ? 'true' : 'false');
      if (isOn) searchButton.setAttribute('aria-disabled', 'true');
      else searchButton.removeAttribute('aria-disabled');
    }
    locationsContainer.setAttribute('aria-busy', isOn ? 'true' : 'false');

    locations.forEach(loc => {
      if (loc && loc.cardEl) loc.cardEl.style.opacity = isOn ? '0.5' : '1';
    });
  }

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
    const options = Object.assign({ flyTo: true, flyZoom: 6 }, opts || {});
    setSearchingUIState(true);

    geocoder.geocode({ address: query, componentRestrictions: { country: 'US' } }, (results, status) => {
      if (status === 'OK' && results[0]?.geometry?.location) {
        const location = results[0].geometry.location;
        const userLat = location.lat();
        const userLng = location.lng();

        updateUserLocationMarker(userLat, userLng);

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
        // A11Y: Tell AT users that the search failed.
        announce('We could not find that location. Please check spelling or try a ZIP code.');
        setSearchingUIState(false);
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
    if (!query) {
      announce('Please enter a city or ZIP code.');
      searchInput.focus();
      return;
    }
    clearActiveLocation();
    setSearchingUIState(true);
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

  // --- Distance Matrix & user location ---------------
  const MAX_DESTINATIONS_PER_REQUEST = 25;
  const distanceService = new google.maps.DistanceMatrixService();

  async function calculateAndApplyDistances(originLatLng, options) {
    const opts = Object.assign({ sortResults: true }, options || {});
    if (!locations.length) return;

    setSearchingUIState(true);

    try {
      const originLat = typeof originLatLng.lat === 'function' ? originLatLng.lat() : originLatLng.lat;
      const originLng = typeof originLatLng.lng === 'function' ? originLatLng.lng() : originLatLng.lng;

      resetAllLocationVisibility();

      locations.forEach(loc => {
        loc.durationText = null;
        if (loc.durationWrapper) loc.durationWrapper.classList.add('d-none');

        if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
          loc.distanceValueMeters = Number.POSITIVE_INFINITY;
          if (loc.distanceWrapper) loc.distanceWrapper.classList.add('d-none');
          return;
        }

        const meters = haversineMeters(originLat, originLng, loc.lat, loc.lng);
        loc.distanceValueMeters = meters;

        const miles = meters / 1609.344;
        loc.distanceText = `${miles.toFixed(1)} mi`;

        if (loc.distanceTextEl) loc.distanceTextEl.textContent = loc.distanceText;
        if (loc.distanceWrapper) loc.distanceWrapper.classList.remove('d-none');

        // A11Y: Update card's aria-label so AT users hear the new distance.
        const parts = [loc.name || 'ETS location'];
        if (loc.address) parts.push(loc.address);
        parts.push(`${loc.distanceText} away`);
        loc.cardEl.setAttribute('aria-label', parts.join(', ') + '. Show on map.');

        if (loc.marker && loc.marker.getPopup()) {
          loc.marker.getPopup().setHTML(buildPopupHTML(loc));
        }
      });

      if (opts.sortResults) {
        sortLocationsByDistance();
      }

      // A11Y: Announce result count so screen reader users know results loaded.
      const visibleCount = locations.filter(
        l => typeof l.distanceValueMeters === 'number' && isFinite(l.distanceValueMeters)
      ).length;
      announce(
        visibleCount
          ? `Showing ${visibleCount} ETS location${visibleCount === 1 ? '' : 's'}, sorted by distance. Nearest: ${locations[0]?.name || ''}, ${locations[0]?.distanceText || ''}.`
          : 'No ETS locations found.'
      );
    } catch (err) {
      console.error('Haversine error:', err);
      hideDistanceUI();
    } finally {
      setSearchingUIState(false);
    }
  }

  function updateUserLocationMarker(lat, lng) {
    lastUserLngLat = { lat, lng };
    if (!map) return;

    if (!userLocationMarker) {
      const el = document.createElement('div');
      el.className = 'ets-user-marker';
      // A11Y: User-location dot is decorative — the list announces "near you".
      el.setAttribute('aria-hidden', 'true');
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

    updateUserLocationMarker(latitude, longitude);
    const originLatLng = new google.maps.LatLng(latitude, longitude);

    calculateAndApplyDistances(originLatLng, {
      autoSelectNearest: true,
      fitMapToUserAndNearest: lastGeolocateWasUserAction
    });

    if (lastGeolocateWasUserAction) {
      announce('Showing ETS locations near your current location.');
    }
    lastGeolocateWasUserAction = false;
  }

  function handleGeolocationError(error) {
    console.warn('Geolocation error:', error);
    if (lastGeolocateWasUserAction) {
      lastGeolocateWasUserAction = false;
      setSearchingUIState(false);
      return;
    }
    hideDistanceUI();
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

  // --- Map init -----
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

    // A11Y: NavigationControl buttons are focusable by default; keep them.
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    // A11Y: Mapbox keyboard handler ships enabled by default (arrows pan, +/- zoom).
    // We assert it explicitly so a future refactor doesn't accidentally disable it.
    if (map.keyboard && typeof map.keyboard.enable === 'function') {
      map.keyboard.enable();
    }

    map.on('load', () => {
      createMarkersAndWireCards();

      if (typeof animateToZoom === 'number') {
        map.easeTo({
          center: [centerLngLat.lng, centerLngLat.lat],
          zoom: animateToZoom,
          duration: 900,
          essential: true,
          offset: [0, 30]
        });
      }
    });
  }

  // --- Bootstrapping ---------------------------------------
  (async function bootstrap() {
    const urlQuery = getQueryFromUrl();

    if ('geolocation' in navigator) {
      tryGeolocateAndCalculate(false);
    } else {
      hideDistanceUI();
    }

    const useCurrentLocationRow = document.querySelector(
      '.find_ets-location-searchbox .flex.align-center.gap-6.margin-top-tiny'
    );
    if (useCurrentLocationRow && 'geolocation' in navigator) {
      // A11Y: Turn the "use current location" row into a real button.
      useCurrentLocationRow.style.cursor = 'pointer';
      if (!useCurrentLocationRow.hasAttribute('role')) {
        useCurrentLocationRow.setAttribute('role', 'button');
      }
      if (!useCurrentLocationRow.hasAttribute('tabindex')) {
        useCurrentLocationRow.setAttribute('tabindex', '0');
      }
      if (!useCurrentLocationRow.hasAttribute('aria-label')) {
        useCurrentLocationRow.setAttribute('aria-label', 'Use my current location');
      }
      const triggerGeolocate = () => {
        clearActiveLocation();
        tryGeolocateAndCalculate(true);
      };
      useCurrentLocationRow.addEventListener('click', triggerGeolocate);
      useCurrentLocationRow.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerGeolocate();
        }
      });
    }

    if (urlQuery) {
      try {
        if (searchInput) searchInput.value = urlQuery;
        const { gLocation, lat, lng } = await geocodeQuery(urlQuery);
        initMapWithCenter({ lat, lng }, 4, 6);
        updateUserLocationMarker(lat, lng);
        calculateAndApplyDistances(gLocation, {
          autoSelectNearest: false,
          fitMapToUserAndNearest: false
        });
        hasDoneInitialCameraMove = true;
        return;
      } catch (err) {
        console.warn('URL query geocode failed, falling back to default map:', err);
      }
    }

    initMapWithCenter({ lng: -98.5795, lat: 39.8283 }, 3);
    map.on('load', () => {
      centerMapOnDensestArea();
    });
  })();
}