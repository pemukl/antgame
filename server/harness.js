// Headless balance harness with fun-proxy metrics (PLAN.md Phase 0).
// Usage: node harness.js [maxYears] [runs] [mode]
//   mode: both (default) | lazybloom | lazyburrow
// Prints a season-by-season log for the first run, then a summary:
// survival, growth curve, actions/min per role, idle seasons, danger time.

'use strict';

const { createGame, tick, storeTotals, stockCaps, score, GRID } = require('./game');
const bot = require('./bot');

const MAX_YEARS = +(process.argv[2] || 8);
const RUNS = +(process.argv[3] || 1);
const MODE = process.argv[4] || 'both';
const DT = 0.05;

function gardenInfo(g) {
  let n = 0, ripe = 0, growing = 0;
  for (const row of g.grid) for (const cell of row) {
    if (cell.kind !== 'garden') continue;
    n++;
    if (cell.gs >= 4) ripe++;
    else if (cell.gs > 0) growing++;
  }
  return { n, ripe, growing };
}

function run(verbose) {
  const g = createGame();
  const sb = bot.newBotState(), su = bot.newBotState();
  let lastSeason = -1;
  let simT = 0;
  // idle-season tracking: commands issued per role per season
  const idle = { bloom: 0, burrow: 0 };
  let seasonStartCmds = { bloom: 0, burrow: 0 };
  const closeSeason = () => {
    for (const role of ['bloom', 'burrow']) {
      if (g.stats.cmds[role] - seasonStartCmds[role] < 3) idle[role]++;
    }
    seasonStartCmds = { bloom: g.stats.cmds.bloom, burrow: g.stats.cmds.burrow };
  };

  while (!g.gameOver && g.year <= MAX_YEARS) {
    if (g.seasonIdx !== lastSeason) {
      if (lastSeason >= 0) closeSeason();
      lastSeason = g.seasonIdx;
      if (verbose) {
        const t = storeTotals(g);
        const gi = gardenInfo(g);
        const flowers = g.sources.filter(s => s.planted && !s.dead).length;
        console.log(
          `Y${g.year} ${['Spring','Summer','Autumn','Winter'][g.seasonIdx].padEnd(6)} ` +
          `ants=${String(g.ants.length).padStart(2)} eggs=${g.eggs.length} ` +
          `🍯${String(t.sugar).padStart(2)} 🥩${String(t.protein).padStart(2)}/${stockCaps(g)} ` +
          `dock=${g.dock.sugar}+${g.dock.protein} 🌰${g.seedStore}+${g.ledge} ` +
          `gardens=${gi.n}(${gi.growing}▲${gi.ripe}✓) flowers=${flowers} ` +
          `edges=${g.edges.length} qHP=${Math.round(g.queenHP)} q@(${g.queenCell.c},${g.queenCell.r}) ⭐${score(g)}`);
      }
    }
    if (MODE !== 'lazybloom') bot.act(g, 'bloom', sb, DT);
    if (MODE !== 'lazyburrow') bot.act(g, 'burrow', su, DT);
    tick(g, DT);
    simT += DT;
  }
  closeSeason();
  const minutes = simT / 60;
  const res = {
    died: g.gameOver, year: g.year, msg: g.overMsg, ants: g.ants.length,
    score: score(g), milestones: g.milestone,
    harvests: g.stats.gardenHarvests, planted: g.stats.flowersPlanted,
    antsByYear: g.stats.antsByYear.slice(),
    cmdsPerMin: {
      bloom: +(g.stats.cmds.bloom / minutes).toFixed(1),
      burrow: +(g.stats.cmds.burrow / minutes).toFixed(1),
    },
    idle, dangerT: +g.stats.dangerT.toFixed(1),
  };
  if (verbose) {
    console.log(g.gameOver
      ? `DEAD Y${g.year}: ${g.overMsg}`
      : `SURVIVED ${MAX_YEARS} years — ants=${g.ants.length} ⭐${res.score}`);
    console.log(`growth: ants by year = [${res.antsByYear.join(', ')}]`);
    console.log(`fun proxies: cmds/min bloom=${res.cmdsPerMin.bloom} burrow=${res.cmdsPerMin.burrow} · ` +
      `idle seasons bloom=${idle.bloom} burrow=${idle.burrow} · queen-danger ${res.dangerT}s · ` +
      `milestones=${res.milestones} harvests=${res.harvests} planted=${res.planted}`);
  }
  return res;
}

const results = [];
for (let i = 0; i < RUNS; i++) results.push(run(i === 0));
if (RUNS > 1) {
  const survived = results.filter(r => !r.died);
  console.log(`\n=== ${MODE}: ${survived.length}/${RUNS} runs survived ${MAX_YEARS} years ===`);
  for (const r of results.filter(x => x.died)) console.log(`  died Y${r.year}: ${r.msg}`);
  if (survived.length) {
    const avg = (f) => (survived.reduce((n, r) => n + f(r), 0) / survived.length).toFixed(1);
    console.log(`avg: ⭐${avg(r => r.score)} ants=${avg(r => r.ants)} milestones=${avg(r => r.milestones)} ` +
      `harvests=${avg(r => r.harvests)} planted=${avg(r => r.planted)} danger=${avg(r => r.dangerT)}s`);
    console.log(`avg idle seasons: bloom=${avg(r => r.idle.bloom)} burrow=${avg(r => r.idle.burrow)} · ` +
      `cmds/min: bloom=${avg(r => r.cmdsPerMin.bloom)} burrow=${avg(r => r.cmdsPerMin.burrow)}`);
    const maxYears = Math.max(...survived.map(r => r.antsByYear.length));
    const curve = [];
    for (let y = 0; y < maxYears; y++) {
      const vals = survived.filter(r => r.antsByYear.length > y).map(r => r.antsByYear[y]);
      curve.push((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(0));
    }
    console.log(`avg growth curve: [${curve.join(', ')}]`);
  }
}
