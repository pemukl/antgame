// Hearth & Hollow — two-player humming prototype.
// Player 1 (mouse): the Golem, walking the misty forest above.
// Player 2 (WASD + E): the Fire Sprite, tending the hearth inside the Golem's chest.
//
// Everything is drawn with canvas primitives. No assets, no build, no deps.

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');

  // ---------- constants ----------
  const W = 1024, H = 640;
  const SPLIT_Y = 320;                  // forest above, chest below
  const GROUND_Y = SPLIT_Y - 18;        // where golem's feet rest
  const WORLD_END = 4200;               // length of the forest level
  const SLOW_SPEED = 60;                // px/s
  const FAST_SPEED = 150;               // px/s with SPEED rune lit
  const ARM_REACH = 130;                // how far golem arm can grab
  const HEARTH_MAX = 100;
  const SEED_VALUE = 22;                // hearth refill per seed
  const BURN = { strength: 4.0, speed: 6.0, sight: 2.0 }; // hearth drain per second
  const SPRITE_SPEED = 170;             // px/s inside chest

  // chest interior layout (in chest-local coords, where (0,0) is top-left of chest pane)
  const CHEST_TOP = SPLIT_Y;
  const CHEST_H = H - SPLIT_Y;          // 320
  const CHEST_W = W;
  const HEARTH = { x: W / 2, y: SPLIT_Y + 200, r: 34 };
  const RUNES = [
    { key: 'strength', label: 'STR',  glyph: '⚒', x: W / 2 - 280, y: SPLIT_Y + 160 },
    { key: 'speed',    label: 'SPD',  glyph: '⚡', x: W / 2 + 280, y: SPLIT_Y + 160 },
    { key: 'sight',    label: 'SEE',  glyph: '◉', x: W / 2,       y: SPLIT_Y + 290 },
  ];
  // The chute landing zone — where seeds dropped by the golem appear inside the chest.
  const CHUTE_LANDING = { x: W / 2, y: SPLIT_Y + 40 };

  // ---------- world / level ----------
  // Pre-seed a fixed forest so each run is comparable.
  // Item types: 'seed' (fuel), 'boulder' (blocks path), 'animal' (rescue)
  function buildForest() {
    const items = [];
    // spread seeds, boulders, animals along the path
    const positions = [
      { x: 380,  t: 'seed' },
      { x: 560,  t: 'animal', species: '🐇' },
      { x: 760,  t: 'seed' },
      { x: 900,  t: 'boulder' },
      { x: 1080, t: 'seed' },
      { x: 1260, t: 'animal', species: '🦊' },
      { x: 1440, t: 'seed' },
      { x: 1620, t: 'boulder' },
      { x: 1800, t: 'seed' },
      { x: 1960, t: 'seed' },
      { x: 2120, t: 'animal', species: '🦌' },
      { x: 2300, t: 'boulder' },
      { x: 2480, t: 'seed' },
      { x: 2680, t: 'animal', species: '🐢' },
      { x: 2880, t: 'seed' },
      { x: 3040, t: 'boulder' },
      { x: 3220, t: 'seed' },
      { x: 3380, t: 'animal', species: '🐿' },
      { x: 3560, t: 'seed' },
      { x: 3760, t: 'seed' },
    ];
    for (const p of positions) {
      items.push({
        x: p.x,
        y: GROUND_Y - (p.t === 'boulder' ? 18 : 10),
        type: p.t,
        species: p.species || null,
        state: 'idle', // 'idle' | 'held' | 'gone' | 'rescued'
        wobble: 0,
      });
    }
    return items;
  }

  // ---------- state ----------
  const state = {
    started: false,
    t: 0,
    golem: {
      x: 200, y: GROUND_Y,
      targetX: 200,
      facing: 1,
      walkPhase: 0,
      armReachT: 0,     // 0..1 how far the arm is extended
      armTarget: null,  // item being reached toward, if any
      holding: null,    // item reference being carried
      bumpT: 0,         // for failed lifts (no STRENGTH)
    },
    sprite: {
      x: W / 2, y: SPLIT_Y + 240,
      carrying: null,   // null | 'seed'
      trail: [],
    },
    hearth: HEARTH_MAX * 0.6,
    runes: { strength: false, speed: false, sight: true },
    chestSeeds: [],     // [{x, y, vy, settled}]
    forest: buildForest(),
    rescued: 0,
    totalAnimals: 0,
    camX: 0,
    mouse: { x: 0, y: 0, down: false },
    keys: new Set(),
    eToggledOn: false, // edge-triggered E
    flash: null,       // {msg, t} short floating text
  };
  state.totalAnimals = state.forest.filter(i => i.type === 'animal').length;

  // ---------- input ----------
  function canvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  canvas.addEventListener('mousemove', e => {
    const p = canvasPos(e);
    state.mouse.x = p.x; state.mouse.y = p.y;
  });
  canvas.addEventListener('mousedown', e => {
    const p = canvasPos(e);
    state.mouse.x = p.x; state.mouse.y = p.y; state.mouse.down = true;
    // a click in the forest sets walk target
    if (p.y < SPLIT_Y) {
      state.golem.targetX = clamp(p.x + state.camX, 80, WORLD_END - 80);
    }
  });
  canvas.addEventListener('mouseup', () => { state.mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (e.repeat) return; // ignore OS key-repeat for edge-triggered actions
    const k = e.key.toLowerCase();
    state.keys.add(k);
    if (k === 'e') state.eToggledOn = true;
    if (k === 'r') resetLevel();
  });
  window.addEventListener('keyup', e => {
    state.keys.delete(e.key.toLowerCase());
  });

  function resetLevel() {
    state.golem.x = 200; state.golem.targetX = 200; state.golem.holding = null;
    state.sprite.x = W / 2; state.sprite.y = SPLIT_Y + 240; state.sprite.carrying = null;
    state.hearth = HEARTH_MAX * 0.6;
    state.runes = { strength: false, speed: false, sight: true };
    state.chestSeeds.length = 0;
    state.forest = buildForest();
    state.totalAnimals = state.forest.filter(i => i.type === 'animal').length;
    state.rescued = 0;
    state.camX = 0;
    flash('restarted');
  }

  overlay.addEventListener('click', () => {
    overlay.classList.add('hidden');
    state.started = true;
  });

  // ---------- helpers ----------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); }
  function flash(msg) { state.flash = { msg, t: 1.6 }; }

  // ---------- tick ----------
  function tick(dt) {
    state.t += dt;
    if (!state.started) return;

    // --- sprite movement (chest interior) ---
    const s = state.sprite;
    let vx = 0, vy = 0;
    if (state.keys.has('a') || state.keys.has('arrowleft'))  vx -= 1;
    if (state.keys.has('d') || state.keys.has('arrowright')) vx += 1;
    if (state.keys.has('w') || state.keys.has('arrowup'))    vy -= 1;
    if (state.keys.has('s') || state.keys.has('arrowdown'))  vy += 1;
    const mag = Math.hypot(vx, vy);
    if (mag > 0) { vx /= mag; vy /= mag; }
    s.x = clamp(s.x + vx * SPRITE_SPEED * dt, 30, W - 30);
    s.y = clamp(s.y + vy * SPRITE_SPEED * dt, SPLIT_Y + 22, H - 30);
    // trail
    s.trail.push({ x: s.x, y: s.y, life: 0.45 });
    if (s.trail.length > 30) s.trail.shift();
    for (const p of s.trail) p.life -= dt;

    // --- rune toggle (E) ---
    if (state.eToggledOn) {
      state.eToggledOn = false;
      let best = null, bestD = 60;
      for (const r of RUNES) {
        const d = dist(s.x, s.y, r.x, r.y);
        if (d < bestD) { bestD = d; best = r; }
      }
      if (best && state.hearth > 0) {
        state.runes[best.key] = !state.runes[best.key];
        flash(`${best.label} ${state.runes[best.key] ? 'lit' : 'dim'}`);
      } else if (best && state.hearth <= 0) {
        flash(`hearth is cold`);
      }
    }

    // --- seed pickup / hearth feed ---
    // pick up a seed if walking over one and not carrying
    if (!s.carrying) {
      for (const seed of state.chestSeeds) {
        if (!seed.settled) continue;
        if (dist(s.x, s.y, seed.x, seed.y) < 22) {
          s.carrying = seed;
          seed.heldBy = 'sprite';
          break;
        }
      }
    }
    // if carrying, drag the seed with the sprite
    if (s.carrying) {
      s.carrying.x = s.x;
      s.carrying.y = s.y - 12;
    }
    // feed the hearth on overlap
    if (s.carrying && dist(s.x, s.y, HEARTH.x, HEARTH.y) < HEARTH.r + 8) {
      state.hearth = clamp(state.hearth + SEED_VALUE, 0, HEARTH_MAX);
      // remove the seed
      const i = state.chestSeeds.indexOf(s.carrying);
      if (i >= 0) state.chestSeeds.splice(i, 1);
      s.carrying = null;
      flash('+fuel');
    }

    // animate falling seeds
    for (const seed of state.chestSeeds) {
      if (seed.settled) continue;
      seed.vy = (seed.vy || 0) + 600 * dt;
      seed.y += seed.vy * dt;
      // settled when reaches landing y (and add slight random offset to spread)
      if (seed.y >= seed.landY) {
        seed.y = seed.landY;
        seed.settled = true;
        seed.vy = 0;
      }
    }

    // --- hearth drain ---
    let drain = 0;
    for (const r of RUNES) if (state.runes[r.key]) drain += BURN[r.key];
    state.hearth = clamp(state.hearth - drain * dt, 0, HEARTH_MAX);
    if (state.hearth <= 0) {
      // force runes off
      if (state.runes.strength || state.runes.speed || state.runes.sight) {
        flash('hearth out — runes dim');
      }
      state.runes.strength = state.runes.speed = state.runes.sight = false;
    }

    // --- golem walking ---
    const g = state.golem;
    const speed = state.runes.speed ? FAST_SPEED : SLOW_SPEED;
    const dx = g.targetX - g.x;
    if (Math.abs(dx) > 2) {
      const step = clamp(dx, -speed * dt, speed * dt);
      // boulder collision: if a boulder is blocking the path, stop just short.
      const dir = Math.sign(step);
      let next = g.x + step;
      for (const item of state.forest) {
        if (item.type !== 'boulder' || item.state !== 'idle') continue;
        const halfW = 28;
        // moving right and boulder is ahead
        if (dir > 0 && item.x > g.x && item.x - halfW < next + 40) {
          next = item.x - halfW - 40;
        } else if (dir < 0 && item.x < g.x && item.x + halfW > next - 40) {
          next = item.x + halfW + 40;
        }
      }
      g.x = clamp(next, 80, WORLD_END - 80);
      g.facing = dir >= 0 ? 1 : -1;
      g.walkPhase += Math.abs(speed) * dt * 0.03;
    }

    // --- arm reach logic ---
    // The golem reaches when the mouse is held down over an interactable in range,
    // OR when carrying something and mouse held — drop targeting is "release over chute".
    const wantingArm = state.mouse.down && state.mouse.y < SPLIT_Y;
    const mouseWorld = { x: state.mouse.x + state.camX, y: state.mouse.y };

    if (wantingArm) {
      g.armReachT = clamp(g.armReachT + dt * 4, 0, 1);
      if (!g.holding) {
        // find nearest interactable item in reach of golem's hand at full extension
        let best = null, bestD = ARM_REACH;
        for (const item of state.forest) {
          if (item.state !== 'idle') continue;
          const d = dist(g.x, GROUND_Y - 40, item.x, item.y);
          const mouseClose = dist(mouseWorld.x, mouseWorld.y, item.x, item.y);
          if (d < bestD && mouseClose < 90) { bestD = d; best = item; }
        }
        g.armTarget = best;
        if (best && g.armReachT > 0.85) {
          // attempt to lift
          if (best.type === 'boulder' && !state.runes.strength) {
            // bounce — fail
            best.wobble = 0.6;
            g.bumpT = 0.25;
            flash('needs STR');
          } else if (best.type === 'animal' && !state.runes.strength) {
            best.wobble = 0.4;
            g.bumpT = 0.2;
            flash('needs STR (gentle)');
          } else {
            g.holding = best;
            best.state = 'held';
          }
        }
      } else {
        // already holding — extend arm toward mouse (releasing happens on mouseup)
        g.armTarget = null;
      }
    } else {
      g.armReachT = clamp(g.armReachT - dt * 6, 0, 1);
      // release on mouseup if holding
      if (g.holding && g.armReachT < 0.05) {
        // (handled below on actual mouseup)
      }
    }

    // bump animation timer
    if (g.bumpT > 0) g.bumpT = Math.max(0, g.bumpT - dt);
    // wobble decay on idle items
    for (const item of state.forest) if (item.wobble > 0) item.wobble = Math.max(0, item.wobble - dt * 1.5);

    // --- release logic when mouse goes up while holding ---
    if (!state.mouse.down && g.holding) {
      const held = g.holding;
      const releaseScreenX = state.mouse.x; // where to release
      const releaseScreenY = state.mouse.y;
      // case A: released over the chute (anywhere in screen-x near golem, in upper third just above split)
      const chuteScreenX = g.x - state.camX;
      const overChute = releaseScreenY > SPLIT_Y - 70 && Math.abs(releaseScreenX - chuteScreenX) < 60;
      if (held.type === 'seed' && overChute) {
        // drop into chest
        state.chestSeeds.push({
          x: CHUTE_LANDING.x + (Math.random() - 0.5) * 60,
          y: CHUTE_LANDING.y - 80,
          landY: CHUTE_LANDING.y + (Math.random() - 0.5) * 18,
          vy: 0,
          settled: false,
        });
        held.state = 'gone';
        g.holding = null;
        flash('seed dropped');
      } else if (held.type === 'animal') {
        // release the animal — if near the Spirit Tree, count as rescued
        const treeX = WORLD_END - 60;
        if (Math.abs(g.x - treeX) < 200) {
          held.state = 'rescued';
          held.x = treeX - 30;
          held.y = GROUND_Y - 18;
          state.rescued++;
          g.holding = null;
          flash('rescued!');
        } else {
          // set down
          held.state = 'idle';
          held.x = g.x + g.facing * 50;
          held.y = GROUND_Y - 10;
          g.holding = null;
        }
      } else if (held.type === 'boulder') {
        // toss aside off-path (slightly behind golem)
        held.state = 'gone';
        g.holding = null;
        flash('boulder cleared');
      } else if (held.type === 'seed') {
        // dropped somewhere other than chute — put back on the ground
        held.state = 'idle';
        held.x = g.x + g.facing * 40;
        held.y = GROUND_Y - 10;
        g.holding = null;
      }
    }

    // held item follows the golem's hand (above its head)
    if (g.holding) {
      g.holding.x = g.x;
      g.holding.y = GROUND_Y - 110;
    }

    // --- camera ---
    state.camX = clamp(g.x - W / 2, 0, WORLD_END - W);

    // flash timer
    if (state.flash) {
      state.flash.t -= dt;
      if (state.flash.t <= 0) state.flash = null;
    }
  }

  // ---------- render ----------
  function render() {
    // --- top half: forest ---
    drawForest();
    // --- bottom half: chest interior ---
    drawChest();
    // --- HUD ---
    drawHUD();
    // splash if not started — overlay handles that
  }

  function drawForest() {
    // sky/mist gradient
    const grd = ctx.createLinearGradient(0, 0, 0, SPLIT_Y);
    grd.addColorStop(0, '#16243a');
    grd.addColorStop(0.5, '#2c4760');
    grd.addColorStop(1, '#4a6b6c');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, SPLIT_Y);

    // distant parallax tree silhouettes
    drawTreeBand(0.25, '#1c2a3a', 70, 130);
    drawTreeBand(0.55, '#2a3a47', 90, 170);
    drawTreeBand(0.85, '#384b58', 110, 210);

    // ground line
    ctx.fillStyle = '#3b5249';
    ctx.fillRect(0, GROUND_Y, W, SPLIT_Y - GROUND_Y);
    ctx.fillStyle = '#2c3d36';
    ctx.fillRect(0, GROUND_Y, W, 3);

    // mist drift (animated)
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 6; i++) {
      const x = ((i * 200 + state.t * 18 + (i * 73)) % (W + 240)) - 120;
      const y = 80 + i * 35;
      ctx.fillStyle = '#cfe4dc';
      ctx.beginPath();
      ctx.ellipse(x, y, 110, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Spirit Tree at world end
    const treeScreenX = (WORLD_END - 60) - state.camX;
    if (treeScreenX > -100 && treeScreenX < W + 100) {
      ctx.save();
      ctx.translate(treeScreenX, GROUND_Y);
      const pulse = 0.85 + 0.15 * Math.sin(state.t * 1.6);
      // glow halo
      const halo = ctx.createRadialGradient(0, -80, 6, 0, -80, 140);
      halo.addColorStop(0, `rgba(255,220,140,${0.55 * pulse})`);
      halo.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-140, -220, 280, 220);
      // trunk
      ctx.fillStyle = '#5b4a36';
      ctx.fillRect(-12, -90, 24, 90);
      // canopy
      ctx.fillStyle = '#7eb273';
      ctx.beginPath();
      ctx.arc(0, -115, 50, 0, Math.PI * 2);
      ctx.arc(-32, -90, 38, 0, Math.PI * 2);
      ctx.arc(28, -92, 40, 0, Math.PI * 2);
      ctx.fill();
      // glowing motes
      for (let i = 0; i < 5; i++) {
        const a = state.t * 1.3 + i;
        ctx.fillStyle = `rgba(255,235,170,${0.7 * pulse})`;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 26, -110 + Math.sin(a) * 18, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // world items
    for (const item of state.forest) {
      if (item.state === 'gone') continue;
      if (item.state === 'held') continue; // drawn with golem
      const sx = item.x - state.camX;
      if (sx < -60 || sx > W + 60) continue;
      drawItem(item, sx, item.y);
    }

    // golem
    drawGolem();

    // held item (if any) — drawn after golem so it's over the head
    if (state.golem.holding) {
      const it = state.golem.holding;
      drawItem(it, it.x - state.camX, it.y);
    }

    // chute outline shown when carrying a seed (hint where to drop)
    if (state.golem.holding && state.golem.holding.type === 'seed') {
      const cx = state.golem.x - state.camX;
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(state.t * 6);
      ctx.strokeStyle = '#ffb46a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(cx - 36, SPLIT_Y - 60, 72, 60);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffb46a';
      ctx.font = '11px ui-rounded, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('drop here', cx, SPLIT_Y - 66);
      ctx.restore();
    }

    // arm reach cursor hint when mouse over interactable
    if (!state.mouse.down && state.mouse.y < SPLIT_Y) {
      const mw = state.mouse.x + state.camX;
      for (const item of state.forest) {
        if (item.state !== 'idle') continue;
        const d = dist(state.golem.x, GROUND_Y - 40, item.x, item.y);
        if (d < ARM_REACH && dist(mw, state.mouse.y, item.x, item.y) < 60) {
          ctx.save();
          ctx.strokeStyle = '#ffd089';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(item.x - state.camX, item.y - 6, 22, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
          break;
        }
      }
    }
  }

  function drawTreeBand(parallax, color, minH, maxH) {
    ctx.fillStyle = color;
    const offset = -(state.camX * parallax) % 160;
    for (let i = -1; i < W / 160 + 2; i++) {
      const x = i * 160 + offset;
      const h = minH + ((i * 53) % (maxH - minH));
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y);
      ctx.lineTo(x + 40, GROUND_Y - h);
      ctx.lineTo(x + 80, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawItem(item, sx, sy) {
    const sightOn = state.runes.sight;
    const wob = Math.sin(state.t * 14) * item.wobble * 6;
    ctx.save();
    ctx.translate(sx + wob, sy);
    if (item.type === 'seed') {
      // glowing fire-seed
      const dim = sightOn ? 1.0 : 0.35;
      const pulse = 0.7 + 0.3 * Math.sin(state.t * 4 + item.x * 0.01);
      const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
      halo.addColorStop(0, `rgba(255,180,80,${0.85 * dim * pulse})`);
      halo.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-30, -30, 60, 60);
      ctx.fillStyle = `rgba(255,220,140,${dim})`;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,130,50,${dim})`;
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    } else if (item.type === 'boulder') {
      ctx.fillStyle = '#6b6a6a';
      ctx.beginPath();
      ctx.ellipse(0, -2, 30, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4d4c4c';
      ctx.beginPath();
      ctx.ellipse(0, 16, 32, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a8888';
      ctx.beginPath();
      ctx.ellipse(-10, -8, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (item.type === 'animal') {
      const dim = sightOn ? 1.0 : 0.4;
      if (item.state === 'rescued') {
        // little glow next to the spirit tree
        const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
        halo.addColorStop(0, 'rgba(255,235,170,0.6)');
        halo.addColorStop(1, 'rgba(255,235,170,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(-20, -20, 40, 40);
      }
      ctx.globalAlpha = dim;
      ctx.font = '22px serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.species || '🐾', 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawGolem() {
    const g = state.golem;
    const sx = g.x - state.camX;
    const sy = g.y;
    const bump = g.bumpT > 0 ? Math.sin(g.bumpT * 60) * 3 : 0;
    const stepBob = Math.sin(g.walkPhase * 8) * 2;
    ctx.save();
    ctx.translate(sx + bump, sy);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 8, 50, 8, 0, 0, Math.PI * 2); ctx.fill();

    // legs
    ctx.fillStyle = '#7d8a8b';
    const legOff = Math.sin(g.walkPhase * 8) * 6;
    ctx.fillRect(-22, -40, 16, 40 + legOff);
    ctx.fillRect(6, -40, 16, 40 - legOff);

    // torso (the chest cavity — important visual cue)
    ctx.fillStyle = '#8c9899';
    ctx.fillRect(-36, -100 + stepBob, 72, 70);
    // chest "opening" — same color as the chest interior to hint at the connection
    ctx.fillStyle = '#3c2c1f';
    ctx.fillRect(-22, -82 + stepBob, 44, 32);
    // little hearth glow visible through the opening
    const hearthGlow = state.hearth / HEARTH_MAX;
    const ghalo = ctx.createRadialGradient(0, -66 + stepBob, 2, 0, -66 + stepBob, 26);
    ghalo.addColorStop(0, `rgba(255,150,60,${0.85 * hearthGlow})`);
    ghalo.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = ghalo;
    ctx.fillRect(-30, -90 + stepBob, 60, 40);

    // chute (above the chest opening)
    ctx.fillStyle = '#5a4738';
    ctx.fillRect(-8, -100 + stepBob, 16, 8);

    // head
    ctx.fillStyle = '#9aa6a6';
    ctx.fillRect(-22, -130 + stepBob, 44, 30);
    // eyes — brighter when SIGHT lit
    const eyeOn = state.runes.sight;
    ctx.fillStyle = eyeOn ? '#ffeaa0' : '#322';
    ctx.fillRect(-12 + (g.facing > 0 ? 2 : -2), -118 + stepBob, 6, 4);
    ctx.fillRect(6 + (g.facing > 0 ? 2 : -2), -118 + stepBob, 6, 4);

    // arm — kinematic, reaches toward mouse-world
    const armBaseX = g.facing > 0 ? 32 : -32;
    const armBaseY = -78 + stepBob;
    let targetX, targetY;
    if (g.holding) {
      // hold target above the head
      targetX = 0;
      targetY = -150;
    } else if (g.armTarget) {
      targetX = g.armTarget.x - g.x;
      targetY = g.armTarget.y - sy;
    } else {
      // rest pose
      targetX = armBaseX * 0.4;
      targetY = -50;
    }
    const reach = state.golem.armReachT;
    const handX = lerp(armBaseX, targetX, reach);
    const handY = lerp(armBaseY, targetY, reach);
    // arm as a thick line + joint
    ctx.strokeStyle = '#8c9899';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armBaseX, armBaseY);
    const midX = (armBaseX + handX) / 2 + (g.facing > 0 ? 6 : -6);
    const midY = (armBaseY + handY) / 2 + 10;
    ctx.lineTo(midX, midY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    // hand
    ctx.fillStyle = '#a8b3b3';
    ctx.beginPath();
    ctx.arc(handX, handY, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawChest() {
    // chest interior background — warm dark wood-stone
    const grd = ctx.createLinearGradient(0, SPLIT_Y, 0, H);
    grd.addColorStop(0, '#1a1310');
    grd.addColorStop(1, '#0d0807');
    ctx.fillStyle = grd;
    ctx.fillRect(0, SPLIT_Y, W, H - SPLIT_Y);

    // top edge — inside view of the chest cavity ceiling
    ctx.fillStyle = '#2a1f18';
    ctx.fillRect(0, SPLIT_Y, W, 14);
    // ribs of the chest interior
    ctx.strokeStyle = '#3a2c22';
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo((i * W) / 8, SPLIT_Y + 14);
      ctx.lineTo((i * W) / 8, H - 2);
      ctx.stroke();
    }
    // walls (left & right curve in)
    ctx.fillStyle = '#1a120e';
    ctx.beginPath();
    ctx.moveTo(0, SPLIT_Y);
    ctx.quadraticCurveTo(60, SPLIT_Y + CHEST_H / 2, 0, H);
    ctx.lineTo(0, SPLIT_Y);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, SPLIT_Y);
    ctx.quadraticCurveTo(W - 60, SPLIT_Y + CHEST_H / 2, W, H);
    ctx.lineTo(W, SPLIT_Y);
    ctx.fill();

    // chute opening (where seeds enter)
    ctx.fillStyle = '#3b2a1c';
    ctx.fillRect(CHUTE_LANDING.x - 28, SPLIT_Y + 4, 56, 18);
    ctx.fillStyle = 'rgba(255,200,120,0.18)';
    ctx.fillRect(CHUTE_LANDING.x - 28, SPLIT_Y + 4, 56, 6);

    // hearth
    drawHearth();

    // runes
    for (const r of RUNES) drawRune(r);

    // falling / settled seeds
    for (const seed of state.chestSeeds) {
      if (state.sprite.carrying === seed) continue;
      drawChestSeed(seed.x, seed.y, seed.settled);
    }

    // sprite trail
    for (const p of state.sprite.trail) {
      if (p.life <= 0) continue;
      ctx.fillStyle = `rgba(255,180,90,${p.life * 0.4})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    // sprite
    drawSprite();

    // sprite carrying a seed — draw the seed glow above
    if (state.sprite.carrying) {
      drawChestSeed(state.sprite.carrying.x, state.sprite.carrying.y, true);
    }
  }

  function drawHearth() {
    const fill = state.hearth / HEARTH_MAX;
    const flame = (0.7 + 0.3 * Math.sin(state.t * 22 + Math.sin(state.t * 7) * 2)) * fill;

    // stone ring
    ctx.fillStyle = '#3a2a20';
    ctx.beginPath();
    ctx.arc(HEARTH.x, HEARTH.y + 12, HEARTH.r + 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c120c';
    ctx.beginPath();
    ctx.arc(HEARTH.x, HEARTH.y + 12, HEARTH.r + 6, 0, Math.PI * 2);
    ctx.fill();

    // outer glow halo
    const halo = ctx.createRadialGradient(HEARTH.x, HEARTH.y, 6, HEARTH.x, HEARTH.y, 220);
    halo.addColorStop(0, `rgba(255,160,60,${0.5 * flame})`);
    halo.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(HEARTH.x - 220, HEARTH.y - 220, 440, 440);

    // flame body
    if (fill > 0.02) {
      ctx.fillStyle = `rgba(255,160,40,${0.9 * fill})`;
      ctx.beginPath();
      ctx.ellipse(HEARTH.x, HEARTH.y, HEARTH.r * fill, HEARTH.r * 1.2 * fill, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,220,120,${flame})`;
      ctx.beginPath();
      ctx.ellipse(HEARTH.x, HEARTH.y - 4, HEARTH.r * 0.55 * fill, HEARTH.r * 0.9 * fill, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,200,${flame * 0.9})`;
      ctx.beginPath();
      ctx.ellipse(HEARTH.x, HEARTH.y - 8, HEARTH.r * 0.25 * fill, HEARTH.r * 0.5 * fill, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // hearth fuel bar (above the hearth)
    ctx.fillStyle = '#2a1d14';
    ctx.fillRect(HEARTH.x - 50, HEARTH.y - 64, 100, 8);
    ctx.fillStyle = '#ffb46a';
    ctx.fillRect(HEARTH.x - 50, HEARTH.y - 64, 100 * fill, 8);
    ctx.strokeStyle = '#5a3e26';
    ctx.strokeRect(HEARTH.x - 50, HEARTH.y - 64, 100, 8);

    // label
    ctx.fillStyle = 'rgba(255,210,140,0.8)';
    ctx.font = '11px ui-rounded, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HEARTH', HEARTH.x, HEARTH.y - 70);
  }

  function drawRune(r) {
    const lit = state.runes[r.key];
    const near = dist(state.sprite.x, state.sprite.y, r.x, r.y) < 60;
    const pulse = 0.7 + 0.3 * Math.sin(state.t * 4 + r.x);
    ctx.save();
    ctx.translate(r.x, r.y);

    // outer halo
    if (lit) {
      const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 70);
      halo.addColorStop(0, `rgba(255,180,80,${0.55 * pulse})`);
      halo.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-70, -70, 140, 140);
    }
    // carved stone disc
    ctx.fillStyle = '#241914';
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lit ? '#3a2616' : '#1a120e';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    // glyph
    ctx.fillStyle = lit ? `rgba(255,200,110,${pulse})` : '#5a4a3c';
    ctx.font = '22px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(r.glyph, 0, 1);
    // label
    ctx.fillStyle = lit ? '#ffd089' : '#7d6a55';
    ctx.font = '10px ui-rounded, sans-serif';
    ctx.fillText(r.label, 0, 38);
    // proximity hint
    if (near) {
      ctx.strokeStyle = '#ffd089';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd089';
      ctx.font = '10px ui-rounded, sans-serif';
      ctx.fillText('[E]', 0, -36);
    }
    ctx.restore();
  }

  function drawChestSeed(x, y, settled) {
    const pulse = 0.7 + 0.3 * Math.sin(state.t * 6 + x * 0.05);
    const halo = ctx.createRadialGradient(x, y, 2, x, y, 22);
    halo.addColorStop(0, `rgba(255,180,80,${0.85 * pulse})`);
    halo.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(x - 22, y - 22, 44, 44);
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
    // body glow
    const halo = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, 28);
    halo.addColorStop(0, `rgba(255,210,130,${0.85 * flick})`);
    halo.addColorStop(1, 'rgba(255,210,130,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(s.x - 28, s.y - 28, 56, 56);
    // little flame
    ctx.fillStyle = `rgba(255,160,60,${flick})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, 6, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,200,${flick})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - 3, 3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // wings/sparkles
    for (let i = 0; i < 3; i++) {
      const a = state.t * 6 + i * 2.1;
      ctx.fillStyle = `rgba(255,230,150,${0.6 * flick})`;
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(a) * 11, s.y + Math.sin(a) * 11, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHUD() {
    // hearth bar + runes (top right)
    const padX = 12, padY = 12, barW = 200, barH = 12;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W - barW - 24, padY - 8, barW + 16, 70);
    ctx.fillStyle = '#3a2616';
    ctx.fillRect(W - barW - 16, padY, barW, barH);
    ctx.fillStyle = '#ffb46a';
    ctx.fillRect(W - barW - 16, padY, barW * (state.hearth / HEARTH_MAX), barH);
    ctx.strokeStyle = '#5a3e26';
    ctx.strokeRect(W - barW - 16, padY, barW, barH);
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '11px ui-rounded, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('hearth', W - barW - 16, padY - 2);

    // rune dots
    const xs = [W - barW - 16, W - barW + 50, W - barW + 110];
    const ks = ['strength', 'speed', 'sight'];
    const ls = ['STR', 'SPD', 'SEE'];
    for (let i = 0; i < 3; i++) {
      const lit = state.runes[ks[i]];
      ctx.fillStyle = lit ? '#ffd089' : '#5a4a3c';
      ctx.beginPath();
      ctx.arc(xs[i] + 8, padY + barH + 24, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lit ? '#ffd089' : '#8a7a64';
      ctx.fillText(ls[i], xs[i] + 20, padY + barH + 28);
    }
    ctx.restore();

    // score (rescued/total) — bottom right
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W - 160, H - 36, 148, 24);
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '13px ui-rounded, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`rescued  ${state.rescued} / ${state.totalAnimals}`, W - 18, H - 18);
    ctx.restore();

    // distance / spirit-tree indicator — top center
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
    ctx.beginPath();
    ctx.arc(W / 2 + trackW / 2, 20, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '10px ui-rounded, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Golem → Spirit Tree', W / 2, 40);
    ctx.restore();

    // flash text
    if (state.flash) {
      ctx.save();
      ctx.globalAlpha = clamp(state.flash.t, 0, 1);
      ctx.fillStyle = '#ffd089';
      ctx.font = '14px ui-rounded, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.flash.msg, W / 2, SPLIT_Y - 8);
      ctx.restore();
    }

    // end of forest message
    if (state.golem.x >= WORLD_END - 200 && state.rescued >= state.totalAnimals) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(W / 2 - 200, 60, 400, 60);
      ctx.fillStyle = '#ffe9a8';
      ctx.font = '20px ui-rounded, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('all friends home — the forest is humming', W / 2, 96);
      ctx.restore();
    }
  }

  // ---------- loop ----------
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
