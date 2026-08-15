/**
 * Core Application Engine
 * Beli Rankings (Left) + Interactive Live Map (Right) + Instant Photo Popups + Scroll Sync
 */

const App = {
  rankings: (typeof window !== "undefined" && window.BELI_RANKINGS) ? window.BELI_RANKINGS : ((typeof BELI_RANKINGS !== "undefined") ? BELI_RANKINGS : []),
  photos: (typeof window !== "undefined" && window.PHOTOS) ? window.PHOTOS : ((typeof PHOTOS !== "undefined") ? PHOTOS : []),
  currentView: "unified",
  savedIds: new Set(),
  activeRestaurant: null,
  activePhotoList: [],
  activePhotoIndex: 0,
  activeStoryIndex: 0,
  storyTimer: null,
  storyProgressInterval: null,
  scrollObserver: null,
  isManualSelecting: false,
  manualSelectTimer: null,

  filters: {
    search: "",
    selectedNeighborhoods: new Set(),
    score: "all",
    price: "all",
    selectedCuisines: new Set(),
    sort: "beli_rank"
  },

  init() {
    this.loadSaved();
    this.bindNavigation();
    this.bindThemeToggle();
    this.bindFilters();
    this.bindModals();
    this.bindRoulette();
    this.bindStoryReel();

    if (window.MapEngine) {
      window.MapEngine.init();
    }

    this.applyFilters();
    this.updateStats();

    console.log("App ready. Rankings: " + this.rankings.length + ", Photos: " + this.photos.length);
  },

  loadSaved() {
    try {
      const saved = localStorage.getItem("pratik_saved_spots");
      if (saved) {
        this.savedIds = new Set(JSON.parse(saved));
      }
    } catch (e) {
      console.warn("Could not load saved spots:", e);
    }
    this.updateSavedCount();
  },

  saveToStorage() {
    try {
      localStorage.setItem("pratik_saved_spots", JSON.stringify(Array.from(this.savedIds)));
    } catch (e) {
      console.warn("Could not write to localStorage:", e);
    }
    this.updateSavedCount();
  },

  updateSavedCount() {
    const count = this.savedIds.size;
    const navEl = document.getElementById("saved-count-nav");
    const displayEl = document.getElementById("saved-count-display");
    if (navEl) navEl.textContent = count;
    if (displayEl) displayEl.textContent = count + " spot" + (count === 1 ? "" : "s") + " saved";
  },

  toggleSave(restaurantId) {
    if (this.savedIds.has(restaurantId)) {
      this.savedIds.delete(restaurantId);
    } else {
      this.savedIds.add(restaurantId);
    }
    this.saveToStorage();
    this.renderRankingsFeed();
    this.renderSaved();
  },

  updateStats() {
    const totalRankedEl = document.getElementById("stat-total-ranked");
    const photosCountEl = document.getElementById("stat-photos-count");
    if (totalRankedEl) totalRankedEl.textContent = this.rankings.length || "189";
    if (photosCountEl) photosCountEl.textContent = this.photos.length || "182";
  },

  bindNavigation() {
    const navBtns = document.querySelectorAll(".nav-tab-btn");
    navBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.getAttribute("data-view");
        this.switchView(view);
      });
    });
  },

  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll(".nav-tab-btn").forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-view") === viewName);
    });

    document.querySelectorAll(".view-section").forEach(sec => {
      sec.classList.remove("active");
    });

    const targetSec = document.getElementById("view-" + viewName);
    if (targetSec) {
      targetSec.classList.add("active");
    }

    if (viewName === "unified" && window.MapEngine) {
      window.MapEngine.invalidateSize();
    } else if (viewName === "saved") {
      this.renderSaved();
    }
  },

  bindFilters() {
    const searchInput = document.getElementById("global-search");
    const citySelect = document.getElementById("filter-city");
    const sortSelect = document.getElementById("sort-order");

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.filters.search = e.target.value.toLowerCase().trim();
        this.applyFilters();
      });
    }

    if (citySelect) {
      citySelect.addEventListener("change", (e) => {
        this.filters.city = e.target.value;
        this.applyFilters();
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener("change", (e) => {
        this.filters.sort = e.target.value;
        this.applyFilters();
      });
    }

    this.bindCuisineMultiselect();
    this.bindNeighborhoodMultiselect();
  },

  bindNeighborhoodMultiselect() {
    const triggerBtn = document.getElementById("neighborhood-dropdown-trigger");
    const panel = document.getElementById("neighborhood-dropdown-panel");
    const selectAllBtn = document.getElementById("neighborhood-select-all");
    const clearAllBtn = document.getElementById("neighborhood-clear-all");
    const checkboxes = document.querySelectorAll("#neighborhood-checkboxes-container input[type='checkbox']");

    if (triggerBtn && panel) {
      triggerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close other dropdowns if open
        const cuisinePanel = document.getElementById("cuisine-dropdown-panel");
        if (cuisinePanel) cuisinePanel.classList.remove("show");
        const cuisineTrigger = document.getElementById("cuisine-dropdown-trigger");
        if (cuisineTrigger) cuisineTrigger.classList.remove("active");

        const neighPanel = document.getElementById("neighborhood-dropdown-panel");
        if (neighPanel) neighPanel.classList.remove("show");
        const neighTrigger = document.getElementById("neighborhood-dropdown-trigger");
        if (neighTrigger) neighTrigger.classList.remove("active");
        const isOpen = panel.classList.contains("show");
        panel.classList.toggle("show", !isOpen);
        triggerBtn.classList.toggle("active", !isOpen);
      });

      panel.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      document.addEventListener("click", () => {
        panel.classList.remove("show");
        triggerBtn.classList.remove("active");
      });
    }

    const updateNeighborhoodSelection = () => {
      this.filters.selectedNeighborhoods.clear();
      checkboxes.forEach(cb => {
        if (cb.checked) {
          this.filters.selectedNeighborhoods.add(cb.value);
        }
      });

      const count = this.filters.selectedNeighborhoods.size;
      const countBadge = document.getElementById("neighborhood-count-badge");
      const label = document.getElementById("neighborhood-trigger-label");

      if (count > 0) {
        if (countBadge) {
          countBadge.textContent = count;
          countBadge.style.display = "inline-block";
        }
        if (label) label.textContent = "📍 Neighborhoods";
      } else {
        if (countBadge) countBadge.style.display = "none";
        if (label) label.textContent = "📍 Neighborhoods (All)";
      }

      this.applyFilters();
    };

    checkboxes.forEach(cb => {
      cb.addEventListener("change", updateNeighborhoodSelection);
    });

    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => {
        checkboxes.forEach(cb => cb.checked = true);
        updateNeighborhoodSelection();
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        checkboxes.forEach(cb => cb.checked = false);
        updateNeighborhoodSelection();
      });
    }
  },

  bindCuisineMultiselect() {
    const triggerBtn = document.getElementById("cuisine-dropdown-trigger");
    const panel = document.getElementById("cuisine-dropdown-panel");
    const selectAllBtn = document.getElementById("cuisine-select-all");
    const clearAllBtn = document.getElementById("cuisine-clear-all");
    const checkboxes = document.querySelectorAll("#cuisine-checkboxes-container input[type='checkbox']");

    if (triggerBtn && panel) {
      triggerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const neighPanel = document.getElementById("neighborhood-dropdown-panel");
        if (neighPanel) neighPanel.classList.remove("show");
        const neighTrigger = document.getElementById("neighborhood-dropdown-trigger");
        if (neighTrigger) neighTrigger.classList.remove("active");
        const isOpen = panel.classList.contains("show");
        panel.classList.toggle("show", !isOpen);
        triggerBtn.classList.toggle("active", !isOpen);
      });

      panel.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      document.addEventListener("click", () => {
        panel.classList.remove("show");
        triggerBtn.classList.remove("active");
      });
    }

    const updateCuisineSelection = () => {
      this.filters.selectedCuisines.clear();
      checkboxes.forEach(cb => {
        if (cb.checked) {
          this.filters.selectedCuisines.add(cb.value);
        }
      });

      const count = this.filters.selectedCuisines.size;
      const countBadge = document.getElementById("cuisine-count-badge");
      const label = document.getElementById("cuisine-trigger-label");

      if (count > 0) {
        if (countBadge) {
          countBadge.textContent = count;
          countBadge.style.display = "inline-block";
        }
        if (label) label.textContent = "🍜 Cuisines";
      } else {
        if (countBadge) countBadge.style.display = "none";
        if (label) label.textContent = "🍜 Cuisines (All)";
      }

      this.applyFilters();
    };

    checkboxes.forEach(cb => {
      cb.addEventListener("change", updateCuisineSelection);
    });

    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => {
        checkboxes.forEach(cb => cb.checked = true);
        updateCuisineSelection();
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        checkboxes.forEach(cb => cb.checked = false);
        updateCuisineSelection();
      });
    }
  },

  getScoreGradient(score) {
    if (score >= 9.8) return "linear-gradient(135deg, #10b981, #059669)";
    if (score >= 9.0) return "linear-gradient(135deg, #06b6d4, #0284c7)";
    if (score >= 8.0) return "linear-gradient(135deg, #3b82f6, #4f46e5)";
    if (score >= 7.0) return "linear-gradient(135deg, #8b5cf6, #7c3aed)";
    return "linear-gradient(135deg, #64748b, #475569)";
  },

  applyFilters() {
    let list = [...this.rankings];

    if (this.filters.search) {
      const q = this.filters.search;
      list = list.filter(r => 
        r.name.toLowerCase().includes(q) ||
        (r.neighborhood && r.neighborhood.toLowerCase().includes(q)) ||
        (r.city && r.city.toLowerCase().includes(q)) ||
        (r.cuisines && r.cuisines.some(c => c.toLowerCase().includes(q)))
      );
    }

    if (this.filters.selectedNeighborhoods && this.filters.selectedNeighborhoods.size > 0) {
      const selectedList = Array.from(this.filters.selectedNeighborhoods).map(s => s.toLowerCase());
      list = list.filter(r => {
        const n = (r.neighborhood || "").toLowerCase();
        const c = (r.city || "").toLowerCase();
        return selectedList.some(sel => n.includes(sel) || c.includes(sel) || sel.includes(n));
      });
    }

    if (this.filters.score !== "all") {
      const minScore = parseFloat(this.filters.score);
      list = list.filter(r => (r.score || 0) >= minScore);
    }

    if (this.filters.price !== "all") {
      list = list.filter(r => r.price === this.filters.price);
    }

    if (this.filters.selectedCuisines && this.filters.selectedCuisines.size > 0) {
      const selectedList = Array.from(this.filters.selectedCuisines).map(s => s.toLowerCase());
      list = list.filter(r => 
        r.cuisines && r.cuisines.some(c => selectedList.some(sel => c.toLowerCase().includes(sel)))
      );
    }

    list.sort((a, b) => {
      if (this.filters.sort === "beli_rank") {
        return (a.rank || 999) - (b.rank || 999);
      }
      if (this.filters.sort === "score_desc") {
        return (b.score || 0) - (a.score || 0);
      }
      if (this.filters.sort === "score_asc") {
        return (a.score || 0) - (b.score || 0);
      }
      if (this.filters.sort === "photos_desc") {
        return (b.photos ? b.photos.length : 0) - (a.photos ? a.photos.length : 0);
      }
      if (this.filters.sort === "name_asc") {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });

    this.filteredRankings = list;

    this.renderRankingsFeed();

    if (window.MapEngine) {
      window.MapEngine.renderMarkers(list);
    }

    this.setupScrollSync();
  },

  renderRankingsFeed() {
    const container = document.getElementById("rankings-feed-container");
    const countEl = document.getElementById("feed-count-display");
    if (!container) return;

    if (countEl) {
      countEl.textContent = "Showing " + this.filteredRankings.length + " Ranked Spots";
    }

    if (this.filteredRankings.length === 0) {
      container.innerHTML = `
        <div style="padding: 3.5rem 1.5rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-color);">
          <i class="fa-solid fa-utensils" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.5;"></i>
          <h3 style="font-size: 1.15rem; font-weight: 700; color: #fff; margin-bottom: 0.4rem;">No matching restaurants found</h3>
          <p style="font-size: 0.88rem;">Try clearing search terms or selecting another cuisine filter.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.filteredRankings.map(rest => {
      const score = rest.score || 8.5;
      const gradient = this.getScoreGradient(score);
      const isSaved = this.savedIds.has(rest.id);
      const hasPhotos = rest.photos && rest.photos.length > 0;
      const photoCount = rest.photos ? rest.photos.length : 0;

      const rankSpecialClass = rest.rank === 1 ? "top-1" : rest.rank === 2 ? "top-2" : rest.rank === 3 ? "top-3" : "";
      const cuisinesHtml = (rest.cuisines || []).slice(0, 3).map(c => `<span class="card-tag">${c}</span>`).join("");
      const priceStr = rest.price ? `<span class="price-chip">${rest.price}</span><span class="dot-sep">•</span>` : "";

      const photoPreviewHtml = hasPhotos
        ? `
          <div class="rank-photo-preview" onclick="event.stopPropagation(); App.onRestaurantSelect('${rest.id}', false)" title="Click to view ${photoCount} food photos">
            <img src="${(window.location.pathname.endsWith("/picks/") ? "../images/" : "images/")}${rest.photos[0]}" alt="${rest.name}">
            <span class="rank-photo-count-badge"><i class="fa-solid fa-camera"></i> ${photoCount}</span>
          </div>
        `
        : "";

      return `
        <div class="ranking-item-card" data-restaurant-id="${rest.id}" id="rank-item-${rest.id}" onclick="App.onRestaurantSelect('${rest.id}', false)">
          <div class="rank-badge-col">
            <span class="rank-number ${rankSpecialClass}">#${rest.rank}</span>
          </div>

          ${photoPreviewHtml}

          <div class="rank-main-info">
            <div class="rank-restaurant-title">
              <span>${rest.name}</span>
            </div>
            <div class="rank-meta-row">
              ${priceStr}<span>${rest.neighborhood || ""}, ${rest.city || "Chicago"}</span>
            </div>
            <div class="card-tags">${cuisinesHtml}</div>
          </div>

          <div class="rank-right-actions">
            <div class="rank-score-badge" style="background: ${gradient};">
              ★ ${score.toFixed(1)}
            </div>
            <button class="btn-save-toggle ${isSaved ? 'saved' : ''}" onclick="event.stopPropagation(); App.toggleSave('${rest.id}')" title="Save to bucket list">
              <i class="${isSaved ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'}"></i>
            </button>
          </div>
        </div>
      `;
    }).join("");
  },

  setupScrollSync() {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }

    const cards = document.querySelectorAll(".ranking-item-card");
    if (!cards.length) return;

    let debounceTimer = null;
    const isMobile = window.innerWidth <= 768;

    // On mobile, the top 240px is occupied by the frozen map
    // The focus zone begins directly beneath the map
    const rootMargin = isMobile ? "-240px 0px -55% 0px" : "-15% 0px -60% 0px";

    this.scrollObserver = new IntersectionObserver((entries) => {
      if (this.isManualSelecting) return;

      const visibleEntries = entries.filter(e => e.isIntersecting);
      if (!visibleEntries.length) return;

      // Pick the topmost visible card entering the focus zone right below the map
      const topEntry = visibleEntries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const restId = topEntry.target.getAttribute("data-restaurant-id");
      if (!restId) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (this.isManualSelecting) return;

        cards.forEach(c => c.classList.remove("active-in-view"));
        topEntry.target.classList.add("active-in-view");

        if (window.MapEngine) {
          window.MapEngine.highlightRestaurant(restId, true, false, true);
        }
      }, 40);
    }, {
      root: null,
      rootMargin: rootMargin,
      threshold: 0.05
    });

    cards.forEach(card => this.scrollObserver.observe(card));
  },

  onRestaurantSelect(restaurantId, fromMap = false) {
    if (!restaurantId) return;

    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest) return;

    const isMobile = window.innerWidth <= 768;

    // Temporarily lock scroll observer during user click
    this.isManualSelecting = true;
    clearTimeout(this.manualSelectTimer);
    this.manualSelectTimer = setTimeout(() => {
      this.isManualSelecting = false;
    }, 1200);

    // Highlight card
    document.querySelectorAll(".ranking-item-card").forEach(c => c.classList.remove("active-in-view"));
    const card = document.getElementById("rank-item-" + restaurantId);
    if (card) {
      card.classList.add("active-in-view");
      if (fromMap) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    if (isMobile) {
      // ON MOBILE ONLY: Pop up full-screen photo card over the whole screen
      this.openPhotoModal(restaurantId);
      if (window.MapEngine) {
        window.MapEngine.highlightRestaurant(restaurantId, true, false, false);
      }
    } else {
      // ON DESKTOP: Fly map and open in-map photo popup
      if (window.MapEngine) {
        window.MapEngine.highlightRestaurant(restaurantId, true, true, false);
      }
    }
  },

  openPhotoModal(restaurantId) {
    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest) return;

    this.activeRestaurant = rest;
    this.activePhotoList = (rest.photos && rest.photos.length > 0) ? rest.photos : [];
    this.activePhotoIndex = 0;

    const modal = document.getElementById("lightbox-modal");
    if (modal) {
      modal.classList.toggle("single-photo", this.activePhotoList.length <= 1);
    }
    const card = document.querySelector(".lightbox-card");
    if (card) card.scrollTop = 0;

    this.renderPhotoModalSlide();
    if (modal) modal.classList.add("active");
  },

  renderPhotoModalSlide() {
    if (!this.activeRestaurant) return;

    const rest = this.activeRestaurant;
    const imgBasePath = window.location.pathname.endsWith("/picks/") ? "../images/" : "images/";

    const modal = document.getElementById("lightbox-modal");
    if (modal) {
      modal.classList.toggle("single-photo", this.activePhotoList.length <= 1);
    }

    const mediaContainer = document.querySelector(".lightbox-media");
    const lightboxImg = document.getElementById("lightbox-img");
    const counterBadge = document.getElementById("lightbox-photo-counter");
    const prevBtn = document.getElementById("lightbox-prev");
    const nextBtn = document.getElementById("lightbox-next");

    if (this.activePhotoList && this.activePhotoList.length > 0) {
      const photoFilename = this.activePhotoList[this.activePhotoIndex];
      if (lightboxImg) {
        lightboxImg.src = imgBasePath + photoFilename;
        lightboxImg.style.display = "block";
      }
      if (mediaContainer) mediaContainer.style.display = "block";

      if (this.activePhotoList.length > 1) {
        if (counterBadge) {
          counterBadge.textContent = `📸 ${this.activePhotoIndex + 1} / ${this.activePhotoList.length}`;
          counterBadge.style.setProperty("display", "inline-flex", "important");
        }
        if (prevBtn) prevBtn.style.setProperty("display", "flex", "important");
        if (nextBtn) nextBtn.style.setProperty("display", "flex", "important");
      } else {
        if (counterBadge) counterBadge.style.setProperty("display", "none", "important");
        if (prevBtn) prevBtn.style.setProperty("display", "none", "important");
        if (nextBtn) nextBtn.style.setProperty("display", "none", "important");
      }
    } else {
      if (lightboxImg) {
        lightboxImg.src = "";
        lightboxImg.style.display = "none";
      }
      if (mediaContainer) mediaContainer.style.display = "none";
      if (counterBadge) counterBadge.style.setProperty("display", "none", "important");
      if (prevBtn) prevBtn.style.setProperty("display", "none", "important");
      if (nextBtn) nextBtn.style.setProperty("display", "none", "important");
    }
    
    const titleEl = document.getElementById("lightbox-title");
    if (titleEl) titleEl.textContent = rest.name;

    const locEl = document.getElementById("lightbox-location");
    if (locEl) locEl.textContent = (rest.neighborhood || "") + ", " + (rest.city || "Chicago");

    const rankEl = document.getElementById("lightbox-rank-badge");
    if (rankEl) rankEl.textContent = "#" + rest.rank + " on Pratik's Beli";

    const scoreBadge = document.getElementById("lightbox-score-badge");
    if (scoreBadge) {
      scoreBadge.innerHTML = `<div class="rank-score-badge" style="background: ${this.getScoreGradient(rest.score || 8.5)}; font-size: 1.05rem; padding: 4px 12px;">★ ${(rest.score || 8.5).toFixed(1)}</div>`;
    }

    const cuisinesEl = document.getElementById("lightbox-cuisines");
    if (cuisinesEl) {
      cuisinesEl.innerHTML = (rest.cuisines || []).map(c => `<span class="card-tag">${c}</span>`).join("");
    }

    const mapsBtn = document.getElementById("lightbox-maps-btn");
    if (mapsBtn) {
      mapsBtn.href = rest.google_maps_url || `https://maps.google.com/?q=${encodeURIComponent(rest.name + " " + rest.city)}`;
    }
  },

  selectModalPhoto(idx) {
    this.activePhotoIndex = idx;
    this.renderPhotoModalSlide();
  },

  modalNextPhoto() {
    if (!this.activePhotoList || this.activePhotoList.length <= 1) return;
    this.activePhotoIndex = (this.activePhotoIndex + 1) % this.activePhotoList.length;
    this.renderPhotoModalSlide();
  },

  modalPrevPhoto() {
    if (!this.activePhotoList || this.activePhotoList.length <= 1) return;
    this.activePhotoIndex = (this.activePhotoIndex - 1 + this.activePhotoList.length) % this.activePhotoList.length;
    this.renderPhotoModalSlide();
  },

  closePhotoModal() {
    const modal = document.getElementById("lightbox-modal");
    if (modal) modal.classList.remove("active");
  },

  bindModals() {
    const closeBtn = document.getElementById("lightbox-close");
    const prevBtn = document.getElementById("lightbox-prev");
    const nextBtn = document.getElementById("lightbox-next");
    const modal = document.getElementById("lightbox-modal");

    if (closeBtn) closeBtn.addEventListener("click", () => this.closePhotoModal());
    if (prevBtn) prevBtn.addEventListener("click", () => this.modalPrevPhoto());
    if (nextBtn) nextBtn.addEventListener("click", () => this.modalNextPhoto());

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.closePhotoModal();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (modal && modal.classList.contains("active")) {
        if (e.key === "Escape") this.closePhotoModal();
        if (e.key === "ArrowRight") this.modalNextPhoto();
        if (e.key === "ArrowLeft") this.modalPrevPhoto();
      }
    });
  },

  bindRoulette() {
    const openBtn = document.getElementById("btn-open-roulette");
    const closeBtn = document.getElementById("roulette-close");
    const spinBtn = document.getElementById("roulette-spin-btn");
    const modal = document.getElementById("roulette-modal");
    const viewBtn = document.getElementById("roulette-view-btn");

    if (openBtn && modal) {
      openBtn.addEventListener("click", () => {
        modal.classList.add("active");
        this.resetRoulette();
      });
    }

    if (closeBtn && modal) {
      closeBtn.addEventListener("click", () => modal.classList.remove("active"));
    }

    if (spinBtn) {
      spinBtn.addEventListener("click", () => this.spinRoulette());
    }

    if (viewBtn) {
      viewBtn.addEventListener("click", () => {
        if (this.rouletteWinner) {
          modal.classList.remove("active");
          this.onRestaurantSelect(this.rouletteWinner.id, true);
        }
      });
    }
  },

  resetRoulette() {
    const resultBox = document.getElementById("roulette-result-box");
    const viewBtn = document.getElementById("roulette-view-btn");
    if (resultBox) {
      resultBox.innerHTML = `<div id="roulette-spinning-text" style="font-size: 1.2rem; font-weight: 800; color: var(--accent-gold);">Press Spin to Roll!</div>`;
    }
    if (viewBtn) viewBtn.style.display = "none";
    this.rouletteWinner = null;
  },

  spinRoulette() {
    const candidates = this.rankings.filter(r => (r.score || 0) >= 8.5);
    if (!candidates.length) return;

    const resultBox = document.getElementById("roulette-result-box");
    const viewBtn = document.getElementById("roulette-view-btn");
    const spinBtn = document.getElementById("roulette-spin-btn");

    if (spinBtn) spinBtn.disabled = true;
    if (viewBtn) viewBtn.style.display = "none";

    let counter = 0;
    const interval = setInterval(() => {
      const randomRest = candidates[Math.floor(Math.random() * candidates.length)];
      if (resultBox) {
        resultBox.innerHTML = `
          <div style="font-size: 1.3rem; font-weight: 800; color: #fff;">${randomRest.name}</div>
          <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">#${randomRest.rank} • ${randomRest.neighborhood || ''}, ${randomRest.city || 'Chicago'}</div>
        `;
      }
      counter++;

      if (counter > 18) {
        clearInterval(interval);
        const winner = candidates[Math.floor(Math.random() * candidates.length)];
        this.rouletteWinner = winner;

        if (resultBox) {
          resultBox.innerHTML = `
            <div style="font-size: 0.85rem; font-weight: 800; color: var(--accent-gold); text-transform: uppercase; margin-bottom: 4px;">🎉 Today's Pick:</div>
            <div style="font-size: 1.45rem; font-weight: 800; color: #fff;">${winner.name}</div>
            <div style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 4px;">#${winner.rank} on Beli • ★ ${(winner.score || 8.5).toFixed(1)}</div>
          `;
        }

        if (spinBtn) spinBtn.disabled = false;
        if (viewBtn) viewBtn.style.display = "inline-flex";
      }
    }, 90);
  },

  bindStoryReel() {
    const openBtn = document.getElementById("btn-open-story-reel");
    const closeBtn = document.getElementById("story-close");
    const modal = document.getElementById("story-reel-modal");
    const prevTap = document.getElementById("story-prev-tap");
    const nextTap = document.getElementById("story-next-tap");

    if (openBtn && modal) {
      openBtn.addEventListener("click", () => {
        if (this.photos.length > 0) {
          modal.classList.add("active");
          this.activeStoryIndex = 0;
          this.playStorySlide();
        }
      });
    }

    if (closeBtn && modal) {
      closeBtn.addEventListener("click", () => {
        modal.classList.remove("active");
        this.clearStoryTimers();
      });
    }

    if (prevTap) {
      prevTap.addEventListener("click", () => this.prevStorySlide());
    }

    if (nextTap) {
      nextTap.addEventListener("click", () => this.nextStorySlide());
    }
  },

  clearStoryTimers() {
    clearTimeout(this.storyTimer);
    clearInterval(this.storyProgressInterval);
  },

  playStorySlide() {
    this.clearStoryTimers();
    if (!this.photos.length) return;

    const photo = this.photos[this.activeStoryIndex];
    const imgEl = document.getElementById("story-current-img");
    const titleEl = document.getElementById("story-restaurant-name");
    const locEl = document.getElementById("story-location-sub");
    const captionEl = document.getElementById("story-caption-text");
    const tagsEl = document.getElementById("story-tags-row");
    const scoreEl = document.getElementById("story-score-badge");
    const progressContainer = document.getElementById("story-progress-bars");

    if (imgEl) imgEl.src = photo.src;
    if (titleEl) titleEl.textContent = photo.restaurant_name;
    if (locEl) locEl.textContent = photo.location || "Chicago, IL";
    if (captionEl) captionEl.textContent = photo.caption || "Pratik’s Picks Story";
    if (tagsEl) {
      tagsEl.innerHTML = (photo.cuisines || []).map(c => `<span class="card-tag">${c}</span>`).join("");
    }
    if (scoreEl) {
      scoreEl.innerHTML = `<span style="background: ${this.getScoreGradient(photo.beli_score || 8.5)}; color: white; padding: 4px 10px; border-radius: 9999px; font-weight: 700; font-size: 0.85rem;">★ ${(photo.beli_score || 8.5).toFixed(1)}</span>`;
    }

    // Render progress bars
    if (progressContainer) {
      progressContainer.innerHTML = this.photos.slice(0, Math.min(25, this.photos.length)).map((p, idx) => `
        <div class="story-progress-seg">
          <div class="story-progress-fill" id="story-progress-fill-${idx}" style="width: ${idx < this.activeStoryIndex ? '100%' : '0%'}"></div>
        </div>
      `).join("");
    }

    const currentFill = document.getElementById(`story-progress-fill-${this.activeStoryIndex}`);
    let progress = 0;
    const duration = 5000;
    const step = 50;

    this.storyProgressInterval = setInterval(() => {
      progress += (step / duration) * 100;
      if (currentFill) currentFill.style.width = `${Math.min(progress, 100)}%`;
    }, step);

    this.storyTimer = setTimeout(() => {
      this.nextStorySlide();
    }, duration);
  },

  nextStorySlide() {
    if (this.activeStoryIndex < Math.min(24, this.photos.length - 1)) {
      this.activeStoryIndex++;
      this.playStorySlide();
    } else {
      const modal = document.getElementById("story-reel-modal");
      if (modal) modal.classList.remove("active");
      this.clearStoryTimers();
    }
  },

  prevStorySlide() {
    if (this.activeStoryIndex > 0) {
      this.activeStoryIndex--;
      this.playStorySlide();
    }
  },

  renderSaved() {
    const container = document.getElementById("saved-cards-container");
    if (!container) return;

    const savedSpots = this.rankings.filter(r => this.savedIds.has(r.id));
    if (savedSpots.length === 0) {
      container.innerHTML = `
        <div style="padding: 3.5rem 1.5rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-color);">
          <i class="fa-solid fa-bookmark" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.5;"></i>
          <h3 style="font-size: 1.15rem; font-weight: 700; color: #fff; margin-bottom: 0.4rem;">No saved restaurants yet</h3>
          <p style="font-size: 0.88rem;">Click the bookmark icon on any ranking card to add it to your personal wishlist!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = savedSpots.map(rest => {
      const score = rest.score || 8.5;
      const hasPhotos = rest.photos && rest.photos.length > 0;
      const photoPreviewHtml = hasPhotos
        ? `<div class="rank-photo-preview" onclick="event.stopPropagation(); App.onRestaurantSelect('${rest.id}', false)"><img src="${(window.location.pathname.endsWith("/picks/") ? "../images/" : "images/")}${rest.photos[0]}" alt="${rest.name}"></div>`
        : "";

      return `
        <div class="ranking-item-card" onclick="App.switchView('unified'); setTimeout(() => App.onRestaurantSelect('${rest.id}', false), 200);">
          <div class="rank-badge-col">
            <span class="rank-number">#${rest.rank}</span>
          </div>
          ${photoPreviewHtml}
          <div class="rank-main-info">
            <div class="rank-restaurant-title"><span>${rest.name}</span></div>
            <div class="rank-meta-row"><span>${rest.neighborhood || ""}, ${rest.city || "Chicago"}</span></div>
            <div class="card-tags">${(rest.cuisines || []).map(c => `<span class="card-tag">${c}</span>`).join("")}</div>
          </div>
          <div class="rank-right-actions">
            <div class="rank-score-badge" style="background: ${this.getScoreGradient(score)};">★ ${score.toFixed(1)}</div>
            <button class="btn-save-toggle saved" onclick="event.stopPropagation(); App.toggleSave('${rest.id}')"><i class="fa-solid fa-bookmark"></i></button>
          </div>
        </div>
      `;
    }).join("");
  },

  bindThemeToggle() {
    const btnDark = document.getElementById("theme-btn-dark");
    const btnLight = document.getElementById("theme-btn-light");

    const setTheme = (theme) => {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("pratik_food_theme", theme);

      if (btnDark && btnLight) {
        btnDark.classList.toggle("active", theme === "dark");
        btnLight.classList.toggle("active", theme === "light");
      }

      if (window.MapEngine) {
        window.MapEngine.setTileStyle(theme === "light" ? "voyager" : "dark");
      }
    };

    if (btnDark) {
      btnDark.addEventListener("click", () => setTheme("dark"));
    }

    if (btnLight) {
      btnLight.addEventListener("click", () => setTheme("light"));
    }

    // Load saved preference or default to dark
    const savedTheme = localStorage.getItem("pratik_food_theme") || "dark";
    setTheme(savedTheme);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});

window.App = App;

