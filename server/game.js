// Bloom & Burrow — authoritative simulation, v7 "the growing cut".
//
// Two interlocking growth engines (see PLAN.md §7):
//  - Bloom builds a persistent TREE of trails over nodes (dock, wild sources,
//    planted flowers). Segments are the scarce currency; nothing evaporates.
//    Weather muddies, never erases. Planted flowers are both renewable food
//    and the tree's custom junction nodes.
//  - Burrow farms: fungus gardens (seed → 4 stages → harvest) and the brood
//    (protein → queen → egg → tap-feed → ant), inside a nest whose climate is
//    two visible lines — frost creeping from above, damp swelling from below.
//    Comfort is the moving band between them; outside it things STALL, they
//    don't die. The queen alone can die, slowly, against a visible meter.
//  - The seed loop couples the halves both ways: gardens yield seeds, workers
//    carry them out to the dock ledge, Bloom plants them where the network
//    wants its next hub.

'use strict';

// ---------- world ----------
const GRID = { cols: 12, rows: 18 };
const WORLD = { w: 1000, h: 620 };
const DOCK_POINT = { x: WORLD.w - 25, y: 310 };
const DOCK_CAP = 15;
const LEDGE_CAP = 3;              // outbound seed ledge — separate from the pile
const ENTRANCE = { c: 0, r: 0 };

const ANT_SPEED_OUT = 115;        // px/s in the meadow
const ANT_SPEED_IN = 2.8;         // cells/s underground
const HARVEST_TIME = 1.5, DIG_TIME = 2.0, FILL_TIME = 3.0, HAUL_LOAD = 2;
const QUEEN_SPEED = 0.8;

// ---------- economy ----------
const STOCK_CAP = 10;             // pieces per stockpile cell, sugar+protein mixed
const ANT_RATION = 100;           // s of colony time one sugar feeds one mouth
const WINTER_EAT_MULT = 2.5;
const FAMINE_DEATH = 25;          // s of empty stores between worker deaths (soft)
const FREEZE_LIMIT = 8;           // s an ant survives outside in winter (they sprint home)
const MAX_WILD = 11;

// brood
const EGG_TIME = 20, EGGS_PER_NURSERY = 3;
const EGG_PROTEIN = 4;
const EGG_FEED_GRACE = 7;
const EGG_FEED_TIME = 8;

// gardens — Burrow's crop: seed (1🍯+1🥩) → 4 stages → harvest 3🥩,
// every 2nd harvest of a garden also yields a 🌰 seed
const GARDEN_STAGES = 4, GARDEN_STAGE_TIME = 12;
const GARDEN_YIELD = 3, GARDEN_SEED_EVERY = 2;

// the trail tree — segments are the scarce currency (Mini Metro lines)
const SEG_BASE = 8, SEG_PER_MILESTONE = 2;
const SEG_PX = 150;               // 1 segment per 150 px of edge
const EDGE_MAX_LEN = 600;         // forces trunks to hop through nodes
const ERASE_REFUND_DELAY = 5;     // s before an erased edge's segments return
const ORPHAN_TTL = 10;            // s an orphaned edge waits to be re-parented

// planted flowers — renewable sugar AND the tree's custom waypoints
const FLOWER_SPROUT = 20;
const FLOWER_CAP = 6;
const FLOWER_REGROW = 8;          // s per nectar piece, spring & summer
const FLOWER_LIFE = 2;            // dies of old age after this many full years
const PLANT_MIN_DOCK = 250;       // barren ring: nothing grows near the pit
const PLANT_MIN_SPACING = 80;

// progression — growth unlocks capacity for BOTH players, forever:
// 10, 14, 18, 24, then every +8 ants (32, 40, 48…). Each milestone grants
// trail segments and a garden slot — the colony that grows can build more.
function milestoneThreshold(n) { return n < 4 ? [10, 14, 18, 24][n] : 24 + 8 * (n - 3); }
const PREP_SPEED = 1.15;          // a warned colony works faster all season
const NECTAR_SEED_EVERY = 25;     // foragers find a seed among this many petals

const SEASONS = [
  { name: 'Spring', len: 55, events: [{ t: 12, dur: 3, kind: 'rain' }] },
  { name: 'Summer', len: 55, events: [{ t: 18, dur: 8, kind: 'drought' }, { t: 38, dur: 8, kind: 'drought' }] },
  { name: 'Autumn', len: 45, events: [{ t: 6, dur: 5, kind: 'rain' }, { t: 18, dur: 5, kind: 'rain' }, { t: 30, dur: 5, kind: 'rain' }] },
  { name: 'Winter', len: 25, events: [] },
];

// ---------- climate bands ----------
// Two lines, both always visible, both moving slowly. Comfort is between
// them. The peaks OVERLAP at row 7.5 on purpose: no row is safe all year,
// so the nest needs a summer wing (shallow) and a winter wing (deep) and
// everything breathes up and down the shaft once a year.
function frostPeak(g) { return Math.min(9, 7.5 + 0.25 * (g.year - 1)); }
function frostRow(g) {
  let f = 2;
  if (season(g).name === 'Winter') f = 2 + (frostPeak(g) - 2) * (g.seasonT / season(g).len);
  if (g.drought) f = Math.max(f, 4);   // summer droughts bake the shallows
  return f;
}
function dampRow(g) {
  let d = 14;
  if (season(g).name === 'Spring') d = 14 - (14 - 7.5) * Math.sin(Math.PI * g.seasonT / season(g).len);
  return d - g.dampSurge;              // autumn rain pushes the damp up ~2 rows
}
function inComfort(g, r) { return r >= frostRow(g) && r < dampRow(g); }
// how bad is this row right now? 0 = comfy, else rows beyond the line.
// Damage scales with depth-beyond so a near-miss is a scar and sustained
// neglect is fatal (a queen 5 rows into the frost loses ~8 HP/s).
function bandStress(g, r) {
  const f = frostRow(g), d = dampRow(g);
  if (r < f) return f - r;
  if (r >= d) return r - d + 1;
  return 0;
}
// the queen never feels a surface drought (that's a farming concern — eggs
// and gardens stall); only the winter frost and the rising damp touch her
function queenBandStress(g) {
  let f = 2;
  if (season(g).name === 'Winter') f = 2 + (frostPeak(g) - 2) * (g.seasonT / season(g).len);
  const d = dampRow(g), r = g.queenCell.r;
  if (r < f) return f - r;
  if (r >= d) return r - d + 1;
  return 0;
}

let TOAST_SEQ = 1, SOURCE_SEQ = 1, EDGE_SEQ = 1, EGG_SEQ = 1, CARD_SEQ = 1;

