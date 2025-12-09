const GOOGLE_API_KEY = 'AIzaSyBh_TeVoplznorINcTO5QAAi1kgBwtd7jk';

function initETSLocationFinder() {
    const locationsContainer = document.querySelector('.locations-ets.w-dyn-items');
    if (!locationsContainer) return;

    // --- 1) Build locations array from DOM -----------------------------
    const locationCardEls = locationsContainer.querySelectorAll('.location-item');

    const locations = Array.from(locationCardEls).map((cardEl, index) => {
        const lat = parseFloat(cardEl.getAttribute('data-lat'));
        const lng = parseFloat(cardEl.getAttribute('data-lng'));

        // Each card is inside a .w-dyn-item wrapper
        const itemWrapper = cardEl.closest('.w-dyn-item') || cardEl;

        const distanceWrapper = cardEl.querySelector('.distance-in-miles-wrapper');
        const distanceTextEl = cardEl.querySelector('.distance-text');

        const durationWrapper = cardEl.querySelector('.estimated-drie-time-wrapper');
        const durationTextEl = cardEl.querySelector('.estimated-drive-time-text');

        return {
        id: index,
        lat,
        lng,
        cardEl,
        itemWrapper,
        distanceWrapper,
        distanceTextEl,
        durationWrapper,
        durationTextEl,
        distanceValueMeters: null,
        distanceText: null,
        durationText: null
        };
    });

    if (!locations.length) return;

    // --- 2) Utility: hide / show distance & time ----------------------

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

    // Start with whatever is in HTML (you’ve put d-none by default).
    // We’ll only remove d-none after we have real data.

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

    // --- 4) Distance Matrix: compute distance & drive time ------------

    const MAX_DESTINATIONS_PER_REQUEST = 25;
    const distanceService = new google.maps.DistanceMatrixService();

    /**
     * origin can be a google.maps.LatLng (geolocation) or any LatLng-like.
     */
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

                // We now have valid data: show wrappers
                showDistanceForLocation(loc);
            } else {
                // No distance – keep them hidden for this location
                loc.distanceValueMeters = Number.POSITIVE_INFINITY;
                if (loc.distanceWrapper) loc.distanceWrapper.classList.add('d-none');
                if (loc.durationWrapper) loc.durationWrapper.classList.add('d-none');
            }
            });
        });

        sortLocationsByDistance();
        } catch (err) {
        console.error('Distance Matrix error:', err);
        // On total failure, hide everything again
        hideDistanceUI();
        }
    }

    // --- 5) Geolocation handlers (page-load + "Use current location") -

    function handleGeolocationSuccess(position) {
        const { latitude, longitude } = position.coords;
        const originLatLng = new google.maps.LatLng(latitude, longitude);
        calculateAndApplyDistances(originLatLng);
    }

    function handleGeolocationError(error) {
        console.warn('Geolocation error:', error);
        // User denied or error – distance & time stay hidden
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

    // 🔔 Ask for location ON LOAD
    if ('geolocation' in navigator) {
        tryGeolocateAndCalculate();
    } else {
        hideDistanceUI();
    }

    // 🧭 "Use current location" click
    const useCurrentLocationRow = document.querySelector(
        '.find_ets-location-searchbox .flex.align-center.gap-6.margin-top-tiny'
    );
    if (useCurrentLocationRow && 'geolocation' in navigator) {
        useCurrentLocationRow.style.cursor = 'pointer';
        useCurrentLocationRow.addEventListener('click', () => {
        tryGeolocateAndCalculate();
        });
    }


    const searchInput = document.getElementById('location-or-zipcode');
    const searchForm = document.getElementById('email-form');
    const searchButton = document.querySelector('.form-find-gym .w-button');

    let autocomplete = null;
    if (searchInput && google.maps.places) {
        autocomplete = new google.maps.places.Autocomplete(searchInput, {
        types: ['geocode'],
        componentRestrictions: { country: 'us' }
        });
        // We keep suggestions, but we won’t rely on place_changed.
        // The real trigger is the Search button / form submit.
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
            calculateAndApplyDistances(location);
            } else {
            console.warn('Geocoding failed:', status);
            // Don’t change existing distances in this case.
            }
        }
        );
    }

    // --- SEARCH BUTTON CLICK HANDLER (NO FORM SUBMISSION) ---

    if (searchForm) {
    // Disable Webflow automatic submission entirely
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        return false; // stop Webflow default
    });
    }

    function handleSearchButtonClick(e) {
    e.preventDefault(); // stop Webflow’s form submit
    e.stopPropagation();

    const query = searchInput.value.trim();
    if (!query) return;

    geocodeAndCalculateFromQuery(query);
    }

    if (searchButton) {
        searchButton.addEventListener('click', handleSearchButtonClick);
    }

}