// Bloom & Burrow — authoritative simulation, prototype 3.
//
// The core bet: both players sculpt living flows.
//  - Bloom draws pheromone trails that evaporate unless ant traffic reinforces
//    them (real stigmergy): a living road network that needs gardening.
//  - Burrow digs tunnels that water actually flows through: rain pours in at
//    the entrance, falls, pools and spreads. Architecture is survival.

'use strict';

// The nest is DEEP, not wide — a vertical cut through the anthill. This is
// portrait-shaped on purpose, and coarse on purpose: fewer, bigger cells so
// every dig is a decision and every square is a fat touch target.
const GRID = { cols: 12, rows: 18 };
const FROST_ROWS = 2;    // baseline frost; in winter it creeps deeper (see frostDepth)
const MELT_ROW = 14;     // cells this deep seep groundwater in spring
const QUEEN_SPEED = 0.8; // cells/s when carried to a new chamber
const ENTRANCE = { c: 0, r: 0 };
const WORLD = { w: 1000, h: 620 };
const DOCK_POINT = { x: WORLD.w - 25, y: 310 };
const DOCK_CAP = 15;

const ANT_SPEED_OUT = 115;   // px/s in the meadow
const ANT_SPEED_IN = 2.8;    // cells/s underground
const HARVEST_TIME = 1.5, DIG_TIME = 1.2, HAUL_LOAD = 2;
const EGG_COST = 4, EGG_TIME = 20, EGGS_PER_NURSERY = 3;
const STORE_PER_CELL = 25;
const EAT_PER_ANT = 0.013, EAT_QUEEN = 0.12, WINTER_EAT_MULT = 2.5;
const FREEZE_LIMIT = 6;
const MAX_SOURCES = 11;

// pheromone economy — tuned so a shared spine + short twigs beats straight
// spokes: strokes are cheap, budget is scarce, traffic flows down the tree.
const PHER_MAX = 100, PHER_REGEN = 1.8, PHER_COST_PER_PX = 0.1;
const TRAIL_MAX = 12;
const TRAIL_DECAY = 0.018;        // per second, untouched trail lives ~55s
const TRAIL_REINFORCE = 0.07;     // per delivered good, applied to the WHOLE chain
const TRAIL_RAIN_HIT = 0.35;      // instant loss when a rain event starts
const TRAIL_PICKUP_R = 40;        // px: source counts as "on" a trail (generous — near misses count)
const GATE_COST = 5;

// water
const QUEEN_DROWN_TIME = 8;
const ANT_DROWN_TIME = 5;

const SEASONS = [
  { name: 'Spring', len: 55, events: [{ t: 12, dur: 3, kind: 'rain', rate: 0.24 }] },
  { name: 'Summer', len: 55, events: [{ t: 18, dur: 8, kind: 'drought' }, { t: 38, dur: 8, kind: 'drought' }] },
  { name: 'Autumn', len: 45, events: [{ t: 6, dur: 5, kind: 'rain', rate: 0.42 }, { t: 18, dur: 5, kind: 'rain', rate: 0.42 }, { t: 30, dur: 5, kind: 'rain', rate: 0.42 }] },
  { name: 'Winter', len: 25, events: [] },
];
// in winter the frost creeps downward: from row 2 at first snow to row ~7 at
// the season's end — the queen must be carried below it, brood pauses above it
function frostDepth(g) {
  if (SEASONS[g.seasonIdx].name !== 'Winter') return FROST_ROWS;
  return FROST_ROWS + (g.seasonT / SEASONS[3].len) * 5;
}

let TOAST_SEQ = 1;
let SOURCE_SEQ = 1;
let TRAIL_SEQ = 1;

// ---------- construction ----------
function createGame() {
  const g = {
    year: 1, seasonIdx: 0, seasonT: 0,
    grid: [], water: [], ants: [], sources: [], eggs: [], digs: [], trails: [], toasts: [],
    store: { sugar: 14, protein: 6 },
    dock: { sugar: 0, protein: 0 },
    desiredOutside: 4, recall: false,
    pher: PHER_MAX,
    queenHP: 100, starving: false, starveT: 0, queenDrownT: 0,
    sourceTimer: 0, rebalanceT: 0, spreadFlip: false,
    raining: false, rainRate: 0, drought: false,
    lastCap: 0, capToastT: 0,
    queen: { x: 4.5, y: 2.5, path: [] },   // the queen is movable — carry her with the seasons
    queenCell: { c: 4, r: 2 },
    frostToasted: false,
    gameOver: false, overMsg: '',
  };
  for (let r = 0; r < GRID.rows; r++) {
    g.grid.push(Array.from({ length: GRID.cols }, () => ({ dug: false, kind: null, closed: false })));
    g.water.push(new Array(GRID.cols).fill(0));
  }
  // starter nest: entrance corridor, a small drainage sump under it, queen deeper in
  const predug = [
    [0,0],[1,0],[2,0],[3,0],[4,0],       // entrance corridor
    [1,1],[1,2],[1,3],                   // starter sump (catches rain water)
    [4,1],[4,2],[3,2],[3,3],[5,2],[5,3], // living quarters
  ];
  for (const [c, r] of predug) g.grid[r][c].dug = true;
  g.grid[2][5].kind = 'stockpile';
  g.grid[3][5].kind = 'stockpile';
  g.grid[3][3].kind = 'nursery';
  g.lastCap = stockCap(g);

  for (let i = 0; i < 4; i++) g.ants.push(newAnt(g, 'out'));
  for (let i = 0; i < 4; i++) g.ants.push(newAnt(g, 'in'));
  for (let i = 0; i < 6; i++) spawnSource(g);
  toast(g, 'Year 1 — Spring. Draw trails from the dock to food!', false, 'bloom');
  toast(g, 'Year 1 — Spring. Rain will pour in at the entrance — mind your sump.', false, 'burrow');
  return g;
}

