// Bot partner — fills the other role so you can test solo, and drives the
// headless balance harness. v7 strategies:
//  - Bloom: connects food into a dock-rooted tree (nearest-node attach),
//    prunes husk leaves, plants seeds as junction hubs partway to the wilds,
//    warns before winter and before the melt, recalls ahead of the frost.
//  - Burrow: digs a summer wing (shallow gardens) and a winter wing (deep
//    bunker + nursery + gardens), farms on cooldown, tap-feeds the brood,
//    walks the queen down ahead of the frost and up at the thaw.

'use strict';

const { command, storeTotals, stockCaps, GRID } = require('./game');

const DOCK = { x: 975, y: 310 };

// build order: dig-only entries have kind null; rooms get dug then built.
// Summer wing sits at rows 4–5 (below the drought line at 4, above the
// spring damp peak at 7.5). Winter wing sits at rows 9–11 (below the frost
// peak, above the permanent groundwater at 14).
const BUILD_PLAN = [
  { c: 5, r: 4, kind: 'garden' },       // first garden, right by the quarters
  { c: 3, r: 4, kind: 'stockpile' },    // more pantry near the action
  { c: 4, r: 4, kind: null },           // the shaft begins
  { c: 4, r: 5, kind: null },
  { c: 4, r: 6, kind: null },
  { c: 4, r: 7, kind: null },
  { c: 4, r: 8, kind: null },
  { c: 4, r: 9, kind: null },
  { c: 4, r: 10, kind: null },          // queen's winter chamber
  { c: 3, r: 10, kind: 'nursery' },     // winter nursery beside her
  { c: 5, r: 10, kind: 'stockpile' },   // winter pantry — the hoard lives here
  { c: 6, r: 4, kind: 'garden' },       // second garden (opens at milestone 1)
  { c: 5, r: 9, kind: 'garden' },       // winter garden (milestone 2)
  { c: 3, r: 9, kind: 'stockpile' },
  { c: 6, r: 9, kind: 'garden' },       // milestone 3
  { c: 2, r: 4, kind: 'stockpile' },
  // the colony keeps growing (milestones every +8 ants) — keep expanding both
  // wings: more pantry for the bigger winter hoard, more gardens as slots open
  { c: 5, r: 5, kind: 'stockpile' },
  { c: 6, r: 5, kind: 'stockpile' },
  { c: 6, r: 10, kind: 'stockpile' },
  { c: 7, r: 4, kind: 'garden' },
  { c: 3, r: 5, kind: 'stockpile' },
  { c: 7, r: 9, kind: 'garden' },
  { c: 2, r: 9, kind: 'stockpile' },
  { c: 7, r: 5, kind: 'stockpile' },
  { c: 7, r: 10, kind: 'stockpile' },
  { c: 8, r: 4, kind: 'garden' },
  { c: 8, r: 9, kind: 'garden' },
  { c: 8, r: 5, kind: 'stockpile' },
  { c: 8, r: 10, kind: 'stockpile' },
];
const QUEEN_WINTER = { c: 4, r: 10 };
const QUEEN_SUMMER = { c: 4, r: 2 };

function newBotState() {
  return { actT: 0, warnedWinter: 0, warnedMelt: 0, planted: 0 };
}

function isHuskLike(s) {
  if (s.sproutT > 0) return false;
  return s.planted ? s.dead : s.amt <= 0;
}

