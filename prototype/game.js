// Hearth & Hollow — two-player asymmetric humming coop (v2).
// Player 1 (mouse): the Golem, walking the misty forest above.
// Player 2 (WASD + E): the Fire Sprite, tending the hearth inside its chest.
//
// v2 refinements (informed by Lovers in a Dangerous Spacetime / Keep Talking & Nobody Explodes):
//  - More threats than the sprite has hands: forest spawns wolves, mist, gaps, boulders, animals.
//  - Each threat demands a specific rune (STR / SPD / SEE). Sprite anticipates, golem executes.
//  - Hidden fuel-seeds visible only with SEE on — keeps the sight rune meaningful.
//  - All three runes lit = "Bloom mode": golem briefly super-powered, hearth drains 3× faster.
//  - Privileged signal for the sprite: runes pulse red inside the chest when a matching threat
//    is incoming — the asymmetric info channel.
//  - Soft fail: hearth at 0 for 8s → golem rests. R restarts. Replayable.
//  - WebAudio chimes/thuds/whooshes for cross-room feedback.
//
// Single file, vanilla canvas, no deps, no build.

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');

  // ============================================================
  //  CONSTANTS
  // ============================================================
  const W = 1024, H = 640;
  const SPLIT_Y = 320;
  const GROUND_Y = SPLIT_Y - 18;
  const WORLD_END = 4200;
  const SLOW_SPEED = 70;
  const FAST_SPEED = 180;
  const ARM_REACH = 140;
  const HEARTH_MAX = 100;
  const SEED_VALUE = 22;
  const BURN = { strength: 5.0, speed: 7.0, sight: 3.0 };
  const BLOOM_DRAIN = 3.0;            // extra drain when all 3 runes lit (gentle tax on the burst)
  const BLOOM_SPEED_MULT = 1.5;       // golem speed boost in bloom
  const BLOOM_REACH_MULT = 1.3;       // golem arm reach boost in bloom
  const SPRITE_SPEED = 220;
  const WOLF_SPEED = 95;
  const WOLF_TRIGGER_DIST = 360;
  const WOLF_BITE_DIST = 56;
  const WOLF_BITE_DMG = 22;
  const COLLAPSE_TIME = 8.0;          // seconds hearth at 0 before rest
  const PULSE_LOOKAHEAD = 520;        // sprite gets warning when threat is this close
  const MIST_BLIND_SPEED_MULT = 0.30;
  // v3 additions
  const EMBER_SPAWN_HEARTH = 75;      // hearth fuel above which embers can spit
  const EMBER_SPAWN_INTERVAL = 1.6;   // avg seconds between embers when conditions met
  const EMBER_SCORCH_DELAY = 4.0;     // seconds settled before scorching a rune
  const EMBER_STOMP_DIST = 24;        // sprite-to-ember distance for stomp
  const EMBER_STOMP_BONUS = 2;        // small fuel reward for stomping
  const EMBER_SCORCH_LOCKOUT = 6.0;   // seconds a scorched rune is locked
  const EMBER_SCORCH_DMG = 12;        // hearth fuel lost when ember scorches
  const BELLOWS_DRAIN_MULT = 0.4;     // hearth drain × this while pumping
  const BELLOWS_RANGE = 70;           // sprite-to-hearth distance to pump
  const DIRE_WOLF_HP = 3;
  const DIRE_WOLF_SPEED = 110;
  const DIRE_WOLF_TRIGGER = 480;
  const DIRE_WOLF_BITE_DMG = 30;

  const CHUTE_LANDING = { x: W / 2, y: SPLIT_Y + 40 };
  const HEARTH = { x: W / 2, y: SPLIT_Y + 200, r: 38 };
  const RUNES = [
    { key: 'strength', label: 'STR', glyph: '⚒', x: W / 2 - 290, y: SPLIT_Y + 150 },
    { key: 'speed',    label: 'SPD', glyph: '⚡', x: W / 2 + 290, y: SPLIT_Y + 150 },
    { key: 'sight',    label: 'SEE', glyph: '◉', x: W / 2,       y: SPLIT_Y + 285 },
  ];

  // ============================================================
  //  WORLD (level layout — hand-crafted tempo curve)
  // ============================================================
  function buildWorld() {
    const items = [];
    const push = o => items.push({ wobble: 0, ...o });

    // ACT 1 — calm tutorial (200..900)
    push({ kind: 'seed',   x: 340,  hidden: false });
    push({ kind: 'animal', x: 460,  species: '🐇' });
    push({ kind: 'seed',   x: 620,  hidden: false });
    push({ kind: 'boulder', x: 800 });

    // ACT 2 — rising (900..2400)
    push({ kind: 'seed',   x: 980,  hidden: true });
    push({ kind: 'wolf',   x: 1180, dead: false, vx: 0, state: 'lurk', spawnX: 1180 });
    push({ kind: 'seed',   x: 1280, hidden: false });
    push({ kind: 'animal', x: 1380, species: '🦊' });
    push({ kind: 'mist',   x: 1520, w: 360 });
    push({ kind: 'seed',   x: 1560, hidden: false });
    push({ kind: 'seed',   x: 1700, hidden: true });
    push({ kind: 'gap',    x: 1900, w: 110 });
    push({ kind: 'seed',   x: 2080, hidden: false });
    push({ kind: 'boulder', x: 2180 });
    push({ kind: 'wolf',   x: 2300, dead: false, vx: 0, state: 'lurk', spawnX: 2300 });
    push({ kind: 'animal', x: 2380, species: '🦌' });

    // ACT 3 — chaos (2400..3500)
    push({ kind: 'seed',   x: 2500, hidden: true });
    push({ kind: 'mist',   x: 2650, w: 320 });
    push({ kind: 'wolf',   x: 2720, dead: false, vx: 0, state: 'lurk', spawnX: 2720 });
    push({ kind: 'seed',   x: 2800, hidden: false });
    push({ kind: 'animal', x: 2940, species: '🐢' });
    push({ kind: 'gap',    x: 3060, w: 110 });
    push({ kind: 'seed',   x: 3220, hidden: false });
    push({ kind: 'boulder', x: 3300 });
    push({ kind: 'direwolf', x: 3400, dead: false, vx: 0, state: 'lurk',
           hp: DIRE_WOLF_HP, hitT: 0, hitFlashT: 0 });
    push({ kind: 'animal', x: 3520, species: '🐿' });

    // ACT 4 — finale calm
    push({ kind: 'seed',   x: 3700, hidden: false });
    push({ kind: 'seed',   x: 3850, hidden: true });

    for (const it of items) {
      it.state = it.state || 'idle';   // idle | held | gone | rescued
      if (it.kind === 'boulder' || it.kind === 'seed' || it.kind === 'animal') {
        it.y = GROUND_Y - (it.kind === 'boulder' ? 18 : 10);
      }
    }
    return items;
  }

  // ============================================================
  //  STATE
  // ============================================================
  const state = makeFreshState();
  function makeFreshState() {
    return {
      started: false,
      t: 0,
      shake: 0,
      bloomFlashT: 0,
      golem: {
        x: 200, y: GROUND_Y, targetX: 200, facing: 1,
        walkPhase: 0, armReachT: 0, armTarget: null, holding: null,
        bumpT: 0, confusedT: 0, restT: 0,        // restT > 0 means collapsed
        jumpT: 0,                                 // animation timer for gap leaps
      },
      sprite: {
        x: W / 2, y: SPLIT_Y + 240, carrying: null, trail: [], pumping: false, pumpPhase: 0,
      },
      hearth: HEARTH_MAX * 0.7,
      hearthDeadT: 0,
      lastFedT: 0,                                     // time of last seed feed (for ember spawn gate)
      runes: { strength: false, speed: false, sight: true },
      runePulse: { strength: 0, speed: 0, sight: 0 },   // 0..1 warning brightness
      runeScorch: { strength: 0, speed: 0, sight: 0 }, // > 0 = seconds remaining locked
      chestSeeds: [],
      embers: [],                                      // {x, y, vx, vy, settled, scorchIn, deadT}
      emberCooldown: EMBER_SPAWN_INTERVAL * 0.7,
      celebrateT: 0,
      celebrateParticles: [],
      world: buildWorld(),
      rescued: 0,
      totalAnimals: 0,
      camX: 0,
      mouse: { x: 0, y: 0, down: false },
      keys: new Set(),
      eEdge: false,
      flash: null,
      bloomMode: false,
      ended: false,                                // 'won' | 'rest' | false
      endT: 0,
    };
  }

  function reset() {
    Object.assign(state, makeFreshState());
    state.started = true;
    state.totalAnimals = state.world.filter(i => i.kind === 'animal').length;
    flash('a new walk begins');
  }

  state.totalAnimals = state.world.filter(i => i.kind === 'animal').length;

  // ============================================================
  //  AUDIO (tiny WebAudio synth — no assets)
  // ============================================================
  let audio = null;
  function ensureAudio() {
    if (audio) return audio;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      audio = new C();
    } catch (e) { audio = { suspended: true, currentTime: 0 }; }
    return audio;
  }
  function blip(freq, dur, type = 'sine', vol = 0.08, slideTo = null) {
    if (!audio || audio.suspended || audio.state === 'suspended') return;
    try {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, audio.currentTime);
      if (slideTo != null) o.frequency.exponentialRampToValueAtTime(slideTo, audio.currentTime + dur);
      g.gain.setValueAtTime(vol, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur + 0.02);
    } catch (e) {}
  }
  function chord(freqs, dur, type = 'triangle', vol = 0.06) {
    for (const f of freqs) blip(f, dur, type, vol);
  }
  function snd(name) {
    switch (name) {
      case 'rune-on':   chord([523, 659, 784], 0.32, 'triangle', 0.05); break;     // C major
      case 'rune-off':  chord([392, 523], 0.18, 'triangle', 0.04); break;
      case 'feed':      blip(740, 0.18, 'triangle', 0.08, 1100); break;
      case 'grab':      blip(220, 0.08, 'square', 0.05, 320); break;
      case 'drop-in':   blip(440, 0.14, 'sine', 0.06, 220); break;
      case 'bump':      blip(110, 0.18, 'square', 0.07, 70); break;
      case 'wolf':      blip(180, 0.30, 'sawtooth', 0.08, 90); break;
      case 'bite':      blip(90, 0.18, 'square', 0.12, 50); break;
      case 'rescue':    chord([784, 988, 1175], 0.45, 'sine', 0.07); break;
      case 'bloom':     chord([523, 659, 784, 988], 0.55, 'triangle', 0.05); break;
      case 'leap':      blip(330, 0.18, 'sine', 0.05, 660); break;
      case 'collapse':  blip(140, 0.6, 'sawtooth', 0.1, 50); break;
      case 'win':       chord([523, 659, 784, 1047], 0.9, 'sine', 0.08); break;
      // v3
      case 'ember':     blip(880, 0.10, 'square', 0.05, 1320); break;
      case 'stomp':     blip(260, 0.10, 'sine', 0.06, 130); break;
      case 'scorch':    blip(180, 0.40, 'sawtooth', 0.10, 80); break;
      case 'bellows':   blip(420, 0.10, 'sine', 0.04, 520); break;
      case 'direwolf':  chord([110, 138, 165], 0.55, 'sawtooth', 0.10); break;
      case 'direhit':   blip(150, 0.18, 'square', 0.10, 90); break;
      case 'direkill':  chord([147, 110, 82], 0.7, 'sawtooth', 0.12); break;
      case 'fanfare':   chord([523, 659, 784, 1047, 1319], 1.4, 'triangle', 0.07); break;
    }
  }

  // ============================================================
  //  HELPERS
  // ============================================================
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function flash(msg, dur = 1.8) { state.flash = { msg, t: dur, max: dur }; }

  // ============================================================
  //  INPUT
  // ============================================================
  function canvasPos(evt) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - r.left) * (canvas.width / r.width),
      y: (evt.clientY - r.top) * (canvas.height / r.height),
    };
  }
  canvas.addEventListener('mousemove', e => {
    const p = canvasPos(e); state.mouse.x = p.x; state.mouse.y = p.y;
  });
  canvas.addEventListener('mousedown', e => {
    const p = canvasPos(e); state.mouse.x = p.x; state.mouse.y = p.y; state.mouse.down = true;
    if (state.golem.restT > 0) return;
    if (state.ended) return;
    if (p.y < SPLIT_Y) state.golem.targetX = clamp(p.x + state.camX, 80, WORLD_END - 80);
  });
  canvas.addEventListener('mouseup', () => { state.mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    ensureAudio();
    const k = e.key.toLowerCase();
    state.keys.add(k);
    if (k === 'e') state.eEdge = true;
    if (k === 'r') reset();
    if (k === 'm') toggleMute();
    if (k === ' ') e.preventDefault();              // don't scroll page on space
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    state.keys.delete(k);
    if (k === ' ' || k === 'spacebar') state.keys.delete(' ');
  });

  let muted = false;
  function toggleMute() {
    muted = !muted;
    if (audio && audio.destination) {
      // crude mute by recreating context not necessary; just gate snd()
    }
    flash(muted ? 'sound off' : 'sound on');
  }
  const _snd = snd;
  function play(name) { if (!muted) _snd(name); }

  overlay.addEventListener('click', () => {
    ensureAudio();
    overlay.classList.add('hidden');
    document.getElementById('wrap').classList.add('playing');
    state.started = true;
  });

  // ============================================================
  //  TICK
  // ============================================================
  function tick(dt) {
    state.t += dt;
    state.shake = Math.max(0, state.shake - dt * 8);
    state.bloomFlashT = Math.max(0, state.bloomFlashT - dt);
    if (!state.started) return;

    if (state.ended) {
      state.endT += dt;
      tickCelebration(dt);            // keep particles & dancing alive after win
      return;
    }

    tickSprite(dt);
    tickRunes(dt);
    tickHearth(dt);
    tickEmbers(dt);
    tickWolves(dt);
    tickGolem(dt);
    tickArm(dt);
    tickPulses(dt);
    tickChestSeeds(dt);
    tickCelebration(dt);
    tickCamera();
    if (state.flash) { state.flash.t -= dt; if (state.flash.t <= 0) state.flash = null; }
    checkEnd();
  }

  function tickSprite(dt) {
    const s = state.sprite;

    // bellows: SPACE held + within range of hearth + carrying nothing
    const nearHearth = dist(s.x, s.y, HEARTH.x, HEARTH.y) < BELLOWS_RANGE;
    const wasPumping = s.pumping;
    s.pumping = state.keys.has(' ') && nearHearth && !s.carrying && state.hearth > 0;
    if (s.pumping && !wasPumping) play('bellows');
    if (s.pumping) s.pumpPhase += dt * 7;

    let vx = 0, vy = 0;
    if (!s.pumping) {
      if (state.keys.has('a') || state.keys.has('arrowleft'))  vx -= 1;
      if (state.keys.has('d') || state.keys.has('arrowright')) vx += 1;
      if (state.keys.has('w') || state.keys.has('arrowup'))    vy -= 1;
      if (state.keys.has('s') || state.keys.has('arrowdown'))  vy += 1;
    }
    const m = Math.hypot(vx, vy); if (m > 0) { vx /= m; vy /= m; }
    s.x = clamp(s.x + vx * SPRITE_SPEED * dt, 30, W - 30);
    s.y = clamp(s.y + vy * SPRITE_SPEED * dt, SPLIT_Y + 24, H - 28);

    // stomp embers (settled ones) by overlap
    for (const em of state.embers) {
      if (em.deadT > 0) continue;
      if (dist(s.x, s.y, em.x, em.y) < EMBER_STOMP_DIST) {
        em.deadT = 0.3;
        state.hearth = clamp(state.hearth + EMBER_STOMP_BONUS, 0, HEARTH_MAX);
        play('stomp');
      }
    }

    s.trail.push({ x: s.x, y: s.y, life: 0.45 });
    if (s.trail.length > 28) s.trail.shift();
    for (const p of s.trail) p.life -= dt;
    // pickup
    if (!s.carrying) {
      for (const seed of state.chestSeeds) {
        if (!seed.settled) continue;
        if (dist(s.x, s.y, seed.x, seed.y) < 24) {
          s.carrying = seed; seed.heldBy = 'sprite';
          play('grab');
          break;
        }
      }
    }
    if (s.carrying) { s.carrying.x = s.x; s.carrying.y = s.y - 12; }
    // feed
    if (s.carrying && dist(s.x, s.y, HEARTH.x, HEARTH.y) < HEARTH.r + 6) {
      state.hearth = clamp(state.hearth + SEED_VALUE, 0, HEARTH_MAX);
      state.lastFedT = 0;
      const i = state.chestSeeds.indexOf(s.carrying);
      if (i >= 0) state.chestSeeds.splice(i, 1);
      s.carrying = null;
      flash('+fuel', 0.9);
      play('feed');
    }
  }

  function tickRunes(dt) {
    // decay scorch lockouts
    for (const r of RUNES) if (state.runeScorch[r.key] > 0) {
      state.runeScorch[r.key] = Math.max(0, state.runeScorch[r.key] - dt);
    }
    if (state.eEdge) {
      state.eEdge = false;
      const s = state.sprite;
      let best = null, bestD = 110;
      for (const r of RUNES) {
        const d = dist(s.x, s.y, r.x, r.y);
        if (d < bestD) { bestD = d; best = r; }
      }
      if (best) {
        if (state.runeScorch[best.key] > 0) {
          flash(`${best.label} scorched — wait`, 0.7);
          play('bump');
        } else if (state.hearth <= 0 && !state.runes[best.key]) {
          flash('hearth is cold');
          play('bump');
        } else {
          state.runes[best.key] = !state.runes[best.key];
          flash(`${best.label} ${state.runes[best.key] ? 'lit' : 'dim'}`, 0.7);
          play(state.runes[best.key] ? 'rune-on' : 'rune-off');
        }
      } else {
        flash('(walk closer to a rune)', 0.5);
      }
    }
  }

  function tickHearth(dt) {
    state.lastFedT += dt;

    // sum of lit-rune burn rates
    let drain = 0;
    for (const r of RUNES) if (state.runes[r.key]) drain += BURN[r.key];
    // bloom mode: all three lit → extra drain + buff (handled in golem speed/arm)
    const allLit = state.runes.strength && state.runes.speed && state.runes.sight;
    if (allLit && !state.bloomMode) {
      state.bloomMode = true;
      state.bloomFlashT = 1.2;
      flash('★ BLOOM MODE — burn brightly!', 1.4);
      play('bloom');
      // particle burst around the golem (forest-space)
      for (let i = 0; i < 22; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 80 + Math.random() * 120;
        state.celebrateParticles.push({
          x: state.golem.x + Math.cos(ang) * 18,
          y: GROUND_Y - 60 + Math.sin(ang) * 18,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 40,
          life: 0.8 + Math.random() * 0.6,
          hue: 38 + Math.random() * 16,
        });
      }
    } else if (!allLit && state.bloomMode) {
      state.bloomMode = false;
    }
    if (state.bloomMode) drain += BLOOM_DRAIN;
    // bellows pump halves drain
    if (state.sprite.pumping) drain *= BELLOWS_DRAIN_MULT;

    state.hearth = clamp(state.hearth - drain * dt, 0, HEARTH_MAX);

    // ember spit: when well-fueled and recently fed, embers occasionally pop out
    state.emberCooldown -= dt;
    if (state.hearth > EMBER_SPAWN_HEARTH && state.emberCooldown <= 0 && state.lastFedT < 6.0) {
      spitEmber();
      state.emberCooldown = EMBER_SPAWN_INTERVAL * (0.7 + Math.random() * 0.6);
    }

    if (state.hearth <= 0) {
      if (state.runes.strength || state.runes.speed || state.runes.sight) {
        flash('hearth out — runes dim');
        play('collapse');
      }
      state.runes.strength = state.runes.speed = state.runes.sight = false;
      state.bloomMode = false;
      state.sprite.pumping = false;
      state.hearthDeadT += dt;
    } else {
      state.hearthDeadT = 0;
    }
  }

  function spitEmber() {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const speed = 220 + Math.random() * 80;
    state.embers.push({
      x: HEARTH.x + (Math.random() - 0.5) * 14,
      y: HEARTH.y - 8,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      settled: false,
      landY: SPLIT_Y + 70 + Math.random() * (H - SPLIT_Y - 110),
      scorchIn: EMBER_SCORCH_DELAY,
      deadT: 0,
      sparkPhase: Math.random() * Math.PI * 2,
    });
    play('ember');
  }

  function tickEmbers(dt) {
    for (const em of state.embers) {
      em.sparkPhase += dt * 12;
      if (em.dying) { em.fadeT -= dt; continue; }
      if (!em.settled) {
        em.vy += 800 * dt;
        em.x += em.vx * dt;
        em.y += em.vy * dt;
        if (em.y >= em.landY || em.x < 30 || em.x > W - 30) {
          em.settled = true;
          em.y = Math.min(em.y, H - 32);
          em.vx = em.vy = 0;
        }
      } else {
        em.scorchIn -= dt;
        if (em.scorchIn <= 0) {
          let best = null, bestD = Infinity;
          for (const r of RUNES) {
            const d = dist(em.x, em.y, r.x, r.y);
            if (d < bestD) { bestD = d; best = r; }
          }
          if (best) {
            state.runes[best.key] = false;
            state.runeScorch[best.key] = EMBER_SCORCH_LOCKOUT;
            state.hearth = Math.max(0, state.hearth - EMBER_SCORCH_DMG);
            state.shake = Math.max(state.shake, 0.5);
            flash(`${best.label} scorched!`, 1.2);
            play('scorch');
          }
          em.dying = true; em.fadeT = 0.35;
        }
      }
    }
    // dt-based stomp marker triggers dying when tickSprite set deadT
    for (const em of state.embers) {
      if (em.deadT > 0 && !em.dying) { em.dying = true; em.fadeT = 0.3; em.stomped = true; }
    }
    state.embers = state.embers.filter(e => !e.dying || e.fadeT > 0);
  }

  function tickWolves(dt) {
    for (const w of state.world) {
      if (w.kind === 'wolf' && !w.dead) {
        const distToGolem = w.x - state.golem.x;
        const abs = Math.abs(distToGolem);
        if (w.state === 'lurk' && abs < WOLF_TRIGGER_DIST) { w.state = 'chase'; play('wolf'); }
        if (w.state === 'chase') {
          const dir = -Math.sign(distToGolem);
          w.x += dir * WOLF_SPEED * dt;
          w.vx = dir * WOLF_SPEED;
          if (abs < WOLF_BITE_DIST && state.golem.restT <= 0) {
            state.hearth = Math.max(0, state.hearth - WOLF_BITE_DMG);
            state.shake = 0.9;
            w.dead = true; w.state = 'dead';
            flash('wolf bit the hearth!', 1.4);
            play('bite');
          }
        }
      }
      if (w.kind === 'direwolf' && !w.dead) {
        const distToGolem = w.x - state.golem.x;
        const abs = Math.abs(distToGolem);
        if (w.state === 'lurk' && abs < DIRE_WOLF_TRIGGER) {
          w.state = 'chase';
          play('direwolf');
          flash('DIRE WOLF — only Bloom can fell it in one!', 2.4);
        }
        if (w.state === 'chase') {
          const dir = -Math.sign(distToGolem);
          w.x += dir * DIRE_WOLF_SPEED * dt;
          w.vx = dir * DIRE_WOLF_SPEED;
          // bite, but back off briefly after each bite (so it doesn't bite-spam)
          if (w.hitT > 0) w.hitT = Math.max(0, w.hitT - dt);
          if (w.hitFlashT > 0) w.hitFlashT = Math.max(0, w.hitFlashT - dt);
          if (abs < WOLF_BITE_DIST + 8 && state.golem.restT <= 0 && w.hitT <= 0) {
            state.hearth = Math.max(0, state.hearth - DIRE_WOLF_BITE_DMG);
            state.shake = 1.2;
            w.hitT = 1.2;                              // dire wolf bite-cooldown to avoid instakill
            // dire wolf hops back a bit
            w.x += -dir * 60;
            flash('DIRE WOLF BIT THE HEARTH!', 1.4);
            play('bite');
          }
        }
      }
    }
  }

  function tickGolem(dt) {
    const g = state.golem;
    if (g.restT > 0) {
      g.restT = Math.max(0, g.restT - dt);
      return;
    }
    // mist detection — slow if in mist without SEE
    let inMist = false;
    for (const m of state.world) {
      if (m.kind !== 'mist') continue;
      if (g.x > m.x - m.w / 2 && g.x < m.x + m.w / 2) { inMist = true; break; }
    }
    const blindedByMist = inMist && !state.runes.sight;
    g.confusedT = blindedByMist ? Math.min(1, g.confusedT + dt * 4) : Math.max(0, g.confusedT - dt * 4);
    // gap detection — stop at gap if no SPD
    let gapBlock = null;
    for (const gap of state.world) {
      if (gap.kind !== 'gap') continue;
      const left = gap.x - gap.w / 2, right = gap.x + gap.w / 2;
      if (state.runes.speed) continue;       // can leap
      if (g.x < left && g.targetX > left) gapBlock = left - 42;
      if (g.x > right && g.targetX < right) gapBlock = right + 42;
    }
    // boulder collision (only blocks if STR is off OR boulder not yet held)
    let walls = [];
    for (const it of state.world) {
      if (it.kind === 'boulder' && it.state === 'idle') walls.push(it.x);
    }
    let speed = state.runes.speed ? FAST_SPEED : SLOW_SPEED;
    if (state.bloomMode) speed *= BLOOM_SPEED_MULT;
    if (blindedByMist) speed *= MIST_BLIND_SPEED_MULT;
    let dx = g.targetX - g.x;
    if (gapBlock != null) {
      if (g.targetX > g.x && gapBlock < g.targetX) g.targetX = gapBlock;
      if (g.targetX < g.x && gapBlock > g.targetX) g.targetX = gapBlock;
      dx = g.targetX - g.x;
    }
    if (Math.abs(dx) > 2) {
      let step = clamp(dx, -speed * dt, speed * dt);
      const dir = Math.sign(step);
      let next = g.x + step;
      for (const wx of walls) {
        if (dir > 0 && wx > g.x && wx - 28 < next + 38) next = wx - 28 - 38;
        if (dir < 0 && wx < g.x && wx + 28 > next - 38) next = wx + 28 + 38;
      }
      g.x = clamp(next, 80, WORLD_END - 80);
      g.facing = dir >= 0 ? 1 : -1;
      g.walkPhase += Math.abs(speed) * dt * 0.025;
    }
    // jump animation timer over gaps
    for (const gap of state.world) {
      if (gap.kind !== 'gap') continue;
      if (!state.runes.speed) continue;
      if (g.x > gap.x - gap.w / 2 - 50 && g.x < gap.x + gap.w / 2 + 50 && g.jumpT <= 0) {
        g.jumpT = 0.5;
        play('leap');
      }
    }
    if (g.jumpT > 0) g.jumpT = Math.max(0, g.jumpT - dt);
    if (g.bumpT > 0) g.bumpT = Math.max(0, g.bumpT - dt);
    for (const it of state.world) if (it.wobble > 0) it.wobble = Math.max(0, it.wobble - dt * 1.5);
  }

  function tickArm(dt) {
    const g = state.golem;
    if (g.restT > 0) { g.armReachT = Math.max(0, g.armReachT - dt * 6); return; }
    const wantingArm = state.mouse.down && state.mouse.y < SPLIT_Y;
    const mw = { x: state.mouse.x + state.camX, y: state.mouse.y };

    if (wantingArm) {
      g.armReachT = clamp(g.armReachT + dt * 4.5, 0, 1);
      if (!g.holding) {
        // find a reachable target near the mouse
        const reach = ARM_REACH * (state.bloomMode ? BLOOM_REACH_MULT : 1);
        let best = null, bestD = reach;
        for (const it of state.world) {
          if (it.kind === 'seed' || it.kind === 'animal' || it.kind === 'boulder') {
            if (it.state !== 'idle') continue;
            if (it.kind === 'seed' && it.hidden && !state.runes.sight) continue;
            const d = dist(g.x, GROUND_Y - 40, it.x, it.y);
            const mc = dist(mw.x, mw.y, it.x, it.y);
            if (d < bestD && mc < 90) { bestD = d; best = it; }
          } else if (it.kind === 'wolf' && !it.dead) {
            const d = dist(g.x, GROUND_Y - 40, it.x, GROUND_Y - 10);
            const mc = dist(mw.x, mw.y, it.x, GROUND_Y - 10);
            if (d < bestD && mc < 100) { bestD = d; best = it; }
          } else if (it.kind === 'direwolf' && !it.dead) {
            const d = dist(g.x, GROUND_Y - 40, it.x, GROUND_Y - 10);
            const mc = dist(mw.x, mw.y, it.x, GROUND_Y - 10);
            if (d < bestD && mc < 110) { bestD = d; best = it; }
          }
        }
        g.armTarget = best;
        if (best && g.armReachT > 0.85) {
          attemptInteract(best);
        }
      } else {
        g.armTarget = null;
      }
    } else {
      g.armReachT = Math.max(0, g.armReachT - dt * 6);
      if (state.mouse.down === false && g.holding) {
        releaseHeld();
      }
    }
    // held item rides with hand
    if (g.holding) { g.holding.x = g.x; g.holding.y = GROUND_Y - 110; }
  }

  function attemptInteract(item) {
    const g = state.golem;
    if (item.kind === 'wolf') {
      if (state.runes.strength) {
        item.dead = true; item.state = 'dead';
        item.wobble = 0.4;
        state.shake = 0.5;
        flash('wolf smashed!', 1.0);
        play('bump');
      } else {
        item.wobble = 0.4;
        g.bumpT = 0.25;
        pulse('strength');
        flash('needs STR — wolf!', 0.9);
        play('bump');
      }
      return;
    }
    if (item.kind === 'direwolf') {
      if (!state.runes.strength) {
        item.wobble = 0.6;
        g.bumpT = 0.25;
        pulse('strength');
        flash('DIRE WOLF — needs STR!', 1.0);
        play('bump');
        return;
      }
      // bloom = one-shot. otherwise 3 hits and the wolf hops back briefly.
      if (state.bloomMode) {
        item.dead = true; item.state = 'dead'; item.hp = 0;
        state.shake = 1.4;
        flash('★ DIRE WOLF FELLED ★', 2.0);
        play('direkill');
      } else {
        item.hp = Math.max(0, item.hp - 1);
        item.hitFlashT = 0.4;
        item.wobble = 0.3;
        state.shake = 0.7;
        // hop back so the golem isn't grabbing it mid-bite
        item.x += -state.golem.facing * 90;
        play('direhit');
        if (item.hp <= 0) {
          item.dead = true; item.state = 'dead';
          flash('the DIRE WOLF falls!', 2.0);
          play('direkill');
        } else {
          flash(`DIRE WOLF — ${item.hp} hp left`, 1.0);
        }
      }
      return;
    }
    if (item.kind === 'boulder' && !state.runes.strength) {
      item.wobble = 0.6;
      g.bumpT = 0.25;
      pulse('strength');
      flash('needs STR', 0.7);
      play('bump');
      return;
    }
    if (item.kind === 'animal' && !state.runes.strength) {
      item.wobble = 0.4;
      g.bumpT = 0.2;
      pulse('strength');
      flash('STR (gentle)', 0.7);
      play('bump');
      return;
    }
    // pick up
    g.holding = item; item.state = 'held';
    play('grab');
  }

  function releaseHeld() {
    const g = state.golem;
    const held = g.holding;
    if (!held) return;
    const releaseScreenY = state.mouse.y;
    const chuteScreenX = g.x - state.camX;
    const overChute = releaseScreenY > SPLIT_Y - 80 && Math.abs(state.mouse.x - chuteScreenX) < 70;
    if (held.kind === 'seed' && overChute) {
      state.chestSeeds.push({
        x: CHUTE_LANDING.x + (Math.random() - 0.5) * 60,
        y: CHUTE_LANDING.y - 80,
        landY: CHUTE_LANDING.y + (Math.random() - 0.5) * 18,
        vy: 0, settled: false,
      });
      held.state = 'gone'; g.holding = null;
      flash('seed dropped', 0.7);
      play('drop-in');
    } else if (held.kind === 'animal') {
      const treeX = WORLD_END - 60;
      if (Math.abs(g.x - treeX) < 200) {
        held.state = 'rescued';
        held.x = treeX - 30 + (state.rescued - state.totalAnimals / 2) * 18;
        held.y = GROUND_Y - 18;
        state.rescued++;
        g.holding = null;
        flash('rescued! ✨', 1.4);
        play('rescue');
      } else {
        held.state = 'idle';
        held.x = g.x + g.facing * 50;
        held.y = GROUND_Y - 10;
        g.holding = null;
      }
    } else if (held.kind === 'boulder') {
      held.state = 'gone';
      g.holding = null;
      flash('boulder cleared', 0.7);
      play('drop-in');
    } else if (held.kind === 'seed') {
      held.state = 'idle';
      held.x = g.x + g.facing * 40;
      held.y = GROUND_Y - 10;
      g.holding = null;
    }
  }

  function pulse(rune) { state.runePulse[rune] = Math.max(state.runePulse[rune], 1.0); }

  function tickPulses(dt) {
    // decay all
    for (const r of RUNES) state.runePulse[r.key] = Math.max(0, state.runePulse[r.key] - dt * 0.8);
    // scan upcoming threats and set pulses for unlit-needed runes
    const gx = state.golem.x;
    for (const it of state.world) {
      const ahead = it.x - gx;
      if (ahead < 0 || ahead > PULSE_LOOKAHEAD) continue;
      const intensity = 1 - ahead / PULSE_LOOKAHEAD; // 0..1
      if (it.kind === 'boulder' && it.state === 'idle' && !state.runes.strength) {
        state.runePulse.strength = Math.max(state.runePulse.strength, intensity);
      }
      if (it.kind === 'wolf' && !it.dead) {
        if (!state.runes.strength && !state.runes.speed) {
          state.runePulse.strength = Math.max(state.runePulse.strength, intensity * 0.85);
          state.runePulse.speed    = Math.max(state.runePulse.speed,    intensity * 0.85);
        } else if (!state.runes.strength) {
          state.runePulse.strength = Math.max(state.runePulse.strength, intensity * 0.4);
        }
      }
      if (it.kind === 'direwolf' && !it.dead) {
        // dire wolf wants BLOOM (all three). pulse hard on all that aren't lit.
        if (!state.runes.strength) state.runePulse.strength = Math.max(state.runePulse.strength, intensity);
        if (!state.runes.speed)    state.runePulse.speed    = Math.max(state.runePulse.speed,    intensity * 0.7);
        if (!state.runes.sight)    state.runePulse.sight    = Math.max(state.runePulse.sight,    intensity * 0.7);
      }
      if (it.kind === 'mist' && !state.runes.sight) {
        state.runePulse.sight = Math.max(state.runePulse.sight, intensity);
      }
      if (it.kind === 'gap' && !state.runes.speed) {
        state.runePulse.speed = Math.max(state.runePulse.speed, intensity);
      }
      if (it.kind === 'seed' && it.hidden && it.state === 'idle' && !state.runes.sight) {
        state.runePulse.sight = Math.max(state.runePulse.sight, intensity * 0.5);
      }
      if (it.kind === 'animal' && it.state === 'idle' && !state.runes.strength) {
        state.runePulse.strength = Math.max(state.runePulse.strength, intensity * 0.5);
      }
    }
  }

  function tickChestSeeds(dt) {
    for (const seed of state.chestSeeds) {
      if (seed.settled) continue;
      seed.vy = (seed.vy || 0) + 620 * dt;
      seed.y += seed.vy * dt;
      if (seed.y >= seed.landY) { seed.y = seed.landY; seed.settled = true; seed.vy = 0; }
    }
  }

  function tickCamera() {
    state.camX = clamp(state.golem.x - W / 2, 0, WORLD_END - W);
  }

  function tickCelebration(dt) {
    // particle physics always runs (bloom bursts use the same pool)
    for (const p of state.celebrateParticles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 25 * dt;
      p.life -= dt;
    }
    state.celebrateParticles = state.celebrateParticles.filter(p => p.life > 0);

    if (state.ended !== 'won') return;
    state.celebrateT += dt;
    if (state.celebrateT < 6 && Math.random() < dt * 18) {
      const ang = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 50;
      state.celebrateParticles.push({
        x: (WORLD_END - 60) + Math.cos(ang) * r,
        y: GROUND_Y - 110 + Math.sin(ang) * r,
        vx: (Math.random() - 0.5) * 30,
        vy: -30 - Math.random() * 40,
        life: 2.0 + Math.random() * 1.0,
        hue: 36 + Math.random() * 20,
      });
    }
  }

  function checkEnd() {
    if (state.golem.restT <= 0 && state.hearthDeadT >= COLLAPSE_TIME) {
      state.golem.restT = 99;
      state.ended = 'rest';
      flash('the golem rests — press R to wake', 5.0);
      play('collapse');
    }
    if (!state.ended && state.golem.x >= WORLD_END - 90) {
      state.ended = 'won';
      flash(`the forest hums — ${state.rescued} / ${state.totalAnimals} friends home`, 5.0);
      play('fanfare');
    }
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function render() {
    ctx.save();
    if (state.shake > 0) {
      const sx = (Math.random() - 0.5) * state.shake * 8;
      const sy = (Math.random() - 0.5) * state.shake * 8;
      ctx.translate(sx, sy);
    }
    drawForest();
    drawChest();
    drawHUD();
    if (state.ended) drawEndScreen();
    ctx.restore();
  }

  function drawForest() {
    // sky/mist gradient
    const grd = ctx.createLinearGradient(0, 0, 0, SPLIT_Y);
    grd.addColorStop(0, '#16243a');
    grd.addColorStop(0.5, '#2c4760');
    grd.addColorStop(1, '#4a6b6c');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, SPLIT_Y);

    drawTreeBand(0.25, '#1c2a3a', 70, 130);
    drawTreeBand(0.55, '#2a3a47', 90, 170);
    drawTreeBand(0.85, '#384b58', 110, 210);

    // ground line with gaps cut out
    drawGround();

    // ambient drifting mist
    ctx.globalAlpha = 0.32;
    for (let i = 0; i < 6; i++) {
      const x = ((i * 200 + state.t * 18 + (i * 73)) % (W + 240)) - 120;
      const y = 80 + i * 35;
      ctx.fillStyle = '#cfe4dc';
      ctx.beginPath(); ctx.ellipse(x, y, 110, 22, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // mist patches (heavy)
    for (const m of state.world) {
      if (m.kind !== 'mist') continue;
      const sx = m.x - state.camX;
      if (sx + m.w / 2 < -50 || sx - m.w / 2 > W + 50) continue;
      const opacity = state.runes.sight ? 0.18 : 0.78;
      const grd2 = ctx.createRadialGradient(sx, GROUND_Y - 80, 10, sx, GROUND_Y - 80, m.w * 0.7);
      grd2.addColorStop(0, `rgba(220,230,240,${opacity})`);
      grd2.addColorStop(1, 'rgba(220,230,240,0)');
      ctx.fillStyle = grd2;
      ctx.fillRect(sx - m.w / 2 - 40, 0, m.w + 80, SPLIT_Y);
      // swirling motes
      for (let k = 0; k < 6; k++) {
        const a = state.t * 0.7 + k;
        const mx = sx + Math.cos(a) * m.w * 0.3;
        const my = GROUND_Y - 60 + Math.sin(a * 1.3) * 30;
        ctx.fillStyle = `rgba(200,210,220,${opacity * 0.8})`;
        ctx.beginPath(); ctx.arc(mx, my, 16, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Spirit tree
    drawSpiritTree();

    // celebration / bloom particles (world-space)
    for (const p of state.celebrateParticles) {
      const sx = p.x - state.camX;
      if (sx < -20 || sx > W + 20) continue;
      const a = clamp(p.life / 1.5, 0, 1);
      ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${a})`;
      ctx.beginPath(); ctx.arc(sx, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `hsla(${p.hue + 10}, 100%, 86%, ${a * 0.7})`;
      ctx.beginPath(); ctx.arc(sx, p.y, 1.2, 0, Math.PI * 2); ctx.fill();
    }

    // World items (excluding mist/gaps already drawn or to be drawn elsewhere)
    for (const it of state.world) {
      if (it.kind === 'mist' || it.kind === 'gap') continue;
      if (it.state === 'gone') continue;
      if (it.state === 'held') continue;
      const sx = it.x - state.camX;
      if (sx < -60 || sx > W + 60) continue;
      drawWorldItem(it, sx);
    }

    drawGolem();

    if (state.golem.holding) {
      const it = state.golem.holding;
      drawWorldItem(it, it.x - state.camX);
    }

    // chute hint
    if (state.golem.holding && state.golem.holding.kind === 'seed') {
      const cx = state.golem.x - state.camX;
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(state.t * 6);
      ctx.strokeStyle = '#ffb46a'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(cx - 38, SPLIT_Y - 64, 76, 64);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffb46a'; ctx.font = '11px ui-rounded, sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('drop here', cx, SPLIT_Y - 70);
      ctx.restore();
    }

    // reach-cursor hint
    if (!state.mouse.down && state.mouse.y < SPLIT_Y && state.golem.restT <= 0) {
      const mw = state.mouse.x + state.camX;
      let nearest = null, ndist = 60;
      for (const it of state.world) {
        if ((it.kind === 'seed' || it.kind === 'animal' || it.kind === 'boulder') && it.state === 'idle') {
          if (it.kind === 'seed' && it.hidden && !state.runes.sight) continue;
          const d = dist(state.golem.x, GROUND_Y - 40, it.x, it.y);
          const mc = dist(mw, state.mouse.y, it.x, it.y);
          if (d < ARM_REACH && mc < ndist) { ndist = mc; nearest = it; }
        } else if (it.kind === 'wolf' && !it.dead) {
          const d = dist(state.golem.x, GROUND_Y - 40, it.x, GROUND_Y - 10);
          const mc = dist(mw, state.mouse.y, it.x, GROUND_Y - 10);
          if (d < ARM_REACH && mc < ndist) { ndist = mc; nearest = it; }
        }
      }
      if (nearest) {
        ctx.save();
        ctx.strokeStyle = '#ffd089'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        const ty = nearest.kind === 'wolf' ? GROUND_Y - 10 : nearest.y - 6;
        ctx.beginPath(); ctx.arc(nearest.x - state.camX, ty, 22, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
      }
    }
  }

  function drawTreeBand(par, color, minH, maxH) {
    ctx.fillStyle = color;
    const off = -(state.camX * par) % 160;
    // sway: scale with parallax (closer trees sway more)
    const swayAmp = 4 * par;
    const swayBase = state.t * 0.9;
    for (let i = -1; i < W / 160 + 2; i++) {
      const x = i * 160 + off;
      const h = minH + ((i * 53) % (maxH - minH));
      const tip = swayAmp * Math.sin(swayBase + i * 0.7);
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y); ctx.lineTo(x + 40 + tip, GROUND_Y - h); ctx.lineTo(x + 80, GROUND_Y);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawGround() {
    // collect gaps in view
    const gaps = [];
    for (const it of state.world) {
      if (it.kind !== 'gap') continue;
      const sx = it.x - state.camX;
      if (sx + it.w / 2 < -10 || sx - it.w / 2 > W + 10) continue;
      gaps.push({ l: sx - it.w / 2, r: sx + it.w / 2 });
    }
    gaps.sort((a, b) => a.l - b.l);
    // fill ground in segments between gaps
    ctx.fillStyle = '#3b5249';
    let cursor = 0;
    for (const g of gaps) {
      if (g.l > cursor) ctx.fillRect(cursor, GROUND_Y, g.l - cursor, SPLIT_Y - GROUND_Y);
      cursor = Math.max(cursor, g.r);
    }
    if (cursor < W) ctx.fillRect(cursor, GROUND_Y, W - cursor, SPLIT_Y - GROUND_Y);
    // top edge highlight
    ctx.fillStyle = '#2c3d36';
    cursor = 0;
    for (const g of gaps) {
      if (g.l > cursor) ctx.fillRect(cursor, GROUND_Y, g.l - cursor, 3);
      cursor = Math.max(cursor, g.r);
    }
    if (cursor < W) ctx.fillRect(cursor, GROUND_Y, W - cursor, 3);
    // gap visual depth shading
    for (const g of gaps) {
      const grd = ctx.createLinearGradient(0, GROUND_Y, 0, SPLIT_Y);
      grd.addColorStop(0, 'rgba(0,0,0,0.7)');
      grd.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = grd;
      ctx.fillRect(g.l, GROUND_Y, g.r - g.l, SPLIT_Y - GROUND_Y);
      // little "no ground" indicator
      ctx.fillStyle = '#1a221e';
      ctx.fillRect(g.l - 2, GROUND_Y, 4, 6);
      ctx.fillRect(g.r - 2, GROUND_Y, 4, 6);
    }
  }

  function drawSpiritTree() {
    const sx = (WORLD_END - 60) - state.camX;
    if (sx < -100 || sx > W + 100) return;
    ctx.save();
    ctx.translate(sx, GROUND_Y);
    const allWon = state.rescued >= state.totalAnimals;
    const pulse = 0.85 + 0.15 * Math.sin(state.t * 1.6);
    const intensity = allWon ? 1.0 : 0.6;
    const halo = ctx.createRadialGradient(0, -80, 6, 0, -80, 160);
    halo.addColorStop(0, `rgba(255,220,140,${0.6 * pulse * intensity})`);
    halo.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = halo; ctx.fillRect(-160, -240, 320, 240);
    ctx.fillStyle = '#5b4a36'; ctx.fillRect(-12, -90, 24, 90);
    ctx.fillStyle = '#7eb273';
    ctx.beginPath();
    ctx.arc(0, -115, 50, 0, Math.PI * 2);
    ctx.arc(-32, -90, 38, 0, Math.PI * 2);
    ctx.arc(28, -92, 40, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = state.t * 1.3 + i;
      ctx.fillStyle = `rgba(255,235,170,${0.7 * pulse * intensity})`;
      ctx.beginPath(); ctx.arc(Math.cos(a) * 26, -110 + Math.sin(a) * 18, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawWorldItem(it, sx) {
    const sightOn = state.runes.sight;
    const wob = Math.sin(state.t * 14) * (it.wobble || 0) * 6;
    ctx.save();
    ctx.translate(sx + wob, it.y || GROUND_Y - 10);
    if (it.kind === 'seed') {
      const dim = it.hidden ? (sightOn ? 1.0 : 0.06) : (sightOn ? 1.0 : 0.4);
      const pulse = 0.7 + 0.3 * Math.sin(state.t * 4 + it.x * 0.01);
      const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
      halo.addColorStop(0, `rgba(255,180,80,${0.85 * dim * pulse})`);
      halo.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = halo; ctx.fillRect(-30, -30, 60, 60);
      ctx.fillStyle = `rgba(255,220,140,${dim})`;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,130,50,${dim})`;
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    } else if (it.kind === 'boulder') {
      ctx.fillStyle = '#6b6a6a';
      ctx.beginPath(); ctx.ellipse(0, -2, 32, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4d4c4c';
      ctx.beginPath(); ctx.ellipse(0, 18, 34, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a8888';
      ctx.beginPath(); ctx.ellipse(-10, -8, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (it.kind === 'animal') {
      const dim = sightOn ? 1.0 : 0.5;
      if (it.state === 'rescued') {
        const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
        halo.addColorStop(0, 'rgba(255,235,170,0.7)');
        halo.addColorStop(1, 'rgba(255,235,170,0)');
        ctx.fillStyle = halo; ctx.fillRect(-22, -22, 44, 44);
      }
      let hopY = 0;
      if (it.state === 'rescued' && state.ended === 'won') {
        const phase = state.t * 5 + it.x * 0.013;
        hopY = -Math.abs(Math.sin(phase)) * 10;
      }
      ctx.globalAlpha = dim;
      ctx.font = '26px serif'; ctx.textAlign = 'center';
      ctx.fillText(it.species || '🐾', 0, hopY);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (it.kind === 'wolf') drawWolf(it, sx);
    if (it.kind === 'direwolf') drawDireWolf(it, sx);
  }

  function drawDireWolf(w, sx) {
    if (w.dead) {
      ctx.save();
      ctx.translate(sx, GROUND_Y - 6);
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = '#2a1714';
      ctx.beginPath(); ctx.ellipse(0, 0, 38, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3328';
      ctx.fillRect(-34, -8, 68, 8);
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(sx, GROUND_Y - 8);
    const dir = w.vx < 0 ? -1 : 1;
    ctx.scale(dir, 1);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 8, 40, 6, 0, 0, Math.PI * 2); ctx.fill();
    // body (larger, darker)
    const flash = w.hitFlashT > 0 ? Math.sin(w.hitFlashT * 30) * 0.5 + 0.5 : 0;
    ctx.fillStyle = flash > 0.3 ? '#a04040' : '#2a1a18';
    ctx.beginPath(); ctx.ellipse(0, -16, 34, 18, 0, 0, Math.PI * 2); ctx.fill();
    // head
    ctx.fillStyle = flash > 0.3 ? '#a85050' : '#3a2622';
    ctx.beginPath(); ctx.arc(30, -22, 13, 0, Math.PI * 2); ctx.fill();
    // ears
    ctx.beginPath();
    ctx.moveTo(22, -34); ctx.lineTo(26, -42); ctx.lineTo(30, -30); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(31, -34); ctx.lineTo(36, -44); ctx.lineTo(40, -30); ctx.fill();
    // glowing eye
    const eyeGlow = 0.7 + 0.3 * Math.sin(state.t * 8);
    ctx.fillStyle = `rgba(255,90,40,${eyeGlow})`;
    ctx.beginPath(); ctx.arc(34, -22, 3, 0, Math.PI * 2); ctx.fill();
    // bared teeth
    ctx.fillStyle = '#e8d8a0';
    ctx.fillRect(36, -14, 5, 4);
    // legs
    const step = Math.sin(state.t * 16 + w.x * 0.01) * 4;
    ctx.fillStyle = '#1f1311';
    ctx.fillRect(-22, -4, 5, 10 + step);
    ctx.fillRect(-6, -4, 5, 10 - step);
    ctx.fillRect(12, -4, 5, 10 + step);
    ctx.fillRect(22, -4, 5, 10 - step);
    // bushy tail
    ctx.fillStyle = '#2a1a18';
    ctx.beginPath();
    ctx.ellipse(-32, -18, 11, 6, Math.sin(state.t * 7) * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // HP pips above its head (when triggered)
    if (w.state === 'chase' && !w.dead) {
      const baseY = GROUND_Y - 70;
      for (let i = 0; i < DIRE_WOLF_HP; i++) {
        ctx.fillStyle = i < w.hp ? '#ff7a4a' : '#3a1a14';
        ctx.beginPath();
        ctx.arc(sx - 18 + i * 14, baseY, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2a1010'; ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  function drawWolf(w, sx) {
    if (w.dead) {
      ctx.save();
      ctx.translate(sx, GROUND_Y - 8);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#3a2a26';
      ctx.beginPath();
      ctx.ellipse(0, 0, 24, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a4438';
      ctx.fillRect(-22, -6, 44, 6);
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(sx, GROUND_Y - 8);
    const dir = w.vx < 0 ? -1 : 1;
    ctx.scale(dir, 1);
    // body
    ctx.fillStyle = '#4a3b34';
    ctx.beginPath();
    ctx.ellipse(0, -10, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // head
    ctx.fillStyle = '#5c4a40';
    ctx.beginPath();
    ctx.arc(20, -14, 9, 0, Math.PI * 2); ctx.fill();
    // ears
    ctx.beginPath();
    ctx.moveTo(15, -22); ctx.lineTo(18, -28); ctx.lineTo(22, -20); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22, -22); ctx.lineTo(25, -28); ctx.lineTo(28, -20); ctx.fill();
    // eye
    ctx.fillStyle = '#ffba6a';
    ctx.beginPath(); ctx.arc(22, -14, 1.6, 0, Math.PI * 2); ctx.fill();
    // legs (animated)
    const step = Math.sin(state.t * 18 + w.x * 0.01) * 3;
    ctx.fillStyle = '#3a2c25';
    ctx.fillRect(-16, -4, 4, 8 + step);
    ctx.fillRect(-4, -4, 4, 8 - step);
    ctx.fillRect(8, -4, 4, 8 + step);
    ctx.fillRect(16, -4, 4, 8 - step);
    // tail
    ctx.fillStyle = '#4a3b34';
    ctx.beginPath();
    ctx.ellipse(-22, -14, 7, 4, Math.sin(state.t * 8) * 0.4, 0, Math.PI * 2);
    ctx.fill();
    // alert glint when chasing
    if (w.state === 'chase') {
      ctx.fillStyle = `rgba(255,90,90,${0.5 + 0.5 * Math.sin(state.t * 9)})`;
      ctx.beginPath(); ctx.arc(22, -14, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawGolem() {
    const g = state.golem;
    const sx = g.x - state.camX;
    const jumpLift = Math.sin(g.jumpT * Math.PI / 0.5) * 30; // arc
    const sy = g.y - (g.jumpT > 0 ? jumpLift : 0);
    const bump = g.bumpT > 0 ? Math.sin(g.bumpT * 60) * 3 : 0;
    const stepBob = Math.sin(g.walkPhase * 8) * 2;
    const resting = g.restT > 0;
    ctx.save();
    ctx.translate(sx + bump, sy);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 8, 50, 8, 0, 0, Math.PI * 2); ctx.fill();

    if (resting) {
      // slumped
      ctx.fillStyle = '#5a6262';
      ctx.fillRect(-36, -50, 72, 50);
      ctx.fillStyle = '#6e7878';
      ctx.fillRect(-26, -78, 52, 28);
      ctx.fillStyle = '#222';
      ctx.fillRect(-12, -66, 6, 2);
      ctx.fillRect(6, -66, 6, 2);
      // tiny zzz
      ctx.fillStyle = 'rgba(220,220,255,0.6)';
      ctx.font = '14px serif'; ctx.textAlign = 'left';
      ctx.fillText('z', 28, -78 + Math.sin(state.t * 2) * 2);
      ctx.fillText('z', 36, -90 + Math.sin(state.t * 2 + 1) * 2);
      ctx.restore();
      return;
    }

    // legs
    ctx.fillStyle = state.bloomMode ? '#bbb29e' : '#7d8a8b';
    const legOff = Math.sin(g.walkPhase * 8) * 6;
    ctx.fillRect(-22, -40, 16, 40 + legOff);
    ctx.fillRect(6, -40, 16, 40 - legOff);

    // torso (chest cavity)
    ctx.fillStyle = state.bloomMode ? '#d0c4ad' : '#8c9899';
    ctx.fillRect(-36, -100 + stepBob, 72, 70);
    // chest opening
    ctx.fillStyle = '#3c2c1f';
    ctx.fillRect(-22, -82 + stepBob, 44, 32);
    // hearth glow seen through opening
    const hearthGlow = state.hearth / HEARTH_MAX;
    const ghalo = ctx.createRadialGradient(0, -66 + stepBob, 2, 0, -66 + stepBob, 28);
    ghalo.addColorStop(0, `rgba(255,150,60,${0.85 * hearthGlow})`);
    ghalo.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = ghalo;
    ctx.fillRect(-32, -90 + stepBob, 64, 42);

    // chute on top
    ctx.fillStyle = '#5a4738';
    ctx.fillRect(-9, -101 + stepBob, 18, 8);

    // head
    ctx.fillStyle = state.bloomMode ? '#dfd0b6' : '#9aa6a6';
    ctx.fillRect(-22, -130 + stepBob, 44, 30);
    // eyes — change color with SEE
    const eyeOn = state.runes.sight;
    ctx.fillStyle = eyeOn ? '#ffeaa0' : '#322';
    const eyeShift = g.facing > 0 ? 2 : -2;
    ctx.fillRect(-12 + eyeShift, -118 + stepBob, 6, 4);
    ctx.fillRect(6 + eyeShift, -118 + stepBob, 6, 4);

    // bloom glow halo
    if (state.bloomMode) {
      ctx.globalCompositeOperation = 'lighter';
      const bloom = ctx.createRadialGradient(0, -60, 6, 0, -60, 100);
      bloom.addColorStop(0, `rgba(255,230,150,${0.45 + 0.25 * Math.sin(state.t * 10)})`);
      bloom.addColorStop(1, 'rgba(255,230,150,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(-100, -180, 200, 220);
      ctx.globalCompositeOperation = 'source-over';
    }

    // confused mist bubble
    if (g.confusedT > 0.1) {
      ctx.fillStyle = `rgba(255,255,255,${g.confusedT * 0.9})`;
      ctx.font = '18px serif'; ctx.textAlign = 'center';
      ctx.fillText('?', 0, -140 + Math.sin(state.t * 6) * 2);
    }

    // arm
    const armBaseX = g.facing > 0 ? 32 : -32;
    const armBaseY = -78 + stepBob;
    let targetX, targetY;
    if (g.holding) { targetX = 0; targetY = -150; }
    else if (g.armTarget) { targetX = g.armTarget.x - g.x; targetY = (g.armTarget.kind === 'wolf' ? GROUND_Y - 10 : g.armTarget.y) - sy; }
    else { targetX = armBaseX * 0.4; targetY = -50; }
    const reach = g.armReachT;
    const handX = lerp(armBaseX, targetX, reach);
    const handY = lerp(armBaseY, targetY, reach);
    ctx.strokeStyle = state.bloomMode ? '#cfc3a9' : '#8c9899';
    ctx.lineWidth = 11; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armBaseX, armBaseY);
    const midX = (armBaseX + handX) / 2 + (g.facing > 0 ? 6 : -6);
    const midY = (armBaseY + handY) / 2 + 10;
    ctx.lineTo(midX, midY); ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.fillStyle = state.bloomMode ? '#e6d7b6' : '#a8b3b3';
    ctx.beginPath(); ctx.arc(handX, handY, 8, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function drawChest() {
    const grd = ctx.createLinearGradient(0, SPLIT_Y, 0, H);
    grd.addColorStop(0, '#1a1310'); grd.addColorStop(1, '#0d0807');
    ctx.fillStyle = grd; ctx.fillRect(0, SPLIT_Y, W, H - SPLIT_Y);

    ctx.fillStyle = '#2a1f18';
    ctx.fillRect(0, SPLIT_Y, W, 14);
    ctx.strokeStyle = '#3a2c22'; ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo((i * W) / 8, SPLIT_Y + 14); ctx.lineTo((i * W) / 8, H - 2); ctx.stroke();
    }
    ctx.fillStyle = '#1a120e';
    ctx.beginPath();
    ctx.moveTo(0, SPLIT_Y); ctx.quadraticCurveTo(60, SPLIT_Y + 160, 0, H);
    ctx.lineTo(0, SPLIT_Y); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, SPLIT_Y); ctx.quadraticCurveTo(W - 60, SPLIT_Y + 160, W, H);
    ctx.lineTo(W, SPLIT_Y); ctx.fill();

    // chute opening
    ctx.fillStyle = '#3b2a1c';
    ctx.fillRect(CHUTE_LANDING.x - 28, SPLIT_Y + 4, 56, 18);
    ctx.fillStyle = 'rgba(255,200,120,0.18)';
    ctx.fillRect(CHUTE_LANDING.x - 28, SPLIT_Y + 4, 56, 6);

    drawHearth();
    for (const r of RUNES) drawRune(r);
    for (const em of state.embers) drawEmber(em);
    for (const seed of state.chestSeeds) {
      if (state.sprite.carrying === seed) continue;
      drawChestSeed(seed.x, seed.y, seed.settled);
    }
    for (const p of state.sprite.trail) {
      if (p.life <= 0) continue;
      ctx.fillStyle = `rgba(255,180,90,${p.life * 0.4})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 * p.life, 0, Math.PI * 2); ctx.fill();
    }
    drawSprite();
    drawBellowsHint();
    if (state.sprite.carrying) drawChestSeed(state.sprite.carrying.x, state.sprite.carrying.y, true);
  }

  function drawEmber(em) {
    const dying = em.dying;
    const fade = dying ? clamp(em.fadeT / 0.35, 0, 1) : 1;
    if (!em.settled) {
      // streaking ember in mid-air
      const len = 12;
      ctx.strokeStyle = `rgba(255,140,40,${0.8 * fade})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(em.x - em.vx * 0.04, em.y - em.vy * 0.04);
      ctx.lineTo(em.x, em.y);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,210,140,${fade})`;
      ctx.beginPath(); ctx.arc(em.x, em.y, 3, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // settled — pulsing scorch timer ring
    const danger = clamp(1 - em.scorchIn / EMBER_SCORCH_DELAY, 0, 1);
    const ringR = 14 + danger * 8;
    const ringAlpha = (0.25 + 0.45 * danger) * fade;
    if (!dying) {
      ctx.strokeStyle = `rgba(255,80,40,${ringAlpha})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(em.x, em.y, ringR, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // glow & spark
    const flick = 0.8 + 0.2 * Math.sin(em.sparkPhase);
    const halo = ctx.createRadialGradient(em.x, em.y, 1, em.x, em.y, 16);
    halo.addColorStop(0, `rgba(255,150,60,${0.8 * fade * flick})`);
    halo.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(em.x - 16, em.y - 16, 32, 32);
    ctx.fillStyle = `rgba(255,180,80,${fade * flick})`;
    ctx.beginPath(); ctx.arc(em.x, em.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,80,40,${fade})`;
    ctx.beginPath(); ctx.arc(em.x, em.y, 2, 0, Math.PI * 2); ctx.fill();
    if (dying && em.stomped) {
      // stomp puff
      ctx.strokeStyle = `rgba(255,200,140,${fade * 0.7})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(em.x, em.y, (1 - fade) * 18 + 4, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawBellowsHint() {
    const s = state.sprite;
    if (s.carrying) return;
    const nearHearth = dist(s.x, s.y, HEARTH.x, HEARTH.y) < BELLOWS_RANGE;
    if (!nearHearth || state.hearth <= 0) return;
    const pulse = 0.6 + 0.4 * Math.sin(state.t * 5);
    ctx.save();
    if (s.pumping) {
      // active pump: visible bellows expanding/contracting beneath the hearth
      const phase = Math.sin(s.pumpPhase);
      const bw = 70 + phase * 10;
      const bh = 18 + phase * 6;
      ctx.fillStyle = '#4a2e1a';
      ctx.beginPath();
      ctx.ellipse(HEARTH.x, HEARTH.y + HEARTH.r + 24, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a4e2c';
      ctx.beginPath();
      ctx.ellipse(HEARTH.x, HEARTH.y + HEARTH.r + 22, bw / 2 - 4, bh / 2 - 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,210,140,${pulse})`;
      ctx.font = '11px ui-rounded, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('PUMPING ♨', HEARTH.x, HEARTH.y + HEARTH.r + 50);
    } else {
      ctx.fillStyle = `rgba(255,210,140,${0.5 + 0.3 * pulse})`;
      ctx.font = '11px ui-rounded, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('[SPACE] pump', HEARTH.x, HEARTH.y + HEARTH.r + 36);
    }
    ctx.restore();
  }

  function drawHearth() {
    const fill = state.hearth / HEARTH_MAX;
    const flame = (0.7 + 0.3 * Math.sin(state.t * 22 + Math.sin(state.t * 7) * 2)) * fill;
    const lowFuel = state.hearth < 25 ? 1.0 : 0.0;
    const warn = lowFuel * (0.5 + 0.5 * Math.sin(state.t * 8));

    // stone ring
    ctx.fillStyle = '#3a2a20';
    ctx.beginPath(); ctx.arc(HEARTH.x, HEARTH.y + 12, HEARTH.r + 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1c120c';
    ctx.beginPath(); ctx.arc(HEARTH.x, HEARTH.y + 12, HEARTH.r + 6, 0, Math.PI * 2); ctx.fill();

    // outer glow
    const halo = ctx.createRadialGradient(HEARTH.x, HEARTH.y, 6, HEARTH.x, HEARTH.y, 240);
    const haloAlpha = 0.5 * flame + warn * 0.3;
    halo.addColorStop(0, `rgba(255,160,60,${haloAlpha})`);
    halo.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(HEARTH.x - 220, HEARTH.y - 220, 440, 440);

    if (fill > 0.02) {
      ctx.fillStyle = `rgba(255,160,40,${0.9 * fill})`;
      ctx.beginPath();
      ctx.ellipse(HEARTH.x, HEARTH.y, HEARTH.r * fill, HEARTH.r * 1.25 * fill, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,220,120,${flame})`;
      ctx.beginPath();
      ctx.ellipse(HEARTH.x, HEARTH.y - 4, HEARTH.r * 0.55 * fill, HEARTH.r * 0.95 * fill, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,200,${flame * 0.9})`;
      ctx.beginPath();
      ctx.ellipse(HEARTH.x, HEARTH.y - 8, HEARTH.r * 0.25 * fill, HEARTH.r * 0.5 * fill, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // low fuel alarm icon
    if (warn > 0.1) {
      ctx.fillStyle = `rgba(255,80,80,${warn})`;
      ctx.font = 'bold 12px ui-rounded, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('!', HEARTH.x, HEARTH.y - 50);
    }

    // bar
    ctx.fillStyle = '#2a1d14';
    ctx.fillRect(HEARTH.x - 50, HEARTH.y - 64, 100, 8);
    ctx.fillStyle = state.hearth < 25 ? '#ff7a4a' : '#ffb46a';
    ctx.fillRect(HEARTH.x - 50, HEARTH.y - 64, 100 * fill, 8);
    ctx.strokeStyle = '#5a3e26'; ctx.strokeRect(HEARTH.x - 50, HEARTH.y - 64, 100, 8);

    ctx.fillStyle = 'rgba(255,210,140,0.8)';
    ctx.font = '11px ui-rounded, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('HEARTH', HEARTH.x, HEARTH.y - 70);
  }

  function drawRune(r) {
    const lit = state.runes[r.key];
    const near = dist(state.sprite.x, state.sprite.y, r.x, r.y) < 110;
    const pulse = 0.7 + 0.3 * Math.sin(state.t * 4 + r.x);
    const warn = state.runePulse[r.key]; // 0..1
    const scorch = state.runeScorch[r.key]; // > 0 = lockout seconds remaining
    ctx.save();
    ctx.translate(r.x, r.y);

    if (scorch > 0) {
      // scorched lockout — visible black smolder + red X
      const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 60);
      halo.addColorStop(0, `rgba(120,20,20,${0.6 + 0.2 * Math.sin(state.t * 12)})`);
      halo.addColorStop(1, 'rgba(120,20,20,0)');
      ctx.fillStyle = halo; ctx.fillRect(-60, -60, 120, 120);
    }

    // warning glow (red pulse) — the sprite's privileged signal
    if (warn > 0.05 && !lit) {
      const a = warn * (0.6 + 0.4 * Math.sin(state.t * 10));
      const wh = ctx.createRadialGradient(0, 0, 4, 0, 0, 80);
      wh.addColorStop(0, `rgba(255,80,80,${a * 0.7})`);
      wh.addColorStop(1, 'rgba(255,80,80,0)');
      ctx.fillStyle = wh; ctx.fillRect(-80, -80, 160, 160);
    }

    if (lit) {
      const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 78);
      halo.addColorStop(0, `rgba(255,180,80,${0.55 * pulse})`);
      halo.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = halo; ctx.fillRect(-78, -78, 156, 156);
    }
    ctx.fillStyle = scorch > 0 ? '#160808' : '#241914';
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = scorch > 0 ? '#0a0404' : (lit ? '#3a2616' : '#1a120e');
    ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = scorch > 0 ? '#5a2020' : (lit ? `rgba(255,200,110,${pulse})` : '#5a4a3c');
    ctx.font = '24px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(r.glyph, 0, 1);
    ctx.fillStyle = lit ? '#ffd089' : (scorch > 0 ? '#ff5a4a' : (warn > 0.1 ? '#ff9a8a' : '#7d6a55'));
    ctx.font = '10px ui-rounded, sans-serif';
    ctx.fillText(r.label, 0, 40);
    if (scorch > 0) {
      // X mark + countdown ring
      ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-12, -12); ctx.lineTo(12, 12);
      ctx.moveTo(12, -12); ctx.lineTo(-12, 12);
      ctx.stroke();
      const ringFrac = scorch / EMBER_SCORCH_LOCKOUT;
      ctx.strokeStyle = 'rgba(255,90,90,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ringFrac);
      ctx.stroke();
    }
    if (near && scorch <= 0) {
      ctx.strokeStyle = '#ffd089'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd089'; ctx.font = '10px ui-rounded, sans-serif';
      ctx.fillText('[E]', 0, -38);
    }
    ctx.restore();
  }

  function drawChestSeed(x, y, settled) {
    const pulse = 0.7 + 0.3 * Math.sin(state.t * 6 + x * 0.05);
    const halo = ctx.createRadialGradient(x, y, 2, x, y, 22);
    halo.addColorStop(0, `rgba(255,180,80,${0.85 * pulse})`);
    halo.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = halo; ctx.fillRect(x - 22, y - 22, 44, 44);
    ctx.fillStyle = '#ffd49a';
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff8a3a';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    if (!settled) {
      ctx.strokeStyle = 'rgba(255,200,120,0.3)';
      ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 4); ctx.stroke();
    }
  }

  function drawSprite() {
    const s = state.sprite;
    const flick = 0.85 + 0.15 * Math.sin(state.t * 18);
    let dx = 0, dy = 0;
    if (state.ended === 'won') {
      // float up & wobble through the chute
      dy = -clamp(state.endT * 38, 0, 220) + Math.sin(state.t * 2) * 6;
      dx = Math.sin(state.t * 1.4) * 18;
    } else if (s.pumping) {
      // pulse while pumping
      dy = Math.sin(s.pumpPhase) * 3;
    }
    const x = s.x + dx, y = s.y + dy;
    const halo = ctx.createRadialGradient(x, y, 2, x, y, 30);
    halo.addColorStop(0, `rgba(255,210,130,${0.85 * flick})`);
    halo.addColorStop(1, 'rgba(255,210,130,0)');
    ctx.fillStyle = halo; ctx.fillRect(x - 30, y - 30, 60, 60);
    ctx.fillStyle = `rgba(255,160,60,${flick})`;
    ctx.beginPath(); ctx.ellipse(x, y, 6, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,255,200,${flick})`;
    ctx.beginPath(); ctx.ellipse(x, y - 3, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 3; i++) {
      const a = state.t * 6 + i * 2.1;
      ctx.fillStyle = `rgba(255,230,150,${0.6 * flick})`;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * 11, y + Math.sin(a) * 11, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawHUD() {
    const padY = 12, barW = 200, barH = 12;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W - barW - 24, padY - 8, barW + 16, 70);
    ctx.fillStyle = '#3a2616';
    ctx.fillRect(W - barW - 16, padY, barW, barH);
    ctx.fillStyle = state.hearth < 25 ? '#ff7a4a' : '#ffb46a';
    ctx.fillRect(W - barW - 16, padY, barW * (state.hearth / HEARTH_MAX), barH);
    ctx.strokeStyle = '#5a3e26'; ctx.strokeRect(W - barW - 16, padY, barW, barH);
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '11px ui-rounded, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('hearth', W - barW - 16, padY - 2);

    const xs = [W - barW - 16, W - barW + 50, W - barW + 110];
    const ks = ['strength', 'speed', 'sight'];
    const ls = ['STR', 'SPD', 'SEE'];
    for (let i = 0; i < 3; i++) {
      const lit = state.runes[ks[i]];
      const warn = state.runePulse[ks[i]];
      if (warn > 0.1 && !lit) {
        ctx.fillStyle = `rgba(255,90,90,${warn * 0.6 + 0.4 * Math.sin(state.t * 10) * warn})`;
        ctx.beginPath(); ctx.arc(xs[i] + 8, padY + barH + 24, 12, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = lit ? '#ffd089' : '#5a4a3c';
      ctx.beginPath(); ctx.arc(xs[i] + 8, padY + barH + 24, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lit ? '#ffd089' : (warn > 0.1 ? '#ffa890' : '#8a7a64');
      ctx.fillText(ls[i], xs[i] + 20, padY + barH + 28);
    }
    ctx.restore();

    // score
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W - 160, H - 36, 148, 24);
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '13px ui-rounded, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`rescued  ${state.rescued} / ${state.totalAnimals}`, W - 18, H - 18);
    ctx.restore();

    // progress
    ctx.save();
    const prog = clamp(state.golem.x / WORLD_END, 0, 1);
    const trackW = 300;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(W / 2 - trackW / 2 - 8, 12, trackW + 16, 16);
    ctx.fillStyle = '#3a4a4a';
    ctx.fillRect(W / 2 - trackW / 2, 16, trackW, 8);
    ctx.fillStyle = '#7eb273';
    ctx.fillRect(W / 2 - trackW / 2, 16, trackW * prog, 8);
    ctx.fillStyle = '#ffd089';
    ctx.beginPath(); ctx.arc(W / 2 + trackW / 2, 20, 5, 0, Math.PI * 2); ctx.fill();
    // threat icons along the track for the upcoming few meters
    for (const it of state.world) {
      const ax = it.x - state.golem.x;
      if (ax < 0 || ax > 900) continue;
      const tx = W / 2 - trackW / 2 + (it.x / WORLD_END) * trackW;
      let glyph = null, color = '#e8e4d8';
      if (it.kind === 'wolf' && !it.dead) { glyph = '◢'; color = '#ff8888'; }
      if (it.kind === 'direwolf' && !it.dead) { glyph = '◆'; color = '#ff4040'; }
      if (it.kind === 'mist') { glyph = '~'; color = '#cfe4dc'; }
      if (it.kind === 'gap') { glyph = '∨'; color = '#b0c8d4'; }
      if (it.kind === 'boulder' && it.state === 'idle') { glyph = '●'; color = '#aaa'; }
      if (glyph) {
        ctx.fillStyle = color;
        ctx.font = '11px ui-rounded, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(glyph, tx, 14);
      }
    }
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '10px ui-rounded, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Golem → Spirit Tree', W / 2, 40);
    ctx.restore();

    // bloom mode banner
    if (state.bloomMode) {
      ctx.save();
      const a = 0.6 + 0.4 * Math.sin(state.t * 6);
      ctx.fillStyle = `rgba(255,220,120,${a})`;
      ctx.font = '14px ui-rounded, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('★ BLOOM ★', W / 2, 60);
      ctx.restore();
    }

    if (state.flash) {
      ctx.save();
      ctx.globalAlpha = clamp(state.flash.t / Math.min(1, state.flash.max), 0, 1);
      ctx.fillStyle = '#ffd089';
      ctx.font = '14px ui-rounded, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(state.flash.msg, W / 2, SPLIT_Y - 8);
      ctx.restore();
    }
  }

  function drawEndScreen() {
    ctx.save();
    if (state.ended === 'won') {
      // Non-modal celebration banner — show animals dancing & sprite floating
      const bannerY = 90;
      const a = clamp(state.endT * 1.4, 0, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`;
      ctx.fillRect(W / 2 - 240, bannerY - 36, 480, 80);
      ctx.fillStyle = `rgba(255,233,168,${a})`;
      ctx.font = '24px ui-rounded, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('★ the forest hums ★', W / 2, bannerY);
      ctx.font = '14px ui-rounded, sans-serif';
      ctx.fillStyle = `rgba(232,228,216,${a})`;
      ctx.fillText(`${state.rescued} of ${state.totalAnimals} friends home — press R to walk again`, W / 2, bannerY + 24);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(W / 2 - 240, H / 2 - 80, 480, 160);
      ctx.fillStyle = '#ffe9a8';
      ctx.font = '22px ui-rounded, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`the golem rests`, W / 2, H / 2 - 20);
      ctx.font = '14px ui-rounded, sans-serif';
      ctx.fillStyle = '#e8e4d8';
      ctx.fillText(`the hearth went cold`, W / 2, H / 2 + 12);
      ctx.font = '12px ui-rounded, sans-serif';
      ctx.fillStyle = '#cfc0a8';
      ctx.fillText(`press R to walk again`, W / 2, H / 2 + 48);
    }
    ctx.restore();
  }

  // ============================================================
  //  MAIN LOOP
  // ============================================================
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