function newAnt(g, side) {
  const a = {
    side, state: side === 'out' ? 'idleOut' : 'idleIn',
    x: 0, y: 0, path: [], carry: null, dig: null,
    trailId: 0, s: 0, targetS: 0, dir: 1,
    timer: 0, freeze: 0, drown: 0, wx: 0, wy: 0, wt: 0,
  };
  if (side === 'out') {
    a.x = DOCK_POINT.x - 40 - Math.random() * 60;
    a.y = DOCK_POINT.y + (Math.random() - 0.5) * 80;
  } else {
    a.x = 3.5 + (Math.random() - 0.5) * 0.4;
    a.y = 0.5;
  }
  return a;
}

// ---------- helpers ----------
function season(g) { return SEASONS[g.seasonIdx]; }
function eventScale(g) { return 1 + 0.35 * (g.year - 1); }
function cellOf(x, y) {
  return {
    c: Math.max(0, Math.min(GRID.cols - 1, Math.floor(x))),
    r: Math.max(0, Math.min(GRID.rows - 1, Math.floor(y))),
  };
}
function waterOpen(g, c, r) { // can water occupy/flow through this cell?
  if (c < 0 || r < 0 || c >= GRID.cols || r >= GRID.rows) return false;
  const cell = g.grid[r][c];
  if (!cell.dug) return false;
  if (cell.kind === 'gate' && cell.closed) return false;
  return true;
}
function passable(g, c, r) { // can an ant walk here?
  if (!waterOpen(g, c, r)) return false;
  return g.water[r][c] <= 0.5;
}
function stockCap(g) {
  let n = 0;
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) {
    const cell = g.grid[r][c];
    if (cell.kind === 'stockpile' && cell.dug && g.water[r][c] <= 0.5) n++;
  }
  return n * STORE_PER_CELL;
}
function storeTotal(g) { return g.store.sugar + g.store.protein; }
function dockTotal(g) { return g.dock.sugar + g.dock.protein; }
function gateCount(g) {
  let n = 0;
  for (const row of g.grid) for (const cell of row) if (cell.kind === 'gate') n++;
  return n;
}
function maxGates(g) { return 2 + (g.year - 1); }
function score(g) {
  return (g.year - 1) * 20 + g.ants.length * 2 + Math.floor(storeTotal(g) / 5);
}
function toast(g, msg, bad, role) {
  g.toasts.push({ id: TOAST_SEQ++, msg, bad: !!bad, role: role || 'all' });
  if (g.toasts.length > 12) g.toasts.shift();
}
function moveToward(a, tx, ty, speed, dt, snap) {
  const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
  if (d < snap) { a.x = tx; a.y = ty; return true; }
  a.x += (dx / d) * speed * dt;
  a.y += (dy / d) * speed * dt;
  return false;
}
function bfs(g, start, goalTest) {
  const key = (c, r) => r * GRID.cols + c;
  const prev = new Map();
  const q = [start];
  prev.set(key(start.c, start.r), null);
  while (q.length) {
    const cur = q.shift();
    if (goalTest(cur.c, cur.r)) {
      const path = [];
      let k = cur;
      while (k) { path.unshift(k); k = prev.get(key(k.c, k.r)); }
      path.shift();
      return path;
    }
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const c = cur.c + dc, r = cur.r + dr;
      if (!passable(g, c, r) || prev.has(key(c, r))) continue;
      prev.set(key(c, r), cur);
      q.push({ c, r });
    }
  }
  return null;
}
function followPath(g, a, dt) {
  if (!a.path.length) return true;
  const t = a.path[0];
  if (moveToward(a, t.c + 0.5, t.r + 0.5, ANT_SPEED_IN, dt, 0.08)) a.path.shift();
  return a.path.length === 0;
}
function goIdleIn(a) { a.state = 'idleIn'; a.path = []; a.dig = null; }

// ---------- trails ----------
function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}
function buildTrail(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}
function trailPos(t, s) {
  s = Math.max(0, Math.min(t.len, s));
  let i = 1;
  while (i < t.cum.length && t.cum[i] < s) i++;
  if (i >= t.pts.length) return t.pts[t.pts.length - 1];
  const a = t.pts[i - 1], b = t.pts[i];
  const seg = t.cum[i] - t.cum[i - 1] || 1;
  const f = (s - t.cum[i - 1]) / seg;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
function trailById(g, id) { return g.trails.find(t => t.id === id); }
// a delivery strengthens the used stroke AND every ancestor down to the dock —
// this is what makes trunk-and-twig networks beat straight spokes
function reinforceChain(g, t, amount) {
  let cur = t, guard = 0;
  while (cur && guard++ < 30) {
    cur.strength = Math.min(1, cur.strength + amount);
    cur = cur.parentId ? trailById(g, cur.parentId) : null;
  }
}
// s-positions where this trail passes near each source
function computeTrailSources(g, t) {
  t.srcS = [];
  for (const src of g.sources) {
    for (let i = 0; i < t.pts.length; i++) {
      if (Math.hypot(t.pts[i].x - src.x, t.pts[i].y - src.y) <= TRAIL_PICKUP_R) {
        t.srcS.push({ id: src.id, s: t.cum[i] });
        break;
      }
    }
  }
  t.srcS.sort((a, b) => a.s - b.s);
}
function trailHasFood(g, t) {
  return t.srcS.some(e => { const s = srcById(g, e.id); return s && s.amt > 0; });
}
function removeTrail(g, id) {
  // removing a stroke takes its whole subtree with it — no path home, no trail
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of g.trails) {
      if (!doomed.has(t.id) && doomed.has(t.parentId)) { doomed.add(t.id); grew = true; }
    }
  }
  if (!g.trails.some(t => doomed.has(t.id))) return;
  g.trails = g.trails.filter(t => !doomed.has(t.id));
  for (const a of g.ants) {
    if (a.side === 'out' && doomed.has(a.trailId) && (a.state === 'trailOut' || a.state === 'trailBack' || a.state === 'harvest')) {
      a.trailId = 0;
      a.state = 'freeBack';
    }
  }
}

