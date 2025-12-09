const GOOGLE_API_KEY = 'AIzaSyBh_TeVoplznorINcTO5QAAi1kgBwtd7jk';

function initETSLocationFinder() {
    const locationsContainer = document.querySelector('.locations-ets.w-dyn-items');
    if (!locationsContainer) return;

    // --- 1) Build locations array from DOM -----------------------------
    const locationCardEls = locationsContainer.querySelectorAll('.location-item');

    const locations = Array.from(locationCardEls).map((cardEl, index) => {
        const lat = parseFloat(cardEl.getAttribute('data-lat'));
        const lng = parseFloat(cardEl.getAttribute('data-lng'));

        const itemWrapper = cardEl.closest('.w-dyn-item') || cardEl;

        const distanceWrapper = cardEl.querySelector('.distance-in-miles-wrapper');
        const distanceTextEl = cardEl.querySelector('.distance-text'); // <div class="distance-text">

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
        distanceValueMeters: null, // numeric distance for sorting
        distanceText: null,
        durationText: null
        };
    });

    if (!locations.length) return;

    // --- 2) Utility: hide distance/time UI -----------------------------
    function hideDistanceUI() {
        locations.forEach(loc => {
        if (loc.distanceWrapper) loc.distanceWrapper.classList.add('d-none');
        if (loc.durationWrapper) loc.durationWrapper.classList.add('d-none');
        });
    }

    // --- 3) Sorting DOM by distance -----------------------------------
    function sortLocationsByDistance() {
        if (!locationsContainer) return;

        // Smallest distance first
        locations.sort((a, b) => {
        const da = typeof a.distanceValueMeters === 'number' ? a.distanceValueMeters : Number.POSITIVE_INFINITY;
        const db = typeof b.distanceValueMeters === 'number' ? b.distanceValueMeters : Number.POSITIVE_INFINITY;
        return da - db;
        });

        // Re-append the .w-dyn-item wrappers in new order
        locations.forEach(loc => {
        if (loc.itemWrapper) {
            locationsContainer.appendChild(loc.itemWrapper);
        } else {
            locationsContainer.appendChild(loc.cardEl);
        }
        });
    }

    // --- 4) Distance Matrix: compute distance & drive time ------------
    const MAX_DESTINATIONS_PER_REQUEST = 25; // per Distance Matrix limits
    const distanceService = new google.maps.DistanceMatrixService();

    async function calculateAndApplyDistances(userLat, userLng) {
        if (!locations.length) return;

        const origin = new google.maps.LatLng(userLat, userLng);
        const promises = [];

        for (let i = 0; i < locations.length; i += MAX_DESTINATIONS_PER_REQUEST) {
        const chunk = locations.slice(i, i + MAX_DESTINATIONS_PER_REQUEST);
        const destinations = chunk.map(loc => new google.maps.LatLng(loc.lat, loc.lng));

        // Wrap DistanceMatrixService callback into a Promise
        const p = new Promise((resolve, reject) => {
            distanceService.getDistanceMatrix(
            {
                origins: [origin],
                destinations,
                travelMode: google.maps.TravelMode.DRIVING,
                unitSystem: google.maps.UnitSystem.IMPERIAL // miles
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
                const distanceText = el.distance.text; // e.g. "12.3 mi"
                const durationText = el.duration.text; // e.g. "25 mins"

                loc.distanceValueMeters = el.distance.value;
                loc.distanceText = distanceText;
                loc.durationText = durationText;

                if (loc.distanceTextEl) {
                loc.distanceTextEl.textContent = distanceText;
                }
                if (loc.durationTextEl) {
                loc.durationTextEl.textContent = durationText;
                }

                // Ensure visible (user might have denied earlier)
                if (loc.distanceWrapper) loc.distanceWrapper.classList.remove('d-none');
                if (loc.durationWrapper) loc.durationWrapper.classList.remove('d-none');
            } else {
                loc.distanceValueMeters = Number.POSITIVE_INFINITY;
            }
            });
        });

        sortLocationsByDistance();
        } catch (err) {
        console.error('Distance Matrix error:', err);
        hideDistanceUI();
        }
    }

    // --- 5) Geolocation: "Use current location" -----------------------

    // This is the row with the map-pin icon + "Use current location" text
    const useCurrentLocationRow = document.querySelector(
        '.find_ets-location-searchbox .flex.align-center.gap-6.margin-top-tiny'
    );

    if (useCurrentLocationRow && 'geolocation' in navigator) {
        useCurrentLocationRow.style.cursor = 'pointer';

        useCurrentLocationRow.addEventListener('click', () => {
        navigator.geolocation.getCurrentPosition(
            position => {
            const { latitude, longitude } = position.coords;
            calculateAndApplyDistances(latitude, longitude);
            },
            error => {
            console.warn('Geolocation error:', error);
            // User denied or error – hide distance/time and leave sorting as-is
            hideDistanceUI();
            },
            {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 300000
            }
        );
        });
    } else {
        // If geolocation is not available at all, hide distance/time
        if (!('geolocation' in navigator)) {
        hideDistanceUI();
        }
    }

    // --- 6) Places Autocomplete (US only) for the search bar ----------

    const searchInput = document.getElementById('location-or-zipcode');

    if (searchInput && google.maps.places) {
        const autocomplete = new google.maps.places.Autocomplete(searchInput, {
        types: ['geocode'],
        componentRestrictions: { country: 'us' }
        });

        autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place || !place.geometry || !place.geometry.location) {
            return;
        }

        const userLat = place.geometry.location.lat();
        const userLng = place.geometry.location.lng();

        // Use selected place as "user location" for distances
        calculateAndApplyDistances(userLat, userLng);
        });
    }
}