// ---------- construction ----------
function createGame() {
  const g = {
    year: 1, seasonIdx: 0, seasonT: 0,
    grid: [], ants: [], sources: [], edges: [], eggs: [], digs: [], toasts: [],
    parent: { 0: null },              // trail tree: nodeId -> parent nodeId
    refunds: [],                      // segments on their way back after an erase
    dock: { sugar: 0, protein: 0 },
    ledge: 1,                         // outbound seeds — one starter gift for Bloom
    seedStore: 0,                     // seeds waiting underground for the ferry
    desiredOutside: 4, recall: false,
    queenHP: 100, starving: false,
    eatAcc: 0, famineT: 0,
    queenFed: 0, broodOn: true,
    warnWinter: false, warnMelt: false, prepared: false, bandWarnT: 0,
    raining: false, drought: false, mudT: 0, dampSurge: 0, proteinDiet: false,
    sourceTimer: 0, rebalanceT: 0, nectarSeedAcc: 0,
    milestone: 0,
    queen: { x: 4.5, y: 2.5, path: [] },
    queenCell: { c: 4, r: 2 },
    stats: { gardenHarvests: 0, flowersPlanted: 0, cmds: { bloom: 0, burrow: 0 }, dangerT: 0, antsByYear: [] },
    yearStats: { antsStart: 8, harvests: 0, planted: 0 },
    postcard: null,
    leakToastT: 0, stallToastT: 0, queenBandToastT: 0,
    gameOver: false, overMsg: '',
  };
  for (let r = 0; r < GRID.rows; r++) {
    g.grid.push(Array.from({ length: GRID.cols }, () => ({
      dug: false, kind: null,
      sugar: 0, protein: 0,           // stockpile contents (mixed)
      gs: 0, gt: 0, gh: 0, gp: 0,     // garden: stage, stage-progress, harvest count, pieces waiting
      leakT: 0,
    })));
  }
  // starter nest: entrance corridor, a short shaft, the queen's quarters
  const predug = [
    [0,0],[1,0],[2,0],[3,0],[4,0],    // entrance corridor
    [4,1],[4,2],[4,3],                // shaft
    [3,2],[3,3],[5,2],[5,3],          // living quarters
  ];
  for (const [c, r] of predug) g.grid[r][c].dug = true;
  g.grid[2][5].kind = 'stockpile'; g.grid[2][5].sugar = 8;
  g.grid[3][5].kind = 'stockpile'; g.grid[3][5].sugar = 2; g.grid[3][5].protein = 2;
  g.grid[3][3].kind = 'nursery';

  for (let i = 0; i < 4; i++) g.ants.push(newAnt(g, 'out'));
  for (let i = 0; i < 4; i++) g.ants.push(newAnt(g, 'in'));
  for (let i = 0; i < 6; i++) spawnWild(g);
  toast(g, 'Year 1 — Spring. Tap the dock, then a source, to lay a trail. A seed waits on the ledge!', false, 'bloom');
  toast(g, 'Year 1 — Spring. Dig, build a garden, keep the queen between the frost and the damp.', false, 'burrow');
  return g;
}