// ---------- sources ----------
function srcById(g, id) { return g.sources.find(s => s.id === id); }
function spawnSource(g) {
  if (g.sources.filter(s => s.amt > 0).length >= MAX_SOURCES) return;
  const minD = Math.min(120 + 70 * (g.year - 1), 550);
  // sometimes seed the OPPOSITE food type near an existing source, so a single
  // clever route through both lets ants fill both paws in one trip
  const alive = g.sources.filter(s => s.amt > 0);
  const anchor = alive.length && Math.random() < 0.45
    ? alive[Math.floor(Math.random() * alive.length)] : null;
  const type = anchor
    ? (anchor.type === 'nectar' ? 'carcass' : 'nectar')
    : (Math.random() < 0.66 ? 'nectar' : 'carcass');
  for (let tries = 0; tries < 30; tries++) {
    let x, y;
    if (anchor) {
      const ang = Math.random() * Math.PI * 2, dist = 95 + Math.random() * 120;
      x = anchor.x + Math.cos(ang) * dist;
      y = anchor.y + Math.sin(ang) * dist;
      if (x < 40 || x > WORLD.w - 100 || y < 45 || y > WORLD.h - 45) continue;
    } else {
      x = 40 + Math.random() * (WORLD.w - 140);
      y = 45 + Math.random() * (WORLD.h - 90);
    }
    const d = Math.hypot(x - DOCK_POINT.x, y - DOCK_POINT.y);
    if (d < minD * (anchor ? 0.7 : 1) || d > 980) continue;
    if (g.sources.some(s => s.amt > 0 && Math.hypot(s.x - x, s.y - y) < 80)) continue;
    // richness scales hard with distance: near the pit you find scraps that
    // drain fast (trails there die and must be redrawn), far out sit feasts
    // worth one long, permanent trail. Going high pays; staying low leaks
    // pheromone on constant redrawing.
    const src = {
      id: SOURCE_SEQ++, x, y, type,
      amt: (type === 'nectar' ? 3 : 2) + Math.min(14, Math.round(d / 75)),
    };
    g.sources.push(src);
    for (const t of g.trails) computeTrailSources(g, t);
    return;
  }
}

// ---------- seasons & weather ----------
function applySeasonStart(g) {
  const name = season(g).name;
  if (name === 'Spring') {
    g.year++;
    toast(g, `Year ${g.year} — Spring! Score so far: ${score(g)}.`, false, 'all');
    for (let i = 0; i < 4; i++) spawnSource(g);
  } else if (name === 'Summer') {
    toast(g, 'Summer — peak foraging, but droughts will bake your trails.', false, 'bloom');
    toast(g, 'Summer — the nest dries out. Good time to dig.', false, 'burrow');
  } else if (name === 'Autumn') {
    toast(g, 'Autumn — heavy rain incoming. Warn your partner below!', true, 'bloom');
    toast(g, 'Autumn — rain will pour in through the entrance. Dig sumps, set gates!', true, 'burrow');
  } else if (name === 'Winter') {
    toast(g, 'Winter (fast forward) — the colony huddles and eats its stores.', true, 'all');
    toast(g, 'The frost will creep downward — carry the queen below it!', true, 'burrow');
    g.frostToasted = false;
    g.sources.length = 0;
    g.trails.length = 0;
    for (const a of g.ants) {
      if (a.side === 'out' && (a.state === 'trailOut' || a.state === 'trailBack' || a.state === 'harvest')) {
        a.trailId = 0; a.state = 'freeBack';
      }
    }
    if (g.ants.some(a => a.side === 'out')) toast(g, 'Ants are still outside in the frost!', true, 'bloom');
  }
}

function updateWeather(g, dt) {
  const evs = season(g).events;
  const wasRaining = g.raining;
  g.raining = false; g.drought = false; g.rainRate = 0;
  for (const ev of evs) {
    if (g.seasonT >= ev.t && g.seasonT < ev.t + ev.dur) {
      if (ev.kind === 'rain') { g.raining = true; g.rainRate = ev.rate * eventScale(g); }
      else if (ev.kind === 'drought') g.drought = true;
    }
  }
  if (g.raining && !wasRaining) {
    for (const t of g.trails) t.strength -= TRAIL_RAIN_HIT;
    toast(g, 'Rain! Your trails are washing out.', true, 'bloom');
    toast(g, 'Rain! Water is coming in at the entrance.', true, 'burrow');
  }
}

