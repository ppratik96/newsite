/**
 * Pratik’s Picks Studio — iPhone Web App Engine
 * Manages restaurant rankings, auto-geocoding, iPhone photo compression/upload,
 * Beli text/screenshot import, local IndexedDB drafts, and atomic GitHub Pages publishing.
 */

const StudioApp = {
  repoOwner: "ppratik96",
  repoName: "newsite",
  repoBranch: "main",

  rankings: [],
  photoMeta: [],
  queuedUploads: {}, // filename -> { filename, dataUrl, base64, restaurantId, caption }
  hasUnsavedChanges: false,
  changeSummary: new Set(),

  activeTab: "rankings",
  activeFilter: "all",
  searchQuery: "",
  photosSubTab: "missing",
  photoSearchQuery: "",

  editingRestaurantId: null,
  quickUploadTargetId: null,

  commonCuisines: [
    "Chinese", "Hot Pot", "Thai", "Indian", "Japanese", "Sushi", "Ramen",
    "Mexican", "Taqueria", "Italian", "Pasta", "Pizza", "American", "Burgers",
    "Mediterranean", "Middle Eastern", "Korean", "Vietnamese", "Dessert",
    "Bakery", "Brunch", "Seafood", "Steakhouse", "French", "Spanish", "Tapas",
    "Cocktail Bar", "Contemporary", "Fusion"
  ],

  chicagoNeighborhoods: [
    "West Loop", "Fulton Market", "River North", "Chinatown", "Wicker Park",
    "Bucktown", "Logan Square", "Lincoln Park", "Lakeview", "Uptown",
    "The Loop", "South Loop", "Pilsen", "West Town", "Ukrainian Village",
    "Avondale", "Gold Coast", "Streeterville", "Old Town", "Hyde Park",
    "Andersonville", "Bridgeport", "Albany Park", "Roscoe Village"
  ],

  async init() {
    this.loadInitialDataFromGlobals();
    await this.loadDraftFromDB();
    this.bindTabs();
    this.bindRankingsToolbar();
    this.bindDrawer();
    this.bindAddSpotForm();
    this.bindPhotosTab();
    this.bindBeliSyncTab();
    this.bindPublishTab();
    this.bindQuickPhotoInput();

    this.renderAll();

    // If user has a GitHub token saved and no unsaved local draft, silently fetch latest from GitHub
    const token = this.getGithubToken();
    if (token && !this.hasUnsavedChanges) {
      this.syncLatestFromGitHub(true);
    }
  },

  getImgPrefix() {
    return window.location.pathname.includes("/picks/") ? "../images/" : "images/";
  },

  resolvePhotoUrl(filename) {
    if (!filename) return "";
    if (this.queuedUploads[filename] && this.queuedUploads[filename].dataUrl) {
      return this.queuedUploads[filename].dataUrl;
    }
    if (filename.startsWith("data:") || filename.startsWith("http")) {
      return filename;
    }
    const clean = filename.replace(/^(\.\.\/)?images\//, "");
    return this.getImgPrefix() + clean;
  },

  loadInitialDataFromGlobals() {
    const rawRankings = window.BELI_RANKINGS || (typeof BELI_RESTAURANTS_DATA !== "undefined" ? BELI_RESTAURANTS_DATA : []);
    this.rankings = JSON.parse(JSON.stringify(rawRankings)).map((r, i) => ({
      rank: r.rank || (i + 1),
      name: r.name || "Unnamed Spot",
      score: typeof r.score === "number" ? r.score : parseFloat(r.score) || 8.5,
      price: r.price || "$$",
      cuisines: Array.isArray(r.cuisines) ? [...r.cuisines] : [],
      neighborhood: r.neighborhood || "",
      city: r.city || "Chicago",
      notes: r.notes || null,
      id: r.id || this.slugify(r.name || `spot-${i + 1}`),
      lat: typeof r.lat === "number" ? r.lat : parseFloat(r.lat) || 41.8842,
      lng: typeof r.lng === "number" ? r.lng : parseFloat(r.lng) || -87.6481,
      photos: Array.isArray(r.photos) ? r.photos.map(p => p.replace(/^(\.\.\/)?images\//, "")) : [],
      google_maps_url: r.google_maps_url || ""
    }));
    this.normalizeRanks();

    const rawPhotos = window.FOOD_PHOTOS || window.PHOTOS || [];
    this.photoMeta = JSON.parse(JSON.stringify(rawPhotos));
  },

  slugify(str) {
    return (str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || ("spot-" + Date.now());
  },

  normalizeRanks() {
    this.rankings.forEach((r, idx) => {
      r.rank = idx + 1;
    });
  },

  getScoreGradient(score) {
    if (score >= 9.8) return "linear-gradient(135deg, #10b981, #059669)";
    if (score >= 9.0) return "linear-gradient(135deg, #06b6d4, #0284c7)";
    if (score >= 8.0) return "linear-gradient(135deg, #3b82f6, #4f46e5)";
    if (score >= 7.0) return "linear-gradient(135deg, #8b5cf6, #7c3aed)";
    return "linear-gradient(135deg, #64748b, #475569)";
  },

  /* ==========================================================================
     INDEXEDDB LOCAL DRAFT PERSISTENCE
     ========================================================================== */
  openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("PratikPicksStudioDB", 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("drafts")) {
          db.createObjectStore("drafts");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async saveDraftToDB(reason = "Modified rankings") {
    this.hasUnsavedChanges = true;
    if (reason) this.changeSummary.add(reason);
    this.updatePublishBanner();

    try {
      const db = await this.openDB();
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put({
        rankings: this.rankings,
        photoMeta: this.photoMeta,
        queuedUploads: this.queuedUploads,
        changeSummary: Array.from(this.changeSummary),
        updatedAt: Date.now()
      }, "current_draft");
    } catch (e) {
      console.warn("Could not save draft to IndexedDB:", e);
    }
  },

  async loadDraftFromDB() {
    try {
      const db = await this.openDB();
      const draft = await new Promise((resolve) => {
        const tx = db.transaction("drafts", "readonly");
        const req = tx.objectStore("drafts").get("current_draft");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

      if (draft && draft.rankings && draft.rankings.length > 0) {
        this.rankings = draft.rankings;
        this.photoMeta = draft.photoMeta || this.photoMeta;
        this.queuedUploads = draft.queuedUploads || {};
        this.changeSummary = new Set(draft.changeSummary || ["Restored unpublished draft"]);
        this.hasUnsavedChanges = true;
        this.showToast("✨ Restored your unpublished draft");
      }
    } catch (e) {
      console.warn("Could not read draft from IndexedDB:", e);
    }
  },

  async clearDraftFromDB() {
    this.hasUnsavedChanges = false;
    this.changeSummary.clear();
    this.queuedUploads = {};
    this.updatePublishBanner();

    try {
      const db = await this.openDB();
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").delete("current_draft");
    } catch (e) {
      console.warn("Could not clear draft:", e);
    }
  },

  updatePublishBanner() {
    const bar = document.getElementById("publish-floating-bar");
    const countDot = document.getElementById("publish-tab-badge");
    const infoEl = document.getElementById("publish-bar-title");
    const subEl = document.getElementById("publish-bar-subtitle");
    const queueCount = Object.keys(this.queuedUploads).length;
    const changeCount = this.changeSummary.size;

    if (this.hasUnsavedChanges) {
      if (bar && this.activeTab !== "publish") {
        bar.classList.add("visible");
      } else if (bar) {
        bar.classList.remove("visible");
      }
      if (countDot) {
        countDot.style.display = "inline-flex";
        countDot.textContent = changeCount + queueCount || "!";
      }
      if (infoEl) {
        infoEl.textContent = `Unpublished Changes Ready`;
      }
      if (subEl) {
        const parts = [];
        if (changeCount > 0) parts.push(`${changeCount} edit${changeCount > 1 ? "s" : ""}`);
        if (queueCount > 0) parts.push(`${queueCount} new photo${queueCount > 1 ? "s" : ""}`);
        subEl.textContent = parts.join(" • ") || "Tap Publish to push live to pratikpa.tel";
      }
    } else {
      if (bar) bar.classList.remove("visible");
      if (countDot) countDot.style.display = "none";
    }

    this.renderPublishSummary();
  },

  /* ==========================================================================
     NAVIGATION & TABS
     ========================================================================== */
  bindTabs() {
    document.querySelectorAll(".ios-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        this.switchTab(tab);
      });
    });

    const floatPubBtn = document.getElementById("floating-publish-btn");
    if (floatPubBtn) {
      floatPubBtn.addEventListener("click", () => {
        this.switchTab("publish");
      });
    }
  },

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll(".ios-tab-btn").forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-tab") === tabName);
    });
    document.querySelectorAll(".studio-tab-panel").forEach(p => {
      p.classList.toggle("active", p.id === `tab-${tabName}`);
    });

    if (tabName === "add") {
      this.updateSuggestedRankInAddForm();
    } else if (tabName === "photos") {
      this.renderPhotosTab();
    } else if (tabName === "publish") {
      this.renderPublishSummary();
    }

    this.updatePublishBanner();
    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  renderAll() {
    this.updateStatsStrip();
    this.renderRankingsList();
    this.renderPhotosTab();
    this.updatePublishBanner();
  },

  updateStatsStrip() {
    const totalSpots = this.rankings.length;
    const withPhotos = this.rankings.filter(r => r.photos && r.photos.length > 0).length;
    const totalPhotos = this.rankings.reduce((acc, r) => acc + (r.photos ? r.photos.length : 0), 0);

    const elSpots = document.getElementById("stat-spots-count");
    const elCovered = document.getElementById("stat-with-photos");
    const elTotalPhotos = document.getElementById("stat-total-photos");

    if (elSpots) elSpots.textContent = totalSpots;
    if (elCovered) elCovered.textContent = `${withPhotos}/${totalSpots}`;
    if (elTotalPhotos) elTotalPhotos.textContent = totalPhotos;
  },

  /* ==========================================================================
     TAB 1: RANKINGS LIST & REORDERING
     ========================================================================== */
  bindRankingsToolbar() {
    const searchInput = document.getElementById("studio-search-input");
    const clearBtn = document.getElementById("studio-search-clear");

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        if (clearBtn) clearBtn.style.display = this.searchQuery ? "flex" : "none";
        this.renderRankingsList();
      });
    }

    if (clearBtn && searchInput) {
      clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        this.searchQuery = "";
        clearBtn.style.display = "none";
        this.renderRankingsList();
      });
    }

    document.querySelectorAll("#rankings-filter-chips .filter-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("#rankings-filter-chips .filter-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        this.activeFilter = chip.getAttribute("data-filter") || "all";
        this.renderRankingsList();
      });
    });

    const sortByScoreBtn = document.getElementById("btn-auto-sort-score");
    if (sortByScoreBtn) {
      sortByScoreBtn.addEventListener("click", () => {
        if (!confirm("Re-sort all restaurants strictly by Score (highest to lowest), preserving relative order for ties?")) return;
        this.rankings.sort((a, b) => {
          const diff = (b.score || 0) - (a.score || 0);
          if (Math.abs(diff) > 0.001) return diff;
          return (a.rank || 999) - (b.rank || 999);
        });
        this.normalizeRanks();
        this.saveDraftToDB("Sorted rankings by score");
        this.renderAll();
        this.showToast("🏆 Rankings sorted by score!");
      });
    }
  },

  renderRankingsList() {
    const container = document.getElementById("studio-rankings-list");
    if (!container) return;

    let list = [...this.rankings];

    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter(r =>
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.neighborhood && r.neighborhood.toLowerCase().includes(q)) ||
        (r.city && r.city.toLowerCase().includes(q)) ||
        (r.cuisines && r.cuisines.some(c => c.toLowerCase().includes(q))) ||
        String(r.rank) === q.replace("#", "")
      );
    }

    if (this.activeFilter === "top25") {
      list = list.filter(r => r.rank <= 25);
    } else if (this.activeFilter === "missing_photos") {
      list = list.filter(r => !r.photos || r.photos.length === 0);
    } else if (this.activeFilter === "has_photos") {
      list = list.filter(r => r.photos && r.photos.length > 0);
    } else if (this.activeFilter === "elite") {
      list = list.filter(r => (r.score || 0) >= 9.0);
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div class="studio-panel-card" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-secondary);">
          <i class="fa-solid fa-utensils" style="font-size: 2rem; opacity: 0.4; margin-bottom: 0.6rem;"></i>
          <div style="font-weight: 700; color: #fff;">No matching spots</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">Try another search or tap "+ Add Spot" below.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(rest => {
      const hasPhotos = rest.photos && rest.photos.length > 0;
      const photoCount = hasPhotos ? rest.photos.length : 0;
      const topClass = rest.rank === 1 ? "top-1" : rest.rank === 2 ? "top-2" : rest.rank === 3 ? "top-3" : "";
      const score = typeof rest.score === "number" ? rest.score : 8.5;
      const gradient = this.getScoreGradient(score);

      const thumbHtml = hasPhotos
        ? `
          <div class="rest-thumb-box">
            <img src="${this.resolvePhotoUrl(rest.photos[0])}" alt="${this.escapeHtml(rest.name)}" loading="lazy">
            <span class="rest-thumb-count"><i class="fa-solid fa-camera"></i> ${photoCount}</span>
          </div>
        `
        : `
          <div class="rest-thumb-box" onclick="event.stopPropagation(); StudioApp.triggerQuickPhotoUpload('${rest.id}')" title="Quick upload photo">
            <div class="rest-thumb-empty-btn">
              <i class="fa-solid fa-camera" style="font-size: 0.9rem;"></i>
              <span>+Photo</span>
            </div>
          </div>
        `;

      const cuisinesHtml = (rest.cuisines || []).slice(0, 3).map(c => `<span class="mini-tag">${this.escapeHtml(c)}</span>`).join("");

      return `
        <div class="studio-rest-card" onclick="StudioApp.openEditDrawer('${rest.id}')">
          <div class="rank-stepper-col" onclick="event.stopPropagation();">
            <button type="button" class="rank-pill-btn ${topClass}" onclick="StudioApp.promptMoveRank('${rest.id}')" title="Tap to jump to a new rank">
              #${rest.rank}
            </button>
            <div class="rank-nudge-pair">
              <button type="button" class="rank-nudge-btn" onclick="StudioApp.nudgeRank('${rest.id}', -1)" title="Move up 1 rank">▲</button>
              <button type="button" class="rank-nudge-btn" onclick="StudioApp.nudgeRank('${rest.id}', 1)" title="Move down 1 rank">▼</button>
            </div>
          </div>

          ${thumbHtml}

          <div class="rest-card-info">
            <div class="rest-card-name">${this.escapeHtml(rest.name)}</div>
            <div class="rest-card-meta">
              ${rest.price ? `${this.escapeHtml(rest.price)} • ` : ""}${this.escapeHtml(rest.neighborhood || "")}${rest.neighborhood && rest.city ? ", " : ""}${this.escapeHtml(rest.city || "Chicago")}
            </div>
            <div class="rest-card-cuisines">${cuisinesHtml}</div>
          </div>

          <div class="rest-card-right">
            <div class="score-pill" style="background: ${gradient};">★ ${score.toFixed(1)}</div>
            <i class="fa-solid fa-chevron-right" style="font-size: 0.75rem; color: var(--text-muted);"></i>
          </div>
        </div>
      `;
    }).join("");
  },

  promptMoveRank(restaurantId) {
    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest) return;

    const input = prompt(`Move "${rest.name}" (currently #${rest.rank}) to which Rank #? (1 - ${this.rankings.length})`, String(rest.rank));
    if (input === null) return;
    const newRank = parseInt(input.trim(), 10);
    if (isNaN(newRank) || newRank < 1) return;

    this.moveRestaurantToRank(restaurantId, newRank);
  },

  nudgeRank(restaurantId, delta) {
    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest) return;
    const target = rest.rank + delta;
    if (target < 1 || target > this.rankings.length) return;
    this.moveRestaurantToRank(restaurantId, target);
  },

  moveRestaurantToRank(restaurantId, targetRank) {
    const idx = this.rankings.findIndex(r => r.id === restaurantId);
    if (idx === -1) return;

    const clamped = Math.max(1, Math.min(this.rankings.length, targetRank));
    const [item] = this.rankings.splice(idx, 1);
    this.rankings.splice(clamped - 1, 0, item);
    this.normalizeRanks();

    this.syncPhotoMetaWithRankings();
    this.saveDraftToDB(`Moved ${item.name} to #${clamped}`);
    this.renderAll();
    this.showToast(`Moved ${item.name} to #${clamped}`);
  },

  /* ==========================================================================
     RESTAURANT EDIT BOTTOM SHEET DRAWER
     ========================================================================== */
  bindDrawer() {
    const backdrop = document.getElementById("edit-sheet-backdrop");
    const closeBtn = document.getElementById("sheet-close-btn");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.closeEditDrawer());
    }
    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) this.closeEditDrawer();
      });
    }

    // Rank & Score Steppers inside Drawer
    const rankMinus = document.getElementById("drawer-rank-minus");
    const rankPlus = document.getElementById("drawer-rank-plus");
    const scoreMinus = document.getElementById("drawer-score-minus");
    const scorePlus = document.getElementById("drawer-score-plus");

    if (rankMinus) {
      rankMinus.addEventListener("click", () => {
        const el = document.getElementById("drawer-input-rank");
        if (el) el.value = Math.max(1, (parseInt(el.value, 10) || 1) - 1);
      });
    }
    if (rankPlus) {
      rankPlus.addEventListener("click", () => {
        const el = document.getElementById("drawer-input-rank");
        if (el) el.value = Math.min(this.rankings.length, (parseInt(el.value, 10) || 1) + 1);
      });
    }
    if (scoreMinus) {
      scoreMinus.addEventListener("click", () => {
        const el = document.getElementById("drawer-input-score");
        if (el) el.value = Math.max(0, ((parseFloat(el.value) || 8.5) - 0.1)).toFixed(1);
      });
    }
    if (scorePlus) {
      scorePlus.addEventListener("click", () => {
        const el = document.getElementById("drawer-input-score");
        if (el) el.value = Math.min(10.0, ((parseFloat(el.value) || 8.5) + 0.1)).toFixed(1);
      });
    }

    // Price buttons in drawer
    document.querySelectorAll("#drawer-price-group .price-option-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#drawer-price-group .price-option-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // Add custom cuisine in drawer
    const addCuisineBtn = document.getElementById("drawer-add-cuisine-btn");
    if (addCuisineBtn) {
      addCuisineBtn.addEventListener("click", () => {
        const customInput = document.getElementById("drawer-custom-cuisine");
        if (!customInput || !customInput.value.trim()) return;
        const val = customInput.value.trim();
        if (!this.commonCuisines.includes(val)) {
          this.commonCuisines.push(val);
        }
        customInput.value = "";
        const rest = this.rankings.find(r => r.id === this.editingRestaurantId);
        if (rest) {
          if (!rest.cuisines.includes(val)) rest.cuisines.push(val);
          this.renderDrawerCuisines(rest.cuisines);
        }
      });
    }

    // Auto-locate inside drawer
    const geoBtn = document.getElementById("drawer-geocode-btn");
    if (geoBtn) {
      geoBtn.addEventListener("click", () => this.geocodeForDrawer());
    }

    // Photo upload inside drawer
    const drawerFileInput = document.getElementById("drawer-photo-file-input");
    if (drawerFileInput) {
      drawerFileInput.addEventListener("change", async (e) => {
        if (!e.target.files || !e.target.files.length || !this.editingRestaurantId) return;
        await this.handlePhotoFilesForRestaurant(this.editingRestaurantId, Array.from(e.target.files));
        e.target.value = "";
        this.renderDrawerPhotos();
        this.renderAll();
      });
    }

    // Save Drawer button
    const saveBtn = document.getElementById("drawer-save-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => this.saveDrawerChanges());
    }

    // Delete Restaurant button
    const deleteBtn = document.getElementById("drawer-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => this.deleteCurrentRestaurant());
    }
  },

  openEditDrawer(restaurantId) {
    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest) return;

    this.editingRestaurantId = restaurantId;

    document.getElementById("sheet-title").textContent = `#${rest.rank} ${rest.name}`;
    document.getElementById("drawer-input-rank").value = rest.rank;
    document.getElementById("drawer-input-score").value = (rest.score || 8.5).toFixed(1);
    document.getElementById("drawer-input-name").value = rest.name || "";
    document.getElementById("drawer-input-neighborhood").value = rest.neighborhood || "";
    document.getElementById("drawer-input-city").value = rest.city || "Chicago";
    document.getElementById("drawer-input-notes").value = rest.notes || "";
    document.getElementById("drawer-input-lat").value = rest.lat || "";
    document.getElementById("drawer-input-lng").value = rest.lng || "";
    document.getElementById("drawer-input-maps").value = rest.google_maps_url || "";

    document.querySelectorAll("#drawer-price-group .price-option-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-price") === (rest.price || "$$"));
    });

    this.renderDrawerCuisines(rest.cuisines || []);
    this.renderDrawerPhotos();

    const backdrop = document.getElementById("edit-sheet-backdrop");
    if (backdrop) backdrop.classList.add("open");
  },

  closeEditDrawer() {
    const backdrop = document.getElementById("edit-sheet-backdrop");
    if (backdrop) backdrop.classList.remove("open");
    this.editingRestaurantId = null;
  },

  renderDrawerCuisines(selectedCuisines) {
    const container = document.getElementById("drawer-cuisine-chips");
    if (!container) return;

    const allCuisines = Array.from(new Set([...this.commonCuisines, ...(selectedCuisines || [])]));
    container.innerHTML = allCuisines.map(c => {
      const isSel = selectedCuisines.includes(c);
      return `<span class="cuisine-pick-chip ${isSel ? "selected" : ""}" data-cuisine="${this.escapeHtml(c)}">${this.escapeHtml(c)}</span>`;
    }).join("");

    container.querySelectorAll(".cuisine-pick-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("selected");
      });
    });
  },

  renderDrawerPhotos() {
    const grid = document.getElementById("drawer-photos-grid");
    const rest = this.rankings.find(r => r.id === this.editingRestaurantId);
    if (!grid || !rest) return;

    const photos = rest.photos || [];
    if (photos.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 1rem; color: var(--text-secondary); font-size: 0.82rem; background: rgba(15,23,42,0.5); border-radius: 12px;">
          No photos yet for ${this.escapeHtml(rest.name)}. Tap above to pick from your iPhone Camera Roll!
        </div>
      `;
      return;
    }

    grid.innerHTML = photos.map((filename, idx) => {
      const isPrimary = idx === 0;
      const isNew = Boolean(this.queuedUploads[filename]);
      return `
        <div class="drawer-photo-card ${isPrimary ? "is-primary" : ""}">
          <div class="drawer-photo-img-wrap">
            <img src="${this.resolvePhotoUrl(filename)}" alt="Photo ${idx + 1}">
            ${isPrimary ? `<span class="primary-badge">★ Cover</span>` : ""}
            ${isNew ? `<span class="new-photo-badge">NEW</span>` : ""}
          </div>
          <div class="drawer-photo-controls">
            ${!isPrimary ? `
              <button type="button" class="photo-ctrl-btn" onclick="StudioApp.setPrimaryPhoto('${rest.id}', ${idx})" title="Set as Cover Photo">
                <i class="fa-solid fa-star" style="color: var(--accent-gold);"></i> Cover
              </button>
            ` : `<span style="font-size: 0.68rem; color: var(--accent-gold); font-weight: 700;">Primary Photo</span>`}
            <div style="display: flex; gap: 4px;">
              ${idx > 0 ? `<button type="button" class="photo-ctrl-btn" onclick="StudioApp.movePhotoInRestaurant('${rest.id}', ${idx}, -1)">◀</button>` : ""}
              ${idx < photos.length - 1 ? `<button type="button" class="photo-ctrl-btn" onclick="StudioApp.movePhotoInRestaurant('${rest.id}', ${idx}, 1)">▶</button>` : ""}
              <button type="button" class="photo-ctrl-btn danger" onclick="StudioApp.removePhotoFromRestaurant('${rest.id}', ${idx})" title="Remove photo">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  },

  setPrimaryPhoto(restaurantId, photoIdx) {
    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest || !rest.photos || photoIdx <= 0 || photoIdx >= rest.photos.length) return;
    const [chosen] = rest.photos.splice(photoIdx, 1);
    rest.photos.unshift(chosen);

    this.syncPhotoMetaWithRankings();
    this.saveDraftToDB(`Updated cover photo for ${rest.name}`);
    this.renderDrawerPhotos();
    this.renderAll();
    this.showToast("★ Set as cover photo!");
  },

  movePhotoInRestaurant(restaurantId, photoIdx, delta) {
    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest || !rest.photos) return;
    const target = photoIdx + delta;
    if (target < 0 || target >= rest.photos.length) return;
    const [item] = rest.photos.splice(photoIdx, 1);
    rest.photos.splice(target, 0, item);

    this.syncPhotoMetaWithRankings();
    this.saveDraftToDB(`Reordered photos for ${rest.name}`);
    this.renderDrawerPhotos();
    this.renderAll();
  },

  removePhotoFromRestaurant(restaurantId, photoIdx) {
    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest || !rest.photos) return;
    const filename = rest.photos[photoIdx];
    if (!confirm(`Remove this photo from ${rest.name}?`)) return;

    rest.photos.splice(photoIdx, 1);
    delete this.queuedUploads[filename];
    this.photoMeta = this.photoMeta.filter(p => p.filename !== filename);

    this.saveDraftToDB(`Removed photo from ${rest.name}`);
    this.renderDrawerPhotos();
    this.renderAll();
    this.showToast("Photo removed");
  },

  saveDrawerChanges() {
    const rest = this.rankings.find(r => r.id === this.editingRestaurantId);
    if (!rest) return;

    const newRank = parseInt(document.getElementById("drawer-input-rank").value, 10) || rest.rank;
    const newScore = parseFloat(document.getElementById("drawer-input-score").value);

    rest.name = document.getElementById("drawer-input-name").value.trim() || rest.name;
    rest.score = !isNaN(newScore) ? Math.max(0, Math.min(10, newScore)) : rest.score;
    rest.neighborhood = document.getElementById("drawer-input-neighborhood").value.trim();
    rest.city = document.getElementById("drawer-input-city").value.trim() || "Chicago";
    const notesVal = document.getElementById("drawer-input-notes").value.trim();
    rest.notes = notesVal ? notesVal : null;

    const latVal = parseFloat(document.getElementById("drawer-input-lat").value);
    const lngVal = parseFloat(document.getElementById("drawer-input-lng").value);
    if (!isNaN(latVal)) rest.lat = latVal;
    if (!isNaN(lngVal)) rest.lng = lngVal;

    const activePriceBtn = document.querySelector("#drawer-price-group .price-option-btn.active");
    if (activePriceBtn) {
      rest.price = activePriceBtn.getAttribute("data-price") || "$$";
    }

    const selectedCuisines = [];
    document.querySelectorAll("#drawer-cuisine-chips .cuisine-pick-chip.selected").forEach(chip => {
      selectedCuisines.push(chip.getAttribute("data-cuisine"));
    });
    rest.cuisines = selectedCuisines;

    const mapsVal = document.getElementById("drawer-input-maps").value.trim();
    rest.google_maps_url = mapsVal || `https://maps.google.com/?q=${encodeURIComponent(rest.name + " " + rest.city)}`;

    if (newRank !== rest.rank) {
      this.moveRestaurantToRank(rest.id, newRank);
    } else {
      this.syncPhotoMetaWithRankings();
      this.saveDraftToDB(`Updated ${rest.name}`);
      this.renderAll();
    }

    this.closeEditDrawer();
    this.showToast(`✅ Saved ${rest.name}`);
  },

  deleteCurrentRestaurant() {
    const rest = this.rankings.find(r => r.id === this.editingRestaurantId);
    if (!rest) return;
    if (!confirm(`Delete "${rest.name}" (#${rest.rank}) from your rankings? Remaining spots will automatically re-number.`)) return;

    this.rankings = this.rankings.filter(r => r.id !== rest.id);
    this.photoMeta = this.photoMeta.filter(p => p.restaurant_id !== rest.id);
    this.normalizeRanks();

    this.saveDraftToDB(`Deleted ${rest.name}`);
    this.closeEditDrawer();
    this.renderAll();
    this.showToast(`🗑 Deleted ${rest.name}`);
  },

  /* ==========================================================================
     PHOTO COMPRESSION & CAMERA ROLL UPLOAD
     ========================================================================== */
  bindQuickPhotoInput() {
    const quickInput = document.getElementById("quick-photo-file-input");
    if (quickInput) {
      quickInput.addEventListener("change", async (e) => {
        if (!e.target.files || !e.target.files.length || !this.quickUploadTargetId) return;
        await this.handlePhotoFilesForRestaurant(this.quickUploadTargetId, Array.from(e.target.files));
        e.target.value = "";
        this.quickUploadTargetId = null;
        this.renderAll();
      });
    }
  },

  triggerQuickPhotoUpload(restaurantId) {
    this.quickUploadTargetId = restaurantId;
    const quickInput = document.getElementById("quick-photo-file-input");
    if (quickInput) quickInput.click();
  },

  async handlePhotoFilesForRestaurant(restaurantId, files) {
    const rest = this.rankings.find(r => r.id === restaurantId);
    if (!rest) return;

    this.showToast(`📸 Optimizing ${files.length} photo${files.length > 1 ? "s" : ""}...`);

    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const compressedDataUrl = await this.compressImageFile(file, 1600, 0.85);
        const base64Content = compressedDataUrl.split(",")[1];
        const randSuffix = Math.random().toString(36).substring(2, 7);
        const safeSlug = rest.id.substring(0, 28);
        const filename = `${yyyymm}_${safeSlug}_${randSuffix}.jpg`;

        this.queuedUploads[filename] = {
          filename,
          dataUrl: compressedDataUrl,
          base64: base64Content,
          restaurantId: rest.id,
          caption: rest.notes || `${rest.name} food highlight`
        };

        if (!Array.isArray(rest.photos)) rest.photos = [];
        // Put newly uploaded photo at index 0 if restaurant had no photos, or append
        rest.photos.push(filename);

        this.photoMeta.unshift({
          src: `images/${filename}`,
          filename: filename,
          restaurant_id: rest.id,
          restaurant_name: rest.name,
          beli_score: rest.score,
          beli_rank: rest.rank,
          location: `${rest.neighborhood ? rest.neighborhood + ", " : ""}${rest.city || "Chicago"}`,
          cuisines: rest.cuisines || [],
          caption: rest.notes || `${rest.name} Highlight`,
          notes: rest.notes || ""
        });
      } catch (err) {
        console.error("Photo compression error:", err);
        this.showToast(`⚠️ Could not process ${file.name}`);
      }
    }

    await this.saveDraftToDB(`Added ${files.length} photo${files.length > 1 ? "s" : ""} to ${rest.name}`);
    this.showToast(`✅ Added ${files.length} photo${files.length > 1 ? "s" : ""} to ${rest.name}!`);
  },

  compressImageFile(file, maxDimension = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  syncPhotoMetaWithRankings() {
    const restMap = new Map(this.rankings.map(r => [r.id, r]));
    this.photoMeta.forEach(pm => {
      const r = restMap.get(pm.restaurant_id);
      if (r) {
        pm.restaurant_name = r.name;
        pm.beli_score = r.score;
        pm.beli_rank = r.rank;
        pm.cuisines = r.cuisines || [];
        if (r.notes) {
          pm.caption = r.notes;
          pm.notes = r.notes;
        }
      }
    });
  },

  /* ==========================================================================
     TAB 2: ADD NEW RESTAURANT + AUTO-GEOCODING
     ========================================================================== */
  bindAddSpotForm() {
    this.addFormPhotos = []; // array of { file, dataUrl }

    const scoreInput = document.getElementById("add-input-score");
    const scoreMinus = document.getElementById("add-score-minus");
    const scorePlus = document.getElementById("add-score-plus");

    if (scoreMinus && scoreInput) {
      scoreMinus.addEventListener("click", () => {
        scoreInput.value = Math.max(0, (parseFloat(scoreInput.value) || 9.0) - 0.1).toFixed(1);
        this.updateSuggestedRankInAddForm();
      });
    }
    if (scorePlus && scoreInput) {
      scorePlus.addEventListener("click", () => {
        scoreInput.value = Math.min(10, (parseFloat(scoreInput.value) || 9.0) + 0.1).toFixed(1);
        this.updateSuggestedRankInAddForm();
      });
    }
    if (scoreInput) {
      scoreInput.addEventListener("input", () => this.updateSuggestedRankInAddForm());
    }

    const rankMinus = document.getElementById("add-rank-minus");
    const rankPlus = document.getElementById("add-rank-plus");
    const rankInput = document.getElementById("add-input-rank");
    if (rankMinus && rankInput) {
      rankMinus.addEventListener("click", () => {
        rankInput.value = Math.max(1, (parseInt(rankInput.value, 10) || 1) - 1);
        this.updateAddRankNeighborsPreview();
      });
    }
    if (rankPlus && rankInput) {
      rankPlus.addEventListener("click", () => {
        rankInput.value = Math.min(this.rankings.length + 1, (parseInt(rankInput.value, 10) || 1) + 1);
        this.updateAddRankNeighborsPreview();
      });
    }
    if (rankInput) {
      rankInput.addEventListener("input", () => this.updateAddRankNeighborsPreview());
    }

    // Price selector in Add Form
    document.querySelectorAll("#add-price-group .price-option-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#add-price-group .price-option-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // Render cuisine chips in Add Form
    const cuisineContainer = document.getElementById("add-cuisine-chips");
    if (cuisineContainer) {
      cuisineContainer.innerHTML = this.commonCuisines.map(c =>
        `<span class="cuisine-pick-chip" data-cuisine="${this.escapeHtml(c)}">${this.escapeHtml(c)}</span>`
      ).join("");
      cuisineContainer.querySelectorAll(".cuisine-pick-chip").forEach(chip => {
        chip.addEventListener("click", () => chip.classList.toggle("selected"));
      });
    }

    // Auto-Fill Geocode button
    const autoGeoBtn = document.getElementById("add-autofill-geo-btn");
    if (autoGeoBtn) {
      autoGeoBtn.addEventListener("click", () => this.searchPlaceForAddForm());
    }

    // Photos input in Add Form
    const addPhotoInput = document.getElementById("add-photo-file-input");
    if (addPhotoInput) {
      addPhotoInput.addEventListener("change", async (e) => {
        if (!e.target.files || !e.target.files.length) return;
        for (const f of Array.from(e.target.files)) {
          const dataUrl = await this.compressImageFile(f, 1600, 0.85);
          this.addFormPhotos.push({ file: f, dataUrl });
        }
        e.target.value = "";
        this.renderAddFormPhotoPreviews();
      });
    }

    // Submit New Spot
    const submitBtn = document.getElementById("add-spot-submit-btn");
    if (submitBtn) {
      submitBtn.addEventListener("click", () => this.submitNewRestaurant());
    }
  },

  updateSuggestedRankInAddForm() {
    const scoreEl = document.getElementById("add-input-score");
    const rankEl = document.getElementById("add-input-rank");
    if (!scoreEl || !rankEl) return;

    const score = parseFloat(scoreEl.value) || 9.0;
    // Find the first spot with score strictly less than this score
    let suggestedRank = this.rankings.length + 1;
    for (let i = 0; i < this.rankings.length; i++) {
      if ((this.rankings[i].score || 0) < score) {
        suggestedRank = i + 1;
        break;
      }
    }
    rankEl.value = suggestedRank;
    this.updateAddRankNeighborsPreview();
  },

  updateAddRankNeighborsPreview() {
    const rankEl = document.getElementById("add-input-rank");
    const hintEl = document.getElementById("add-rank-context-hint");
    if (!rankEl || !hintEl) return;

    const targetRank = Math.max(1, Math.min(this.rankings.length + 1, parseInt(rankEl.value, 10) || 1));
    const above = targetRank > 1 ? this.rankings[targetRank - 2] : null;
    const below = targetRank <= this.rankings.length ? this.rankings[targetRank - 1] : null;

    const parts = [];
    if (above) parts.push(`Above: #${above.rank} ${above.name} (★${(above.score || 0).toFixed(1)})`);
    if (below) parts.push(`Pushes down: #${below.rank} ${below.name} (★${(below.score || 0).toFixed(1)})`);
    hintEl.textContent = parts.join(" • ") || "Will be placed at #1";
  },

  renderAddFormPhotoPreviews() {
    const grid = document.getElementById("add-photos-preview-grid");
    if (!grid) return;

    if (!this.addFormPhotos.length) {
      grid.innerHTML = "";
      return;
    }

    grid.innerHTML = this.addFormPhotos.map((item, idx) => `
      <div class="drawer-photo-card ${idx === 0 ? "is-primary" : ""}">
        <div class="drawer-photo-img-wrap">
          <img src="${item.dataUrl}" alt="New upload">
          ${idx === 0 ? `<span class="primary-badge">★ Cover</span>` : ""}
        </div>
        <div class="drawer-photo-controls">
          <span style="font-size: 0.7rem; color: var(--text-secondary);">Photo ${idx + 1}</span>
          <button type="button" class="photo-ctrl-btn danger" onclick="StudioApp.removeAddFormPhoto(${idx})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `).join("");
  },

  removeAddFormPhoto(idx) {
    this.addFormPhotos.splice(idx, 1);
    this.renderAddFormPhotoPreviews();
  },

  async searchPlaceForAddForm() {
    const nameEl = document.getElementById("add-input-name");
    const cityEl = document.getElementById("add-input-city");
    const resultsBox = document.getElementById("add-geocode-results");
    if (!nameEl || !nameEl.value.trim()) {
      this.showToast("Enter a restaurant name first!");
      return;
    }

    const query = `${nameEl.value.trim()} ${cityEl && cityEl.value.trim() ? cityEl.value.trim() : "Chicago"}`;
    if (resultsBox) {
      resultsBox.innerHTML = `<div style="font-size: 0.78rem; color: var(--text-secondary); padding: 0.4rem;">🔍 Looking up "${this.escapeHtml(query)}"...</div>`;
    }

    const candidates = await this.lookupGeocodeCandidates(query);
    if (!candidates.length) {
      if (resultsBox) {
        resultsBox.innerHTML = `<div style="font-size: 0.78rem; color: #fda4af; padding: 0.4rem;">No exact address found. You can still type the neighborhood manually!</div>`;
      }
      return;
    }

    // Auto-apply first result and show choices
    this.applyGeocodeToAddForm(candidates[0]);

    if (resultsBox) {
      resultsBox.innerHTML = candidates.slice(0, 3).map((c, idx) => `
        <div class="geocode-result-item" onclick='StudioApp.applyGeocodeCandidateByIndex(${idx})'>
          <div>
            <div style="font-weight: 700; color: #fff;">${this.escapeHtml(c.title)}</div>
            <div style="font-size: 0.72rem; color: var(--text-secondary);">${this.escapeHtml(c.neighborhood || "")}${c.neighborhood ? ", " : ""}${this.escapeHtml(c.city)} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})</div>
          </div>
          <span style="font-size: 0.72rem; color: var(--accent-emerald); font-weight: 700;">${idx === 0 ? "✓ Applied" : "Use"}</span>
        </div>
      `).join("");
      this.lastGeoCandidates = candidates;
    }
  },

  applyGeocodeCandidateByIndex(idx) {
    if (!this.lastGeoCandidates || !this.lastGeoCandidates[idx]) return;
    this.applyGeocodeToAddForm(this.lastGeoCandidates[idx]);
    this.showToast("📍 Location applied!");
  },

  applyGeocodeToAddForm(cand) {
    if (cand.neighborhood) {
      document.getElementById("add-input-neighborhood").value = cand.neighborhood;
    }
    if (cand.city) {
      document.getElementById("add-input-city").value = cand.city;
    }
    document.getElementById("add-input-lat").value = cand.lat.toFixed(5);
    document.getElementById("add-input-lng").value = cand.lng.toFixed(5);
  },

  async geocodeForDrawer() {
    const name = document.getElementById("drawer-input-name").value.trim();
    const city = document.getElementById("drawer-input-city").value.trim() || "Chicago";
    if (!name) return;

    this.showToast(`🔍 Locating ${name}...`);
    const candidates = await this.lookupGeocodeCandidates(`${name} ${city}`);
    if (!candidates.length) {
      this.showToast("⚠️ Could not auto-locate; check name/city");
      return;
    }

    const best = candidates[0];
    if (best.neighborhood && !document.getElementById("drawer-input-neighborhood").value.trim()) {
      document.getElementById("drawer-input-neighborhood").value = best.neighborhood;
    }
    if (best.city) {
      document.getElementById("drawer-input-city").value = best.city;
    }
    document.getElementById("drawer-input-lat").value = best.lat.toFixed(5);
    document.getElementById("drawer-input-lng").value = best.lng.toFixed(5);
    document.getElementById("drawer-input-maps").value = `https://maps.google.com/?q=${encodeURIComponent(name + " " + best.city)}`;
    this.showToast(`📍 Coordinates updated (${best.neighborhood || best.city})`);
  },

  async lookupGeocodeCandidates(query) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=4&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.map(item => {
            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);
            const addr = item.address || {};
            const city = addr.city || addr.town || addr.village || "Chicago";
            let neighborhood = addr.neighbourhood || addr.suburb || addr.quarter || "";
            neighborhood = this.refineChicagoNeighborhood(lat, lng, neighborhood);
            return {
              title: item.name || item.display_name.split(",")[0],
              neighborhood,
              city,
              lat,
              lng
            };
          });
        }
      }
    } catch (e) {
      console.warn("Nominatim lookup error:", e);
    }

    // Fallback to Photon geocoder
    try {
      const photonRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=4`);
      if (photonRes.ok) {
        const pData = await photonRes.json();
        if (pData && Array.isArray(pData.features)) {
          return pData.features.map(f => {
            const [lng, lat] = f.geometry.coordinates;
            const props = f.properties || {};
            const city = props.city || props.town || "Chicago";
            const neighborhood = this.refineChicagoNeighborhood(lat, lng, props.district || props.locality || "");
            return {
              title: props.name || query,
              neighborhood,
              city,
              lat,
              lng
            };
          });
        }
      }
    } catch (e) {
      console.warn("Photon lookup error:", e);
    }
    return [];
  },

  refineChicagoNeighborhood(lat, lng, rawNeighborhood) {
    // Map broad Chicago community area names or coordinates to familiar foodie neighborhoods
    if (lat > 41.8835 && lat < 41.8905 && lng > -87.660 && lng < -87.644) return "Fulton Market";
    if (lat > 41.877 && lat <= 41.886 && lng > -87.665 && lng < -87.642) return "West Loop";
    if (lat > 41.888 && lat < 41.901 && lng > -87.642 && lng < -87.624) return "River North";
    if (lat > 41.848 && lat < 41.858 && lng > -87.640 && lng < -87.626) return "Chinatown";
    if (lat > 41.903 && lat < 41.916 && lng > -87.687 && lng < -87.666) return "Wicker Park";
    if (lat >= 41.916 && lat < 41.930 && lng > -87.688 && lng < -87.666) return "Bucktown";
    if (lat > 41.918 && lat < 41.936 && lng > -87.715 && lng <= -87.688) return "Logan Square";
    if (lat > 41.911 && lat < 41.933 && lng > -87.665 && lng < -87.630) return "Lincoln Park";
    if (lat >= 41.933 && lat < 41.955 && lng > -87.675 && lng < -87.635) return "Lakeview";
    return rawNeighborhood || "";
  },

  async submitNewRestaurant() {
    const name = document.getElementById("add-input-name").value.trim();
    if (!name) {
      this.showToast("⚠️ Please enter the restaurant name");
      return;
    }

    const score = parseFloat(document.getElementById("add-input-score").value) || 9.0;
    const targetRank = Math.max(1, Math.min(this.rankings.length + 1, parseInt(document.getElementById("add-input-rank").value, 10) || 1));
    const neighborhood = document.getElementById("add-input-neighborhood").value.trim() || "Chicago";
    const city = document.getElementById("add-input-city").value.trim() || "Chicago";
    const notes = document.getElementById("add-input-notes").value.trim() || null;

    const activePriceBtn = document.querySelector("#add-price-group .price-option-btn.active");
    const price = activePriceBtn ? activePriceBtn.getAttribute("data-price") : "$$";

    const cuisines = [];
    document.querySelectorAll("#add-cuisine-chips .cuisine-pick-chip.selected").forEach(chip => {
      cuisines.push(chip.getAttribute("data-cuisine"));
    });

    let lat = parseFloat(document.getElementById("add-input-lat").value);
    let lng = parseFloat(document.getElementById("add-input-lng").value);
    if (isNaN(lat) || isNaN(lng)) {
      const geo = await this.lookupGeocodeCandidates(`${name} ${city}`);
      if (geo.length > 0) {
        lat = geo[0].lat;
        lng = geo[0].lng;
      } else {
        lat = 41.8842;
        lng = -87.6481;
      }
    }

    let id = this.slugify(name);
    if (this.rankings.some(r => r.id === id)) {
      id = `${id}-${Math.random().toString(36).substring(2, 5)}`;
    }

    const newRest = {
      rank: targetRank,
      name,
      score: Math.max(0, Math.min(10, score)),
      price,
      cuisines: cuisines.length ? cuisines : ["Restaurant"],
      neighborhood,
      city,
      notes,
      id,
      lat,
      lng,
      photos: [],
      google_maps_url: `https://maps.google.com/?q=${encodeURIComponent(name + " " + city)}`
    };

    // Insert at targetRank
    this.rankings.splice(targetRank - 1, 0, newRest);
    this.normalizeRanks();

    // Process attached photos if any
    if (this.addFormPhotos && this.addFormPhotos.length > 0) {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      this.addFormPhotos.forEach((item, idx) => {
        const randSuffix = Math.random().toString(36).substring(2, 7);
        const filename = `${yyyymm}_${id.substring(0, 28)}_${randSuffix}.jpg`;
        const base64 = item.dataUrl.split(",")[1];
        this.queuedUploads[filename] = {
          filename,
          dataUrl: item.dataUrl,
          base64,
          restaurantId: id,
          caption: notes || `${name} highlight`
        };
        newRest.photos.push(filename);
        this.photoMeta.unshift({
          src: `images/${filename}`,
          filename,
          restaurant_id: id,
          restaurant_name: name,
          beli_score: newRest.score,
          beli_rank: newRest.rank,
          location: `${neighborhood}, ${city}`,
          cuisines: newRest.cuisines,
          caption: notes || `${name} Highlight`,
          notes: notes || ""
        });
      });
    }

    await this.saveDraftToDB(`Added #${targetRank} ${name}`);

    // Reset form
    document.getElementById("add-input-name").value = "";
    document.getElementById("add-input-neighborhood").value = "";
    document.getElementById("add-input-notes").value = "";
    document.getElementById("add-input-lat").value = "";
    document.getElementById("add-input-lng").value = "";
    document.getElementById("add-geocode-results").innerHTML = "";
    document.querySelectorAll("#add-cuisine-chips .cuisine-pick-chip.selected").forEach(c => c.classList.remove("selected"));
    this.addFormPhotos = [];
    this.renderAddFormPhotoPreviews();

    this.renderAll();
    this.switchTab("rankings");
    this.showToast(`🎉 Added ${name} at #${targetRank}!`);
  },

  /* ==========================================================================
     TAB 3: PHOTOS HUB (MISSING PHOTOS QUEUE & ALL PHOTOS GRID)
     ========================================================================== */
  bindPhotosTab() {
    document.querySelectorAll("#photos-subtabs .filter-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#photos-subtabs .filter-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.photosSubTab = btn.getAttribute("data-subtab") || "missing";
        this.renderPhotosTab();
      });
    });

    const photoSearch = document.getElementById("photos-search-input");
    if (photoSearch) {
      photoSearch.addEventListener("input", (e) => {
        this.photoSearchQuery = e.target.value.trim().toLowerCase();
        this.renderPhotosTab();
      });
    }
  },

  renderPhotosTab() {
    const container = document.getElementById("photos-tab-content");
    if (!container) return;

    const missingList = this.rankings.filter(r => !r.photos || r.photos.length === 0);
    const missingBadge = document.getElementById("missing-photos-count-badge");
    if (missingBadge) missingBadge.textContent = missingList.length;

    if (this.photosSubTab === "missing") {
      let filtered = missingList;
      if (this.photoSearchQuery) {
        filtered = filtered.filter(r => r.name.toLowerCase().includes(this.photoSearchQuery) || (r.neighborhood || "").toLowerCase().includes(this.photoSearchQuery));
      }

      if (!filtered.length) {
        container.innerHTML = `
          <div class="studio-panel-card" style="text-align: center; padding: 2.5rem 1rem;">
            <div style="font-size: 2rem; margin-bottom: 0.4rem;">🎉</div>
            <div style="font-weight: 800; color: #fff;">Every ranked spot has a photo!</div>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.65rem;">
          Tap <strong>+ Add Photo</strong> on any spot below to pick directly from your iPhone Camera Roll:
        </div>
        <div class="studio-list">
          ${filtered.map(r => `
            <div class="studio-rest-card" onclick="StudioApp.openEditDrawer('${r.id}')">
              <div class="rank-pill-btn">#${r.rank}</div>
              <div class="rest-card-info">
                <div class="rest-card-name">${this.escapeHtml(r.name)}</div>
                <div class="rest-card-meta">${this.escapeHtml(r.neighborhood || "")}, ${this.escapeHtml(r.city || "Chicago")} • ★ ${(r.score || 8.5).toFixed(1)}</div>
              </div>
              <button type="button" class="pill-btn emerald" onclick="event.stopPropagation(); StudioApp.triggerQuickPhotoUpload('${r.id}')">
                <i class="fa-solid fa-camera"></i> + Add Photo
              </button>
            </div>
          `).join("")}
        </div>
      `;
    } else {
      // All restaurants with photos
      let withPhotos = this.rankings.filter(r => r.photos && r.photos.length > 0);
      if (this.photoSearchQuery) {
        withPhotos = withPhotos.filter(r => r.name.toLowerCase().includes(this.photoSearchQuery) || (r.neighborhood || "").toLowerCase().includes(this.photoSearchQuery));
      }

      container.innerHTML = `
        <div class="drawer-photos-grid">
          ${withPhotos.map(r => `
            <div class="drawer-photo-card" onclick="StudioApp.openEditDrawer('${r.id}')" style="cursor: pointer;">
              <div class="drawer-photo-img-wrap">
                <img src="${this.resolvePhotoUrl(r.photos[0])}" alt="${this.escapeHtml(r.name)}" loading="lazy">
                <span class="primary-badge">#${r.rank}</span>
                <span class="rest-thumb-count"><i class="fa-solid fa-camera"></i> ${r.photos.length}</span>
              </div>
              <div style="padding: 0.5rem 0.6rem;">
                <div style="font-weight: 800; font-size: 0.84rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(r.name)}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary);">Tap to manage ${r.photos.length} photo${r.photos.length > 1 ? "s" : ""}</div>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }
  },

  /* ==========================================================================
     TAB 4: BELI SYNC & SCREENSHOT / LIVE TEXT IMPORT HELPER
     ========================================================================== */
  bindBeliSyncTab() {
    const parseBtn = document.getElementById("beli-parse-btn");
    const applyBtn = document.getElementById("beli-apply-btn");
    const ocrInput = document.getElementById("beli-screenshot-input");

    if (parseBtn) {
      parseBtn.addEventListener("click", () => this.parseBeliImportText());
    }
    if (applyBtn) {
      applyBtn.addEventListener("click", () => this.applyParsedBeliChanges());
    }
    if (ocrInput) {
      ocrInput.addEventListener("change", async (e) => {
        if (!e.target.files || !e.target.files.length) return;
        await this.runScreenshotOCR(Array.from(e.target.files));
        e.target.value = "";
      });
    }
  },

  async runScreenshotOCR(files) {
    const statusEl = document.getElementById("beli-ocr-status");
    const textArea = document.getElementById("beli-import-textarea");
    if (statusEl) statusEl.textContent = "⏳ Loading OCR engine & reading Beli screenshot(s)...";

    try {
      if (typeof Tesseract === "undefined") {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      let combinedText = textArea && textArea.value ? textArea.value + "\n" : "";
      for (let i = 0; i < files.length; i++) {
        if (statusEl) statusEl.textContent = `🔍 Reading screenshot ${i + 1} of ${files.length}...`;
        const result = await Tesseract.recognize(files[i], "eng");
        if (result && result.data && result.data.text) {
          combinedText += result.data.text + "\n";
        }
      }

      if (textArea) textArea.value = combinedText.trim();
      if (statusEl) statusEl.textContent = "✅ Screenshot text extracted! Reviewing matches below...";
      this.parseBeliImportText();
    } catch (err) {
      console.error("OCR error:", err);
      if (statusEl) statusEl.textContent = "⚠️ OCR could not load. Tip: Use iPhone Photos Live Text to copy text from your screenshot and paste below!";
    }
  },

  parseBeliImportText() {
    const textArea = document.getElementById("beli-import-textarea");
    const previewBox = document.getElementById("beli-parse-preview");
    const applyBtn = document.getElementById("beli-apply-btn");
    if (!textArea || !previewBox) return;

    const raw = textArea.value.trim();
    if (!raw) {
      this.showToast("Paste Beli rankings text or upload a screenshot first");
      return;
    }

    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsedItems = [];

    // Pattern 1: Single line like "1. Liuyishou Hotpot 10.0" or "#4 Indienne - 9.9"
    const singleLineRegex = /^#?(\d{1,3})[\.\)\s\-]+(.+?)(?:[\s\-–•]+(\d{1,2}\.\d))?$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(singleLineRegex);
      if (match) {
        const rank = parseInt(match[1], 10);
        let name = match[2].trim();
        let score = match[3] ? parseFloat(match[3]) : null;

        // If score wasn't on the same line, look ahead 1-3 lines (multi-line Beli screenshot format)
        if (score === null) {
          for (let j = 1; j <= 3 && (i + j) < lines.length; j++) {
            const scoreMatch = lines[i + j].match(/^(\d{1,2}\.\d)$/);
            if (scoreMatch) {
              score = parseFloat(scoreMatch[1]);
              break;
            }
          }
        }

        // Clean trailing score if still attached to name
        const trailingScore = name.match(/(.+?)\s+(\d{1,2}\.\d)$/);
        if (trailingScore && score === null) {
          name = trailingScore[1].trim();
          score = parseFloat(trailingScore[2]);
        }

        if (name && name.length >= 2) {
          parsedItems.push({ rank, name, score });
        }
      }
    }

    if (parsedItems.length === 0) {
      previewBox.innerHTML = `<div style="color: #fda4af; font-size: 0.82rem; padding: 0.75rem;">Could not detect numbered lines (e.g. <code>1. Indienne 9.9</code>). Check the format and try again.</div>`;
      if (applyBtn) applyBtn.style.display = "none";
      return;
    }

    // Match against existing restaurants
    this.pendingBeliImport = parsedItems.map(item => {
      const normName = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const existing = this.rankings.find(r => {
        const rNorm = r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return rNorm === normName || rNorm.includes(normName) || normName.includes(rNorm);
      });
      return {
        ...item,
        matchedId: existing ? existing.id : null,
        existingName: existing ? existing.name : null,
        oldRank: existing ? existing.rank : null,
        oldScore: existing ? existing.score : null
      };
    });

    previewBox.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--accent-emerald); margin-bottom: 0.5rem;">
        Found ${this.pendingBeliImport.length} restaurant${this.pendingBeliImport.length > 1 ? "s" : ""}:
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.4rem; max-height: 260px; overflow-y: auto;">
        ${this.pendingBeliImport.map(p => `
          <div style="background: rgba(15,23,42,0.85); border: 1px solid var(--glass-border); border-radius: 10px; padding: 0.5rem 0.7rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
            <div>
              <strong>#${p.rank} ${this.escapeHtml(p.existingName || p.name)}</strong>
              <div style="font-size: 0.7rem; color: var(--text-secondary);">
                ${p.matchedId ? `Matched existing (#${p.oldRank} → #${p.rank})` : `🆕 New restaurant`}
              </div>
            </div>
            <span class="score-pill" style="background: ${this.getScoreGradient(p.score || p.oldScore || 9.0)};">
              ★ ${(p.score || p.oldScore || 9.0).toFixed(1)}
            </span>
          </div>
        `).join("")}
      </div>
    `;

    if (applyBtn) applyBtn.style.display = "flex";
  },

  async applyParsedBeliChanges() {
    if (!this.pendingBeliImport || !this.pendingBeliImport.length) return;

    let updatedCount = 0;
    let addedCount = 0;

    // Sort by target rank ascending
    const sorted = [...this.pendingBeliImport].sort((a, b) => a.rank - b.rank);

    for (const item of sorted) {
      if (item.matchedId) {
        const rest = this.rankings.find(r => r.id === item.matchedId);
        if (rest) {
          if (typeof item.score === "number" && !isNaN(item.score)) {
            rest.score = item.score;
          }
          const idx = this.rankings.indexOf(rest);
          this.rankings.splice(idx, 1);
          const targetIdx = Math.max(0, Math.min(this.rankings.length, item.rank - 1));
          this.rankings.splice(targetIdx, 0, rest);
          updatedCount++;
        }
      } else {
        const id = this.slugify(item.name);
        const newSpot = {
          rank: item.rank,
          name: item.name,
          score: item.score || 9.0,
          price: "$$",
          cuisines: ["Restaurant"],
          neighborhood: "Chicago",
          city: "Chicago",
          notes: null,
          id,
          lat: 41.8842,
          lng: -87.6481,
          photos: [],
          google_maps_url: `https://maps.google.com/?q=${encodeURIComponent(item.name + " Chicago")}`
        };
        const targetIdx = Math.max(0, Math.min(this.rankings.length, item.rank - 1));
        this.rankings.splice(targetIdx, 0, newSpot);
        addedCount++;
      }
    }

    this.normalizeRanks();
    this.syncPhotoMetaWithRankings();
    await this.saveDraftToDB(`Beli Sync (${updatedCount} updated, ${addedCount} new)`);

    this.pendingBeliImport = [];
    document.getElementById("beli-parse-preview").innerHTML = "";
    document.getElementById("beli-apply-btn").style.display = "none";
    document.getElementById("beli-import-textarea").value = "";

    this.renderAll();
    this.switchTab("rankings");
    this.showToast(`✅ Applied ${updatedCount} updates & ${addedCount} new spots!`);
  },

  /* ==========================================================================
     TAB 5: ATOMIC GITHUB PAGES PUBLISHER & SETTINGS
     ========================================================================== */
  getGithubToken() {
    return (localStorage.getItem("pratik_github_pat") || "").trim();
  },

  bindPublishTab() {
    const tokenInput = document.getElementById("github-token-input");
    const saveTokenBtn = document.getElementById("save-token-btn");
    const testConnBtn = document.getElementById("test-github-btn");
    const publishBtn = document.getElementById("btn-publish-live");
    const discardBtn = document.getElementById("btn-discard-draft");
    const pullLatestBtn = document.getElementById("btn-pull-latest");
    const exportBtn = document.getElementById("btn-export-backup");

    if (tokenInput) {
      tokenInput.value = this.getGithubToken();
    }

    if (saveTokenBtn && tokenInput) {
      saveTokenBtn.addEventListener("click", () => {
        const val = tokenInput.value.trim();
        if (val) {
          localStorage.setItem("pratik_github_pat", val);
          this.showToast("🔐 GitHub token saved on this iPhone!");
          this.testGitHubConnection();
        } else {
          localStorage.removeItem("pratik_github_pat");
          this.showToast("GitHub token cleared");
        }
      });
    }

    if (testConnBtn) {
      testConnBtn.addEventListener("click", () => this.testGitHubConnection());
    }

    if (publishBtn) {
      publishBtn.addEventListener("click", () => this.publishToGitHubPages());
    }

    if (discardBtn) {
      discardBtn.addEventListener("click", async () => {
        if (!confirm("Discard all unpublished local edits and reload live rankings?")) return;
        await this.clearDraftFromDB();
        this.loadInitialDataFromGlobals();
        if (this.getGithubToken()) {
          await this.syncLatestFromGitHub(false);
        }
        this.renderAll();
        this.showToast("Reverted to live site data");
      });
    }

    if (pullLatestBtn) {
      pullLatestBtn.addEventListener("click", () => this.syncLatestFromGitHub(false));
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", () => this.downloadBackupJson());
    }
  },

  renderPublishSummary() {
    const listEl = document.getElementById("publish-changes-list");
    if (!listEl) return;

    const changes = Array.from(this.changeSummary);
    const uploads = Object.values(this.queuedUploads);

    if (!this.hasUnsavedChanges && changes.length === 0 && uploads.length === 0) {
      listEl.innerHTML = `
        <div style="color: var(--text-secondary); font-size: 0.84rem; text-align: center; padding: 0.75rem;">
          ✨ Your studio is in sync with live rankings. Make any rank or photo changes and tap Publish!
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.4rem;">
        ${changes.map(c => `<div style="font-size: 0.82rem; color: #e2e8f0;"><i class="fa-solid fa-pen-to-square" style="color: var(--accent-blue); margin-right: 6px;"></i>${this.escapeHtml(c)}</div>`).join("")}
        ${uploads.map(u => `<div style="font-size: 0.82rem; color: var(--accent-emerald);"><i class="fa-solid fa-image" style="margin-right: 6px;"></i>New Photo: ${this.escapeHtml(u.filename)}</div>`).join("")}
      </div>
    `;
  },

  async githubApi(path, options = {}) {
    const token = this.getGithubToken();
    if (!token) throw new Error("Missing GitHub Personal Access Token");

    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {})
      }
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GitHub API ${res.status}: ${errBody.substring(0, 140)}`);
    }
    return res.json();
  },

  async testGitHubConnection() {
    const statusEl = document.getElementById("github-conn-status");
    try {
      if (statusEl) statusEl.innerHTML = `<span style="color: var(--text-secondary);">Testing connection to ${this.repoOwner}/${this.repoName}...</span>`;
      const repo = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}`);
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 700;">✅ Connected to ${repo.full_name} (${repo.permissions && repo.permissions.push ? "Write access verified" : "Read"})</span>`;
      }
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: #fda4af;">❌ ${this.escapeHtml(err.message)}</span>`;
      }
    }
  },

  async syncLatestFromGitHub(silent = false) {
    const token = this.getGithubToken();
    if (!token) {
      if (!silent) this.showToast("Add your GitHub token first");
      return;
    }

    try {
      if (!silent) this.showToast("🔄 Fetching latest rankings from GitHub...");
      const fileData = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/contents/js/restaurants.js?ref=${this.repoBranch}`);
      if (fileData && fileData.content) {
        const decoded = new TextDecoder().decode(Uint8Array.from(atob(fileData.content.replace(/\s/g, "")), c => c.charCodeAt(0)));
        const jsonStart = decoded.indexOf("[");
        const jsonEnd = decoded.lastIndexOf("]");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const parsed = JSON.parse(decoded.substring(jsonStart, jsonEnd + 1));
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.rankings = parsed;
            this.normalizeRanks();
            this.renderAll();
            if (!silent) this.showToast(`✅ Synced ${parsed.length} spots from GitHub!`);
          }
        }
      }
    } catch (e) {
      console.warn("Could not pull latest from GitHub:", e);
      if (!silent) this.showToast("⚠️ Could not pull from GitHub");
    }
  },

  buildRestaurantsJsContent() {
    const json = JSON.stringify(this.rankings, null, 2);
    return `/** Global Data Objects */\nwindow.BELI_RANKINGS = BELI_RANKINGS = ${json};\n`;
  },

  buildBeliDataJsContent() {
    const json = JSON.stringify(this.rankings, null, 2);
    return `// Comprehensive Beli Rankings Data\nconst BELI_RESTAURANTS_DATA = ${json};\n`;
  },

  buildPhotosJsContent() {
    this.syncPhotoMetaWithRankings();
    const json = JSON.stringify(this.photoMeta, null, 2);
    return `window.PHOTOS = window.FOOD_PHOTOS = FOOD_PHOTOS = ${json};\n`;
  },

  utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  },

  async publishToGitHubPages() {
    const token = this.getGithubToken();
    if (!token) {
      this.showToast("⚠️ Enter your GitHub Personal Access Token below first!");
      document.getElementById("github-token-input")?.focus();
      return;
    }

    const btn = document.getElementById("btn-publish-live");
    const statusBox = document.getElementById("publish-live-status");
    if (btn) btn.disabled = true;

    const setStep = (msg, isError = false) => {
      if (statusBox) {
        statusBox.style.display = "block";
        statusBox.style.color = isError ? "#fda4af" : "#e2e8f0";
        statusBox.innerHTML = msg;
      }
    };

    try {
      setStep("⏳ 1/4 Connecting to GitHub (`ppratik96/newsite`)...");
      const refData = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/git/ref/heads/${this.repoBranch}`);
      const latestCommitSha = refData.object.sha;

      const commitData = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/git/commits/${latestCommitSha}`);
      const baseTreeSha = commitData.tree.sha;

      const treeItems = [];

      // 2. Upload any new photos as blobs
      const uploads = Object.values(this.queuedUploads);
      if (uploads.length > 0) {
        for (let i = 0; i < uploads.length; i++) {
          const u = uploads[i];
          setStep(`📸 2/4 Uploading photo ${i + 1} of ${uploads.length} (${u.filename})...`);
          const blobRes = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/git/blobs`, {
            method: "POST",
            body: JSON.stringify({
              content: u.base64,
              encoding: "base64"
            })
          });
          treeItems.push({
            path: `images/${u.filename}`,
            mode: "100644",
            type: "blob",
            sha: blobRes.sha
          });
        }
      }

      // 3. Create blobs for restaurants.js, beli_data.js, photos.js
      setStep("📝 3/4 Building updated rankings & photo index...");
      const filesToUpdate = [
        { path: "js/restaurants.js", content: this.buildRestaurantsJsContent() },
        { path: "js/beli_data.js", content: this.buildBeliDataJsContent() },
        { path: "js/photos.js", content: this.buildPhotosJsContent() }
      ];

      // Also bump cache-buster in picks.html and picks/index.html so live site visitors see updates immediately
      const newVer = `v=${Date.now()}`;
      for (const htmlPath of ["picks.html", "picks/index.html", "picks/admin.html", "admin.html"]) {
        try {
          const htmlFile = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/contents/${htmlPath}?ref=${this.repoBranch}`);
          if (htmlFile && htmlFile.content) {
            const rawHtml = new TextDecoder().decode(Uint8Array.from(atob(htmlFile.content.replace(/\s/g, "")), c => c.charCodeAt(0)));
            const updatedHtml = rawHtml
              .replace(/beli_data\.js\?v=[^"']+/g, `beli_data.js?${newVer}`)
              .replace(/restaurants\.js\?v=[^"']+/g, `restaurants.js?${newVer}`)
              .replace(/photos\.js\?v=[^"']+/g, `photos.js?${newVer}`);
            filesToUpdate.push({ path: htmlPath, content: updatedHtml });
          }
        } catch (e) {
          console.warn(`Skipping cache-buster update for ${htmlPath}:`, e);
        }
      }

      for (const f of filesToUpdate) {
        const blobRes = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({
            content: this.utf8ToBase64(f.content),
            encoding: "base64"
          })
        });
        treeItems.push({
          path: f.path,
          mode: "100644",
          type: "blob",
          sha: blobRes.sha
        });
      }

      // 4. Create Git tree & commit & update branch ref
      setStep("🚀 4/4 Committing & deploying to pratikpa.tel...");
      const newTree = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/git/trees`, {
        method: "POST",
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems
        })
      });

      const summaryList = Array.from(this.changeSummary);
      const commitMsg = summaryList.length > 0
        ? `Update Pratik's Picks via iPhone Studio: ${summaryList.slice(0, 3).join("; ")}`
        : "Update Pratik's Picks rankings & photos via iPhone Studio";

      const newCommit = await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/git/commits`, {
        method: "POST",
        body: JSON.stringify({
          message: commitMsg,
          tree: newTree.sha,
          parents: [latestCommitSha]
        })
      });

      await this.githubApi(`/repos/${this.repoOwner}/${this.repoName}/git/refs/heads/${this.repoBranch}`, {
        method: "PATCH",
        body: JSON.stringify({
          sha: newCommit.sha,
          force: false
        })
      });

      await this.clearDraftFromDB();
      setStep(`✅ <strong>Published!</strong> Commit <code>${newCommit.sha.substring(0, 7)}</code> pushed to GitHub Pages. Your changes will be live on <a href="/picks/" style="color: var(--accent-emerald); text-decoration: underline;">pratikpa.tel/picks</a> in ~25 seconds!`);
      this.showToast("🎉 Published to pratikpa.tel!");
    } catch (err) {
      console.error("Publish error:", err);
      setStep(`❌ Publish failed: ${this.escapeHtml(err.message)}`, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  downloadBackupJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      rankings: this.rankings,
      photos: this.photoMeta
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pratiks_picks_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  showToast(msg) {
    const toast = document.getElementById("studio-toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  },

  escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  StudioApp.init();
});

window.StudioApp = StudioApp;
