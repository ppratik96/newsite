/**
 * ORBITAL ARCADE — Vibecoded Retro Space Arcade Engine
 * Pure HTML5 Canvas + Web Audio API Sound Synthesizer
 */

class SoundFX {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playLaser() {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.12);
    } catch(e) {}
  }

  playExplosion(isLarge = false) {
    if (!this.ctx) return;
    try {
      const dur = isLarge ? 0.4 : 0.2;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(isLarge ? 140 : 220, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(25, this.ctx.currentTime + dur);
      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    } catch(e) {}
  }

  playPickup() {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.06);
      osc.frequency.setValueAtTime(783.99, now + 0.12);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.22);
    } catch(e) {}
  }

  playOrbitalBoost() {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.25);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.25);
    } catch(e) {}
  }

  playGameOver() {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.6);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.6);
    } catch(e) {}
  }
}

class OrbitalGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.sfx = new SoundFX();

    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.state = "START";
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem("orbital_highscore") || "0", 10);
    this.wave = 1;
    this.multiplier = 1;
    this.multiplierTimer = 0;

    this.keys = {};
    this.touchJoystick = { active: false, startX: 0, startY: 0, curX: 0, curY: 0, vx: 0, vy: 0 };
    this.touchFire = false;

    this.initEntities();
    this.initEvents();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  initEntities() {
    this.player = {
      x: this.width / 2,
      y: this.height / 2 + 120,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      radius: 14,
      health: 100,
      maxHealth: 100,
      shield: 100,
      maxShield: 100,
      fireTimer: 0,
      overchargeTimer: 0
    };

    // Central Gravity Planet
    this.gravityWell = {
      x: this.width / 2,
      y: this.height / 2,
      radius: Math.min(this.width, this.height) * 0.08 + 15,
      mass: 1800,
      pulse: 0
    };

    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.stars = [];
    this.powerups = [];
    this.floatingTexts = [];
    this.screenShake = 0;

    for (let i = 0; i < 120; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.4 + 0.1,
        alpha: Math.random() * 0.8 + 0.2
      });
    }

    this.spawnWave();
  }

  spawnWave() {
    const enemyCount = 4 + this.wave * 2;
    for (let i = 0; i < enemyCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.min(this.width, this.height) * 0.45 + Math.random() * 100;
      const x = this.gravityWell.x + Math.cos(angle) * dist;
      const y = this.gravityWell.y + Math.sin(angle) * dist;
      
      const type = Math.random() < 0.3 ? "DRONE" : (Math.random() < 0.2 ? "MINER" : "ASTEROID");
      this.enemies.push({
        x,
        y,
        vx: -Math.sin(angle) * (1.2 + this.wave * 0.15) + (Math.random() - 0.5),
        vy: Math.cos(angle) * (1.2 + this.wave * 0.15) + (Math.random() - 0.5),
        radius: type === "ASTEROID" ? 18 : 12,
        type,
        health: type === "MINER" ? 3 : (type === "ASTEROID" ? 2 : 1),
        maxHealth: type === "MINER" ? 3 : (type === "ASTEROID" ? 2 : 1),
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.05
      });
    }
  }

  initEvents() {
    window.addEventListener("resize", () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      if (this.canvas) {
        this.canvas.width = this.width;
        this.canvas.height = this.height;
      }
      if (this.gravityWell) {
        this.gravityWell.x = this.width / 2;
        this.gravityWell.y = this.height / 2;
        this.gravityWell.radius = Math.min(this.width, this.height) * 0.08 + 15;
      }
    });

    window.addEventListener("keydown", (e) => {
      this.sfx.init();
      this.keys[e.code] = true;
      if (e.code === "Space" && this.state === "START") {
        this.startGame();
      } else if (e.code === "KeyR" && this.state === "GAMEOVER") {
        this.startGame();
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });

    // Touch controls
    const joystickEl = document.getElementById("virtual-joystick-zone");
    if (joystickEl) {
      joystickEl.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this.sfx.init();
        const touch = e.touches[0];
        const rect = joystickEl.getBoundingClientRect();
        this.touchJoystick.active = true;
        this.touchJoystick.startX = touch.clientX - rect.left;
        this.touchJoystick.startY = touch.clientY - rect.top;
        this.touchJoystick.curX = this.touchJoystick.startX;
        this.touchJoystick.curY = this.touchJoystick.startY;
      }, { passive: false });

      joystickEl.addEventListener("touchmove", (e) => {
        e.preventDefault();
        if (!this.touchJoystick.active) return;
        const touch = e.touches[0];
        const rect = joystickEl.getBoundingClientRect();
        this.touchJoystick.curX = touch.clientX - rect.left;
        this.touchJoystick.curY = touch.clientY - rect.top;
        const dx = this.touchJoystick.curX - this.touchJoystick.startX;
        const dy = this.touchJoystick.curY - this.touchJoystick.startY;
        const maxDist = 45;
        const dist = Math.hypot(dx, dy);
        const normDist = Math.min(dist, maxDist) / maxDist;
        const angle = Math.atan2(dy, dx);
        this.touchJoystick.vx = Math.cos(angle) * normDist;
        this.touchJoystick.vy = Math.sin(angle) * normDist;
      }, { passive: false });

      const endJoystick = (e) => {
        e.preventDefault();
        this.touchJoystick.active = false;
        this.touchJoystick.vx = 0;
        this.touchJoystick.vy = 0;
      };
      joystickEl.addEventListener("touchend", endJoystick, { passive: false });
      joystickEl.addEventListener("touchcancel", endJoystick, { passive: false });
    }

    const fireBtn = document.getElementById("virtual-fire-btn");
    if (fireBtn) {
      fireBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this.sfx.init();
        this.touchFire = true;
        if (this.state === "START" || this.state === "GAMEOVER") {
          this.startGame();
        }
      }, { passive: false });
      fireBtn.addEventListener("touchend", (e) => {
        e.preventDefault();
        this.touchFire = false;
      }, { passive: false });
    }
  }

  startGame() {
    this.sfx.init();
    this.score = 0;
    this.wave = 1;
    this.multiplier = 1;
    this.multiplierTimer = 0;
    this.initEntities();
    this.state = "PLAYING";
    const overlay = document.getElementById("game-overlay");
    if (overlay) overlay.style.display = "none";
  }

  triggerGameOver() {
    this.state = "GAMEOVER";
    this.sfx.playGameOver();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem("orbital_highscore", this.highScore.toString());
    }
    const overlay = document.getElementById("game-overlay");
    const overlayTitle = document.getElementById("overlay-title");
    const overlaySub = document.getElementById("overlay-sub");
    const overlayBtn = document.getElementById("overlay-btn");
    if (overlay && overlayTitle && overlaySub && overlayBtn) {
      overlayTitle.textContent = "MISSION FAILED";
      overlaySub.innerHTML = `Final Score: <strong style="color:#38bdf8">${this.score}</strong> &nbsp;|&nbsp; High Score: <strong style="color:#fbbf24">${this.highScore}</strong>`;
      overlayBtn.textContent = "PLAY AGAIN (R)";
      overlay.style.display = "flex";
    }
  }

  addScore(pts) {
    const total = pts * this.multiplier;
    this.score += total;
    if (this.score > this.highScore) {
      this.highScore = this.score;
    }
    this.multiplierTimer = 240;
    if (this.multiplier < 8 && Math.random() < 0.3) {
      this.multiplier++;
      this.sfx.playOrbitalBoost();
      this.addFloatingText(`x${this.multiplier} BOOST!`, this.player.x, this.player.y - 20, "#fbbf24");
    }
  }

  addFloatingText(text, x, y, color = "#fff") {
    this.floatingTexts.push({ text, x, y, color, life: 40, maxLife: 40, vy: -1.2 });
  }

  spawnExplosion(x, y, color = "#38bdf8", count = 18) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 1;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: Math.random() * 3 + 1.5,
        alpha: 1,
        decay: Math.random() * 0.03 + 0.02
      });
    }
  }

  update(dt) {
    this.stars.forEach(s => {
      s.y += s.speed;
      if (s.y > this.height) s.y = 0;
    });

    if (this.state !== "PLAYING") return;

    if (this.screenShake > 0) this.screenShake -= 0.5;

    if (this.multiplierTimer > 0) {
      this.multiplierTimer--;
      if (this.multiplierTimer <= 0) {
        this.multiplier = 1;
      }
    }

    this.gravityWell.pulse += 0.04;

    let moveX = 0;
    let moveY = 0;

    if (this.keys["ArrowLeft"] || this.keys["KeyA"]) moveX -= 1;
    if (this.keys["ArrowRight"] || this.keys["KeyD"]) moveX += 1;
    if (this.keys["ArrowUp"] || this.keys["KeyW"]) moveY -= 1;
    if (this.keys["ArrowDown"] || this.keys["KeyS"]) moveY += 1;

    if (this.touchJoystick.active) {
      moveX = this.touchJoystick.vx;
      moveY = this.touchJoystick.vy;
    }

    const thrust = 0.45;
    this.player.vx += moveX * thrust;
    this.player.vy += moveY * thrust;

    const dx = this.gravityWell.x - this.player.x;
    const dy = this.gravityWell.y - this.player.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    if (dist > this.gravityWell.radius) {
      const gForce = this.gravityWell.mass / Math.max(distSq, 3000);
      this.player.vx += (dx / dist) * gForce;
      this.player.vy += (dy / dist) * gForce;
    } else {
      this.player.health -= 2;
      this.spawnExplosion(this.player.x, this.player.y, "#f43f5e", 4);
    }

    this.player.vx *= 0.96;
    this.player.vy *= 0.96;
    const maxSpeed = 7.5;
    const curSpeed = Math.hypot(this.player.vx, this.player.vy);
    if (curSpeed > maxSpeed) {
      this.player.vx = (this.player.vx / curSpeed) * maxSpeed;
      this.player.vy = (this.player.vy / curSpeed) * maxSpeed;
    }

    this.player.x += this.player.vx;
    this.player.y += this.player.vy;

    if (curSpeed > 0.3) {
      this.player.angle = Math.atan2(this.player.vy, this.player.vx) + Math.PI / 2;
    }

    if (this.player.x < 0) this.player.x = this.width;
    if (this.player.x > this.width) this.player.x = 0;
    if (this.player.y < 0) this.player.y = this.height;
    if (this.player.y > this.height) this.player.y = 0;

    if (this.player.shield < this.player.maxShield) {
      this.player.shield += 0.08;
    }

    const isFiring = this.keys["Space"] || this.keys["KeyJ"] || this.touchFire;
    if (this.player.fireTimer > 0) this.player.fireTimer--;

    if (isFiring && this.player.fireTimer <= 0) {
      this.player.fireTimer = 9;
      const noseX = this.player.x + Math.sin(this.player.angle) * 14;
      const noseY = this.player.y - Math.cos(this.player.angle) * 14;
      const bulletSpeed = 12;

      this.bullets.push({
        x: noseX,
        y: noseY,
        vx: Math.sin(this.player.angle) * bulletSpeed + this.player.vx * 0.4,
        vy: -Math.cos(this.player.angle) * bulletSpeed + this.player.vy * 0.4,
        life: 55,
        color: this.player.multiplier > 1 ? "#fbbf24" : "#38bdf8"
      });
      this.sfx.playLaser();
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      if (b.life <= 0 || b.x < 0 || b.x > this.width || b.y < 0 || b.y > this.height) {
        this.bullets.splice(i, 1);
      }
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.rot += e.rotSpeed;

      const edx = this.gravityWell.x - e.x;
      const edy = this.gravityWell.y - e.y;
      const edistSq = edx * edx + edy * edy;
      const edist = Math.sqrt(edistSq);
      if (edist > this.gravityWell.radius) {
        const egForce = (this.gravityWell.mass * 0.6) / Math.max(edistSq, 3000);
        e.vx += (edx / edist) * egForce;
        e.vy += (edy / edist) * egForce;
      }

      e.x += e.vx;
      e.y += e.vy;

      for (let j = this.bullets.length - 1; j >= 0; j--) {
        const b = this.bullets[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.radius + 6) {
          this.bullets.splice(j, 1);
          e.health--;
          this.spawnExplosion(b.x, b.y, "#38bdf8", 6);
          if (e.health <= 0) {
            this.sfx.playExplosion(e.type === "ASTEROID");
            this.spawnExplosion(e.x, e.y, e.type === "MINER" ? "#ec4899" : (e.type === "ASTEROID" ? "#a855f7" : "#06b6d4"), 22);
            this.addScore(e.type === "MINER" ? 150 : (e.type === "ASTEROID" ? 80 : 50));
            this.enemies.splice(i, 1);

            if (Math.random() < 0.35) {
              this.powerups.push({
                x: e.x,
                y: e.y,
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5,
                type: Math.random() < 0.5 ? "SHIELD" : "CRYSTAL",
                life: 400
              });
            }
            break;
          }
        }
      }

      if (this.enemies[i] && Math.hypot(this.player.x - e.x, this.player.y - e.y) < this.player.radius + e.radius) {
        const dmg = e.type === "ASTEROID" ? 30 : 20;
        if (this.player.shield > 0) {
          this.player.shield = Math.max(0, this.player.shield - dmg);
        } else {
          this.player.health = Math.max(0, this.player.health - dmg);
        }
        this.screenShake = 12;
        this.sfx.playExplosion(true);
        this.spawnExplosion(this.player.x, this.player.y, "#f43f5e", 20);
        this.enemies.splice(i, 1);

        if (this.player.health <= 0) {
          this.triggerGameOver();
          return;
        }
      }
    }

    if (this.enemies.length === 0) {
      this.wave++;
      this.addFloatingText(`WAVE ${this.wave}!`, this.width / 2, this.height / 2 - 80, "#38bdf8");
      this.spawnWave();
    }

    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      if (Math.hypot(this.player.x - p.x, this.player.y - p.y) < this.player.radius + 15) {
        this.sfx.playPickup();
        if (p.type === "SHIELD") {
          this.player.shield = Math.min(this.player.maxShield, this.player.shield + 40);
          this.addFloatingText("+SHIELD", p.x, p.y, "#38bdf8");
        } else {
          this.addScore(200);
          this.addFloatingText("+200 CRYSTAL", p.x, p.y, "#a855f7");
        }
        this.spawnExplosion(p.x, p.y, "#fbbf24", 12);
        this.powerups.splice(i, 1);
      } else if (p.life <= 0) {
        this.powerups.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.alpha -= pt.decay;
      if (pt.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.life--;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  draw() {
    if (!this.ctx) return;
    this.ctx.save();

    if (this.screenShake > 0) {
      const sx = (Math.random() - 0.5) * this.screenShake;
      const sy = (Math.random() - 0.5) * this.screenShake;
      this.ctx.translate(sx, sy);
    }

    this.ctx.fillStyle = "#070a12";
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.strokeStyle = "rgba(56, 189, 248, 0.04)";
    this.ctx.lineWidth = 1;
    const gridSize = 60;
    for (let x = 0; x < this.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.height);
      this.ctx.stroke();
    }
    for (let y = 0; y < this.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.width, y);
      this.ctx.stroke();
    }

    this.stars.forEach(s => {
      this.ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
      this.ctx.beginPath();
      this.ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      this.ctx.fill();
    });

    const gw = this.gravityWell;
    const pulseRadius = gw.radius + Math.sin(gw.pulse) * 4;
    const grad = this.ctx.createRadialGradient(gw.x, gw.y, gw.radius * 0.2, gw.x, gw.y, pulseRadius * 2);
    grad.addColorStop(0, "#fbbf24");
    grad.addColorStop(0.3, "rgba(245, 158, 11, 0.8)");
    grad.addColorStop(0.7, "rgba(236, 72, 153, 0.2)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");

    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(gw.x, gw.y, pulseRadius * 2, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = "#fffbeb";
    this.ctx.beginPath();
    this.ctx.arc(gw.x, gw.y, gw.radius * 0.7, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = "rgba(245, 158, 11, 0.15)";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.arc(gw.x, gw.y, gw.radius * 2.8, 0, Math.PI * 2);
    this.ctx.stroke();

    this.powerups.forEach(p => {
      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.fillStyle = p.type === "SHIELD" ? "#38bdf8" : "#a855f7";
      this.ctx.shadowColor = p.type === "SHIELD" ? "#38bdf8" : "#a855f7";
      this.ctx.shadowBlur = 10;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });

    this.bullets.forEach(b => {
      this.ctx.save();
      this.ctx.fillStyle = b.color;
      this.ctx.shadowColor = b.color;
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });

    this.enemies.forEach(e => {
      this.ctx.save();
      this.ctx.translate(e.x, e.y);
      this.ctx.rotate(e.rot);

      if (e.type === "ASTEROID") {
        this.ctx.strokeStyle = "#c084fc";
        this.ctx.fillStyle = "rgba(192, 132, 252, 0.15)";
        this.ctx.lineWidth = 2;
        this.ctx.shadowColor = "#c084fc";
        this.ctx.shadowBlur = 8;
        this.ctx.beginPath();
        const sides = 6;
        for (let s = 0; s < sides; s++) {
          const a = (s / sides) * Math.PI * 2;
          const r = e.radius * (0.8 + (s % 2) * 0.3);
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (s === 0) this.ctx.moveTo(px, py);
          else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
      } else if (e.type === "MINER") {
        this.ctx.strokeStyle = "#f43f5e";
        this.ctx.fillStyle = "rgba(244, 63, 94, 0.2)";
        this.ctx.lineWidth = 2;
        this.ctx.shadowColor = "#f43f5e";
        this.ctx.shadowBlur = 10;
        this.ctx.beginPath();
        this.ctx.moveTo(0, -e.radius);
        this.ctx.lineTo(e.radius, e.radius);
        this.ctx.lineTo(-e.radius, e.radius);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
      } else {
        this.ctx.strokeStyle = "#06b6d4";
        this.ctx.fillStyle = "rgba(6, 182, 212, 0.25)";
        this.ctx.lineWidth = 2;
        this.ctx.shadowColor = "#06b6d4";
        this.ctx.shadowBlur = 6;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
      }
      this.ctx.restore();
    });

    this.particles.forEach(pt => {
      this.ctx.fillStyle = pt.color;
      this.ctx.globalAlpha = pt.alpha;
      this.ctx.beginPath();
      this.ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
    });

    if (this.state === "PLAYING" || this.state === "START") {
      this.ctx.save();
      this.ctx.translate(this.player.x, this.player.y);
      this.ctx.rotate(this.player.angle);

      this.ctx.strokeStyle = "#38bdf8";
      this.ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
      this.ctx.shadowColor = "#38bdf8";
      this.ctx.shadowBlur = 12;
      this.ctx.lineWidth = 2.5;

      this.ctx.beginPath();
      this.ctx.moveTo(0, -this.player.radius - 2);
      this.ctx.lineTo(this.player.radius, this.player.radius);
      this.ctx.lineTo(0, this.player.radius * 0.5);
      this.ctx.lineTo(-this.player.radius, this.player.radius);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      if (this.player.shield > 10) {
        this.ctx.strokeStyle = `rgba(56, 189, 248, ${Math.min(1, this.player.shield / 80)})`;
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, this.player.radius + 6, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      this.ctx.restore();
    }

    this.floatingTexts.forEach(ft => {
      this.ctx.save();
      this.ctx.fillStyle = ft.color;
      this.ctx.font = "bold 15px 'Plus Jakarta Sans', sans-serif";
      this.ctx.shadowColor = ft.color;
      this.ctx.shadowBlur = 8;
      this.ctx.globalAlpha = ft.life / ft.maxLife;
      this.ctx.textAlign = "center";
      this.ctx.fillText(ft.text, ft.x, ft.y);
      this.ctx.restore();
    });

    if (this.state === "PLAYING") {
      this.drawHUD();
    }

    this.ctx.restore();
  }

  drawHUD() {
    this.ctx.save();
    this.ctx.fillStyle = "#fff";
    this.ctx.font = "bold 18px 'Plus Jakarta Sans', sans-serif";
    this.ctx.textAlign = "left";
    this.ctx.fillText(`SCORE: ${this.score}`, 20, 35);

    this.ctx.font = "13px 'Plus Jakarta Sans', sans-serif";
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    this.ctx.fillText(`HIGH: ${this.highScore}  |  WAVE ${this.wave}`, 20, 58);

    if (this.multiplier > 1) {
      this.ctx.fillStyle = "#fbbf24";
      this.ctx.font = "bold 14px 'Plus Jakarta Sans', sans-serif";
      this.ctx.fillText(`MULTIPLIER: x${this.multiplier}`, 20, 80);
    }

    const barW = 120;
    const barH = 7;
    const barX = this.width - barW - 20;

    this.ctx.fillStyle = "rgba(255,255,255,0.1)";
    this.ctx.fillRect(barX, 22, barW, barH);
    this.ctx.fillStyle = "#38bdf8";
    this.ctx.fillRect(barX, 22, (this.player.shield / this.player.maxShield) * barW, barH);

    this.ctx.fillStyle = "rgba(255,255,255,0.1)";
    this.ctx.fillRect(barX, 35, barW, barH);
    this.ctx.fillStyle = "#10b981";
    this.ctx.fillRect(barX, 35, (this.player.health / this.player.maxHealth) * barW, barH);

    this.ctx.fillStyle = "rgba(255,255,255,0.7)";
    this.ctx.font = "10px 'Plus Jakarta Sans', sans-serif";
    this.ctx.textAlign = "right";
    this.ctx.fillText("SHIELD", barX - 6, 29);
    this.ctx.fillText("HULL", barX - 6, 42);

    this.ctx.restore();
  }

  loop(timestamp) {
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    this.update(dt);
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const game = new OrbitalGame("arcade-canvas");
  window.OrbitalGameInstance = game;

  const startBtn = document.getElementById("overlay-btn");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      game.startGame();
    });
  }
});