// ---------- water simulation ----------
function updateWater(g, dt) {
  const W = g.water;
  // inflow: rain enters at the entrance and seeps through the topsoil
  if (g.raining) {
    if (waterOpen(g, ENTRANCE.c, ENTRANCE.r)) W[ENTRANCE.r][ENTRANCE.c] += g.rainRate * dt;
    for (let c = 0; c < GRID.cols; c++) {
      if (waterOpen(g, c, 0)) W[0][c] += 0.02 * dt;
    }
  }
  // spring melt: groundwater seeps into anything dug too deep
  if (season(g).name === 'Spring' && g.seasonT < 18) {
    for (let r = MELT_ROW; r < GRID.rows; r++) {
      for (let c = 0; c < GRID.cols; c++) {
        if (waterOpen(g, c, r)) W[r][c] += 0.2 * eventScale(g) * dt;
      }
    }
  }
  // gravity: fall into the cell below
  for (let r = GRID.rows - 2; r >= 0; r--) {
    for (let c = 0; c < GRID.cols; c++) {
      if (W[r][c] <= 0 || !waterOpen(g, c, r)) { if (!waterOpen(g, c, r)) W[r][c] = 0; continue; }
      if (waterOpen(g, c, r + 1) && W[r + 1][c] < 1) {
        const move = Math.min(W[r][c], 1 - W[r + 1][c]);
        W[r][c] -= move; W[r + 1][c] += move;
      }
    }
  }
  // spread sideways (alternate direction to stay symmetric)
  g.spreadFlip = !g.spreadFlip;
  for (let r = 0; r < GRID.rows; r++) {
    for (let ci = 0; ci < GRID.cols; ci++) {
      const c = g.spreadFlip ? ci : GRID.cols - 1 - ci;
      if (W[r][c] <= 0.03 || !waterOpen(g, c, r)) continue;
      for (const dc of g.spreadFlip ? [1, -1] : [-1, 1]) {
        const n = c + dc;
        if (!waterOpen(g, n, r)) continue;
        // only spread if the neighbour can't drain down and is lower
        const diff = W[r][c] - W[r][n];
        if (diff > 0.04) {
          const move = diff / 2 * Math.min(1, 8 * dt);
          W[r][c] -= move; W[r][n] += move;
        }
      }
    }
  }
  // evaporation
  const evap = (season(g).name === 'Summer' ? 0.06 : 0.008) * dt;
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      W[r][c] = Math.max(0, Math.min(1.2, W[r][c] - evap));
    }
  }

  // -- consequences --
  // drowned eggs
  const before = g.eggs.length;
  g.eggs = g.eggs.filter(e => W[e.r][e.c] <= 0.5);
  if (g.eggs.length < before) toast(g, 'Eggs drowned in a flooded nursery!', true, 'burrow');
  // flooded stockpiles spill their share
  const cap = stockCap(g);
  g.capToastT -= dt;
  if (cap < g.lastCap && storeTotal(g) > cap) {
    const total = storeTotal(g);
    const keep = total > 0 ? cap / total : 0;
    g.store.sugar = Math.floor(g.store.sugar * keep);
    g.store.protein = Math.floor(g.store.protein * keep);
    if (g.capToastT <= 0) { toast(g, 'A flooded stockpile spilled its supplies!', true, 'burrow'); g.capToastT = 6; }
  }
  g.lastCap = cap;
  // the queen can drown
  if (W[g.queenCell.r][g.queenCell.c] > 0.5) {
    if (g.queenDrownT === 0) toast(g, '⚠ WATER IN THE THRONE ROOM — the queen is drowning!', true, 'all');
    g.queenDrownT += dt;
    if (g.queenDrownT >= QUEEN_DROWN_TIME) {
      endGame(g, 'The queen drowned. Shape the nest so water flows away from her.');
    }
  } else {
    g.queenDrownT = 0;
  }
  // ants caught in deep water scramble or drown
  for (const a of [...g.ants]) {
    if (a.side !== 'in') continue;
    const cell = cellOf(a.x, a.y);
    if (W[cell.r][cell.c] > 0.7) {
      let moved = false;
      for (const [dc, dr] of [[0,-1],[1,0],[-1,0],[0,1]]) {
        if (passable(g, cell.c + dc, cell.r + dr)) {
          a.x = cell.c + dc + 0.5; a.y = cell.r + dr + 0.5;
          goIdleIn(a); moved = true; break;
        }
      }
      if (!moved) {
        a.drown += dt;
        if (a.drown > ANT_DROWN_TIME) {
          g.ants.splice(g.ants.indexOf(a), 1);
          toast(g, 'A worker drowned in the tunnels.', true, 'burrow');
        }
      }
    } else {
      a.drown = 0;
    }
  }
}

// ---------- tick ----------
function tick(g, dt) {
  if (g.gameOver) return;

  g.seasonT += dt;
  if (g.seasonT >= season(g).len) {
    g.seasonT = 0;
    g.seasonIdx = (g.seasonIdx + 1) % SEASONS.length;
    applySeasonStart(g);
  }
  const winter = season(g).name === 'Winter';
  const name = season(g).name;

  updateWeather(g, dt);
  updateWater(g, dt);

  // pheromone budget & trail evaporation
  g.pher = Math.min(PHER_MAX, g.pher + PHER_REGEN * dt);
  const decay = TRAIL_DECAY * (g.drought ? 3 : 1) * dt;
  for (const t of [...g.trails]) {
    t.strength -= decay;
    if (t.strength <= 0) {
      removeTrail(g, t.id);
      toast(g, 'A trail faded away — no ants were using it.', false, 'bloom');
    }
  }

  if (name === 'Spring' || name === 'Summer') {
    g.sourceTimer += dt;
    if (g.sourceTimer > 6) { g.sourceTimer = 0; spawnSource(g); }
  }

  g.rebalanceT += dt;
  if (g.rebalanceT > 0.5) { g.rebalanceT = 0; rebalance(g); }

  for (const a of [...g.ants]) updateAnt(g, a, dt, winter);

  // the queen being carried to a new chamber
  if (g.queen.path.length) {
    const next = g.queen.path[0];
    if (!passable(g, next.c, next.r)) {
      g.queen.path = [];
      toast(g, 'The queen\'s path is blocked — she stopped.', true, 'burrow');
    } else if (moveToward(g.queen, next.c + 0.5, next.r + 0.5, QUEEN_SPEED, dt, 0.08)) {
      g.queen.path.shift();
    }
    g.queenCell = cellOf(g.queen.x, g.queen.y);
  }

  // winter frost creeps down: eggs above the line die, a shallow queen freezes
  const fd = frostDepth(g);
  if (winter) {
    const before = g.eggs.length;
    g.eggs = g.eggs.filter(e => e.r >= fd);
    if (g.eggs.length < before) toast(g, 'Frost killed the eggs near the surface!', true, 'burrow');
    if (g.queenCell.r < fd) {
      if (!g.frostToasted) { g.frostToasted = true; toast(g, '⚠ THE QUEEN IS FREEZING — carry her below the frost line!', true, 'all'); }
      g.queenHP -= 6 * dt;   // must out-pace the fed-queen regen (+3/s)
    }
  }

  // eggs develop only in the queen's warmth, and faster near the warm surface
  for (const e of g.eggs) {
    const d = Math.hypot(e.c + 0.5 - g.queen.x, e.r + 0.5 - g.queen.y);
    e.w = d <= 3.5;
    if (e.w) e.t += dt * (e.r <= 4 ? 1.4 : 1);
  }
  g.eggs = g.eggs.filter(e => {
    if (g.grid[e.r][e.c].kind !== 'nursery' || !g.grid[e.r][e.c].dug) return false;
    if (e.t >= EGG_TIME) {
      const ant = newAnt(g, 'in');
      ant.x = e.c + 0.5; ant.y = e.r + 0.5;
      g.ants.push(ant);
      toast(g, 'An egg hatched — a new minor joins the colony!', false, 'all');
      return false;
    }
    return true;
  });

  // eating
  const need = (g.ants.length * EAT_PER_ANT + EAT_QUEEN) * dt * (winter ? WINTER_EAT_MULT : 1);
  if (g.store.sugar >= need) {
    g.store.sugar -= need;
    g.starving = false;
    g.queenHP = Math.min(100, g.queenHP + 3 * dt);
  } else {
    g.store.sugar = 0;
    if (!g.starving) toast(g, 'Out of sugar — the colony is starving!', true, 'all');
    g.starving = true;
    g.queenHP -= 3.5 * dt;
    g.starveT += dt;
    if (g.starveT > 5 && g.ants.length > 0) {
      g.starveT = 0;
      g.ants.splice(Math.floor(Math.random() * g.ants.length), 1);
      toast(g, 'A worker starved to death.', true, 'all');
    }
  }

  if (g.queenHP <= 0) endGame(g, 'The queen starved. Keep sugar flowing across the dock next time.');
  else if (g.ants.length === 0 && g.eggs.length === 0) endGame(g, 'The last worker is gone — the colony fell silent.');
}