function newAnt(g, side) {
  const a = {
    side, state: side === 'out' ? 'idleOut' : 'idleIn',
    x: 0, y: 0, path: [], carry: null, dig: null, fetch: null,
    route: null, ri: 0, timer: 0, freeze: 0, wx: 0, wy: 0, wt: 0,
    px: 0, py: 0,                     // plant walk target (cosmetic)
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
function cellOf(x, y) {
  return {
    c: Math.max(0, Math.min(GRID.cols - 1, Math.floor(x))),
    r: Math.max(0, Math.min(GRID.rows - 1, Math.floor(y))),
  };
}
function passable(g, c, r) {
  if (c < 0 || r < 0 || c >= GRID.cols || r >= GRID.rows) return false;
  return g.grid[r][c].dug;
}
function storeTotals(g) {
  const t = { sugar: 0, protein: 0 };
  for (const row of g.grid) for (const cell of row) {
    if (cell.kind === 'stockpile') { t.sugar += cell.sugar; t.protein += cell.protein; }
  }
  return t;
}
function stockCaps(g) {
  let n = 0;
  for (const row of g.grid) for (const cell of row) if (cell.kind === 'stockpile') n += STOCK_CAP;
  return n;
}
function storeTotal(g) { const t = storeTotals(g); return t.sugar + t.protein; }
// free capacity in stockpiles that are NOT in the damp band (haulers avoid leaks)
function stockSpace(g) {
  const d = dampRow(g);
  let n = 0;
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) {
    const cell = g.grid[r][c];
    if (cell.kind === 'stockpile' && r < d) n += STOCK_CAP - cell.sugar - cell.protein;
  }
  return n;
}
function payGood(g, good, n) {
  const t = storeTotals(g);
  if (t[good] < n) return false;
  for (const row of g.grid) for (const cell of row) {
    if (n > 0 && cell.kind === 'stockpile' && cell[good] > 0) {
      const take = Math.min(n, cell[good]);
      cell[good] -= take; n -= take;
    }
  }
  return true;
}
function dockTotal(g) { return g.dock.sugar + g.dock.protein; }
function gardenCount(g) {
  let n = 0;
  for (const row of g.grid) for (const cell of row) if (cell.kind === 'garden') n++;
  return n;
}
function gardenCap(g) { return 1 + g.milestone; }
function segCap(g) { return SEG_BASE + SEG_PER_MILESTONE * g.milestone; }
function segUsed(g) {
  let n = 0;
  for (const e of g.edges) n += e.cost;
  for (const r of g.refunds) n += r.amt;
  return n;
}
function score(g) {
  return g.ants.length * 2 + g.stats.gardenHarvests * 3 + g.stats.flowersPlanted * 4
    + Math.floor(storeTotal(g) / 5);
}
function toast(g, msg, bad, role) {
  g.toasts.push({ id: TOAST_SEQ++, msg, bad: !!bad, role: role || 'all' });
  if (g.toasts.length > 12) g.toasts.shift();
}
function moveToward(a, tx, ty, speed, dt, snap) {
  const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
  // arrive when close enough OR when this step would overshoot — never
  // oscillate around a waypoint, whatever the tick size
  if (d < snap || speed * dt >= d) { a.x = tx; a.y = ty; return true; }
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
function followPath(g, a, dt, speed) {
  if (!a.path.length) return true;
  const t = a.path[0];
  if (moveToward(a, t.c + 0.5, t.r + 0.5, speed, dt, 0.08)) a.path.shift();
  return a.path.length === 0;
}
function goIdleIn(a) {
  a.state = 'idleIn'; a.path = []; a.fetch = null;
  if (a.dig) { a.dig.assigned = false; a.dig = null; }
}

// ---------- the trail tree ----------
function srcById(g, id) { return g.sources.find(s => s.id === id); }
function nodePos(g, id) {
  if (id === 0) return DOCK_POINT;
  return srcById(g, id);
}
function edgeBetween(g, a, b) {
  return g.edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}
function edgesAt(g, id) { return g.edges.filter(e => e.a === id || e.b === id); }
// recompute reachability from the dock. Edges that fall off the tree become
// orphans: they gray out and auto-refund after ORPHAN_TTL unless a new edge
// re-connects their component (re-parenting a whole subtree is one stroke).
function recomputeTree(g) {
  const parent = { 0: null };
  const q = [0];
  while (q.length) {
    const cur = q.shift();
    for (const e of g.edges) {
      const other = e.a === cur ? e.b : (e.b === cur ? e.a : null);
      if (other === null || other in parent) continue;
      parent[other] = cur;
      q.push(other);
    }
  }
  g.parent = parent;
  for (const e of g.edges) {
    const on = (e.a in parent) && (e.b in parent);
    if (on) { e.orphan = false; e.orphanT = 0; }
    else if (!e.orphan) { e.orphan = true; e.orphanT = ORPHAN_TTL; }
  }
}
function pathFromDock(g, id) {
  const path = [];
  let cur = id, guard = 0;
  while (cur !== null && cur !== undefined && guard++ < 200) {
    path.unshift(cur);
    cur = g.parent[cur];
  }
  return path[0] === 0 ? path : null;
}
function refundEdge(g, e, delay) {
  g.refunds.push({ amt: e.cost, t: delay });
}
function removeEdge(g, id, delay) {
  const i = g.edges.findIndex(e => e.id === id);
  if (i < 0) return;
  refundEdge(g, g.edges[i], delay);
  g.edges.splice(i, 1);
  recomputeTree(g);
}

// ---------- sources: wild feasts, husks, planted flowers ----------
function srcGood(src) { return src.type === 'nectar' ? 'sugar' : 'protein'; }
// a node is a "husk" when it can never offer food again but still stands as
// a junction. Wild: depleted. Planted: dead of old age.
function isHusk(src) {
  if (src.sproutT > 0) return false;
  if (src.planted) return src.dead;
  return src.amt <= 0;
}
function spawnWild(g) {
  const alive = g.sources.filter(s => !s.planted && s.amt > 0);
  if (alive.length >= MAX_WILD) return;
  // later years spawn farther out — reach, not punishment, is the difficulty
  const minD = Math.min(120 + 40 * (g.year - 1), 550);
  const type = Math.random() < 0.62 ? 'nectar' : 'carcass';
  for (let tries = 0; tries < 30; tries++) {
    const x = 40 + Math.random() * (WORLD.w - 140);
    const y = 45 + Math.random() * (WORLD.h - 90);
    const d = Math.hypot(x - DOCK_POINT.x, y - DOCK_POINT.y);
    if (d < minD || d > 980) continue;
    if (g.sources.some(s => Math.hypot(s.x - x, s.y - y) < 70)) continue;
    let amt = (type === 'nectar' ? 3 : 2) + Math.min(14, Math.round(d / 75));
    if (g.drought) amt = Math.round(amt * 1.25);   // drought concentrates the far nectar
    g.sources.push({
      id: SOURCE_SEQ++, x, y, type, amt,
      planted: false, dead: false, sproutT: 0, regrowAcc: 0, fadeT: 0, birthYear: g.year,
    });
    return;
  }
}
// dormant = planted under the snow: the seed is a NODE immediately (you can
// wire next spring's tree to it during the winter), and it sprouts at the thaw
function plantFlower(g, x, y, dormant) {
  const src = {
    id: SOURCE_SEQ++, x, y, type: 'nectar', amt: 0,
    planted: true, dead: false, dormant: !!dormant,
    sproutT: dormant ? 0 : FLOWER_SPROUT, regrowAcc: 0, fadeT: 0, birthYear: g.year,
  };
  g.sources.push(src);
  g.stats.flowersPlanted++;
  g.yearStats.planted++;
  // a nearby idle forager walks over to do the planting — pure charm
  const ant = g.ants.find(a => a.side === 'out' && a.state === 'idleOut');
  if (ant) { ant.state = 'plantGo'; ant.px = x; ant.py = y; }
  return src;
}
function updateSources(g, dt) {
  const sn = season(g).name;
  for (const src of [...g.sources]) {
    if (src.sproutT > 0) {
      src.sproutT -= dt;
      if (src.sproutT <= 0) src.amt = 2;   // the sprout opens with a little nectar
      continue;
    }
    // planted flowers regrow through the warm seasons, sleep through the cold
    if (src.planted && !src.dead && (sn === 'Spring' || sn === 'Summer') && !g.drought) {
      src.regrowAcc += dt / FLOWER_REGROW;
      while (src.regrowAcc >= 1 && src.amt < FLOWER_CAP) { src.regrowAcc -= 1; src.amt++; }
    }
    // depleted wild sources / dead flowers with no edges quietly fade away;
    // with edges they stand as husks (junctions you're paying segments for)
    if (isHusk(src)) {
      if (edgesAt(g, src.id).length === 0) {
        src.fadeT += dt;
        if (src.fadeT > 10) g.sources.splice(g.sources.indexOf(src), 1);
      } else src.fadeT = 0;
    }
  }
}

// ---------- seasons & weather ----------
function applySeasonStart(g) {
  const name = season(g).name;
  if (name === 'Spring') {
    // the year turns: postcard first, then the world wakes
    const ys = g.yearStats;
    g.postcard = {
      id: CARD_SEQ++, year: g.year,
      antsFrom: ys.antsStart, antsTo: g.ants.length,
      harvests: ys.harvests, planted: ys.planted, score: score(g),
    };
    toast(g, `Year ${g.year} → ${g.year + 1}: ${ys.antsStart} → ${g.ants.length} ants · ${ys.harvests} harvests · ${ys.planted} flowers planted · ⭐ ${score(g)}`, false, 'all');
    g.year++;
    g.stats.antsByYear.push(g.ants.length);
    g.yearStats = { antsStart: g.ants.length, harvests: 0, planted: 0 };
    g.prepared = g.warnMelt;
    g.warnMelt = false;
    // flowers age at the turn of the year; old ones wilt into husks.
    // Winter-planted seeds wake with the thaw, right where Bloom planned them.
    let woke = 0;
    for (const src of g.sources) {
      if (src.dormant) {
        src.dormant = false; src.sproutT = FLOWER_SPROUT; src.birthYear = g.year;
        woke++;
        continue;
      }
      if (src.planted && !src.dead && g.year - src.birthYear >= FLOWER_LIFE) {
        src.dead = true; src.amt = 0;
      }
    }
    if (woke) toast(g, `${woke} winter seed${woke > 1 ? 's' : ''} sprout${woke > 1 ? '' : 's'} with the thaw 🌼`, false, 'bloom');
    for (let i = 0; i < 4; i++) spawnWild(g);
  } else if (name === 'Winter') {
    g.prepared = g.warnWinter;
    g.warnWinter = false;
    if (g.ants.some(a => a.side === 'out')) toast(g, 'Ants are still outside in the frost!', true, 'bloom');
  } else {
    g.prepared = false;
  }
}
function updateWeather(g, dt) {
  g.raining = false; g.drought = false;
  for (const ev of season(g).events) {
    if (g.seasonT >= ev.t && g.seasonT < ev.t + ev.dur) {
      if (ev.kind === 'rain') g.raining = true;
      else g.drought = true;
    }
  }
  // rain muddies the trails (half speed) and pushes the damp line up ~2 rows;
  // both relax on their own — weather modulates, it never erases
  if (g.raining) g.mudT = 5;
  else g.mudT = Math.max(0, g.mudT - dt);
  const surgeTarget = g.raining && season(g).name === 'Autumn' ? 2 : 0;
  g.dampSurge += Math.sign(surgeTarget - g.dampSurge) * Math.min(Math.abs(surgeTarget - g.dampSurge), dt * 1.2);
}

// ---------- brood ----------
function adjacentNursery(g) {
  let best = null, bestN = EGGS_PER_NURSERY;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = g.queenCell.c + dc, r = g.queenCell.r + dr;
      if (c < 0 || r < 0 || c >= GRID.cols || r >= GRID.rows) continue;
      const cell = g.grid[r][c];
      if (!cell.dug || cell.kind !== 'nursery') continue;
      const n = g.eggs.filter(e => e.c === c && e.r === r).length;
      if (n < bestN) { bestN = n; best = { c, r }; }
    }
  }
  return best;
}
function queenWantsProtein(g) {
  return g.broodOn && g.queenFed < EGG_PROTEIN && !g.queen.path.length && adjacentNursery(g) !== null;
}
function fetching(g, purpose) {
  return g.ants.some(x => x.fetch && x.fetch.purpose === purpose);
}
function checkMilestone(g) {
  while (g.ants.length >= milestoneThreshold(g.milestone)) {
    g.milestone++;
    toast(g, `🎉 The colony thrives — ${g.ants.length} ants! +${SEG_PER_MILESTONE} trail segments · garden slots: ${gardenCap(g)}`, false, 'all');
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
  const sn = season(g).name;

  updateWeather(g, dt);
  updateSources(g, dt);

  // segments find their way back after erases
  for (const r of [...g.refunds]) {
    r.t -= dt;
    if (r.t <= 0) g.refunds.splice(g.refunds.indexOf(r), 1);
  }
  // orphaned edges wait to be re-parented, then fade with a refund
  for (const e of [...g.edges]) {
    if (e.orphan) {
      e.orphanT -= dt;
      if (e.orphanT <= 0) removeEdge(g, e.id, 0);
    }
    e.traffic = Math.max(0, (e.traffic || 0) - 0.05 * dt);
  }

  if (sn === 'Spring' || sn === 'Summer') {
    g.sourceTimer += dt;
    if (g.sourceTimer > 6) { g.sourceTimer = 0; spawnWild(g); }
  }

  g.rebalanceT += dt;
  if (g.rebalanceT > 0.5) { g.rebalanceT = 0; rebalance(g, winter); }

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

  // ---- climate: everything outside comfort stalls; only the queen can die ----
  const qStress = queenBandStress(g);
  g.queenBandToastT -= dt;
  g.bandWarnT -= dt;
  // predictive warning: the line is CLOSING ON the queen but hasn't reached
  // her — a heads-up you can act on, not a punishment you react to
  if (qStress === 0 && g.bandWarnT <= 0) {
    if (winter && g.queenCell.r - frostRow(g) < 1.8 && g.seasonT < season(g).len - 3) {
      g.bandWarnT = 18;
      toast(g, '⚠ The frost is creeping toward the queen — carry her deeper!', true, 'burrow');
    } else if (sn === 'Spring' && g.seasonT < season(g).len * 0.5 && dampRow(g) - g.queenCell.r < 1.8) {
      g.bandWarnT = 18;
      toast(g, '⚠ The damp is rising toward the queen — carry her up!', true, 'burrow');
    }
  }
  if (qStress > 0) {
    g.queenHP -= (2 + 1.2 * (qStress - 1)) * dt;
    if (g.queenBandToastT <= 0) {
      g.queenBandToastT = 12;
      const cold = g.queenCell.r < frostRow(g);
      toast(g, cold ? '⚠ The queen shivers above the frost line — carry her down!' :
        '⚠ The queen sits in the rising damp — carry her up!', true, 'all');
    }
  }

  // when fed enough protein, she lays into an adjacent nursery
  if (g.queenFed >= EGG_PROTEIN && !g.queen.path.length) {
    const spot = adjacentNursery(g);
    if (spot) {
      g.queenFed -= EGG_PROTEIN;
      g.eggs.push({ id: EGG_SEQ++, c: spot.c, r: spot.r, t: 0, fedT: EGG_FEED_GRACE, w: true });
    }
  }

  // eggs develop in warmth + comfort + while fed; otherwise they stall (never die)
  for (const e of g.eggs) {
    const d = Math.hypot(e.c + 0.5 - g.queen.x, e.r + 0.5 - g.queen.y);
    e.w = d <= 3.5;
    e.ok = inComfort(g, e.r);
    if (e.w && e.ok && e.fedT > 0) {
      e.t += dt * (e.r <= 5 ? 1.25 : 1);   // shallow nurseries hatch faster — summer wants you high
      e.fedT -= dt;
    }
  }
  g.eggs = g.eggs.filter(e => {
    if (g.grid[e.r][e.c].kind !== 'nursery' || !g.grid[e.r][e.c].dug) return false;
    if (e.t >= EGG_TIME) {
      const ant = newAnt(g, 'in');
      ant.x = e.c + 0.5; ant.y = e.r + 0.5;
      g.ants.push(ant);
      checkMilestone(g);
      return false;
    }
    return true;
  });

  // gardens grow only in comfort; stalls are shown, never punished
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) {
    const cell = g.grid[r][c];
    if (cell.kind !== 'garden' || cell.gs <= 0 || cell.gs >= GARDEN_STAGES) continue;
    if (!inComfort(g, r)) continue;
    cell.gt += dt;
    if (cell.gt >= GARDEN_STAGE_TIME) { cell.gt = 0; cell.gs++; }
  }

  // stockpiles in the damp leak slowly — a drip, not a spill
  g.leakToastT -= dt;
  const dRow = dampRow(g);
  for (let r = Math.max(0, Math.ceil(dRow)); r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      const cell = g.grid[r][c];
      if (cell.kind !== 'stockpile' || cell.sugar + cell.protein === 0) continue;
      cell.leakT += dt;
      if (cell.leakT >= 10) {
        cell.leakT = 0;
        if (cell.sugar >= cell.protein) cell.sugar--; else cell.protein--;
        if (g.leakToastT <= 0) {
          g.leakToastT = 15;
          toast(g, 'A stockpile in the damp is leaking supplies — move them higher.', true, 'burrow');
        }
      }
    }
  }

  // the colony eats from the stores by itself; dock scraps count in a pinch,
  // and when the sugar runs dry it chews joylessly through protein at 2:1 —
  // a glut of meat is dreary, never deadly
  g.eatAcc += (g.ants.length + 1) * (winter ? WINTER_EAT_MULT : 1) * dt / ANT_RATION;
  while (g.eatAcc >= 1) {
    g.eatAcc -= 1;
    if (payGood(g, 'sugar', 1)) { g.proteinDiet = false; }
    else if (g.dock.sugar > 0) { g.dock.sugar--; g.proteinDiet = false; }
    else if (payGood(g, 'protein', 2) || (g.dock.protein >= 2 && (g.dock.protein -= 2) >= 0)) {
      if (!g.proteinDiet) {
        g.proteinDiet = true;
        toast(g, 'The sugar is gone — the colony grimly eats into the protein stores (2🥩 per meal).', true, 'all');
      }
    }
  }
  const t2 = storeTotals(g);
  if (t2.sugar > 0 || g.dock.sugar > 0 || t2.protein >= 2 || g.dock.protein >= 2) {
    g.starving = false; g.famineT = 0;
    if (qStress === 0) g.queenHP = Math.min(100, g.queenHP + 3 * dt);
  } else {
    if (!g.starving) toast(g, 'The stores are EMPTY — the colony is starving!', true, 'all');
    g.starving = true;
    g.queenHP -= 3.5 * dt;
    g.famineT += dt;
    if (g.famineT >= FAMINE_DEATH && g.ants.length > 0) {
      g.famineT = 0;
      g.ants.splice(Math.floor(Math.random() * g.ants.length), 1);
      toast(g, 'A worker starved to death.', true, 'burrow');
    }
  }

  if (g.queenHP < 50) g.stats.dangerT += dt;
  if (g.queenHP <= 0) {
    endGame(g, g.starving ? 'The queen starved. Keep sugar flowing across the dock next time.'
      : 'The queen faded outside the comfort band. Follow the lines — down in winter, up in spring.');
  } else if (g.ants.length === 0 && g.eggs.length === 0) {
    endGame(g, 'The last worker is gone — the colony fell silent.');
  }
}

