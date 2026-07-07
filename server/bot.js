// Bot partner — fills the other role so you can test solo.
// Strategies are ported from the headless balance harness: the Bloom bot
// builds branching trail networks (spine strategy), the Burrow bot digs
// sumps ahead of the rains, expands storage, and keeps breeding.

'use strict';

const { command } = require('./game');

const SUMP_PLAN = [[1,4],[1,5],[2,5],[1,6],[2,6],[0,5],[2,4],[1,7],[2,7],[0,6]];
const STORE_PLAN = [[6,2],[6,3],[7,2],[7,3],[6,1]];
const BUNKER_PLAN = [[4,3],[4,4],[4,5],[4,6],[4,7],[4,8]];  // contiguous shaft below the frost
const QUEEN_WINTER = { c: 4, r: 8 };
const QUEEN_SUMMER = { c: 4, r: 2 };
const DOCK = { x: 975, y: 310 };

function newBotState() {
  return { actT: 0, trailT: 1.5, sumpDug: 0, storeBuilt: 0, bunkerDug: 0 };
}

function seg(x0, y0, x1, y1) {
  const pts = [];
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 15);
  for (let i = 1; i <= n; i++) {
    pts.push([Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n)]);
  }
  return pts;
}

function act(g, role, st, dt) {
  if (g.gameOver) return;
  st.actT += dt;
  if (st.actT < 1) return;   // think once a second, like a (fast) human
  st.actT = 0;
  const sn = ['Spring', 'Summer', 'Autumn', 'Winter'][g.seasonIdx];

  if (role === 'bloom') {
    const wantRecall = (sn === 'Autumn' && g.seasonT > 34) || sn === 'Winter';
    if (wantRecall !== g.recall) command(g, 'bloom', { type: 'recall' });
    st.trailT += 1;
    if (st.trailT >= 2 && sn !== 'Winter') {
      st.trailT = 0;
      for (const src of g.sources) {
        if (src.amt <= 0) continue;
        if (src.type === 'carcass' && g.store.protein > 20) continue;
        if (g.trails.length >= 12) break;
        const covered = g.trails.some(t => t.srcS.some(e => e.id === src.id));
        if (covered) continue;
        // branch from the nearest point of the existing network (spine play)
        let anchor = { x: DOCK.x, y: DOCK.y, attachId: null, attachIdx: 0 };
        let bestD = Math.hypot(DOCK.x - src.x, DOCK.y - src.y);
        for (const t of g.trails) {
          for (let k = Math.max(0, t.ownStart - 1); k < t.pts.length; k++) {
            const d = Math.hypot(t.pts[k].x - src.x, t.pts[k].y - src.y);
            if (d < bestD) { bestD = d; anchor = { x: t.pts[k].x, y: t.pts[k].y, attachId: t.id, attachIdx: k }; }
          }
        }
        if (g.pher >= bestD / 10 + 3) {
          command(g, 'bloom', {
            type: 'trail', pts: seg(anchor.x, anchor.y, src.x, src.y),
            attachId: anchor.attachId, attachIdx: anchor.attachIdx,
          });
        }
      }
      // housekeeping: erase childless trails that lead to nothing
      for (const t of [...g.trails]) {
        const hasChild = g.trails.some(c => c.parentId === t.id);
        const alive = t.srcS.some(e => { const s = g.sources.find(x => x.id === e.id); return s && s.amt > 0; });
        if (!alive && !hasChild) command(g, 'bloom', { type: 'erase', id: t.id });
      }
    }
    return;
  }

  // ---- burrow ----
  command(g, 'burrow', { type: 'alloc', n: Math.max(3, Math.ceil(g.ants.length * 0.55)) });
  // widen the sump every summer, ahead of autumn's rains
  if (sn === 'Summer' && st.sumpDug < 2 + g.year * 2 && g.digs.length === 0) {
    const nx = SUMP_PLAN[st.sumpDug];
    if (nx && !g.grid[nx[1]][nx[0]].dug) { command(g, 'burrow', { type: 'dig', c: nx[0], r: nx[1] }); st.sumpDug++; }
    else if (nx) st.sumpDug++;
  }
  // dig the winter bunker in autumn, then migrate the queen with the seasons
  if (sn === 'Autumn' && st.bunkerDug < BUNKER_PLAN.length && g.digs.length === 0) {
    const nx = BUNKER_PLAN[st.bunkerDug];
    if (!g.grid[nx[1]][nx[0]].dug) { command(g, 'burrow', { type: 'dig', c: nx[0], r: nx[1] }); st.bunkerDug++; }
    else st.bunkerDug++;
  }
  if (!g.queen.path.length) {
    if (sn === 'Winter' && g.queenCell.r < QUEEN_WINTER.r && g.grid[QUEEN_WINTER.r][QUEEN_WINTER.c].dug) {
      command(g, 'burrow', { type: 'moveQueen', c: QUEEN_WINTER.c, r: QUEEN_WINTER.r });
    } else if (sn !== 'Winter' && sn !== 'Autumn' && g.queenCell.r > 4) {
      command(g, 'burrow', { type: 'moveQueen', c: QUEEN_SUMMER.c, r: QUEEN_SUMMER.r });
    }
  }
  // expand storage when the pantry fills or the dock backs up
  let cap = 0;
  for (const row of g.grid) for (const cell of row) if (cell.kind === 'stockpile' && cell.dug) cap += 25;
  const total = g.store.sugar + g.store.protein;
  if ((total > 0.7 * cap || g.dock.sugar + g.dock.protein >= 12) && g.digs.length === 0
      && st.storeBuilt < STORE_PLAN.length) {
    const [c, r] = STORE_PLAN[st.storeBuilt];
    if (!g.grid[r][c].dug) command(g, 'burrow', { type: 'dig', c, r });
    else if (!g.grid[r][c].kind) { command(g, 'burrow', { type: 'build', kind: 'stockpile', c, r }); st.storeBuilt++; }
    else st.storeBuilt++;
  }
  // breed while times are good — but only when the queen is near the nursery
  const nurseryEggs = g.eggs.filter(e => e.c === 3 && e.r === 3).length;
  const queenNear = Math.hypot(3.5 - g.queen.x, 3.5 - g.queen.y) <= 3.5;
  if (g.ants.length + g.eggs.length < 16 && sn !== 'Autumn' && sn !== 'Winter'
      && g.store.sugar > 14 && g.store.protein >= 4 && nurseryEggs < 3 && queenNear) {
    command(g, 'burrow', { type: 'egg', c: 3, r: 3 });
  }
}

module.exports = { newBotState, act };