function rebalance(g) {
  const eff = g.recall ? 0 : Math.min(g.desiredOutside, g.ants.length);
  const outCount = g.ants.filter(a => a.side === 'out' || a.state === 'goingOut').length;
  if (outCount > eff) {
    const a = g.ants.find(x => x.side === 'out' && (x.state === 'idleOut' || x.state === 'waitDock'))
      || (g.recall ? g.ants.find(x => x.side === 'out') : null);
    if (a) { a.state = 'goingIn'; a.trailId = 0; }
  } else if (outCount < eff) {
    const a = g.ants.find(x => x.side === 'in' && x.state === 'idleIn');
    if (a) {
      const path = bfs(g, cellOf(a.x, a.y), (c, r) => c === ENTRANCE.c && r === ENTRANCE.r);
      if (path !== null) { a.state = 'goingOut'; a.path = path; }
    }
  }
}

function updateAnt(g, a, dt, winter) {
  if (a.side === 'out') {
    if (winter) {
      a.freeze += dt;
      if (a.freeze > FREEZE_LIMIT) {
        g.ants.splice(g.ants.indexOf(a), 1);
        toast(g, 'A worker froze in the snow.', true, 'bloom');
        return;
      }
    }
    updateOutsideAnt(g, a, dt);
  } else {
    a.freeze = 0;
    updateInsideAnt(g, a, dt);
  }
}

// ---- foraging with two typed paws: one sugar slot, one protein slot ----
function srcGood(src) { return src.type === 'nectar' ? 'sugar' : 'protein'; }
function carryCount(a) { return a.carry ? a.carry.sugar + a.carry.protein : 0; }
function slotFree(a, src) { return !a.carry || a.carry[srcGood(src)] === 0; }
// next stop at/after position s where this ant can still pick something up
function nextStop(g, t, s, a) {
  for (const e of t.srcS) {
    if (e.s < s - 1) continue;
    const src = srcById(g, e.id);
    if (src && src.amt > 0 && slotFree(a, src)) return e;
  }
  return null;
}
function takeFrom(g, a, src) {
  src.amt--;
  if (!a.carry) a.carry = { sugar: 0, protein: 0 };
  a.carry[srcGood(src)]++;
  if (src.amt <= 0) toast(g, `A ${src.type === 'nectar' ? 'flower' : 'carcass'} has been picked clean.`, false, 'bloom');
}
// unload at the dock while there is room; each good reinforces the whole chain
function unloadAtDock(g, a) {
  const t = trailById(g, a.trailId);
  while (a.carry && carryCount(a) > 0 && dockTotal(g) < DOCK_CAP) {
    const good = a.carry.sugar > 0 ? 'sugar' : 'protein';
    a.carry[good]--; g.dock[good]++;
    if (t) reinforceChain(g, t, TRAIL_REINFORCE);
  }
  if (a.carry && carryCount(a) === 0) a.carry = null;
  return !a.carry; // true = fully unloaded
}