function rebalance(g, winter) {
  // winter recalls everyone; the world waits out the frost underground
  const eff = (winter || g.recall) ? 0 : Math.min(g.desiredOutside, g.ants.length);
  const outCount = g.ants.filter(a => a.side === 'out' || a.state === 'goingOut').length;
  if (outCount > eff) {
    const a = g.ants.find(x => x.side === 'out' && (x.state === 'idleOut' || x.state === 'waitDock'))
      || ((winter || g.recall) ? g.ants.find(x => x.side === 'out') : null);
    if (a) { a.state = 'goingIn'; a.route = null; }
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

// ---- foraging along the tree, two typed paws ----
function carryCount(a) { return a.carry ? a.carry.sugar + a.carry.protein : 0; }
function slotFree(a, src) { return !a.carry || a.carry[srcGood(src)] === 0; }
function outSpeed(g) {
  // in winter everyone outside is sprinting for the entrance — panic pace,
  // so a reasonable recall loses nobody and only true stragglers freeze
  const sprint = season(g).name === 'Winter' ? 1.45 : 1;
  return ANT_SPEED_OUT * (g.mudT > 0 ? 0.5 : 1) * (g.prepared ? PREP_SPEED : 1) * sprint;
}
function harvestable(g, a, src) {
  if (!src || src.amt <= 0 || src.sproutT > 0 || !slotFree(a, src)) return false;
  // forager judgment: walk past food the dock is already drowning in —
  // the visible signal that regulates the sugar/protein mix by itself
  if (g.dock[srcGood(src)] >= 6) return false;
  return true;
}
// pick a foraging target: any reachable node with food, weighted by amount
function pickRoute(g, a) {
  const opts = [];
  for (const src of g.sources) {
    if (src.amt <= 0 || src.sproutT > 0) continue;
    if (!(src.id in g.parent)) continue;
    if (g.dock[srcGood(src)] >= 6) continue;   // don't set out for a glutted good
    opts.push(src);
  }
  if (!opts.length) return null;
  let total = 0;
  for (const s of opts) total += s.amt;
  let roll = Math.random() * total;
  let pick = opts[0];
  for (const s of opts) { roll -= s.amt; if (roll <= 0) { pick = s; break; } }
  return pathFromDock(g, pick.id);
}
function unloadAtDock(g, a) {
  while (a.carry && carryCount(a) > 0 && dockTotal(g) < DOCK_CAP) {
    const good = a.carry.sugar > 0 ? 'sugar' : 'protein';
    a.carry[good]--; g.dock[good]++;
    // now and then a forager finds a seed among the petals — a baseline
    // trickle so the meadow farm never depends solely on Burrow's gardens
    if (good === 'sugar' && ++g.nectarSeedAcc >= NECTAR_SEED_EVERY) {
      g.nectarSeedAcc = 0;
      if (g.ledge < LEDGE_CAP) {
        g.ledge++;
        toast(g, '🌰 A forager found a seed among the petals — it\'s on the ledge!', false, 'bloom');
      }
    }
  }
  // traffic glow: a delivery warms every edge on the route home (cosmetic)
  if (a.route) {
    for (let i = 1; i < a.route.length; i++) {
      const e = edgeBetween(g, a.route[i - 1], a.route[i]);
      if (e) e.traffic = Math.min(1.5, (e.traffic || 0) + 0.25);
    }
  }
  if (a.carry && carryCount(a) === 0) a.carry = null;
  return !a.carry;
}

function updateOutsideAnt(g, a, dt) {
  switch (a.state) {
    case 'idleOut': {
      if (g.recall) { a.state = 'goingIn'; break; }
      const route = pickRoute(g, a);
      if (route && route.length > 1) {
        a.route = route; a.ri = 1; a.state = 'routeOut';
        break;
      }
      wander(g, a, dt, DOCK_POINT.x - 60, DOCK_POINT.y, 70, false);
      break;
    }
    case 'routeOut': {
      if (!a.route) { a.state = 'freeBack'; break; }
      if (g.recall) { a.state = 'routeBack'; break; }
      const node = nodePos(g, a.route[a.ri]);
      if (!node) { a.route = null; a.state = 'freeBack'; break; }
      if (moveToward(a, node.x, node.y, outSpeed(g), dt, 4)) {
        const src = srcById(g, a.route[a.ri]);
        if (harvestable(g, a, src)) { a.state = 'harvest'; a.timer = HARVEST_TIME; a.hdir = 1; break; }
        if (a.ri >= a.route.length - 1 || carryCount(a) >= 2) a.state = 'routeBack';
        else a.ri++;
      }
      break;
    }
    case 'harvest': {
      const src = srcById(g, a.route ? a.route[a.ri] : -1);
      if (!src || src.amt <= 0 || !slotFree(a, src)) {
        a.state = a.hdir === 1 ? 'routeOut' : 'routeBack';
        if (a.hdir === 1 && a.route && (a.ri >= a.route.length - 1 || carryCount(a) >= 2)) a.state = 'routeBack';
        else if (a.hdir === 1 && a.route) a.ri++;
        break;
      }
      a.timer -= dt;
      if (a.timer <= 0) {
        src.amt--;
        if (!a.carry) a.carry = { sugar: 0, protein: 0 };
        a.carry[srcGood(src)]++;
        if (a.hdir === 1 && a.route && a.ri < a.route.length - 1 && carryCount(a) < 2 && !g.recall) {
          a.ri++; a.state = 'routeOut';
        } else {
          a.state = 'routeBack';
        }
      }
      break;
    }
    case 'routeBack': {
      if (!a.route) { a.state = 'freeBack'; break; }
      if (a.ri <= 0) {
        if (unloadAtDock(g, a)) { a.route = null; a.state = g.recall ? 'goingIn' : 'idleOut'; }
        else a.state = 'waitDock';
        break;
      }
      const node = nodePos(g, a.route[a.ri]);
      if (!node) { a.route = null; a.state = 'freeBack'; break; }
      if (moveToward(a, node.x, node.y, outSpeed(g), dt, 4)) {
        // pick up what we pass on the way home if a paw is free
        const src = srcById(g, a.route[a.ri]);
        if (carryCount(a) < 2 && !g.recall && harvestable(g, a, src)) {
          a.state = 'harvest'; a.timer = HARVEST_TIME; a.hdir = -1;
          break;
        }
        a.ri--;
      }
      break;
    }
    case 'freeBack': {
      if (moveToward(a, DOCK_POINT.x, DOCK_POINT.y, outSpeed(g), dt, 4)) {
        if (unloadAtDock(g, a)) { a.route = null; a.state = g.recall ? 'goingIn' : 'idleOut'; }
        else a.state = 'waitDock';
      }
      break;
    }
    case 'waitDock': {
      if (dockTotal(g) < DOCK_CAP) {
        if (unloadAtDock(g, a)) { a.route = null; a.state = g.recall ? 'goingIn' : 'idleOut'; }
      } else if (g.recall) { a.state = 'goingIn'; }
      else wander(g, a, dt, DOCK_POINT.x - 30, DOCK_POINT.y, 30, false);
      break;
    }
    case 'plantGo': {
      // walking out to pat the seed into the earth (the sprout grows either way)
      if (moveToward(a, a.px, a.py, outSpeed(g), dt, 5)) a.state = 'idleOut';
      break;
    }
    case 'goingIn': {
      if (moveToward(a, DOCK_POINT.x, DOCK_POINT.y, outSpeed(g), dt, 4)) {
        while (a.carry && carryCount(a) > 0 && dockTotal(g) < DOCK_CAP) {
          const good = a.carry.sugar > 0 ? 'sugar' : 'protein';
          a.carry[good]--; g.dock[good]++;
        }
        a.carry = null; a.route = null;
        a.side = 'in';
        a.x = ENTRANCE.c + 0.5; a.y = ENTRANCE.r + 0.5;
        goIdleIn(a);
      }
      break;
    }
    default: a.state = 'idleOut';
  }
}

// ---- inside labor: dig, feed the queen, haul, ferry seeds, clear gardens ----
function inSpeed(g) { return ANT_SPEED_IN * (g.prepared ? PREP_SPEED : 1); }
function pathToProtein(g, a) {
  return bfs(g, cellOf(a.x, a.y), (c, r) => {
    const cell = g.grid[r][c];
    return cell.kind === 'stockpile' && cell.protein > 0;
  });
}
function pathToStockSpace(g, a) {
  const d = dampRow(g);
  return bfs(g, cellOf(a.x, a.y), (c, r) => {
    const cell = g.grid[r][c];
    return cell.kind === 'stockpile' && cell.sugar + cell.protein < STOCK_CAP && r < d;
  });
}
function returnGoods(g, a) {
  if (a.carry) {
    for (const good of ['sugar', 'protein']) {
      let n = a.carry[good];
      for (const row of g.grid) for (const cell of row) {
        if (n > 0 && cell.kind === 'stockpile' && cell.sugar + cell.protein < STOCK_CAP) {
          cell[good]++; n--;
        }
      }
    }
  }
  a.carry = null;
}
function deliverPath(g, a) {
  return bfs(g, cellOf(a.x, a.y), (c, r) => c === g.queenCell.c && r === g.queenCell.r);
}

function updateInsideAnt(g, a, dt) {
  switch (a.state) {
    case 'idleIn': {
      // 1. construction
      let tookDig = false;
      for (const d of g.digs) {
        if (d.assigned) continue;
        const path = bfs(g, cellOf(a.x, a.y), (c, r) => Math.abs(c - d.c) + Math.abs(r - d.r) === 1);
        if (path !== null) { d.assigned = true; a.dig = d; a.path = path; a.state = 'digGo'; tookDig = true; break; }
      }
      if (tookDig) break;
      // 2. protein for the queen — how eggs get made
      if (queenWantsProtein(g) && !fetching(g, 'queenProtein')) {
        const path = pathToProtein(g, a);
        if (path !== null) { a.fetch = { purpose: 'queenProtein' }; a.path = path; a.state = 'fetchGo'; break; }
      }
      // 3. carry a seed out to the ledge — Bloom is waiting for it
      if (g.seedStore > 0 && g.ledge < LEDGE_CAP && !fetching(g, 'seedOut')) {
        const path = bfs(g, cellOf(a.x, a.y), (c, r) => c === ENTRANCE.c && r === ENTRANCE.r);
        if (path !== null) { a.fetch = { purpose: 'seedOut' }; a.path = path; a.state = 'seedGo'; break; }
      }
      // 4. haul dock goods into the stores
      if (dockTotal(g) > 0 && stockSpace(g) > 0) {
        const haulers = g.ants.filter(x => x.state === 'haulGo').length;
        if (haulers * HAUL_LOAD < dockTotal(g)) {
          const path = bfs(g, cellOf(a.x, a.y), (c, r) => c === ENTRANCE.c && r === ENTRANCE.r);
          if (path !== null) { a.path = path; a.state = 'haulGo'; break; }
        }
      }
      // 5. clear harvested garden pieces into the stores
      if (stockSpace(g) > 0 && !fetching(g, 'gardenClear')) {
        const path = bfs(g, cellOf(a.x, a.y), (c, r) => g.grid[r][c].kind === 'garden' && g.grid[r][c].gp > 0);
        if (path !== null) { a.fetch = { purpose: 'gardenClear' }; a.path = path; a.state = 'gardenGo'; break; }
      }
      wander(g, a, dt, g.queenCell.c + 0.5, g.queenCell.r + 0.5, 1.6, true);
      break;
    }
    case 'goingOut': {
      if (followPath(g, a, dt, inSpeed(g))) {
        a.side = 'out';
        a.x = DOCK_POINT.x; a.y = DOCK_POINT.y;
        a.state = 'idleOut';
      }
      break;
    }
    case 'fetchGo': {
      if (!a.fetch) { goIdleIn(a); break; }
      if (followPath(g, a, dt, inSpeed(g))) {
        const at = cellOf(a.x, a.y);
        const cell = g.grid[at.r][at.c];
        if (cell.kind !== 'stockpile' || cell.protein <= 0) { goIdleIn(a); break; }
        cell.protein--;
        a.carry = { sugar: 0, protein: 1 };
        const path = deliverPath(g, a);
        if (path === null) { returnGoods(g, a); goIdleIn(a); break; }
        a.path = path;
        a.state = 'deliverGo';
      }
      break;
    }
    case 'deliverGo': {
      if (!a.fetch) { returnGoods(g, a); goIdleIn(a); break; }
      if (followPath(g, a, dt, inSpeed(g))) {
        const at = cellOf(a.x, a.y);
        if (Math.max(Math.abs(at.c - g.queenCell.c), Math.abs(at.r - g.queenCell.r)) <= 1) {
          g.queenFed++;
          a.carry = null;
        } else {
          const p = deliverPath(g, a);
          if (p !== null) { a.path = p; break; }
          returnGoods(g, a);
        }
        goIdleIn(a);
      }
      break;
    }
    case 'seedGo': {
      if (followPath(g, a, dt, inSpeed(g))) {
        if (g.seedStore > 0 && g.ledge < LEDGE_CAP) {
          g.seedStore--; g.ledge++;
          toast(g, '🌰 A seed arrived on the dock ledge — plant it!', false, 'bloom');
        }
        goIdleIn(a);
      }
      break;
    }
    case 'digGo': {
      if (!a.dig || !g.digs.includes(a.dig)) { goIdleIn(a); break; }
      if (followPath(g, a, dt, inSpeed(g))) {
        a.state = 'digging';
        a.timer = a.dig.fill ? FILL_TIME : DIG_TIME;
      }
      break;
    }
    case 'digging': {
      if (!a.dig || !g.digs.includes(a.dig)) { goIdleIn(a); break; }
      a.timer -= dt;
      if (a.timer <= 0) {
        const { c, r, fill } = a.dig;
        if (fill) {
          const occupied = (g.queenCell.c === c && g.queenCell.r === r)
            || g.eggs.some(e => e.c === c && e.r === r);
          if (occupied) {
            toast(g, 'Can\'t backfill that chamber — someone is still in it.', true, 'burrow');
          } else {
            const cell = g.grid[r][c];
            cell.dug = false; cell.kind = null;
            cell.sugar = 0; cell.protein = 0; cell.gs = 0; cell.gt = 0; cell.gp = 0;
            for (const o of g.ants) {
              if (o === a || o.side !== 'in') continue;
              const oc = cellOf(o.x, o.y);
              if (oc.c === c && oc.r === r) { o.x = a.x; o.y = a.y; goIdleIn(o); }
            }
          }
        } else {
          g.grid[r][c].dug = true;
        }
        g.digs.splice(g.digs.indexOf(a.dig), 1);
        goIdleIn(a);
      }
      break;
    }
    case 'haulGo': {
      if (followPath(g, a, dt, inSpeed(g))) {
        // prefer whichever good the stores are shorter on — protein must
        // never crowd the sugar out of the pantry
        const t = storeTotals(g);
        let good = null;
        if (g.dock.sugar > 0 && g.dock.protein > 0) good = t.sugar <= t.protein ? 'sugar' : 'protein';
        else if (g.dock.sugar > 0) good = 'sugar';
        else if (g.dock.protein > 0) good = 'protein';
        if (!good || stockSpace(g) <= 0) { goIdleIn(a); break; }
        const take = Math.min(HAUL_LOAD, g.dock[good], stockSpace(g));
        g.dock[good] -= take;
        a.carry = { sugar: 0, protein: 0 };
        a.carry[good] = take;
        const path = pathToStockSpace(g, a);
        if (path === null) {
          g.dock[good] += take;
          a.carry = null; goIdleIn(a); break;
        }
        a.path = path; a.state = 'haulReturn';
      }
      break;
    }
    case 'gardenGo': {
      if (followPath(g, a, dt, inSpeed(g))) {
        const at = cellOf(a.x, a.y);
        const cell = g.grid[at.r][at.c];
        if (cell.kind !== 'garden' || cell.gp <= 0) { goIdleIn(a); break; }
        const take = Math.min(HAUL_LOAD, cell.gp);
        cell.gp -= take;
        a.carry = { sugar: 0, protein: take };
        const path = pathToStockSpace(g, a);
        if (path === null) { cell.gp += take; a.carry = null; goIdleIn(a); break; }
        a.path = path; a.state = 'haulReturn'; a.fetch = null;
      }
      break;
    }
    case 'haulReturn': {
      if (followPath(g, a, dt, inSpeed(g))) {
        const at = cellOf(a.x, a.y);
        const cell = g.grid[at.r][at.c];
        if (a.carry && cell.kind === 'stockpile') {
          for (const good of ['sugar', 'protein']) {
            const put = Math.min(a.carry[good], STOCK_CAP - cell.sugar - cell.protein);
            cell[good] += put;
            a.carry[good] -= put;
          }
        }
        if (a.carry && carryCount(a) > 0) {
          const path = pathToStockSpace(g, a);
          if (path !== null) { a.path = path; break; }
          g.dock.sugar += a.carry.sugar; g.dock.protein += a.carry.protein;   // back to the dock pile
        }
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
  g.overMsg = msg + ` — Colony Bloom: ⭐ ${score(g)} (Year ${g.year}).`;
}

// ---------- commands ----------
function command(g, role, cmd) {
  if (g.gameOver) return;
  if (g.stats && g.stats.cmds[role] !== undefined) g.stats.cmds[role]++;
  if (role === 'bloom') {
    if (cmd.type === 'edge') {
      const A = cmd.a | 0, B = cmd.b | 0;
      const pa = nodePos(g, A), pb = nodePos(g, B);
      if (!pa || !pb || A === B) return;
      if (edgeBetween(g, A, B)) { toast(g, 'Those two are already linked.', true, 'bloom'); return; }
      const aIn = A in g.parent, bIn = B in g.parent;
      if (aIn && bIn) { toast(g, 'Both ends are already on the network.', true, 'bloom'); return; }
      if (!aIn && !bIn) { toast(g, 'Start from the network — every trail leads home.', true, 'bloom'); return; }
      const len = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (len < 20) return;
      if (len > EDGE_MAX_LEN) { toast(g, 'Too far for one trail — hop through a node partway.', true, 'bloom'); return; }
      const cost = Math.ceil(len / SEG_PX);
      if (segUsed(g) + cost > segCap(g)) {
        toast(g, `Not enough trail segments (${cost} needed, ${segCap(g) - segUsed(g)} free) — erase somewhere, or grow the colony.`, true, 'bloom');
        return;
      }
      g.edges.push({ id: EDGE_SEQ++, a: A, b: B, len: Math.round(len), cost, orphan: false, orphanT: 0, traffic: 0 });
      recomputeTree(g);
    } else if (cmd.type === 'erase') {
      // winter is planning season: refunds are instant under the snow
      removeEdge(g, cmd.id | 0, season(g).name === 'Winter' ? 0 : ERASE_REFUND_DELAY);
    } else if (cmd.type === 'plant') {
      if (g.ledge <= 0) { toast(g, 'No seed on the ledge — Burrow\'s gardens make them.', true, 'bloom'); return; }
      const x = +cmd.x, y = +cmd.y;
      if (!isFinite(x) || !isFinite(y) || x < 40 || x > WORLD.w - 60 || y < 45 || y > WORLD.h - 45) return;
      if (Math.hypot(x - DOCK_POINT.x, y - DOCK_POINT.y) < PLANT_MIN_DOCK) {
        toast(g, 'Nothing grows on the trampled earth near the pit — plant farther out.', true, 'bloom');
        return;
      }
      const near = g.sources.some(s => Math.hypot(s.x - x, s.y - y) < PLANT_MIN_SPACING);
      if (near) { toast(g, 'Too close to another plant — give the roots room.', true, 'bloom'); return; }
      g.ledge--;
      // winter planting tucks the seed under the snow: a node you can wire
      // trails to RIGHT NOW — plan next spring's whole tree while it sleeps
      plantFlower(g, x, y, season(g).name === 'Winter');
    } else if (cmd.type === 'recall') {
      g.recall = !g.recall;
    } else if (cmd.type === 'warn') {
      const sn = season(g).name;
      const left = Math.ceil(season(g).len - g.seasonT);
      if (sn === 'Autumn' && !g.warnWinter) {
        g.warnWinter = true;
        toast(g, `⚠ 🌸 Bloom warns: WINTER in ~${left}s — hoard sugar, carry the queen down! (a warned colony works faster)`, true, 'burrow');
      } else if (sn === 'Winter' && !g.warnMelt) {
        g.warnMelt = true;
        toast(g, `⚠ 🌸 Bloom warns: the THAW in ~${left}s — the damp will rise, plan the queen's climb!`, true, 'burrow');
      }
    }
  } else if (role === 'burrow') {
    const c = cmd.c | 0, r = cmd.r | 0;
    const valid = c >= 0 && r >= 0 && c < GRID.cols && r < GRID.rows;
    if (!valid && cmd.type !== 'alloc' && cmd.type !== 'brood') return;
    const cell = valid ? g.grid[r][c] : null;
    if (cmd.type === 'dig') {
      const existing = g.digs.findIndex(d => d.c === c && d.r === r);
      if (existing >= 0) g.digs.splice(existing, 1);
      else if (!cell.dug) {
        const nextToTunnel = [[1,0],[-1,0],[0,1],[0,-1]].some(([dc, dr]) => {
          const cc = c + dc, rr = r + dr;
          return cc >= 0 && rr >= 0 && cc < GRID.cols && rr < GRID.rows && g.grid[rr][cc].dug;
        }) || g.digs.some(d => !d.fill && Math.abs(d.c - c) + Math.abs(d.r - r) === 1);
        if (nextToTunnel) g.digs.push({ c, r, assigned: false, fill: false });
        else toast(g, 'Dig next to an existing tunnel.', true, 'burrow');
      }
    } else if (cmd.type === 'fill') {
      const existing = g.digs.findIndex(d => d.c === c && d.r === r);
      if (existing >= 0) { g.digs.splice(existing, 1); return; }
      if (!cell.dug) return;
      if (c === ENTRANCE.c && r === ENTRANCE.r) { toast(g, 'The entrance can\'t be filled.', true, 'burrow'); return; }
      if (cell.kind) {
        if (g.eggs.some(e => e.c === c && e.r === r)) { toast(g, 'The brood is still in there!', true, 'burrow'); return; }
        if (cell.sugar + cell.protein + cell.gp > 0) toast(g, 'The stored goods were lost with the room.', true, 'burrow');
        cell.kind = null; cell.sugar = 0; cell.protein = 0; cell.gs = 0; cell.gt = 0; cell.gh = 0; cell.gp = 0;
      } else {
        if (g.queenCell.c === c && g.queenCell.r === r) { toast(g, 'The queen is in there!', true, 'burrow'); return; }
        g.digs.push({ c, r, assigned: false, fill: true });
      }
    } else if (cmd.type === 'build') {
      if (!cell.dug || cell.kind) return;
      if (cmd.kind === 'stockpile') {
        cell.kind = 'stockpile';
      } else if (cmd.kind === 'nursery') {
        cell.kind = 'nursery';
      } else if (cmd.kind === 'garden') {
        if (gardenCount(g) >= gardenCap(g)) {
          toast(g, `Garden slots: ${gardenCap(g)} — the colony must grow before it farms more.`, true, 'burrow');
          return;
        }
        cell.kind = 'garden'; cell.gs = 0; cell.gt = 0; cell.gh = 0; cell.gp = 0;
      }
    } else if (cmd.type === 'seedGarden') {
      if (cell.kind !== 'garden' || cell.gs !== 0 || cell.gp > 0) return;
      const t = storeTotals(g);
      if (t.sugar < 1 || t.protein < 1) {
        toast(g, 'Seeding a garden takes 1🍯 + 1🥩 compost from the stores.', true, 'burrow');
        return;
      }
      payGood(g, 'sugar', 1); payGood(g, 'protein', 1);
      cell.gs = 1; cell.gt = 0;
    } else if (cmd.type === 'harvest') {
      if (cell.kind !== 'garden' || cell.gs < GARDEN_STAGES) return;
      cell.gs = 0; cell.gt = 0; cell.gh++;
      cell.gp += GARDEN_YIELD;
      g.stats.gardenHarvests++;
      g.yearStats.harvests++;
      if (cell.gh % GARDEN_SEED_EVERY === 0) {
        if (g.seedStore + g.ledge < LEDGE_CAP) {
          g.seedStore++;
        } else {
          cell.gp++;   // seeds are precious but not infinite — extra becomes food
        }
      }
    } else if (cmd.type === 'feed') {
      if (cell.kind !== 'nursery') return;
      for (const e of g.eggs) {
        if (e.c !== c || e.r !== r || e.fedT > 0) continue;
        if (!payGood(g, 'sugar', 1)) {
          toast(g, 'No sugar in the stores to feed the brood!', true, 'burrow');
          break;
        }
        e.fedT = EGG_FEED_TIME;
      }
    } else if (cmd.type === 'moveQueen' && valid) {
      if (!cell.dug) {
        toast(g, 'The queen needs a dug chamber.', true, 'burrow');
      } else {
        const path = bfs(g, g.queenCell, (cc, rr) => cc === c && rr === r);
        if (path === null) toast(g, 'No open path for the queen.', true, 'burrow');
        else if (path.length) g.queen.path = path;
      }
    } else if (cmd.type === 'brood') {
      g.broodOn = !g.broodOn;
    } else if (cmd.type === 'alloc') {
      g.desiredOutside = Math.max(0, Math.min(60, cmd.n | 0));
    }
  }
}

// ---------- serialization ----------
function publicState(g) {
  const gridRows = g.grid.map(row => row.map(cell => {
    if (!cell.dug) return '#';
    if (cell.kind === 'stockpile') return 'S';
    if (cell.kind === 'nursery') return 'N';
    if (cell.kind === 'garden') return 'G';
    return '.';
  }).join(''));
  const stocks = [];
  const gardens = [];
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) {
    const cell = g.grid[r][c];
    if (cell.kind === 'stockpile' && cell.sugar + cell.protein > 0) {
      stocks.push({ c, r, s: cell.sugar, p: cell.protein });
    }
    if (cell.kind === 'garden') {
      gardens.push({ c, r, st: cell.gs, t: Math.round(cell.gt), pc: cell.gp, ok: inComfort(g, r) ? 1 : 0 });
    }
  }
  const totals = storeTotals(g);
  return {
    world: WORLD, gridDim: GRID,
    dockCap: DOCK_CAP, ledgeCap: LEDGE_CAP, stockCellCap: STOCK_CAP, eggProtein: EGG_PROTEIN,
    gardenStages: GARDEN_STAGES,
    plantMinDock: PLANT_MIN_DOCK,
    seasons: SEASONS.map(s => ({ name: s.name, len: s.len, events: s.events })),
    year: g.year, seasonIdx: g.seasonIdx, seasonT: Math.round(g.seasonT * 10) / 10,
    seasonLen: season(g).len,
    raining: g.raining, drought: g.drought, mud: g.mudT > 0,
    seg: { used: segUsed(g), cap: segCap(g) },
    milestone: g.milestone,
    nextMilestone: milestoneThreshold(g.milestone),
    gardenCap: gardenCap(g), gardenCount: gardenCount(g),
    score: score(g),
    store: totals, caps: { total: stockCaps(g) },
    stocks, gardens,
    seeds: { store: g.seedStore, ledge: g.ledge },
    dock: g.dock, desiredOutside: g.desiredOutside, recall: g.recall,
    queenHP: Math.round(g.queenHP), starving: g.starving, proteinDiet: g.proteinDiet,
    queenStress: queenBandStress(g) > 0,
    queenCell: g.queenCell,
    queen: { x: Math.round(g.queen.x * 100) / 100, y: Math.round(g.queen.y * 100) / 100, moving: g.queen.path.length > 0 },
    queenFed: g.queenFed, broodOn: g.broodOn,
    warn: { winterGiven: g.warnWinter, meltGiven: g.warnMelt },
    prepared: g.prepared,
    frostRow: Math.round(frostRow(g) * 10) / 10,
    dampRow: Math.round(dampRow(g) * 10) / 10,
    ants: g.ants.map(a => ({
      s: a.side === 'out' ? 1 : 0,
      x: Math.round(a.x * 100) / 100, y: Math.round(a.y * 100) / 100,
      c: a.carry ? ((a.carry.sugar > 0 ? 1 : 0) | (a.carry.protein > 0 ? 2 : 0)) : 0,
    })),
    sources: g.sources.map(s => ({
      id: s.id, x: Math.round(s.x), y: Math.round(s.y), type: s.type, amt: s.amt,
      pl: s.planted ? 1 : 0, husk: isHusk(s) ? 1 : 0, sprout: s.sproutT > 0 ? Math.ceil(s.sproutT) : 0,
      dm: s.dormant ? 1 : 0,
    })),
    edges: g.edges.map(e => ({
      id: e.id, a: e.a, b: e.b, cost: e.cost,
      orphan: e.orphan ? 1 : 0, traffic: Math.round((e.traffic || 0) * 100) / 100,
    })),
    grid: gridRows,
    digs: g.digs.map(d => ({ c: d.c, r: d.r, f: d.fill ? 1 : 0 })),
    eggs: g.eggs.map(e => ({
      c: e.c, r: e.r, t: Math.round(e.t), w: e.w ? 1 : 0,
      f: e.fedT > 0 ? 1 : 0, ok: e.ok === false ? 0 : 1,
    })),
    postcard: g.postcard,
    toasts: g.toasts,
    gameOver: g.gameOver, overMsg: g.overMsg,
  };
}

module.exports = {
  createGame, tick, command, publicState, SEASONS, storeTotals, stockCaps,
  frostRow, dampRow, inComfort, GRID, score,
};
