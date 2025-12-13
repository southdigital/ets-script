(function initETSPopupNearest() {
  console.log("[ETS-POPUP] init");

  const NETLIFY_URL = "https://etsperformance.netlify.app/.netlify/functions/nearest-locations";
  const LIMIT = 5;

  // -------- DOM --------
  const form = document.getElementById("find-loc-form-popup");
  const input = document.getElementById("user-city-popup");
  const submitBtn = form?.querySelector('input[type="submit"], .w-button');
  const useCurrentBtn = document.querySelector(".use-current-location-popup-btn");
  const listContainer = document.querySelector(
    ".secondary-locations.locations-popup .w-dyn-items"
  );

  if (!form || !input || !submitBtn || !listContainer) {
    console.error("[ETS-POPUP] Missing required DOM nodes");
    return;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  // -------- UI --------
  let isLoading = false;
  const originalBtnText = submitBtn.value || "Search";

  function setLoading(on) {
    isLoading = on;
    submitBtn.disabled = on;
    if ("value" in submitBtn) {
      submitBtn.value = on ? "Searching..." : originalBtnText;
    }
    listContainer.style.opacity = on ? "0.35" : "1";
  }

  function locationDeniedAlert() {
    alert("We can't access your location, please type your zipcode or city.");
  }

  // -------- TEMPLATE --------
  const templateItem = listContainer.querySelector(".w-dyn-item");
  if (!templateItem) {
    console.error("[ETS-POPUP] No template list item found");
    return;
  }

  function renderLocations(items = []) {
    listContainer.innerHTML = "";

    items.slice(0, LIMIT).forEach((data) => {
      const node = templateItem.cloneNode(true);

      const title = node.querySelector("h3");
      if (title) title.textContent = data.name || "";

      const addressText = node.querySelector(".directions-link .text-size-regular");
      if (addressText) addressText.textContent = data.address || "";

      const directionsLink = node.querySelector(".directions-link");
      if (directionsLink && data.lat && data.lng) {
        directionsLink.href = `https://www.google.com/maps/dir/?api=1&destination=${data.lat},${data.lng}`;
      }

      const bookBtn = [...node.querySelectorAll("a")].find((a) =>
        a.textContent.toLowerCase().includes("book")
      );
      if (bookBtn) bookBtn.href = data.bookUrl || "#";

      listContainer.appendChild(node);
    });
  }

  // -------- API --------
  async function fetchNearest(payload) {
    const res = await fetch(NETLIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Request failed");
    return json.items || [];
  }

  async function searchByText(query) {
    if (!query || isLoading) return;
    setLoading(true);
    try {
      const items = await fetchNearest({ q: query, limit: LIMIT });
      renderLocations(items);
    } catch (err) {
      console.error("[ETS-POPUP] text search error", err);
    } finally {
      setLoading(false);
    }
  }

  async function searchByCoords(lat, lng) {
    setLoading(true);
    try {
      const items = await fetchNearest({ lat, lng, limit: LIMIT });
      renderLocations(items);
    } catch (err) {
      console.error("[ETS-POPUP] coord search error", err);
    } finally {
      setLoading(false);
    }
  }

  // -------- SEARCH BUTTON --------
  submitBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    searchByText(input.value.trim());
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // -------- GOOGLE PLACES (US ONLY) --------
  if (window.google?.maps?.places) {
    const autocomplete = new google.maps.places.Autocomplete(input, {
      types: ["geocode"],
      componentRestrictions: { country: "us" }
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      const loc = place?.geometry?.location;
      if (loc) {
        searchByCoords(loc.lat(), loc.lng());
      }
    });
  } else {
    console.error("[ETS-POPUP] Google Places not available");
  }

  // -------- CURRENT LOCATION --------
  async function isUSLocation(lat, lng) {
    if (!google?.maps?.Geocoder) return true;

    const geocoder = new google.maps.Geocoder();
    return new Promise((resolve) => {
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status !== "OK" || !results?.[0]) return resolve(false);
        const country = results[0].address_components.find((c) =>
          c.types.includes("country")
        );
        resolve(country?.short_name === "US");
      });
    });
  }

  useCurrentBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!navigator.geolocation) {
      locationDeniedAlert();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;

        const isUS = await isUSLocation(latitude, longitude);
        if (!isUS) {
          alert("Current location search is available for US locations only.");
          return;
        }

        searchByCoords(latitude, longitude);
      },
      () => locationDeniedAlert(),
      { timeout: 15000 }
    );
  });

})();