function updateOutsideAnt(g, a, dt) {
  switch (a.state) {
    case 'idleOut': {
      if (g.recall) { a.state = 'goingIn'; break; }
      // choose a trail that leads to food, weighted by strength
      const options = g.trails.filter(t => t.strength > 0.03 && nextStop(g, t, 0, a));
      if (options.length) {
        let total = 0;
        for (const t of options) total += t.strength;
        let roll = Math.random() * total;
        let pick = options[0];
        for (const t of options) { roll -= t.strength; if (roll <= 0) { pick = t; break; } }
        a.trailId = pick.id; a.s = 0; a.targetS = nextStop(g, pick, 0, a).s;
        a.dir = 1;
        a.state = 'trailOut';
        break;
      }
      wander(g, a, dt, DOCK_POINT.x - 60, DOCK_POINT.y, 70, false);
      break;
    }
    case 'trailOut': {
      const t = trailById(g, a.trailId);
      if (!t) { a.trailId = 0; a.state = 'freeBack'; break; }
      if (g.recall) { a.state = 'trailBack'; break; }
      a.s += ANT_SPEED_OUT * dt;
      const p = trailPos(t, a.s);
      a.x = p.x; a.y = p.y;
      if (a.s >= a.targetS) {
        a.s = a.targetS;
        const stop = t.srcS.find(e => Math.abs(e.s - a.targetS) < 1);
        const src = stop && srcById(g, stop.id);
        if (src && src.amt > 0 && slotFree(a, src)) {
          a.state = 'harvest'; a.timer = HARVEST_TIME; a.dir = 1;
        } else {
          const next = carryCount(a) < 2 && nextStop(g, t, a.s + 1, a);
          if (next) a.targetS = next.s;
          else a.state = 'trailBack';
        }
      }
      break;
    }
    case 'harvest': {
      const t = trailById(g, a.trailId);
      if (!t) { a.state = 'freeBack'; break; }
      const stop = t.srcS.find(e => Math.abs(e.s - a.s) < 1.5);
      const src = stop && srcById(g, stop.id);
      if (!src || src.amt <= 0 || !slotFree(a, src)) {
        a.state = a.dir === 1 ? 'trailOut' : 'trailBack';
        if (a.dir === 1) {
          const next = carryCount(a) < 2 && nextStop(g, t, a.s + 1, a);
          if (next) a.targetS = next.s; else a.state = 'trailBack';
        }
        break;
      }
      a.timer -= dt;
      if (a.timer <= 0) {
        takeFrom(g, a, src);
        if (a.dir === 1) {
          // paws free and more food further out? keep walking the route
          const next = carryCount(a) < 2 && !g.recall && nextStop(g, t, a.s + 1, a);
          if (next) { a.targetS = next.s; a.state = 'trailOut'; }
          else a.state = 'trailBack';
        } else {
          a.state = 'trailBack';
        }
      }
      break;
    }
    case 'trailBack': {
      const t = trailById(g, a.trailId);
      if (!t) { a.state = 'freeBack'; break; }
      const prevS = a.s;
      a.s -= ANT_SPEED_OUT * dt;
      // grab food we pass on the way home if a paw is free
      if (carryCount(a) < 2 && !g.recall) {
        for (const e of t.srcS) {
          if (e.s <= prevS && e.s >= a.s) {
            const src = srcById(g, e.id);
            if (src && src.amt > 0 && slotFree(a, src)) {
              a.s = e.s; a.state = 'harvest'; a.timer = HARVEST_TIME; a.dir = -1;
              break;
            }
          }
        }
      }
      const p = trailPos(t, Math.max(0, a.s));
      a.x = p.x; a.y = p.y;
      if (a.state === 'trailBack' && a.s <= 0) {
        if (unloadAtDock(g, a)) {
          a.trailId = 0;
          a.state = g.recall ? 'goingIn' : 'idleOut';
        } else a.state = 'waitDock';
      }
      break;
    }
    case 'freeBack': {
      if (moveToward(a, DOCK_POINT.x, DOCK_POINT.y, ANT_SPEED_OUT, dt, 4)) {
        if (unloadAtDock(g, a)) {
          a.trailId = 0;
          a.state = g.recall ? 'goingIn' : 'idleOut';
        } else a.state = 'waitDock';
      }
      break;
    }
    case 'waitDock': {
      if (dockTotal(g) < DOCK_CAP) {
        if (unloadAtDock(g, a)) {
          a.trailId = 0;
          a.state = g.recall ? 'goingIn' : 'idleOut';
        }
      } else if (g.recall) { a.state = 'goingIn'; }
      else wander(g, a, dt, DOCK_POINT.x - 30, DOCK_POINT.y, 30, false);
      break;
    }
    case 'goingIn': {
      if (moveToward(a, DOCK_POINT.x, DOCK_POINT.y, ANT_SPEED_OUT, dt, 4)) {
        if (a.carry) { g.dock.sugar += a.carry.sugar; g.dock.protein += a.carry.protein; a.carry = null; }
        a.side = 'in';
        a.x = ENTRANCE.c + 0.5; a.y = ENTRANCE.r + 0.5;
        goIdleIn(a);
      }
      break;
    }
    default: a.state = 'idleOut';
  }
}

