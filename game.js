/* =========================================================================
   НЕОН-АРЕНА — 2D arena shooter на canvas.
   Без библиотек и ассетов: вся графика рисуется кодом, звук — через WebAudio.
   ========================================================================= */
(function () {
  'use strict';

  /* ------------------------------- утилиты ------------------------------- */
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const hyp = Math.hypot;

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ------------------------------ canvas --------------------------------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  let W = 1;
  let H = 1;
  let DPR = 1;
  let bgGrad = null;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.44, 0, W * 0.5, H * 0.44, Math.max(W, H) * 0.8);
    bgGrad.addColorStop(0, '#0b1728');
    bgGrad.addColorStop(0.5, '#060c16');
    bgGrad.addColorStop(1, '#03050a');
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------------------- спрайты свечения (кэш) -------------------------- */
  const glowCache = new Map();

  function glowSprite(color) {
    let c = glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.16, rgba(color, 0.9));
    grad.addColorStop(0.48, rgba(color, 0.28));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
    return c;
  }

  function blob(x, y, r, color, alpha) {
    const sp = glowSprite(color);
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  function rr(x, y, w, h, r) {
    if (w <= 0 || h <= 0) return;
    const k = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
  }

  /* -------------------------------- звук ---------------------------------- */
  const SFX = {
    ac: null,
    master: null,
    muted: false,

    init() {
      if (this.ac) {
        if (this.ac.state === 'suspended') this.ac.resume().catch(function () {});
        return;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();
        this.master = this.ac.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(this.ac.destination);
        if (this.ac.state === 'suspended') this.ac.resume().catch(function () {});
      } catch (err) {
        this.ac = null;
      }
    },

    tone(freq, dur, type, vol, slideTo, delay) {
      if (this.muted || !this.ac) return;
      const t = this.ac.currentTime + (delay || 0);
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(25, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.03);
    },

    noise(dur, vol, cutoff) {
      if (this.muted || !this.ac) return;
      const ac = this.ac;
      const t = ac.currentTime;
      const len = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff || 1200;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      src.start(t);
    },

    shoot() {
      this.tone(760, 0.055, 'triangle', 0.13, 240);
      this.noise(0.03, 0.05, 4200);
    },
    hit() {
      this.tone(240, 0.035, 'square', 0.045, 130);
    },
    kill(big) {
      this.noise(big ? 0.34 : 0.16, big ? 0.3 : 0.16, big ? 700 : 1500);
      this.tone(big ? 90 : 150, big ? 0.3 : 0.16, 'sine', 0.11, 42);
    },
    hurt() {
      this.tone(120, 0.28, 'sawtooth', 0.18, 45);
      this.noise(0.22, 0.16, 900);
    },
    dash() {
      this.noise(0.16, 0.13, 3200);
      this.tone(280, 0.14, 'sine', 0.07, 720);
    },
    pickup() {
      this.tone(660, 0.07, 'sine', 0.12, 990);
      this.tone(990, 0.09, 'sine', 0.1, 1320, 0.07);
    },
    espit() {
      this.tone(330, 0.12, 'sawtooth', 0.06, 180);
    },
    wave() {
      this.tone(330, 0.12, 'sine', 0.1);
      this.tone(494, 0.18, 'sine', 0.1, null, 0.1);
    },
    waveClear() {
      this.tone(523, 0.1, 'sine', 0.1);
      this.tone(659, 0.1, 'sine', 0.1, null, 0.08);
      this.tone(784, 0.2, 'sine', 0.1, null, 0.16);
    },
    over() {
      this.tone(220, 0.4, 'sawtooth', 0.14, 55);
      this.tone(110, 0.7, 'sine', 0.16, 35, 0.12);
      this.noise(0.6, 0.2, 500);
    },
  };

  function toggleMute() {
    SFX.muted = !SFX.muted;
    if (SFX.master) SFX.master.gain.value = SFX.muted ? 0 : 0.55;
    if (player) floatText(player.x, player.y - 40, SFX.muted ? 'ЗВУК ВЫКЛ' : 'ЗВУК ВКЛ', '#8fb6c9', 13);
  }

  /* ------------------------------- ввод ----------------------------------- */
  const mouse = { x: W / 2, y: H / 2, down: false };
  const keys = Object.create(null);
  let wantDash = false;

  const PREVENT = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];

  window.addEventListener('keydown', function (e) {
    if (PREVENT.indexOf(e.code) !== -1) e.preventDefault();
    keys[e.code] = true;

    if ((e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) {
      wantDash = true;
    }
    if ((e.code === 'Escape' || e.code === 'KeyP') && (state === 'playing' || state === 'paused')) {
      e.preventDefault();
      togglePause();
    }
    if (e.code === 'KeyM' && !e.repeat) toggleMute();
    if (e.code === 'Enter' && (state === 'menu' || state === 'over')) startGame();
    if (e.code === 'KeyR' && state === 'over') startGame();
  });

  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });

  canvas.addEventListener('mousemove', function (e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', function (e) {
    if (e.button === 0) mouse.down = true;
  });
  window.addEventListener('mouseup', function (e) {
    if (e.button === 0) mouse.down = false;
  });
  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });
  window.addEventListener('blur', function () {
    mouse.down = false;
    for (const k in keys) keys[k] = false;
    if (state === 'playing') pauseGame();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'playing') pauseGame();
  });

  /* ------------------------------- DOM ------------------------------------ */
  const ov = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovText = document.getElementById('ov-text');
  const ovKeys = document.getElementById('ov-keys');
  const ovBtn = document.getElementById('ov-btn');
  const ovHint = document.querySelector('.hint');

  function showOverlay(title, html, btn, withKeys) {
    ovTitle.textContent = title;
    ovText.innerHTML = html;
    ovBtn.textContent = btn;
    ovKeys.style.display = withKeys ? 'grid' : 'none';
    if (ovHint) ovHint.style.display = withKeys ? 'block' : 'none';
    ov.classList.remove('hidden');
  }

  function hideOverlay() {
    ov.classList.add('hidden');
  }

  ovBtn.addEventListener('click', function () {
    SFX.init();
    if (state === 'paused') resumeGame();
    else startGame();
  });

  /* ------------------------------ состояние ------------------------------- */
  let state = 'menu'; // menu | playing | paused | over
  let time = 0;
  let player = null;

  let bullets = [];
  let ebullets = [];
  let enemies = [];
  let particles = [];
  let pickups = [];
  let texts = [];

  let spawnQueue = [];
  let spawnTimer = 0;
  let wave = 0;
  let waveCleared = false;
  let waveCooldown = 0;
  let banner = null;

  let score = 0;
  let best = 0;
  let combo = 0;
  let comboTimer = 0;

  let shake = 0;
  let flash = 0;
  let lastTs = 0;

  try {
    best = parseInt(localStorage.getItem('neon-arena-best') || '0', 10) || 0;
  } catch (err) {
    best = 0;
  }

  const dust = [];
  function initDust() {
    dust.length = 0;
    for (let i = 0; i < 80; i++) {
      dust.push({
        x: rand(0, W),
        y: rand(0, H),
        vx: rand(-7, 7),
        vy: rand(-13, -3),
        r: rand(0.5, 1.9),
        a: rand(0.05, 0.22),
      });
    }
  }
  initDust();

  /* --------------------------- игровые сущности --------------------------- */
  const TYPES = {
    grunt: { hp: 30, r: 13, speed: 112, dmg: 14, score: 10, color: '#ff3b6b', shape: 'circle' },
    zipper: { hp: 18, r: 10, speed: 235, dmg: 10, score: 14, color: '#ffd166', shape: 'triangle' },
    spitter: { hp: 38, r: 14, speed: 80, dmg: 12, score: 22, color: '#a06bff', shape: 'diamond' },
    brute: { hp: 120, r: 26, speed: 58, dmg: 24, score: 45, color: '#ff8a3d', shape: 'square' },
  };

  const SPAWN_COST = { grunt: 1, zipper: 1.2, spitter: 1.8, brute: 3.4 };

  function comboMult() {
    return 1 + Math.min(combo, 20) * 0.05;
  }

  function addScore(base) {
    const val = Math.round(base * comboMult());
    score += val;
    return val;
  }

  function floatText(x, y, text, color, size) {
    texts.push({ x: x, y: y, text: text, color: color, size: size || 14, life: 0.9, max: 0.9 });
  }

  function explode(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const s = rand(power * 0.15, power);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.25, 0.75),
        max: 0.75,
        size: rand(1.5, 4.5),
        color: color,
      });
    }
    if (particles.length > 800) particles.splice(0, particles.length - 800);
    shake = Math.min(22, shake + power * 0.012);
  }

  /* ---------------------------- игрок ------------------------------------- */
  function startGame() {
    SFX.init();
    hideOverlay();

    player = {
      x: W / 2,
      y: H * 0.65,
      vx: 0,
      vy: 0,
      r: 13,
      angle: -Math.PI / 2,
      hp: 100,
      maxHp: 100,
      weapon: 1,
      fireCd: 0,
      invuln: 1.2,
      dashCd: 0,
      dashTime: 0,
      dashVX: 0,
      dashVY: 0,
    };

    bullets = [];
    ebullets = [];
    enemies = [];
    particles = [];
    pickups = [];
    texts = [];
    spawnQueue = [];

    score = 0;
    combo = 0;
    comboTimer = 0;
    wave = 1;
    waveCleared = false;
    waveCooldown = 0;
    banner = null;
    shake = 0;
    flash = 0;
    wantDash = false;
    mouse.down = false;

    state = 'playing';
    startWave();
  }

  function gameOver() {
    if (!player) return;
    const px = player.x;
    const py = player.y;
    explode(px, py, '#4de2ff', 70, 460);
    explode(px, py, '#ff4d6d', 40, 300);
    flash = 1;
    shake = 22;
    SFX.over();

    const prevBest = best;
    const isRecord = score > prevBest;
    best = Math.max(best, score);
    try {
      localStorage.setItem('neon-arena-best', String(best));
    } catch (err) {
      /* приватный режим — просто не сохраняем */
    }

    player = null;
    banner = null;
    state = 'over';

    showOverlay(
      'ИГРА ОКОНЧЕНА',
      'Волна <b>' + wave + '</b> &nbsp;·&nbsp; Очки <b>' + score + '</b><br>' +
        (isRecord ? 'Новый рекорд!' : 'Рекорд: <b>' + best + '</b>'),
      'ЕЩЁ РАЗ',
      false
    );
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    mouse.down = false;
    for (const k in keys) keys[k] = false;
    showOverlay('ПАУЗА', 'Передышка. Враги подождут.', 'ПРОДОЛЖИТЬ', false);
  }

  function resumeGame() {
    if (state !== 'paused') return;
    hideOverlay();
    lastTs = 0;
    state = 'playing';
  }

  function togglePause() {
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
  }

  /* ------------------------------ волны ----------------------------------- */
  function buildWave(n) {
    let budget = 3.5 + n * 1.7 + Math.pow(n, 1.4) * 0.18;
    const available = ['grunt'];
    if (n >= 2) available.push('zipper');
    if (n >= 3) available.push('spitter');
    if (n >= 5) available.push('brute');

    const out = [];
    let guard = 0;
    while (budget > 0.95 && guard++ < 400) {
      // на ранних волнах заметный перевес обычных «бегунов»
      let type;
      if (Math.random() < (n < 4 ? 0.7 : 0.42)) type = 'grunt';
      else type = pick(available);

      const cost = SPAWN_COST[type];
      if (cost > budget) {
        if (budget < 1) break;
        out.push('grunt');
        budget -= 1;
        continue;
      }
      out.push(type);
      budget -= cost;
    }
    if (!out.length) out.push('grunt');
    return out;
  }

  function startWave() {
    spawnQueue = buildWave(wave);
    spawnTimer = 0.7;
    waveCleared = false;
    banner = { text: 'ВОЛНА ' + wave, sub: 'ВРАГОВ: ' + spawnQueue.length, life: 1.8, max: 1.8 };
    SFX.wave();
  }

  function spawnOne() {
    const type = spawnQueue.shift();
    if (!type) return;
    const m = 60;
    let x;
    let y;
    const side = randInt(0, 3);
    if (side === 0) {
      x = rand(0, W);
      y = -m;
    } else if (side === 1) {
      x = W + m;
      y = rand(0, H);
    } else if (side === 2) {
      x = rand(0, W);
      y = H + m;
    } else {
      x = -m;
      y = rand(0, H);
    }
    spawnEnemy(type, x, y);
  }

  function spawnEnemy(type, x, y) {
    const t = TYPES[type];
    const hpMul = 1 + (wave - 1) * 0.06;
    const hp = Math.max(1, Math.round(t.hp * hpMul));

    enemies.push({
      type: type,
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      hp: hp,
      maxHp: hp,
      r: t.r,
      speed: t.speed * (1 + (wave - 1) * 0.012),
      dmg: t.dmg,
      score: t.score,
      color: t.color,
      shape: t.shape,
      angle: 0,
      flash: 0,
      shootCd: rand(0.9, 2.2),
      phase: rand(0, TAU),
      spin: t.shape === 'square' ? rand(-0.5, 0.5) : 0,
      dead: false,
    });

    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU);
      const s = rand(60, 260);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.2, 0.5),
        max: 0.5,
        size: rand(1, 3),
        color: t.color,
      });
    }
  }

  function updateWaves(dt) {
    if (spawnQueue.length) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = Math.max(0.16, 0.62 - wave * 0.03);
        spawnOne();
      }
      return;
    }

    if (enemies.length === 0) {
      if (!waveCleared) {
        waveCleared = true;
        waveCooldown = 2.4;
        const bonus = 60 * wave;
        score += bonus;
        banner = {
          text: 'ВОЛНА ' + wave + ' ЗАЧИЩЕНА',
          sub: '+' + bonus + ' ОЧКОВ',
          life: 2,
          max: 2,
        };
        SFX.waveClear();
      }
      waveCooldown -= dt;
      if (waveCooldown <= 0) {
        wave += 1;
        waveCleared = false;
        startWave();
      }
    } else {
      waveCleared = false;
    }
  }

  /* ------------------------------ урон ------------------------------------ */
  function hurtPlayer(amount, srcX, srcY) {
    const p = player;
    if (!p || p.invuln > 0) return;

    p.hp -= amount;
    p.invuln = 0.8;
    flash = Math.min(1, flash + 0.6);
    shake = Math.min(22, shake + 10);
    combo = 0;
    comboTimer = 0;

    explode(p.x, p.y, '#ff4d6d', 14, 210);
    SFX.hurt();

    const a = Math.atan2(p.y - srcY, p.x - srcX);
    p.vx += Math.cos(a) * 300;
    p.vy += Math.sin(a) * 300;

    if (p.hp <= 0) {
      p.hp = 0;
      gameOver();
    }
  }

  function damageEnemy(e, dmg, x, y) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 1;

    for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU);
      const s = rand(60, 230);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.15, 0.35),
        max: 0.35,
        size: rand(1.2, 3),
        color: e.color,
      });
    }

    if (e.hp <= 0) killEnemy(e);
    else SFX.hit();
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;

    combo += 1;
    comboTimer = 2.6;

    const val = addScore(e.score);
    floatText(e.x, e.y - 12, '+' + val, e.color, e.type === 'brute' ? 20 : 15);
    explode(e.x, e.y, e.color, e.type === 'brute' ? 38 : 18, e.type === 'brute' ? 430 : 260);
    shake = Math.min(22, shake + (e.type === 'brute' ? 9 : 2.5));
    SFX.kill(e.type === 'brute');
    maybeDrop(e);

    if (e.type === 'brute') {
      for (let i = 0; i < 2; i++) {
        spawnEnemy('grunt', e.x + rand(-26, 26), e.y + rand(-26, 26));
      }
    }
  }

  function maybeDrop(e) {
    let chance = 0.16 + (e.type === 'brute' ? 0.55 : 0) + (e.type === 'spitter' ? 0.06 : 0);
    if (Math.random() > chance) return;

    let type = Math.random() < 0.62 ? 'health' : 'weapon';
    if (player && player.hp > player.maxHp * 0.7 && type === 'health' && Math.random() < 0.55) type = 'weapon';
    if (player && player.weapon >= 3 && type === 'weapon' && Math.random() < 0.5) type = 'health';

    pickups.push({
      x: e.x,
      y: e.y,
      vx: rand(-40, 40),
      vy: rand(-40, 40),
      r: 12,
      type: type,
      life: 14,
      color: type === 'health' ? '#58ffa5' : '#ffd166',
      pulse: rand(0, TAU),
    });
  }

  /* ---------------------------- обновление -------------------------------- */
  function update(dt) {
    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    updateEBullets(dt);
    updatePickups(dt);
    updateParticles(dt);
    updateTexts(dt);
    updateWaves(dt);

    if (banner) {
      banner.life -= dt;
      if (banner.life <= 0) banner = null;
    }

    shake *= Math.exp(-dt * 7);
    if (shake < 0.15) shake = 0;
    flash = Math.max(0, flash - dt * 1.8);
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 0;
    }
  }

  function updatePlayer(dt) {
    const p = player;
    if (!p) return;

    p.invuln = Math.max(0, p.invuln - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.fireCd -= dt;

    p.angle = Math.atan2(mouse.y - p.y, mouse.x - p.x);

    let ix = 0;
    let iy = 0;
    if (keys.KeyW || keys.ArrowUp) iy -= 1;
    if (keys.KeyS || keys.ArrowDown) iy += 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;
    const ilen = hyp(ix, iy);
    if (ilen > 0) {
      ix /= ilen;
      iy /= ilen;
    }

    if (wantDash) {
      wantDash = false;
      if (p.dashCd <= 0 && p.dashTime <= 0) {
        const dx = ilen > 0 ? ix : Math.cos(p.angle);
        const dy = ilen > 0 ? iy : Math.sin(p.angle);
        p.dashTime = 0.16;
        p.dashCd = 1.15;
        p.dashVX = dx * 1500;
        p.dashVY = dy * 1500;
        p.invuln = Math.max(p.invuln, 0.3);
        shake = Math.min(16, shake + 3);
        for (const e of enemies) e.dashHit = false;
        SFX.dash();

        for (let i = 0; i < 16; i++) {
          const a = rand(0, TAU);
          const s = rand(20, 200);
          particles.push({
            x: p.x,
            y: p.y,
            vx: Math.cos(a) * s - dx * 120,
            vy: Math.sin(a) * s - dy * 120,
            life: rand(0.2, 0.45),
            max: 0.45,
            size: rand(1, 3),
            color: '#7ff0ff',
          });
        }
      }
    }

    if (p.dashTime > 0) {
      p.dashTime -= dt;
      p.vx = p.dashVX;
      p.vy = p.dashVY;
    } else {
      const speed = 330;
      const k = 1 - Math.exp(-dt * 16);
      p.vx = lerp(p.vx, ix * speed, k);
      p.vy = lerp(p.vy, iy * speed, k);
    }

    p.x = clamp(p.x + p.vx * dt, 21, W - 21);
    p.y = clamp(p.y + p.vy * dt, 21, H - 21);

    if (mouse.down && p.fireCd <= 0) fire();
  }

  function fire() {
    const p = player;
    const speed = 980;
    const dmg = 15;

    const shots = [];
    if (p.weapon <= 1) {
      shots.push([p.angle, 16, 0]);
    } else if (p.weapon === 2) {
      shots.push([p.angle, 16, 7]);
      shots.push([p.angle, 16, -7]);
    } else {
      shots.push([p.angle, 20, 0]);
      shots.push([p.angle - 0.1, 13, 9]);
      shots.push([p.angle + 0.1, 13, -9]);
    }

    const ca = Math.cos(p.angle);
    const sa = Math.sin(p.angle);

    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const ang = s[0] + rand(-0.012, 0.012);
      const px = p.x + ca * s[1] - sa * s[2];
      const py = p.y + sa * s[1] + ca * s[2];
      bullets.push({
        x: px,
        y: py,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        r: 4.2,
        dmg: dmg,
        life: 1.15,
        color: '#7ff0ff',
      });
    }

    p.fireCd = p.weapon === 3 ? 0.155 : p.weapon === 2 ? 0.13 : 0.14;
    p.vx -= ca * 42;
    p.vy -= sa * 42;

    // вспышка у ствола
    for (let i = 0; i < 2; i++) {
      const a = p.angle + rand(-0.3, 0.3);
      particles.push({
        x: p.x + ca * 20,
        y: p.y + sa * 20,
        vx: Math.cos(a) * rand(80, 240),
        vy: Math.sin(a) * rand(80, 240),
        life: rand(0.06, 0.14),
        max: 0.14,
        size: rand(0.8, 2),
        color: '#bff6ff',
      });
    }

    shake = Math.min(6, shake + 0.5);
    SFX.shoot();
  }

  function updateEnemies(dt) {
    const p = player;
    if (!p) return;

    for (const e of enemies) {
      if (e.hp <= 0) continue;

      e.flash = Math.max(0, e.flash - dt * 4);
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = hyp(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;

      let dvx = 0;
      let dvy = 0;

      if (e.type === 'zipper') {
        const s = Math.sin(time * 6 + e.phase) * 0.85;
        dvx = (ux - uy * s) * e.speed * 0.9;
        dvy = (uy + ux * s) * e.speed * 0.9;
      } else if (e.type === 'spitter') {
        if (d > 300) {
          dvx = ux * e.speed;
          dvy = uy * e.speed;
        } else if (d < 190) {
          dvx = -ux * e.speed;
          dvy = -uy * e.speed;
        } else {
          dvx = -uy * e.speed * 0.8;
          dvy = ux * e.speed * 0.8;
        }

        e.shootCd -= dt;
        const onScreen = e.x > -20 && e.x < W + 20 && e.y > -20 && e.y < H + 20;
        if (e.shootCd <= 0 && onScreen && d < 560) {
          e.shootCd = rand(1.7, 2.4);
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          ebullets.push({
            x: e.x + Math.cos(a) * (e.r + 4),
            y: e.y + Math.sin(a) * (e.r + 4),
            vx: Math.cos(a) * 330,
            vy: Math.sin(a) * 330,
            r: 5.5,
            dmg: 10,
            life: 4,
            color: '#c084ff',
          });
          SFX.espit();
        }
      } else {
        dvx = ux * e.speed;
        dvy = uy * e.speed;
      }

      const k = 1 - Math.exp(-dt * 4);
      e.vx = lerp(e.vx, dvx, k);
      e.vy = lerp(e.vy, dvy, k);
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      if (e.spin) e.angle += e.spin * dt;
      else e.angle = Math.atan2(e.vy, e.vx);

      const rr2 = e.r + p.r;
      if (d < rr2) {
        if (p.dashTime > 0) {
          e.vx += ux * 320;
          e.vy += uy * 320;
          if (!e.dashHit) {
            e.dashHit = true;
            damageEnemy(e, 60, e.x, e.y);
            explode(e.x, e.y, '#7ff0ff', 7, 190);
          }
        } else {
          hurtPlayer(e.dmg, e.x, e.y);
          e.vx -= ux * 240;
          e.vy -= uy * 240;
        }
      }
    }

    // мягкое расталкивание, чтобы толпа не слипалась в одну точку
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (a.hp <= 0) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (b.hp <= 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const sum = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < sum * sum) {
          const d = Math.sqrt(d2);
          const push = ((sum - d) / d) * 0.5;
          a.x -= dx * push * 0.6;
          a.y -= dy * push * 0.6;
          b.x += dx * push * 0.6;
          b.y += dy * push * 0.6;
        }
      }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].hp <= 0) enemies.splice(i, 1);
    }
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let gone = b.life <= 0 || b.x < -50 || b.x > W + 50 || b.y < -50 || b.y > H + 50;

      if (!gone) {
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (e.hp <= 0) continue;
          const rr2 = b.r + e.r;
          const dx = e.x - b.x;
          const dy = e.y - b.y;
          if (dx * dx + dy * dy <= rr2 * rr2) {
            damageEnemy(e, b.dmg, b.x, b.y);
            gone = true;
            break;
          }
        }
      }

      if (gone) bullets.splice(i, 1);
    }
  }

  function updateEBullets(dt) {
    const p = player;
    for (let i = ebullets.length - 1; i >= 0; i--) {
      const b = ebullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let gone = b.life <= 0 || b.x < -60 || b.x > W + 60 || b.y < -60 || b.y > H + 60;

      if (!gone && p) {
        const rr2 = b.r + p.r;
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        if (dx * dx + dy * dy <= rr2 * rr2) {
          hurtPlayer(b.dmg, b.x, b.y);
          gone = true;
        }
      }

      if (gone) ebullets.splice(i, 1);
    }
  }

  function updatePickups(dt) {
    const p = player;
    if (!p) return;

    for (let i = pickups.length - 1; i >= 0; i--) {
      const pk = pickups[i];
      pk.life -= dt;
      pk.pulse += dt * 4;

      const dx = p.x - pk.x;
      const dy = p.y - pk.y;
      const d = hyp(dx, dy) || 1;

      if (d < 190) {
        const pull = (1 - d / 190) * 1000 + 140;
        pk.vx += (dx / d) * pull * dt;
        pk.vy += (dy / d) * pull * dt;
      }

      const drag = Math.exp(-dt * 1.6);
      pk.vx *= drag;
      pk.vy *= drag;
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;

      if (d < p.r + pk.r) {
        collect(pk);
        pickups.splice(i, 1);
        continue;
      }
      if (pk.life <= 0) pickups.splice(i, 1);
    }
  }

  function collect(pk) {
    const p = player;
    if (pk.type === 'health') {
      if (p.hp >= p.maxHp - 0.01) {
        score += 50;
        floatText(p.x, p.y - 28, '+50', '#58ffa5', 16);
      } else {
        p.hp = Math.min(p.maxHp, p.hp + 25);
        floatText(p.x, p.y - 28, '+25 HP', '#58ffa5', 16);
      }
    } else if (p.weapon < 3) {
      p.weapon += 1;
      floatText(p.x, p.y - 28, 'ОРУЖИЕ ' + p.weapon, '#ffd166', 16);
    } else {
      score += 150;
      floatText(p.x, p.y - 28, '+150', '#ffd166', 16);
    }
    SFX.pickup();
    explode(pk.x, pk.y, pk.color, 12, 190);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-dt * 2.6);
      p.vx *= drag;
      p.vy *= drag;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function updateTexts(dt) {
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      t.y -= 36 * dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
  }

  function updateAmbient(dt) {
    for (const d of dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < -10) {
        d.y = H + 10;
        d.x = rand(0, W);
      }
      if (d.x < -10) d.x = W + 10;
      if (d.x > W + 10) d.x = -10;
    }
  }

  /* ------------------------------ отрисовка ------------------------------- */
  function render() {
    drawBackground();

    ctx.save();
    if (shake > 0.3) ctx.translate(rand(-shake, shake), rand(-shake, shake));

    drawGlows();
    drawEntities();
    drawShots();
    drawTexts();
    drawBanner();

    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,40,70,' + (flash * 0.32).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'playing' || state === 'paused') drawHud();
    drawReticle();
  }

  function drawBackground() {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const gs = 64;
    const off = (time * 9) % gs;
    ctx.strokeStyle = 'rgba(90,200,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -off; x <= W + gs; x += gs) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = -off; y <= H + gs; y += gs) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    for (const d of dust) blob(d.x, d.y, d.r * 7, '#4de2ff', d.a);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawGlows() {
    ctx.globalCompositeOperation = 'lighter';

    for (const e of enemies) {
      if (e.hp <= 0) continue;
      blob(e.x, e.y, e.r * 3.2, e.color, 0.17);
    }

    if (player) {
      blob(player.x, player.y, 46, '#4de2ff', 0.2);
      const sp = hyp(player.vx, player.vy);
      const thrust = clamp(sp / 420, 0.25, 1);
      const ex = player.x - Math.cos(player.angle) * 14;
      const ey = player.y - Math.sin(player.angle) * 14;
      blob(ex, ey, 10 + 16 * thrust, '#2bc4e8', 0.55);
      if (player.dashTime > 0) blob(player.x, player.y, 62, '#7ff0ff', 0.3);
    }

    for (const pk of pickups) {
      blob(pk.x, pk.y, 34, pk.color, 0.32 + Math.sin(pk.pulse) * 0.08);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawEntities() {
    for (const e of enemies) {
      if (e.hp > 0) drawEnemy(e);
    }
    if (player) drawPlayer();
    for (const pk of pickups) drawPickup(pk);
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);

    const col = e.flash > 0.35 ? '#ffffff' : e.color;
    ctx.fillStyle = rgba(e.color, 0.15);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    ctx.beginPath();
    if (e.shape === 'circle') {
      ctx.arc(0, 0, e.r, 0, TAU);
    } else if (e.shape === 'triangle') {
      ctx.moveTo(e.r * 1.35, 0);
      ctx.lineTo(-e.r * 0.9, e.r * 0.85);
      ctx.lineTo(-e.r * 0.9, -e.r * 0.85);
      ctx.closePath();
    } else if (e.shape === 'diamond') {
      ctx.moveTo(e.r * 1.3, 0);
      ctx.lineTo(0, e.r);
      ctx.lineTo(-e.r * 1.3, 0);
      ctx.lineTo(0, -e.r);
      ctx.closePath();
    } else {
      ctx.rect(-e.r * 0.8, -e.r * 0.8, e.r * 1.6, e.r * 1.6);
    }
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2.5, e.r * 0.3), 0, TAU);
    ctx.fillStyle = rgba(e.color, 0.8);
    ctx.fill();

    if (e.flash > 0.35) {
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 1.5, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();

    if (e.hp < e.maxHp) {
      const w = Math.max(18, e.r * 1.9);
      const x = e.x - w / 2;
      const y = e.y - e.r - 11;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = e.color;
      ctx.fillRect(x, y, w * (e.hp / e.maxHp), 3);
    }
  }

  function drawPlayer() {
    const p = player;
    const blink = p.invuln > 0 && p.dashTime <= 0 && Math.floor(time * 24) % 2 === 0;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.globalAlpha = blink ? 0.45 : 1;

    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-9, 12);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-9, -12);
    ctx.closePath();
    ctx.fillStyle = 'rgba(11,38,56,0.94)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4de2ff';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(1, 0, 3.4, 0, TAU);
    ctx.fillStyle = '#e8fdff';
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPickup(pk) {
    const s = 1 + Math.sin(pk.pulse) * 0.1;
    const fade = pk.life < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(time * 10)) : 1;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(pk.x, pk.y);
    ctx.scale(s, s);
    ctx.lineWidth = 2;
    ctx.strokeStyle = pk.color;
    ctx.fillStyle = rgba(pk.color, 0.16);

    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, TAU);
    ctx.fill();
    ctx.stroke();

    if (pk.type === 'health') {
      ctx.fillStyle = pk.color;
      ctx.fillRect(-6.5, -2.2, 13, 4.4);
      ctx.fillRect(-2.2, -6.5, 4.4, 13);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -7.5);
      ctx.lineTo(6.5, 5);
      ctx.lineTo(-6.5, 5);
      ctx.closePath();
      ctx.fillStyle = pk.color;
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawShots() {
    ctx.globalCompositeOperation = 'lighter';

    for (const b of ebullets) {
      blob(b.x, b.y, 21, b.color, 0.85);
      ctx.fillStyle = '#f0e0ff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.6, 0, TAU);
      ctx.fill();
    }

    ctx.lineCap = 'round';
    for (const b of bullets) {
      const tx = b.x - b.vx * 0.018;
      const ty = b.y - b.vy * 0.018;
      ctx.strokeStyle = 'rgba(127,240,255,0.42)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      blob(b.x, b.y, 13, '#7ff0ff', 0.6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 1.9, 0, TAU);
      ctx.fill();
    }

    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      blob(p.x, p.y, p.size * 3.6, p.color, a * 0.9);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawTexts() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of texts) {
      const a = clamp(t.life / t.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = '700 ' + t.size + 'px ui-monospace, Consolas, monospace';
      ctx.strokeStyle = 'rgba(2,6,12,0.75)';
      ctx.lineWidth = 3;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  function drawBanner() {
    if (!banner) return;
    const prog = 1 - banner.life / banner.max;
    const a = clamp(Math.min(prog / 0.12, (1 - prog) / 0.3), 0, 1);
    if (a <= 0) return;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';

    ctx.font = '700 ' + Math.round(clamp(W * 0.035, 22, 38)) + 'px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#bff6ff';
    try {
      ctx.letterSpacing = '8px';
    } catch (err) {
      /* старые браузеры — без разрядки */
    }
    ctx.fillText(banner.text, W / 2, H * 0.26);
    try {
      ctx.letterSpacing = '0px';
    } catch (err) {
      /* ignore */
    }

    if (banner.sub) {
      ctx.font = '600 14px ui-monospace, Consolas, monospace';
      ctx.fillStyle = 'rgba(150,220,245,0.85)';
      ctx.fillText(banner.sub, W / 2, H * 0.26 + 30);
    }

    ctx.restore();
  }

  function drawHud() {
    const p = player;
    if (!p) return;

    ctx.save();

    // ---- волна ----
    ctx.textAlign = 'center';
    ctx.font = '700 16px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(170,238,255,0.92)';
    try {
      ctx.letterSpacing = '6px';
    } catch (err) {
      /* ignore */
    }
    ctx.fillText('ВОЛНА ' + wave, W / 2, 42);
    try {
      ctx.letterSpacing = '0px';
    } catch (err) {
      /* ignore */
    }

    // ---- очки и рекорд ----
    ctx.textAlign = 'right';
    ctx.font = '700 24px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#eafcff';
    ctx.fillText(String(score), W - 22, 42);

    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(140,200,225,0.65)';
    ctx.fillText('РЕКОРД ' + best, W - 22, 60);

    // ---- комбо ----
    if (combo > 0) {
      ctx.textAlign = 'center';
      ctx.font = '700 13px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#ffd166';
      ctx.fillText('x' + comboMult().toFixed(2) + '  ·  ' + combo, W / 2, 64);
    }

    // ---- здоровье ----
    const bw = clamp(W * 0.24, 170, 250);
    const bh = 11;
    const bx = 24;
    const by = H - 40;

    ctx.fillStyle = 'rgba(6,16,26,0.72)';
    ctx.strokeStyle = 'rgba(77,226,255,0.28)';
    ctx.lineWidth = 1;
    rr(bx - 5, by - 5, bw + 10, bh + 10, 7);
    ctx.fill();
    ctx.stroke();

    const ratio = clamp(p.hp / p.maxHp, 0, 1);
    const hpCol = ratio > 0.55 ? '#4de2ff' : ratio > 0.28 ? '#ffd166' : '#ff4d6d';
    if (ratio > 0) {
      ctx.fillStyle = hpCol;
      rr(bx, by, bw * ratio, bh, 5);
      ctx.fill();
    }

    ctx.textAlign = 'left';
    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(200,245,255,0.9)';
    ctx.fillText('HP ' + Math.ceil(p.hp), bx, by - 12);

    // ---- рывок ----
    const dw = 56;
    const dx = bx + bw + 30;
    ctx.fillStyle = 'rgba(6,16,26,0.72)';
    rr(dx, by, dw, bh, 5);
    ctx.fill();

    const dashReady = 1 - clamp(p.dashCd / 1.15, 0, 1);
    if (dashReady > 0) {
      ctx.fillStyle = dashReady >= 1 ? '#7ff0ff' : 'rgba(120,200,230,0.45)';
      rr(dx, by, dw * dashReady, bh, 5);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(200,245,255,0.75)';
    ctx.fillText('РЫВОК', dx, by - 12);

    // ---- оружие ----
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(200,245,255,0.75)';
    ctx.fillText('ОРУЖИЕ', W - 24, by - 12);
    for (let i = 0; i < 3; i++) {
      const w = 16;
      const h = 11;
      const x = W - 24 - (3 - i) * (w + 5) + 5;
      ctx.fillStyle = i < p.weapon ? '#ffd166' : 'rgba(255,209,102,0.16)';
      rr(x, by, w, h, 3);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawReticle() {
    if (state !== 'playing') return;
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.rotate(time * 0.8);
    ctx.strokeStyle = 'rgba(127,240,255,0.8)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const start = i * (Math.PI / 2) + 0.28;
      ctx.beginPath();
      ctx.arc(0, 0, 9, start, start + Math.PI / 2 - 0.56);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 1.7, 0, TAU);
    ctx.fillStyle = '#bff6ff';
    ctx.fill();
    ctx.restore();
  }

  /* -------------------------------- цикл ---------------------------------- */
  function frame(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    time += dt;
    updateAmbient(dt);

    if (state === 'playing') {
      update(dt);
    } else if (state === 'over') {
      updateParticles(dt);
      updateTexts(dt);
      shake *= Math.exp(-dt * 6);
      if (shake < 0.15) shake = 0;
      flash = Math.max(0, flash - dt * 1.5);
    }

    render();
    requestAnimationFrame(frame);
  }

  /* -------------------------------- старт --------------------------------- */
  // Отладочный доступ: используется автотестом и удобен в консоли браузера.
  window.__arena = {
    get state() { return state; },
    get wave() { return wave; },
    get score() { return score; },
    get hp() { return player ? player.hp : 0; },
    get enemies() { return enemies.length; },
    get bullets() { return bullets.length; },
    get player() { return player; },
    get list() { return enemies; },
    start: startGame,
    spawn: function (type, x, y) { spawnEnemy(type, x, y); },
    hit: function (amount) { if (player) hurtPlayer(amount, player.x + 1, player.y); },
    clear: function () {
      for (let i = enemies.length - 1; i >= 0; i--) {
        damageEnemy(enemies[i], 99999, enemies[i].x, enemies[i].y);
      }
    },
  };

  function menuText() {
    return (
      'Выживи как можно дольше: волны врагов становятся плотнее, а оружие — мощнее.' +
      '<br>Рекорд: <b>' + best + '</b>'
    );
  }

  showOverlay('НЕОН-АРЕНА', menuText(), 'ИГРАТЬ', true);
  requestAnimationFrame(frame);

  // ?auto=1 — быстрый запуск без клика (удобно для проверки/скриншотов)
  try {
    if (new URLSearchParams(window.location.search).has('auto')) startGame();
  } catch (err) {
    /* ignore */
  }
})();
