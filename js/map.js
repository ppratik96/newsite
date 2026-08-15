/**
 * Map Engine using Leaflet & CartoDB Tiles
 * Renders custom ranking score markers with centered in-map photo popups next to each spot.
 * Features progressive zoom-tiered marker rendering:
 * - Default / City Zoom (<13): Only 9.0+ elite spots
 * - Neighborhood Zoom (13-14): 8.0+ spots
 * - Street Zoom (15+): All ranked spots
 */

const MapEngine = {
  map: null,
  markersGroup: null,
  markersMap: new Map(),
  currentTileLayer: null,
  activeRestaurantId: null,
  currentRestaurantsList: [],
  popupPhotoIndexes: new Map(),
  tileLayers: {},

  init() {
    const mapContainer = document.getElementById("map");
    if (!mapContainer) return;

    if (typeof L === "undefined") {
      console.warn("Leaflet library not loaded yet.");
      return;
    }

    try {
      this.tileLayers = {
        dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png", {
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
          subdomains: "abcd",
          maxZoom: 19
        }),
        voyager: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
          subdomains: "abcd",
          maxZoom: 19
        })
      };

      const defaultCenter = [41.8842, -87.6481];
      this.map = L.map("map", {
        center: defaultCenter,
        zoom: 12,
        zoomControl: false,
        scrollWheelZoom: true,
        dragging: true,
        touchZoom: true,
        doubleClickZoom: true
      });

      this.currentTileLayer = this.tileLayers.dark;
      this.currentTileLayer.addTo(this.map);

      this.markersGroup = L.featureGroup().addTo(this.map);
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);
      this.bindControls();

      // Listen to zoom changes to progressively reveal markers
      this.map.on("zoomend", () => {
        this.updateMarkerVisibility();
      });

      setTimeout(() => {
        if (this.map) this.map.invalidateSize();
      }, 300);
    } catch (err) {
      console.error("Leaflet initialization error:", err);
    }
  },

  bindControls() {
    const btnRecenter = document.getElementById("map-btn-recenter");
    if (btnRecenter) {
      btnRecenter.addEventListener("click", () => {
        this.fitAll();
      });
    }
  },

  setTileStyle(styleName) {
    if (!this.map || !this.tileLayers || !this.tileLayers[styleName]) return;
    if (this.currentTileLayer) {
      this.map.removeLayer(this.currentTileLayer);
    }
    this.currentTileLayer = this.tileLayers[styleName];
    this.currentTileLayer.addTo(this.map);
  },

  getScoreGradient(score) {
    if (score >= 9.8) return "linear-gradient(135deg, #10b981, #059669)";
    if (score >= 9.0) return "linear-gradient(135deg, #06b6d4, #0284c7)";
    if (score >= 8.0) return "linear-gradient(135deg, #3b82f6, #4f46e5)";
    if (score >= 7.0) return "linear-gradient(135deg, #8b5cf6, #7c3aed)";
    return "linear-gradient(135deg, #64748b, #475569)";
  },

  createPinIcon(restaurant, isActive = false) {
    if (typeof L === "undefined") return null;

    const score = restaurant.score || 8.5;
    const rankNum = restaurant.rank;
    const rank = rankNum ? "#" + rankNum : "★";
    const activeClass = isActive ? "active-pin" : "";

    let bgGradient = this.getScoreGradient(score);
    let podiumClass = "";
    let needleColor = "rgba(255, 255, 255, 0.85)";

    if (rankNum === 1) {
      bgGradient = "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)";
      podiumClass = "podium-gold";
      needleColor = "#f59e0b";
    } else if (rankNum === 2) {
      bgGradient = "linear-gradient(135deg, #94a3b8 0%, #475569 100%)";
      podiumClass = "podium-silver";
      needleColor = "#cbd5e1";
    } else if (rankNum === 3) {
      bgGradient = "linear-gradient(135deg, #ea580c 0%, #9a3412 100%)";
      podiumClass = "podium-bronze";
      needleColor = "#ea580c";
    }

    const html = `
      <div class="custom-pin-container ${activeClass} ${podiumClass}" data-id="${restaurant.id}">
        <div class="custom-pin-bubble" style="background: ${bgGradient};">
          <span>${rank}</span>
        </div>
        <div class="custom-pin-needle" style="border-top-color: ${needleColor};"></div>
      </div>
    `;

    return L.divIcon({
      html: html,
      className: "custom-leaflet-marker",
      iconSize: [44, 28],
      iconAnchor: [22, 28]
    });
  },

  buildPopupHtml(restaurant) {
    const score = restaurant.score || 8.5;
    const gradient = this.getScoreGradient(score);
    const hasPhotos = restaurant.photos && restaurant.photos.length > 0;
    const photos = restaurant.photos || [];
    const currentIndex = this.popupPhotoIndexes.get(restaurant.id) || 0;
    const photoSrc = hasPhotos ? "images/" + photos[currentIndex % photos.length] : "";

    let mediaHtml = "";
    if (hasPhotos) {
      const navButtons = photos.length > 1 ? `
        <button class="map-photo-nav-btn map-photo-prev" onclick="event.stopPropagation(); MapEngine.changePopupPhoto('${restaurant.id}', -1)" title="Previous Photo">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button class="map-photo-nav-btn map-photo-next" onclick="event.stopPropagation(); MapEngine.changePopupPhoto('${restaurant.id}', 1)" title="Next Photo">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        <span class="map-photo-counter-badge"><i class="fa-solid fa-camera"></i> ${(currentIndex % photos.length) + 1} / ${photos.length}</span>
      ` : "";

      mediaHtml = `
        <div class="map-photo-media">
          <img id="map-popup-img-${restaurant.id}" src="${photoSrc}" alt="${restaurant.name}">
          ${navButtons}
        </div>
      `;
    }

    const priceHtml = restaurant.price ? `<span class="price-chip">${restaurant.price}</span>` : "";
    const cuisinesHtml = (restaurant.cuisines || []).slice(0, 3).map(c => `<span class="card-tag">${c}</span>`).join("");
    const notesHtml = restaurant.notes ? `<div class="map-photo-notes"><i class="fa-solid fa-quote-left" style="opacity: 0.5; margin-right: 4px;"></i>${restaurant.notes}</div>` : "";

    return `
      <div class="map-photo-card" id="map-photo-card-${restaurant.id}">
        ${mediaHtml}
        <div class="map-photo-body">
          <div class="map-photo-header">
            <div>
              <div class="map-photo-rank-pill">#${restaurant.rank} ON BELI</div>
              <h3 class="map-photo-title">${restaurant.name}</h3>
              <div class="map-photo-meta">
                ${priceHtml}
                <span>${restaurant.neighborhood || ""}, ${restaurant.city || "Chicago"}</span>
              </div>
            </div>
            <div class="rank-score-badge" style="background: ${gradient}; font-size: 0.95rem; padding: 4px 10px;">
              ★ ${score.toFixed(1)}
            </div>
          </div>
          <div class="card-tags">${cuisinesHtml}</div>
          ${notesHtml}
          <div class="map-photo-actions">
            <a href="${restaurant.google_maps_url || 'https://maps.google.com/?q=' + encodeURIComponent(restaurant.name + ' ' + (restaurant.city || 'Chicago'))}" target="_blank" class="map-photo-btn" style="background: #2563eb; color: #fff;">
              <i class="fa-solid fa-diamond-turn-right"></i> Google Maps
            </a>
          </div>
        </div>
      </div>
    `;
  },

  changePopupPhoto(restaurantId, delta) {
    const entry = this.markersMap.get(restaurantId);
    if (!entry) return;

    const photos = entry.data.photos || [];
    if (photos.length <= 1) return;

    let currentIndex = this.popupPhotoIndexes.get(restaurantId) || 0;
    currentIndex = (currentIndex + delta + photos.length) % photos.length;
    this.popupPhotoIndexes.set(restaurantId, currentIndex);

    const popupContent = this.buildPopupHtml(entry.data);
    entry.marker.setPopupContent(popupContent);
  },

  renderMarkers(restaurantsList) {
    this.currentRestaurantsList = restaurantsList || [];
    this.updateMarkerVisibility();

    if (this.markersGroup && this.markersGroup.getLayers().length > 0 && !this.activeRestaurantId) {
      this.fitAll();
    }
  },

  updateMarkerVisibility() {
    if (!this.map || !this.markersGroup || typeof L === "undefined") return;

    const currentZoom = this.map.getZoom();
    
    // Zoom-tiered score filtering:
    // - Default / City level (< 13): 9.8+ only (The Absolute Pinnacle)
    // - High-level Neighborhood (13): 9.0+
    // - Neighborhood level (14): 8.0+
    // - Street level (>= 15): All ranked spots
    let minScore = 9.8;
    if (currentZoom >= 15) {
      minScore = 0.0;
    } else if (currentZoom >= 14) {
      minScore = 8.0;
    } else if (currentZoom >= 13) {
      minScore = 9.0;
    } else {
      minScore = 9.8;
    }

    const visibleRestaurants = this.currentRestaurantsList.filter(rest => {
      if (!rest.lat || !rest.lng) return false;
      // Always show active selected restaurant or if score meets zoom threshold
      return (rest.score || 0) >= minScore || rest.id === this.activeRestaurantId;
    });

    const activeIdsOnMap = new Set(visibleRestaurants.map(r => r.id));

    // Remove markers that shouldn't be visible
    this.markersMap.forEach((entry, id) => {
      if (!activeIdsOnMap.has(id)) {
        this.markersGroup.removeLayer(entry.marker);
      }
    });

    // Add or update markers that should be visible
    visibleRestaurants.forEach(rest => {
      let entry = this.markersMap.get(rest.id);

      if (!entry) {
        const icon = this.createPinIcon(rest, rest.id === this.activeRestaurantId);
        if (!icon) return;

        const zIndexOffset = rest.id === this.activeRestaurantId ? 20000 : (10000 - (rest.rank || 999));
        const marker = L.marker([rest.lat, rest.lng], {
          icon: icon,
          title: `#${rest.rank} ${rest.name}`,
          zIndexOffset: zIndexOffset
        });

        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          if (window.App) {
            window.App.onRestaurantSelect(rest.id, true);
          }
        });

        const popupHtml = this.buildPopupHtml(rest);
        marker.bindPopup(popupHtml, {
          offset: [0, -26],
          maxWidth: 340,
          minWidth: 280,
          autoPan: false
        });

        entry = { marker, data: rest };
        this.markersMap.set(rest.id, entry);
      }

      if (!this.markersGroup.hasLayer(entry.marker)) {
        this.markersGroup.addLayer(entry.marker);
      }

      // Update pin icon active state and rank-priority z-index layering
      const pinIcon = this.createPinIcon(rest, rest.id === this.activeRestaurantId);
      if (pinIcon) entry.marker.setIcon(pinIcon);
      const zOffset = rest.id === this.activeRestaurantId ? 20000 : (10000 - (rest.rank || 999));
      entry.marker.setZIndexOffset(zOffset);
    });
  },

  highlightRestaurant(restaurantId, fly = true, openPopup = true, fromScroll = false) {
    if (!this.map || !restaurantId) return;

    this.activeRestaurantId = restaurantId;

    // Refresh marker visibility to ensure selected spot is on the map
    this.updateMarkerVisibility();

    const entry = this.markersMap.get(restaurantId);

    if (entry) {
      const { marker, data } = entry;

      // Update popup content
      const popupHtml = this.buildPopupHtml(data);
      marker.setPopupContent(popupHtml);

      const targetLatLng = marker.getLatLng();
      const targetZoom = Math.max(this.map.getZoom(), 14);

      // Compute centered position so the entire popup card above the pin is centered
      const point = this.map.project(targetLatLng, targetZoom);
      point.y -= 230;
      const centeredLatLng = this.map.unproject(point, targetZoom);

      if (fly) {
        if (fromScroll) {
          this.map.panTo(centeredLatLng, { animate: true, duration: 0.5 });
        } else {
          this.map.flyTo(centeredLatLng, targetZoom, { duration: 0.8 });
        }
      }

      if (openPopup) {
        setTimeout(() => {
          marker.openPopup();
        }, fromScroll ? 120 : 200);
      }
    }
  },

  fitAll() {
    if (this.map && this.markersGroup && this.markersGroup.getLayers().length > 0) {
      this.map.fitBounds(this.markersGroup.getBounds(), { padding: [40, 40], maxZoom: 13 });
    }
  },

  invalidateSize() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 200);
    }
  }
};

window.MapEngine = MapEngine;