function updateInsideAnt(g, a, dt) {
  switch (a.state) {
    case 'idleIn': {
      let tookDig = false;
      for (const d of g.digs) {
        if (d.assigned) continue;
        const path = bfs(g, cellOf(a.x, a.y), (c, r) =>
          Math.abs(c - d.c) + Math.abs(r - d.r) === 1);
        if (path !== null) { d.assigned = true; a.dig = d; a.path = path; a.state = 'digGo'; tookDig = true; break; }
      }
      if (tookDig) break;
      const space = stockCap(g) - storeTotal(g);
      if (dockTotal(g) > 0 && space > 0) {
        const haulers = g.ants.filter(x => x.state === 'haulGo').length;
        if (haulers * HAUL_LOAD < dockTotal(g)) {
          const path = bfs(g, cellOf(a.x, a.y), (c, r) => c === ENTRANCE.c && r === ENTRANCE.r);
          if (path !== null) { a.path = path; a.state = 'haulGo'; break; }
        }
      }
      wander(g, a, dt, g.queenCell.c + 0.5, g.queenCell.r + 0.5, 1.6, true);
      break;
    }
    case 'goingOut': {
      if (followPath(g, a, dt)) {
        a.side = 'out';
        a.x = DOCK_POINT.x; a.y = DOCK_POINT.y;
        a.state = 'idleOut';
      }
      break;
    }
    case 'digGo': {
      if (!a.dig || !g.digs.includes(a.dig)) { goIdleIn(a); break; }
      if (followPath(g, a, dt)) { a.state = 'digging'; a.timer = DIG_TIME; }
      break;
    }
    case 'digging': {
      if (!a.dig || !g.digs.includes(a.dig)) { goIdleIn(a); break; }
      a.timer -= dt;
      if (a.timer <= 0) {
        g.grid[a.dig.r][a.dig.c].dug = true;
        g.digs.splice(g.digs.indexOf(a.dig), 1);
        goIdleIn(a);
      }
      break;
    }
    case 'haulGo': {
      if (followPath(g, a, dt)) {
        const cap = stockCap(g);
        const space = cap - storeTotal(g);
        // a sensible quartermaster: never let protein hog the pantry — sugar is
        // life. Excess protein stays on the dock (a visible signal to Bloom).
        const proteinOk = () => g.store.protein + (a.carry ? a.carry.protein : 0) < cap * 0.6;
        let take = Math.min(HAUL_LOAD, dockTotal(g), Math.max(0, space));
        if (take <= 0) { goIdleIn(a); break; }
        a.carry = { sugar: 0, protein: 0 };
        for (let i = 0; i < take; i++) {
          if (g.dock.sugar > 0) { g.dock.sugar--; a.carry.sugar++; }
          else if (g.dock.protein > 0 && proteinOk()) { g.dock.protein--; a.carry.protein++; }
        }
        if (a.carry.sugar + a.carry.protein === 0) { a.carry = null; goIdleIn(a); break; }
        const path = bfs(g, cellOf(a.x, a.y), (c, r) =>
          g.grid[r][c].kind === 'stockpile' && g.water[r][c] <= 0.5);
        if (path === null) {
          g.dock.sugar += a.carry.sugar; g.dock.protein += a.carry.protein;
          a.carry = null; goIdleIn(a); break;
        }
        a.path = path; a.state = 'haulReturn';
      }
      break;
    }
    case 'haulReturn': {
      if (followPath(g, a, dt)) {
        g.store.sugar += a.carry.sugar;
        g.store.protein += a.carry.protein;
        a.carry = null;
        goIdleIn(a);
      }
      break;
    }
    default: goIdleIn(a);
  }
}

function wander(g, a, dt, cx, cy, radius, inside) {
  a.wt -= dt;
  if (a.wt <= 0 || Math.hypot(a.wx - a.x, a.wy - a.y) < (inside ? 0.1 : 5)) {
    a.wt = 1 + Math.random() * 2;
    for (let tries = 0; tries < 8; tries++) {
      const wx = cx + (Math.random() - 0.5) * radius * 2;
      const wy = cy + (Math.random() - 0.5) * radius * 2;
      if (inside) {
        const cell = cellOf(wx, wy);
        if (!passable(g, cell.c, cell.r)) continue;
      }
      a.wx = wx; a.wy = wy; break;
    }
  }
  moveToward(a, a.wx, a.wy, inside ? 1.0 : 35, dt, inside ? 0.05 : 3);
}

function endGame(g, msg) {
  g.gameOver = true;
  g.overMsg = msg + ` — Final score: ${score(g)} (Year ${g.year}).`;
}

// ---------- commands ----------
function command(g, role, cmd) {
  if (g.gameOver) return;
  if (role === 'bloom') {
    if (cmd.type === 'trail') {
      if (g.trails.length >= TRAIL_MAX) { toast(g, `Max ${TRAIL_MAX} trails — erase one first (right-click).`, true, 'bloom'); return; }
      let raw = Array.isArray(cmd.pts) ? cmd.pts : [];
      raw = raw.slice(0, 150)
        .map(p => ({ x: +p[0], y: +p[1] }))
        .filter(p => isFinite(p.x) && isFinite(p.y) && p.x >= 0 && p.x <= WORLD.w && p.y >= 0 && p.y <= WORLD.h);
      if (raw.length < 2) return;
      let fullPts, newLen, parentId = 0, ownStart = 1;
      const parent = cmd.attachId ? trailById(g, cmd.attachId) : null;
      if (parent) {
        const idx = Math.max(0, Math.min(parent.pts.length - 1, cmd.attachIdx | 0));
        fullPts = parent.pts.slice(0, idx + 1).concat(raw);
        newLen = polyLen([parent.pts[idx], ...raw]);
        parentId = parent.id;
        ownStart = idx + 1;
      } else {
        if (Math.hypot(raw[0].x - DOCK_POINT.x, raw[0].y - DOCK_POINT.y) > 60) {
          toast(g, 'Trails must start at the dock (or branch off an existing trail).', true, 'bloom');
          return;
        }
        fullPts = [{ x: DOCK_POINT.x, y: DOCK_POINT.y }, ...raw];
        newLen = polyLen(fullPts);
      }
      if (newLen < 20) return;
      if (newLen > 1400) { toast(g, 'That trail is too long for one stroke.', true, 'bloom'); return; }
      const cost = newLen * PHER_COST_PER_PX;
      if (cost > g.pher) { toast(g, `Not enough pheromone (${Math.ceil(cost)} needed).`, true, 'bloom'); return; }
      g.pher -= cost;
      const t = { id: TRAIL_SEQ++, parentId, ownStart, ...buildTrail(fullPts), strength: 1, srcS: [] };
      computeTrailSources(g, t);
      g.trails.push(t);
    } else if (cmd.type === 'erase') {
      removeTrail(g, cmd.id);
    } else if (cmd.type === 'recall') {
      g.recall = !g.recall;
      toast(g, g.recall ? 'RECALL — all foragers are coming home.' : 'Recall lifted — foragers head back out.', false, 'all');
    }
  } else if (role === 'burrow') {
    const c = cmd.c | 0, r = cmd.r | 0;
    const valid = c >= 0 && r >= 0 && c < GRID.cols && r < GRID.rows;
    if (!valid && cmd.type !== 'alloc') return;
    const cell = valid ? g.grid[r][c] : null;
    if (cmd.type === 'dig') {
      const existing = g.digs.findIndex(d => d.c === c && d.r === r);
      if (existing >= 0) g.digs.splice(existing, 1);
      else if (!cell.dug) {
        const nextToTunnel = [[1,0],[-1,0],[0,1],[0,-1]].some(([dc, dr]) => {
          const cc = c + dc, rr = r + dr;
          return cc >= 0 && rr >= 0 && cc < GRID.cols && rr < GRID.rows && g.grid[rr][cc].dug;
        }) || g.digs.some(d => Math.abs(d.c - c) + Math.abs(d.r - r) === 1);
        if (nextToTunnel) g.digs.push({ c, r, assigned: false });
        else toast(g, 'Dig next to an existing tunnel.', true, 'burrow');
      }
    } else if (cmd.type === 'build') {
      if (cmd.kind === 'gate') {
        if (!cell.dug || cell.kind) return;
        if (gateCount(g) >= maxGates(g)) { toast(g, `Max ${maxGates(g)} gates this year.`, true, 'burrow'); return; }
        if (g.store.sugar < GATE_COST) { toast(g, `A gate costs ${GATE_COST} sugar.`, true, 'burrow'); return; }
        g.store.sugar -= GATE_COST;
        cell.kind = 'gate'; cell.closed = true;
        toast(g, 'Gate built (closed). Click it to open/close.', false, 'burrow');
      } else if ((cmd.kind === 'stockpile' || cmd.kind === 'nursery') && cell.dug && !cell.kind && g.water[r][c] <= 0.5) {
        cell.kind = cmd.kind;
      }
    } else if (cmd.type === 'gate') {
      if (cell.kind === 'gate') cell.closed = !cell.closed;
    } else if (cmd.type === 'egg') {
      if (cell.kind !== 'nursery' || !cell.dug || g.water[r][c] > 0.5) toast(g, 'Lay eggs in a (dry) nursery.', true, 'burrow');
      else if (g.eggs.filter(x => x.c === c && x.r === r).length >= EGGS_PER_NURSERY) toast(g, 'That nursery is full.', true, 'burrow');
      else if (g.store.protein < EGG_COST) toast(g, `Need ${EGG_COST} protein for an egg.`, true, 'burrow');
      else { g.store.protein -= EGG_COST; g.eggs.push({ c, r, t: 0 }); }
    } else if (cmd.type === 'moveQueen' && valid) {
      if (!cell.dug || g.water[r][c] > 0.5) {
        toast(g, 'The queen needs a dry, dug chamber.', true, 'burrow');
      } else {
        const path = bfs(g, g.queenCell, (cc, rr) => cc === c && rr === r);
        if (path === null) toast(g, 'No open path for the queen.', true, 'burrow');
        else if (path.length) {
          g.queen.path = path;
          toast(g, 'The queen is on the move — keep her path dry!', false, 'burrow');
        }
      }
    } else if (cmd.type === 'alloc') {
      g.desiredOutside = Math.max(0, Math.min(60, cmd.n | 0));
    }
  }
}