function act(g, role, st, dt) {
  if (g.gameOver) return;
  st.actT += dt;
  if (st.actT < 1) return;   // think once a second, like a (fast) human
  st.actT = 0;
  const sn = ['Spring', 'Summer', 'Autumn', 'Winter'][g.seasonIdx];
  const totals = storeTotals(g);

  if (role === 'bloom') {
    // callouts — a warned colony works faster all season
    if (sn === 'Autumn' && st.warnedWinter !== g.year && g.seasonT > 20) {
      command(g, 'bloom', { type: 'warn' });
      st.warnedWinter = g.year;
    }
    if (sn === 'Winter' && st.warnedMelt !== g.year && g.seasonT > 4) {
      command(g, 'bloom', { type: 'warn' });
      st.warnedMelt = g.year;
    }
    // recall ahead of the frost so nobody freezes outside — the far routes
    // take a while to walk home
    const wantRecall = (sn === 'Autumn' && g.seasonT > 36) || sn === 'Winter';
    if (wantRecall !== g.recall) command(g, 'bloom', { type: 'recall' });

    // grow the tree: hook every living source to its nearest network node
    const inTree = (id) => id in g.parent;
    const nodePos = (id) => id === 0 ? DOCK : g.sources.find(s => s.id === id);
    const segFree = () => {
      let used = 0;
      for (const e of g.edges) used += e.cost;
      for (const r of g.refunds) used += r.amt;
      return (8 + 2 * g.milestone) - used;
    };
    for (const src of g.sources) {
      if (isHuskLike(src)) continue;
      if (src.amt <= 0 && !src.planted && src.sproutT <= 0) continue;
      if (inTree(src.id)) continue;
      // protein backing up on the dock = Burrow can't take more — stop
      // trailing carcasses until the jam clears (the dock IS the signal)
      if (src.type === 'carcass' && g.dock.protein >= 5) continue;
      // nearest attach point among tree nodes (dock included)
      let best = null, bestD = 601;
      for (const id of Object.keys(g.parent)) {
        const p = nodePos(+id);
        if (!p) continue;
        const d = Math.hypot(p.x - src.x, p.y - src.y);
        if (d < bestD) { bestD = d; best = +id; }
      }
      if (best === null) continue;
      const cost = Math.ceil(bestD / 150);
      if (cost <= segFree()) {
        command(g, 'bloom', { type: 'edge', a: best, b: src.id });
      }
    }
    // prune: husk LEAVES pay segments for dead geography — cut them loose
    for (const src of g.sources) {
      if (!isHuskLike(src)) continue;
      const touching = g.edges.filter(e => e.a === src.id || e.b === src.id);
      if (touching.length === 1 && !touching[0].orphan) {
        command(g, 'bloom', { type: 'erase', id: touching[0].id });
      }
    }
    // plant seeds partway toward the food — a hub the tree can trunk through
    if (g.ledge > 0) {
      const alive = g.sources.filter(s => s.amt > 0 && !s.planted);
      let ang = Math.random() * Math.PI * 2;
      if (alive.length) {
        const cx = alive.reduce((n, s) => n + s.x, 0) / alive.length;
        const cy = alive.reduce((n, s) => n + s.y, 0) / alive.length;
        ang = Math.atan2(cy - DOCK.y, cx - DOCK.x);
      }
      for (let tries = 0; tries < 12; tries++) {
        const d = 280 + Math.random() * 170;
        const a2 = ang + (Math.random() - 0.5) * 1.2;
        const x = DOCK.x + Math.cos(a2) * d;
        const y = DOCK.y + Math.sin(a2) * d;
        if (x < 60 || x > 920 || y < 60 || y > 560) continue;
        if (g.sources.some(s => Math.hypot(s.x - x, s.y - y) < 90)) continue;
        command(g, 'bloom', { type: 'plant', x: Math.round(x), y: Math.round(y) });
        st.planted++;
        break;
      }
    }
    return;
  }

  // ---- burrow ----
  // tend the nursery: tap-feed hungry eggs so they keep growing
  const fedCells = new Set();
  for (const e of g.eggs) {
    const key = e.c + ',' + e.r;
    if (e.fedT <= 0 && !fedCells.has(key)) {
      fedCells.add(key);
      command(g, 'burrow', { type: 'feed', c: e.c, r: e.r });
    }
  }
  // labor split: most ants out in the warm seasons, hoard push in autumn
  const outShare = sn === 'Autumn' ? 0.7 : 0.55;
  const wantOut = Math.max(3, Math.ceil(g.ants.length * outShare));
  if (wantOut !== g.desiredOutside) command(g, 'burrow', { type: 'alloc', n: wantOut });

  // work the build plan: one dig at a time, rooms as soon as cells are dug
  const gardenCap = 1 + g.milestone;
  const gardenCount = () => {
    let n = 0;
    for (const row of g.grid) for (const cell of row) if (cell.kind === 'garden') n++;
    return n;
  };
  for (const step of BUILD_PLAN) {
    const cell = g.grid[step.r][step.c];
    // expand the pantry WITH the colony, not ahead of it — skipped steps get
    // picked up on a later pass once the hoard actually needs the room
    if (step.kind === 'stockpile' && !cell.kind
        && stockCaps(g) >= 24 + g.ants.length * 2) continue;
    if (!cell.dug) {
      if (g.digs.length === 0) command(g, 'burrow', { type: 'dig', c: step.c, r: step.r });
      break;   // wait for the diggers before planning further
    }
    if (step.kind && !cell.kind) {
      if (step.kind === 'garden' && gardenCount() >= gardenCap) continue;   // locked — skip ahead
      command(g, 'burrow', { type: 'build', kind: step.kind, c: step.c, r: step.r });
      break;
    }
  }

  // farm: harvest ripe gardens, reseed empty ones — but let the gardens rest
  // while protein is glutting the pantry (a ripe garden never spoils)
  const proteinGlut = totals.protein > 28;
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) {
    const cell = g.grid[r][c];
    if (cell.kind !== 'garden') continue;
    if (cell.gs >= 4 && !proteinGlut) command(g, 'burrow', { type: 'harvest', c, r });
    else if (cell.gs === 0 && cell.gp === 0 && !proteinGlut
        && totals.sugar >= 3 && totals.protein >= 2) {
      command(g, 'burrow', { type: 'seedGarden', c, r });
    }
  }

  // the queen's year: down ahead of the frost, up at the thaw
  if (!g.queen.path.length) {
    const wantWinter = sn === 'Winter' || (sn === 'Autumn' && g.seasonT > 30);
    if (wantWinter && g.queenCell.r < QUEEN_WINTER.r
        && g.grid[QUEEN_WINTER.r][QUEEN_WINTER.c].dug) {
      command(g, 'burrow', { type: 'moveQueen', c: QUEEN_WINTER.c, r: QUEEN_WINTER.r });
    } else if ((sn === 'Spring' || sn === 'Summer') && g.queenCell.r > 4) {
      command(g, 'burrow', { type: 'moveQueen', c: QUEEN_SUMMER.c, r: QUEEN_SUMMER.r });
    }
  }

  // brood pacing: always chase the next milestone (+2 buffer), never outrun
  // the pantry, and pause through the autumn hoard push
  const pop = g.ants.length + g.eggs.length;
  const nextThreshold = g.milestone < 4 ? [10, 14, 18, 24][g.milestone] : 24 + 8 * (g.milestone - 3);
  const wantBrood = pop < nextThreshold + 2 && totals.sugar >= 12 && sn !== 'Autumn';
  if (wantBrood !== g.broodOn) command(g, 'burrow', { type: 'brood' });
}

module.exports = { newBotState, act };