// ---------- serialization ----------
const KIND_CHAR = { stockpile: 'S', nursery: 'N' };
function publicState(g) {
  const gridRows = g.grid.map(row => row.map(cell => {
    if (!cell.dug) return '#';
    if (cell.kind === 'gate') return cell.closed ? 'D' : 'O';
    return cell.kind ? KIND_CHAR[cell.kind] : '.';
  }).join(''));
  const waterRows = g.water.map(row =>
    row.map(w => Math.max(0, Math.min(9, Math.round(w * 9)))).join(''));
  return {
    world: WORLD, gridDim: GRID, frostRows: FROST_ROWS, meltRow: MELT_ROW,
    dockCap: DOCK_CAP, eggCost: EGG_COST,
    seasons: SEASONS.map(s => ({ name: s.name, len: s.len, events: s.events })),
    year: g.year, seasonIdx: g.seasonIdx, seasonT: Math.round(g.seasonT * 10) / 10,
    seasonLen: season(g).len,
    raining: g.raining, drought: g.drought,
    pher: Math.round(g.pher), pherMax: PHER_MAX, trailMax: TRAIL_MAX,
    gates: { count: gateCount(g), max: maxGates(g), cost: GATE_COST },
    score: score(g),
    store: { sugar: Math.floor(g.store.sugar), protein: Math.floor(g.store.protein) },
    cap: stockCap(g),
    dock: g.dock, desiredOutside: g.desiredOutside, recall: g.recall,
    queenHP: Math.round(g.queenHP), starving: g.starving,
    queenDanger: g.queenDrownT > 0, queenCell: g.queenCell,
    queen: { x: Math.round(g.queen.x * 100) / 100, y: Math.round(g.queen.y * 100) / 100, moving: g.queen.path.length > 0 },
    frostDepth: Math.round(frostDepth(g) * 10) / 10,
    ants: g.ants.map(a => ({
      s: a.side === 'out' ? 1 : 0,
      x: Math.round(a.x * 100) / 100, y: Math.round(a.y * 100) / 100,
      // bitmask: 1 = carrying sugar, 2 = carrying protein (both = 3)
      c: a.carry ? ((a.carry.sugar > 0 ? 1 : 0) | (a.carry.protein > 0 ? 2 : 0)) : 0,
    })),
    sources: g.sources.filter(s => s.amt > 0).map(s => ({
      id: s.id, x: Math.round(s.x), y: Math.round(s.y), type: s.type, amt: s.amt,
    })),
    trails: g.trails.map(t => ({
      id: t.id,
      ownStart: t.ownStart,
      strength: Math.round(t.strength * 100) / 100,
      pts: t.pts.map(p => [Math.round(p.x), Math.round(p.y)]),
      food: trailHasFood(g, t),
    })),
    grid: gridRows, water: waterRows,
    digs: g.digs.map(d => ({ c: d.c, r: d.r })),
    eggs: g.eggs.map(e => ({ c: e.c, r: e.r, t: Math.round(e.t), w: e.w ? 1 : 0 })),
    toasts: g.toasts,
    gameOver: g.gameOver, overMsg: g.overMsg,
  };
}

module.exports = { createGame, tick, command, publicState, SEASONS };
