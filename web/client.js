// Bloom & Burrow client, v7 "the growing cut".
// Bloom: tap node → tap node (or drag) to lay permanent trail edges; plant
// seeds into flowers that double as junctions. Burrow: farm gardens and keep
// the colony inside the comfort band between the frost and the damp lines.

'use strict';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

let myRole = null, token = null;
let curr = null, prev = null, currAt = 0, prevAt = 0;
let tool = 'dig';
const seenToasts = new Set();
let rainDrops = [];

// ---------- tiny synth (no assets) ----------
let audio = null, muted = false;
function ac() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  return audio;
}
function beep(freq, dur, type, vol) {
  if (muted) return;
  try {
    const a = ac(), o = a.createOscillator(), gn = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    gn.gain.setValueAtTime(vol || 0.08, a.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(gn); gn.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  } catch (e) { /* audio blocked until first gesture */ }
}
const snd = {
  deliver: () => beep(880, 0.08, 'sine', 0.04),
  hatch: () => { beep(660, 0.12, 'sine', 0.07); setTimeout(() => beep(990, 0.15, 'sine', 0.07), 110); },
  bad: () => beep(160, 0.3, 'sawtooth', 0.05),
  rain: () => beep(220, 0.5, 'triangle', 0.05),
  draw: () => beep(520, 0.05, 'sine', 0.03),
  gate: () => beep(330, 0.1, 'square', 0.04),
  harvest: () => { beep(440, 0.08, 'sine', 0.06); setTimeout(() => beep(550, 0.1, 'sine', 0.06), 80); },
  milestone: () => { beep(523, 0.12, 'sine', 0.08); setTimeout(() => beep(659, 0.12, 'sine', 0.08), 120); setTimeout(() => beep(784, 0.2, 'sine', 0.08), 240); },
};
$('muteBtn').onclick = () => { muted = !muted; $('muteBtn').textContent = muted ? '🔇' : '🔊'; };
$('pauseBtn').onclick = () => cmd({ type: 'pause' });
$('resumeBtn').onclick = () => cmd({ type: 'pause' });
document.addEventListener('pointerdown', () => {
  try { if (ac().state === 'suspended') audio.resume(); } catch (e) { /* no audio */ }
}, { passive: true });

// ---------- lobby / connection ----------
async function join(role) {
  const r = await fetch('/join', { method: 'POST', body: JSON.stringify({ role }) });
  if (!r.ok) { $(role + 'Taken').classList.remove('hidden'); return; }
  const data = await r.json();
  myRole = data.role; token = data.token;
  const es = new EventSource('/events?token=' + token);
  es.onmessage = (ev) => {
    prev = curr; prevAt = currAt;
    curr = JSON.parse(ev.data); currAt = performance.now();
    window.__state = curr; // for tests/debugging
    onState();
  };
  $('lobby').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  $(myRole + 'Bar').classList.remove('hidden');
  $('roleInfo').textContent = myRole === 'bloom' ? 'You are 🌸 BLOOM' : 'You are ⛏️ BURROW';
  const partnerUrl = new URL(location.origin + location.pathname);
  partnerUrl.searchParams.set('role', myRole === 'bloom' ? 'burrow' : 'bloom');
  $('shareUrl').textContent = partnerUrl.href;
  $('shareUrl').href = partnerUrl.href;
  layoutCanvas();
  setTimeout(layoutCanvas, 300);
  setTimeout(layoutCanvas, 1200);
}
function cmd(obj) {
  fetch('/cmd', { method: 'POST', body: JSON.stringify({ token, ...obj }) });
}

$('joinBloom').onclick = () => join('bloom');
$('joinBurrow').onclick = () => join('burrow');
$('botBtn').onclick = () => cmd({ type: 'bot' });
{
  const params = new URLSearchParams(location.search);
  const want = params.get('role');
  if (want === 'bloom' || want === 'burrow') {
    join(want).then(() => { if (params.get('bot') && token) cmd({ type: 'bot' }); });
  }
}
$('restartBtn').onclick = () => cmd({ type: 'restart' });
$('recallBtn').onclick = () => cmd({ type: 'recall' });
$('warnBtn').onclick = () => { cmd({ type: 'warn' }); snd.gate(); };
$('broodBtn').onclick = () => cmd({ type: 'brood' });

// Bloom's two modes on top of normal connect: erase and plant
let eraseMode = false, plantMode = false;
function setModes(e, p) {
  eraseMode = e; plantMode = p;
  selNode = null; pending = null;
  $('eraseBtn').classList.toggle('on', eraseMode);
  $('eraseBtn').textContent = eraseMode ? '✕ Erasing — tap a trail' : '✕ Erase';
  $('plantBtn').classList.toggle('on', plantMode);
}
$('eraseBtn').onclick = () => setModes(!eraseMode, false);
$('plantBtn').onclick = () => setModes(false, !plantMode);

for (const b of document.querySelectorAll('.tool')) {
  b.onclick = () => {
    tool = b.dataset.tool;
    document.querySelectorAll('.tool').forEach(x => x.classList.toggle('active', x === b));
  };
}
$('allocSlider').oninput = (e) => {
  $('allocVal').textContent = e.target.value;
  cmd({ type: 'alloc', n: +e.target.value });
};

async function pollLobby() {
  if (myRole) return;
  try {
    const s = await (await fetch('/state')).json();
    for (const role of ['bloom', 'burrow']) {
      const status = s.roles[role];
      const label = $(role + 'Taken');
      label.classList.toggle('hidden', status === 'free');
      label.textContent = status === 'bot' ? '🤖 bot playing — join to take over' : 'taken';
      $(role === 'bloom' ? 'joinBloom' : 'joinBurrow').disabled = status === 'human';
    }
  } catch (e) { /* server briefly away */ }
  setTimeout(pollLobby, 2000);
}
pollLobby();

// ---------- state-driven UI ----------
let lastAnts = -1, lastDockTotal = -1, lastRaining = false, lastDeliverBeep = 0;
let lastMilestone = -1, lastCard = -1, lastSeasonIdx = -1;
function onState() {
  const s = curr;
  const showWaiting = s.waiting && !s.gameOver;
  const showPaused = s.paused && !showWaiting && !s.gameOver;
  $('overlay').classList.toggle('hidden', !showWaiting && !showPaused && !s.gameOver);
  $('waiting').classList.toggle('hidden', !showWaiting);
  $('pausePanel').classList.toggle('hidden', !showPaused);
  $('gameover').classList.toggle('hidden', !s.gameOver);
  $('lobby').classList.add('hidden');
  if (s.gameOver) $('overMsg').textContent = s.overMsg;
  $('pauseBtn').textContent = s.paused ? '▶ Resume' : '⏸ Pause';
  $('pauseBtn').classList.toggle('on', s.paused);
  $('pauseBtn').disabled = showWaiting;

  const seasonName = s.seasons[s.seasonIdx].name;
  const pill = $('seasonPill');
  pill.textContent = `${seasonName} · Year ${s.year}` + (s.prepared ? ' ⚡' : '');
  const cols = { Spring: '#8fbf6b', Summer: '#e8c95a', Autumn: '#d98e4a', Winter: '#a9c4d8' };
  pill.style.background = cols[seasonName];
  $('seasonFill').style.width = (100 * s.seasonT / s.seasonLen) + '%';
  $('seasonFill').style.background = cols[seasonName];
  const out = s.ants.filter(a => a.s === 1).length;
  const botPartner = s.roles && s.roles[myRole === 'bloom' ? 'burrow' : 'bloom'] === 'bot';
  const dockT = s.dock.sugar + s.dock.protein;
  if (window.innerWidth < 560) {
    $('antInfo').textContent = `🐜${s.ants.length}→${s.nextMilestone} · ${out} out` +
      (s.recall ? ' · ⛑' : '') + (botPartner ? ' · 🤖' : '');
    $('dockInfo').textContent = `⚓${dockT}/${s.dockCap}` + (dockT >= s.dockCap ? '⚠' : '');
  } else {
    $('antInfo').textContent = `🐜 ${s.ants.length} — next milestone at ${s.nextMilestone}` +
      ` · ${out} out` + (s.recall ? ' · RECALL' : '') + (botPartner ? ' · partner 🤖' : '');
    $('dockInfo').textContent = `Dock ${dockT}/${s.dockCap}` + (dockT >= s.dockCap ? ' ⚠ JAM' : '');
  }
  $('scoreInfo').textContent = `⭐ ${s.score}`;

  if (myRole === 'bloom') {
    $('recallBtn').textContent = s.recall ? 'Recall ON — lift it' : 'Recall foragers';
    $('recallBtn').classList.toggle('on', s.recall);
    const wb = $('warnBtn');
    if (seasonName === 'Autumn') {
      wb.classList.remove('hidden');
      wb.disabled = s.warn.winterGiven;
      wb.textContent = s.warn.winterGiven ? '✓ warned' : '📢 Warn: winter!';
    } else if (seasonName === 'Winter') {
      wb.classList.remove('hidden');
      wb.disabled = s.warn.meltGiven;
      wb.textContent = s.warn.meltGiven ? '✓ warned' : '📢 Warn: the melt!';
    } else {
      wb.classList.add('hidden');
    }
    $('forecast').textContent = forecast(s, seasonName);
    const free = s.seg.cap - s.seg.used;
    $('segInfo').innerHTML = `〰 <b>${free}</b> free of ${s.seg.cap}`;
    $('plantBtn').textContent = `🌰 Plant (${s.seeds.ledge})` + (seasonName === 'Winter' ? ' — under the snow' : '');
    $('plantBtn').disabled = s.seeds.ledge <= 0;
    if (s.seeds.ledge <= 0 && plantMode) setModes(false, false);
    if (lastDockTotal >= 0 && dockT > lastDockTotal && performance.now() - lastDeliverBeep > 150) {
      snd.deliver(); lastDeliverBeep = performance.now();
    }
  } else {
    $('storeInfo').innerHTML =
      `🍯 <b>${s.store.sugar}</b> · 🥩 <b>${s.store.protein}</b> / ${s.caps.total}` +
      ` · 🌰 ${s.seeds.store + s.seeds.ledge}` + (s.proteinDiet ? ' <b style="color:#a05030">protein diet</b>' : '');
    $('queenInfo').innerHTML = `👑 ${s.queenHP}%` +
      (s.queenStress ? ' <b style="color:#a02020">STRESSED</b>' : '') +
      (s.starving ? ' <b style="color:#a02020">STARVING</b>' : '') +
      ` · 🥚 ${s.eggs.length} · egg 🥩${s.queenFed}/${s.eggProtein} · 🍄 ${s.gardenCount}/${s.gardenCap}`;
    $('broodBtn').textContent = s.broodOn ? '🍼 Brood: ON' : '🍼 Brood: OFF';
    $('broodBtn').classList.toggle('warn', !s.broodOn);
    const wi = $('warnInfo');
    if (seasonName === 'Autumn' && s.warn.winterGiven) {
      wi.textContent = `⚠ ❄ winter in ${Math.ceil(s.seasonLen - s.seasonT)}s`;
    } else if (seasonName === 'Winter' && s.warn.meltGiven) {
      wi.textContent = `⚠ 💧 melt in ${Math.ceil(s.seasonLen - s.seasonT)}s`;
    } else {
      wi.textContent = '';
    }
    const slider = $('allocSlider');
    slider.max = Math.max(1, s.ants.length);
    if (document.activeElement !== slider) {
      slider.value = s.desiredOutside;
      $('allocVal').textContent = s.desiredOutside;
    }
    // first-game nudge: the garden is the heart of Burrow's loop
    const gbtn = document.querySelector('[data-tool="garden"]');
    if (gbtn) gbtn.classList.toggle('pulse', s.gardenCount === 0 && s.year === 1);
  }

  if (lastAnts >= 0 && s.ants.length > lastAnts && !s.paused) {
    snd.hatch();
    // a birth is worth a little party
    if (myRole === 'burrow') {
      const geo = burrowGeom(s);
      const qx = geo.ox + s.queen.x * geo.cell, qy = geo.oy + s.queen.y * geo.cell;
      puff(qx, qy, '#e8a0bf', 14);
      floatText(qx, qy - 14, '+1 🐜');
    } else {
      const dq = P(975, 310);
      floatText(dq.x, dq.y - 40, '+1 🐜');
    }
  }
  if (s.raining && !lastRaining) snd.rain();
  if (lastMilestone >= 0 && s.milestone > lastMilestone) {
    snd.milestone();
    confetti();
    showBanner(`🎉 ${s.ants.length} ants — the colony thrives!`);
  }
  // the turning of the year, softly announced (a milestone banner wins)
  if (lastSeasonIdx >= 0 && s.seasonIdx !== lastSeasonIdx && !s.paused && (!banner || banner.life < 1.2)) {
    const em = { Spring: '🌱', Summer: '☀️', Autumn: '🍂', Winter: '❄️' }[seasonName];
    showBanner(`${em} ${seasonName}` +
      (seasonName === 'Winter' && myRole === 'bloom' ? ' — planning season, replanning is free' : ''), 2.0);
  }
  lastSeasonIdx = s.seasonIdx;
  lastAnts = s.ants.length; lastDockTotal = dockT; lastRaining = s.raining;
  lastMilestone = s.milestone;

  // the year-end postcard — one shared beat of "look what we did"
  if (s.postcard && s.postcard.id !== lastCard) {
    lastCard = s.postcard.id;
    const pc = s.postcard;
    const el = $('postcard');
    el.innerHTML = `<h2>Year ${pc.year} 🌼</h2>` +
      `<p>${pc.antsFrom} → <b>${pc.antsTo}</b> ants · ${pc.harvests} garden harvests · ` +
      `${pc.planted} flowers planted</p><p class="pcScore">⭐ ${pc.score}</p>`;
    el.classList.remove('hidden');
    snd.milestone();
    setTimeout(() => el.classList.add('hidden'), 6000);
  }

  for (const t of s.toasts) {
    if (seenToasts.has(t.id)) continue;
    seenToasts.add(t.id);
    if (t.role !== 'all' && t.role !== myRole) continue;
    const box = $('toasts');
    while (box.children.length >= 3) box.firstChild.remove();
    const div = document.createElement('div');
    div.className = 'toast' + (t.bad ? ' bad' : '');
    div.textContent = t.msg;
    box.appendChild(div);
    setTimeout(() => div.remove(), t.bad ? 6000 : 4000);
    if (t.bad) snd.bad();
  }
}

function forecast(s, seasonName) {
  const left = Math.ceil(s.seasonLen - s.seasonT);
  const next = s.seasons[s.seasonIdx].events.find(e => e.t + e.dur > s.seasonT);
  let evTxt = '';
  if (next) {
    const inS = Math.ceil(next.t - s.seasonT);
    const label = next.kind === 'rain' ? '🌧 rain' : '🔥 drought';
    evTxt = inS > 0 ? ` · ${label} in ${inS}s` : ` · ${label} NOW`;
  }
  if (seasonName === 'Spring') return `🌱 Mild.${evTxt} · Summer in ${left}s`;
  if (seasonName === 'Summer') return `☀️ Peak season.${evTxt} · Autumn in ${left}s`;
  if (seasonName === 'Autumn') return `🍂 Stormy.${evTxt} · ⚠ WINTER in ${left}s — warn Burrow & recall!`;
  return `❄️ ${left}s of frost — plan the spring tree, warn about the melt!`;
}

// ---------- orientation & canvas layout ----------
let portrait = false;
function layoutCanvas() {
  portrait = window.innerHeight > window.innerWidth;
  if (!myRole) return;
  let w, h;
  if (myRole === 'bloom') { w = portrait ? 620 : 1000; h = portrait ? 1000 : 620; }
  else { w = 464; h = 714; }
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  fitCanvas();
}
function vpW() { return (window.visualViewport && window.visualViewport.width) || window.innerWidth; }
function vpH() { return (window.visualViewport && window.visualViewport.height) || window.innerHeight; }
function barsHeight() {
  let h = 0;
  const top = $('topbar');
  if (top && !top.classList.contains('hidden')) h += top.offsetHeight;
  const bar = myRole && $(myRole + 'Bar');
  if (bar && !bar.classList.contains('hidden')) h += bar.offsetHeight;
  return h;
}
function fitCanvas() {
  const availW = Math.min(vpW() - 4, 1000);
  const availH = Math.max(220, vpH() - barsHeight() - 10);
  const scale = Math.min(availW / canvas.width, availH / canvas.height);
  canvas.style.width = Math.floor(canvas.width * scale) + 'px';
  canvas.style.height = Math.floor(canvas.height * scale) + 'px';
}
window.addEventListener('resize', layoutCanvas);
window.addEventListener('orientationchange', () => setTimeout(layoutCanvas, 60));
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => layoutCanvas());
let lastBarsH = -1;
setInterval(() => {
  if (!myRole) return;
  const h = barsHeight();
  if (h !== lastBarsH) { lastBarsH = h; fitCanvas(); }
}, 500);
const rotBloom = () => portrait && myRole === 'bloom';
function P(x, y) { return rotBloom() ? { x: 620 - y, y: x } : { x, y }; }
function Winv(cx, cy) { return rotBloom() ? { x: cy, y: 620 - cx } : { x: cx, y: cy }; }

// ---------- rendering ----------
function lerpState() {
  if (!curr) return null;
  if (!prev || prev.ants.length !== curr.ants.length) return curr;
  const span = Math.max(1, currAt - prevAt);
  const t = Math.min(1, (performance.now() - currAt) / span);
  return {
    ...curr,
    ants: curr.ants.map((a, i) => {
      const p = prev.ants[i];
      if (p.s !== a.s) return a;
      return { ...a, x: p.x + (a.x - p.x) * t, y: p.y + (a.y - p.y) * t };
    }),
  };
}

// ---------- juice: particles, floating text, banners (canvas coords) ----------
let parts = [], floats = [], banner = null, lastFrameT = performance.now();
function puff(x, y, color, n) {
  for (let i = 0; i < (n || 10); i++) {
    const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 80;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.5 + Math.random() * 0.5, color });
  }
}
function floatText(x, y, txt, color) { floats.push({ x, y, txt, color: color || '#fff7e6', life: 1.5 }); }
function showBanner(txt, life) { banner = { txt, life: life || 3.5 }; }
function confetti() {
  const cols = ['#f3d34a', '#e8a0bf', '#7ba05b', '#8a5aa8'];
  for (let i = 0; i < 60; i++) {
    parts.push({
      x: Math.random() * canvas.width, y: -10 - Math.random() * 40,
      vx: (Math.random() - 0.5) * 40, vy: 60 + Math.random() * 120,
      life: 1.5 + Math.random() * 1.5, color: cols[i % 4],
    });
  }
}
function drawJuice(dt) {
  for (const p of parts) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; p.life -= dt;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  parts = parts.filter(p => p.life > 0);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const f of floats) {
    f.y -= 28 * dt; f.life -= dt;
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
    ctx.font = 'bold 15px sans-serif';
    ctx.strokeStyle = 'rgba(40,30,20,0.7)'; ctx.lineWidth = 3;
    ctx.strokeText(f.txt, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x, f.y);
  }
  floats = floats.filter(f => f.life > 0);
  if (banner) {
    banner.life -= dt;
    ctx.globalAlpha = Math.max(0, Math.min(1, banner.life));
    ctx.font = 'bold 26px sans-serif';
    ctx.strokeStyle = 'rgba(60,40,20,0.85)'; ctx.lineWidth = 5;
    ctx.strokeText(banner.txt, canvas.width / 2, canvas.height * 0.25);
    ctx.fillStyle = '#fff7e6';
    ctx.fillText(banner.txt, canvas.width / 2, canvas.height * 0.25);
    if (banner.life <= 0) banner = null;
  }
  ctx.globalAlpha = 1;
}

let lastWin = '';
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const fdt = Math.min(0.1, (now - lastFrameT) / 1000);
  lastFrameT = now;
  const s = lerpState();
  if (!s || !myRole) return;
  const win = window.innerWidth + 'x' + window.innerHeight;
  if (win !== lastWin) { lastWin = win; layoutCanvas(); }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (myRole === 'bloom') drawBloom(s);
  else drawBurrow(s);
  drawJuice(fdt);
}
requestAnimationFrame(frame);

// ----- Bloom: nodes & edges -----
const DOCKP = { x: 975, y: 310 };
function nodePos(s, id) {
  if (id === 0) return DOCKP;
  return s.sources.find(x => x.id === id) || null;
}
function nearestNode(s, x, y, maxD) {
  let best = null, bestD = maxD;
  const dd = Math.hypot(DOCKP.x - x, DOCKP.y - y);
  if (dd < bestD) { bestD = dd; best = 0; }
  for (const src of s.sources) {
    const d = Math.hypot(src.x - x, src.y - y);
    if (d < bestD) { bestD = d; best = src.id; }
  }
  return best;
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function nearestEdge(s, x, y, maxD) {
  let best = null, bestD = maxD;
  for (const e of s.edges) {
    const a = nodePos(s, e.a), b = nodePos(s, e.b);
    if (!a || !b) continue;
    const d = distToSeg(x, y, a.x, a.y, b.x, b.y);
    if (d < bestD) { bestD = d; best = e.id; }
  }
  return best;
}

let pending = null;   // { from: nodeId, x, y (cursor, world coords), moved }
let selNode = null;   // tap-tap flow: first selected node

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || !curr || myRole !== 'bloom') return;
  ev.preventDefault();
  const { x, y } = worldXY(ev);
  if (eraseMode) {
    const id = nearestEdge(curr, x, y, 20);
    if (id !== null) {
      cmd({ type: 'erase', id });
      const e = curr.edges.find(ed => ed.id === id);
      const cq = canvasXY(ev);
      if (e) floatText(cq.x, cq.y - 10, `+${e.cost} 〰`, '#f3d34a');
      snd.gate();
    }
    return;
  }
  if (plantMode) {
    cmd({ type: 'plant', x: Math.round(x), y: Math.round(y) });
    const cq = canvasXY(ev);
    puff(cq.x, cq.y, '#7ba05b', 8);
    floatText(cq.x, cq.y - 12, '🌰');
    snd.draw();
    return;
  }
  const at = nearestNode(curr, x, y, 42);
  if (at !== null) {
    pending = { from: at, x, y, moved: false };
    canvas.setPointerCapture(ev.pointerId);
    snd.draw();
  } else {
    selNode = null;
  }
});
canvas.addEventListener('pointermove', (ev) => {
  if (myRole !== 'bloom' || !pending) return;
  const { x, y } = worldXY(ev);
  pending.x = x; pending.y = y;
  const from = nodePos(curr, pending.from);
  if (from && Math.hypot(x - from.x, y - from.y) > 25) pending.moved = true;
});
canvas.addEventListener('pointerup', (ev) => {
  if (myRole !== 'bloom' || !pending) return;
  const { x, y } = worldXY(ev);
  const at = nearestNode(curr, x, y, 42);
  if (pending.moved) {
    // drag flow: released on another node → lay the edge
    if (at !== null && at !== pending.from) {
      cmd({ type: 'edge', a: pending.from, b: at });
      snd.draw();
    }
    selNode = null;
  } else {
    // tap flow: first tap selects, second tap connects
    if (selNode !== null && at !== null && at !== selNode) {
      cmd({ type: 'edge', a: selNode, b: at });
      snd.draw();
      selNode = null;
    } else {
      selNode = (at === selNode) ? null : at;
    }
  }
  pending = null;
});
canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  if (myRole !== 'bloom' || !curr) return;
  const { x, y } = worldXY(ev);
  const id = nearestEdge(curr, x, y, 16);
  if (id !== null) cmd({ type: 'erase', id });
});

function canvasXY(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) * (canvas.width / rect.width),
    y: (ev.clientY - rect.top) * (canvas.height / rect.height),
  };
}
function worldXY(ev) {
  const c = canvasXY(ev);
  return Winv(c.x, c.y);
}

// gentle arc between two points — trails read as living paths, not wires
function drawArc(ax, ay, bx, by) {
  const a = P(ax, ay), b = P(bx, by);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const off = Math.min(18, L * 0.08);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mx - dy / L * off, my + dx / L * off, b.x, b.y);
}

function drawBloom(s) {
  const seasonName = s.seasons[s.seasonIdx].name;
  ctx.fillStyle = '#a4c47e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 140; i++) {
    const g = P(((i * 97) % 990) + 5, ((i * 61) % 600) + 8);
    ctx.fillRect(g.x, g.y, 2, 6);
  }
  if (seasonName === 'Autumn') { ctx.fillStyle = 'rgba(160,110,50,0.22)'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  if (seasonName === 'Winter') { ctx.fillStyle = 'rgba(235,243,250,0.6)'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  if (s.drought) { ctx.fillStyle = 'rgba(240,200,90,0.18)'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

  // the barren ring while planting: nothing grows on trampled earth
  if (plantMode) {
    const dq = P(DOCKP.x, DOCKP.y);
    ctx.fillStyle = 'rgba(120,90,60,0.18)';
    ctx.beginPath(); ctx.arc(dq.x, dq.y, s.plantMinDock, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,60,0.5)'; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(dq.x, dq.y, s.plantMinDock, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
  }

  // edges — permanent, thickened by traffic, muddied by rain, gray as orphans
  for (const e of s.edges) {
    const a = nodePos(s, e.a), b = nodePos(s, e.b);
    if (!a || !b) continue;
    const w = 2.5 + 4 * Math.min(1, e.traffic);
    if (e.orphan) {
      ctx.strokeStyle = 'rgba(120,120,120,0.5)';
      ctx.setLineDash([5, 7]);
    } else if (s.mud) {
      ctx.strokeStyle = 'rgba(80,60,45,0.75)';
    } else {
      ctx.strokeStyle = `rgba(120,60,140,${0.4 + 0.4 * Math.min(1, e.traffic)})`;
    }
    ctx.lineWidth = w; ctx.lineCap = 'round';
    drawArc(a.x, a.y, b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // marching dots on live, trafficked trails
    if (!e.orphan && e.traffic > 0.05 && seasonName !== 'Winter') {
      ctx.save();
      ctx.setLineDash([3, 16]);
      ctx.lineDashOffset = -performance.now() / 30;
      ctx.strokeStyle = 'rgba(255,240,255,0.7)';
      ctx.lineWidth = 2;
      drawArc(a.x, a.y, b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  // pending edge preview with live cost
  const previewFrom = pending && pending.moved ? pending.from : selNode;
  if (previewFrom !== null && previewFrom !== undefined) {
    const from = nodePos(s, previewFrom);
    if (from) {
      let tx, ty;
      if (pending && pending.moved) { tx = pending.x; ty = pending.y; }
      const fq = P(from.x, from.y);
      ctx.strokeStyle = '#f3d34a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(fq.x, fq.y, 26 + 3 * Math.sin(performance.now() / 200), 0, 7); ctx.stroke();
      if (tx !== undefined) {
        const snap = nearestNode(s, tx, ty, 42);
        const to = snap !== null && snap !== previewFrom ? nodePos(s, snap) : { x: tx, y: ty };
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        const cost = Math.ceil(len / 150);
        const ok = len <= 600 && cost <= s.seg.cap - s.seg.used;
        ctx.strokeStyle = ok ? 'rgba(120,60,140,0.9)' : 'rgba(200,60,40,0.9)';
        ctx.setLineDash([6, 6]); ctx.lineWidth = 3;
        drawArc(from.x, from.y, to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const tip = P(to.x, to.y);
        ctx.fillStyle = ok ? '#3a2e22' : '#a02020';
        ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(len > 600 ? 'too far — hop through a node' : `${cost} 〰`, tip.x, tip.y - 14);
      }
    }
  }

  // sources: wild flowers, carcasses, planted flowers, sprouts, husks.
  // Anything with food but no trail gets a soft pulsing ring — Bloom's
  // to-do list, readable at a glance.
  const linked = new Set([0]);
  for (const e of s.edges) { linked.add(e.a); linked.add(e.b); }
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 350);
  for (const src of s.sources) {
    const q = P(src.x, src.y);
    if (src.amt > 0 && !linked.has(src.id)) {
      ctx.strokeStyle = `rgba(255,250,235,${0.25 + 0.35 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q.x, q.y, 22 + 3 * pulse, 0, 7); ctx.stroke();
    }
    if (src.dm) {
      // a seed asleep under the snow — already a node you can wire trails to
      ctx.strokeStyle = 'rgba(120,60,140,0.7)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(q.x, q.y, 14, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🌰', q.x, q.y + 5);
      continue;
    }
    if (src.husk) {
      ctx.strokeStyle = 'rgba(90,80,70,0.8)'; ctx.lineWidth = 2;
      for (let l = 0; l < 3; l++) {
        const ang = -Math.PI / 2 + (l - 1) * 0.5;
        ctx.beginPath(); ctx.moveTo(q.x, q.y + 4);
        ctx.lineTo(q.x + Math.cos(ang) * 10, q.y + 4 + Math.sin(ang) * 10); ctx.stroke();
      }
      continue;
    }
    if (src.sprout > 0) {
      ctx.strokeStyle = '#4a6b2f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q.x, q.y + 6); ctx.lineTo(q.x, q.y - 4); ctx.stroke();
      ctx.fillStyle = '#7ba05b';
      ctx.beginPath(); ctx.ellipse(q.x - 4, q.y - 5, 5, 2.5, -0.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(q.x + 4, q.y - 5, 5, 2.5, 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#3a2e22'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${src.sprout}s`, q.x, q.y + 22);
      continue;
    }
    if (src.type === 'nectar') {
      const dormant = src.pl && src.amt === 0;
      ctx.fillStyle = src.pl ? (dormant ? '#b9a8b0' : '#f2b7d4') : '#e8a0bf';
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2 + (src.pl ? performance.now() / 4000 : 0);
        ctx.beginPath(); ctx.arc(q.x + Math.cos(ang) * 8, q.y + Math.sin(ang) * 8, 6, 0, 7); ctx.fill();
      }
      ctx.fillStyle = dormant ? '#c9b98a' : '#f3d34a';
      ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, 7); ctx.fill();
      if (src.pl) {   // a stem — planted flowers are yours
        ctx.strokeStyle = '#4a6b2f'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(q.x, q.y + 8); ctx.lineTo(q.x, q.y + 16); ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#6b4a2f';
      ctx.beginPath(); ctx.ellipse(q.x, q.y, 14, 8, 0.4, 0, 7); ctx.fill();
      ctx.strokeStyle = '#4d3520'; ctx.lineWidth = 1.5;
      for (let l = -1; l <= 1; l++) {
        ctx.beginPath(); ctx.moveTo(q.x + l * 5, q.y - 4); ctx.lineTo(q.x + l * 8, q.y - 13); ctx.stroke();
      }
    }
    if (src.amt > 0) {
      ctx.fillStyle = '#3a2e22'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(src.amt, q.x, q.y + 32);
    }
  }

  // dock strip + the pit
  const rot = rotBloom();
  ctx.fillStyle = '#b98d5e';
  ctx.strokeStyle = 'rgba(90,60,30,0.4)';
  if (rot) {
    ctx.fillRect(0, canvas.height - 46, canvas.width, 46);
    for (let x = 14; x < canvas.width; x += 14) {
      ctx.beginPath(); ctx.moveTo(x, canvas.height - 46); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
  } else {
    ctx.fillRect(canvas.width - 46, 0, 46, canvas.height);
    for (let y = 14; y < canvas.height; y += 14) {
      ctx.beginPath(); ctx.moveTo(canvas.width - 46, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }
  const dq = P(DOCKP.x, DOCKP.y);
  ctx.fillStyle = '#9a7a4a';
  ctx.beginPath(); ctx.ellipse(dq.x, dq.y, 30, 22, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#6b4a2f';
  ctx.beginPath(); ctx.ellipse(dq.x, dq.y, 22, 15, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#241609';
  ctx.beginPath(); ctx.ellipse(dq.x, dq.y, 15, 10, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(120,60,140,0.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(dq.x, dq.y, 34 + 5 * Math.sin(performance.now() / 400), 0, 7); ctx.stroke();
  ctx.fillStyle = '#3a2e22'; ctx.font = 'bold 14px sans-serif';
  if (rot) {
    ctx.textAlign = 'center';
    ctx.fillText('the pit — tap it, then a source, to lay a trail ⤵', canvas.width / 2, canvas.height - 58);
  } else {
    ctx.save();
    ctx.translate(canvas.width - 14, 350); ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.fillText('THE PIT — trails start here', 0, 0);
    ctx.restore();
  }
  // goods waiting on the dock
  let pi = 0;
  for (const [type, color] of [['sugar', '#f3d34a'], ['protein', '#8a5a30']]) {
    for (let n = 0; n < s.dock[type]; n++, pi++) {
      ctx.fillStyle = color;
      ctx.beginPath();
      if (rot) ctx.arc(16 + Math.floor(pi / 2) * 14, canvas.height - 34 + (pi % 2) * 16, 5.5, 0, 7);
      else ctx.arc(canvas.width - 34 + (pi % 2) * 16, 360 + Math.floor(pi / 2) * 14, 5.5, 0, 7);
      ctx.fill();
    }
  }
  if (s.dock.sugar + s.dock.protein >= s.dockCap) {
    ctx.fillStyle = '#a02020'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    if (rot) ctx.fillText('JAM', 40, canvas.height - 52);
    else ctx.fillText('JAM', canvas.width - 23, 340);
  }
  // the seed ledge — Burrow's gifts arriving from below
  for (let n = 0; n < s.seeds.ledge; n++) {
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
    if (rot) ctx.fillText('🌰', canvas.width - 24 - n * 20, canvas.height - 54);
    else ctx.fillText('🌰', canvas.width - 60, 290 - n * 20);
  }

  // ants (carry bitmask: 1 = sugar, 2 = protein)
  for (const a of s.ants) {
    if (a.s !== 1) continue;
    const q = P(a.x, a.y);
    ctx.fillStyle = '#2e2018';
    ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(q.x - 4, q.y, 2.4, 0, 7); ctx.fill();
    if (a.c & 1) {
      ctx.fillStyle = '#f3d34a';
      ctx.beginPath(); ctx.arc(q.x + 3, q.y - 4, 2.6, 0, 7); ctx.fill();
    }
    if (a.c & 2) {
      ctx.fillStyle = '#8a5a30';
      ctx.beginPath(); ctx.arc(q.x - 1, q.y - 5, 2.6, 0, 7); ctx.fill();
    }
  }

  // rain (screen space)
  if (s.raining) {
    if (rainDrops.length < 80) rainDrops.push({ x: Math.random() * canvas.width, y: -10, v: 300 + Math.random() * 200 });
    ctx.strokeStyle = 'rgba(140,180,220,0.6)'; ctx.lineWidth = 1.5;
    for (const d of rainDrops) {
      d.y += d.v / 60;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 10); ctx.stroke();
      if (d.y > canvas.height) { d.y = -10; d.x = Math.random() * canvas.width; }
    }
  } else rainDrops = [];
}

// ----- Burrow: bands, gardens, brood -----
function burrowGeom(s) {
  const cell = Math.floor(Math.min((canvas.width - 20) / s.gridDim.cols, (canvas.height - 60) / s.gridDim.rows));
  return { cell, ox: Math.floor((canvas.width - cell * s.gridDim.cols) / 2), oy: 50 };
}

let queenSel = false;
canvas.addEventListener('click', (ev) => {
  if (myRole !== 'burrow' || !curr) return;
  const { x, y } = canvasXY(ev);
  const geo = burrowGeom(curr);
  const c = Math.floor((x - geo.ox) / geo.cell);
  const r = Math.floor((y - geo.oy) / geo.cell);
  if (c < 0 || r < 0 || c >= curr.gridDim.cols || r >= curr.gridDim.rows) { queenSel = false; return; }
  const qd = Math.hypot(c + 0.5 - curr.queen.x, r + 0.5 - curr.queen.y);
  if (queenSel) {
    queenSel = false;
    if (qd > 0.8) { cmd({ type: 'moveQueen', c, r }); snd.gate(); }
    return;
  }
  if (qd <= 0.8) { queenSel = true; return; }
  const ch = curr.grid[r][c];
  // a garden answers the tap itself: harvest when ripe, seed when empty
  // (Fill still wins so you can deliberately deconstruct)
  if (ch === 'G' && tool !== 'fill') {
    const gd = curr.gardens.find(g2 => g2.c === c && g2.r === r);
    if (gd && gd.st >= curr.gardenStages) {
      cmd({ type: 'harvest', c, r });
      puff(x, y, '#d8905a', 14);
      floatText(x, y - 10, '+3 🥩');
      snd.harvest();
    } else if (gd && gd.st === 0 && gd.pc === 0) {
      cmd({ type: 'seedGarden', c, r });
      puff(x, y, '#9a7ab0', 8);
      floatText(x, y - 10, '🍄');
      snd.draw();
    }
    return;
  }
  // a 🍼 nursery feeds on tap
  if (ch === 'N' && tool !== 'fill' && curr.eggs.some(e => e.c === c && e.r === r && !e.f)) {
    cmd({ type: 'feed', c, r });
    floatText(x, y - 10, '🍼');
    snd.deliver();
    return;
  }
  if (tool === 'dig') cmd({ type: 'dig', c, r });
  else if (tool === 'fill') cmd({ type: 'fill', c, r });
  else cmd({ type: 'build', kind: tool, c, r });
});
let hover = null;
canvas.addEventListener('mousemove', (ev) => {
  if (myRole !== 'burrow' || !curr) { hover = null; return; }
  const { x, y } = canvasXY(ev);
  const geo = burrowGeom(curr);
  hover = { c: Math.floor((x - geo.ox) / geo.cell), r: Math.floor((y - geo.oy) / geo.cell) };
});

function drawBurrow(s) {
  const seasonName = s.seasons[s.seasonIdx].name;
  const geo = burrowGeom(s);
  const { cell, ox, oy } = geo;
  const gw = s.gridDim.cols * cell;

  ctx.fillStyle = '#8a6844';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = seasonName === 'Winter' ? '#dfe9f2' : (s.raining ? '#8fa8bd' : '#bcd6e8');
  ctx.fillRect(0, 0, canvas.width, oy);
  ctx.fillStyle = '#241609';
  ctx.fillRect(ox + 2, oy - 14, cell - 4, 15);
  ctx.fillStyle = '#3a2e22'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('⬆ DOCK' + (s.raining ? ' — 🌧' : ''), ox + cell + 6, oy - 8);

  const stockAt = {};
  for (const st of s.stocks) stockAt[st.c + ',' + st.r] = st;
  const gardenAt = {};
  for (const gd of s.gardens) gardenAt[gd.c + ',' + gd.r] = gd;

  for (let r = 0; r < s.gridDim.rows; r++) {
    for (let c = 0; c < s.gridDim.cols; c++) {
      const ch = s.grid[r][c];
      const x = ox + c * cell, y = oy + r * cell;
      if (ch === '#') {
        ctx.fillStyle = r >= 14 ? '#5e4429' : '#7a5b3c';
        ctx.fillRect(x, y, cell - 1, cell - 1);
        continue;
      }
      ctx.fillStyle = '#453121';
      ctx.fillRect(x, y, cell - 1, cell - 1);
      if (ch === 'S') {
        ctx.strokeStyle = '#c8a86a'; ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, cell - 5, cell - 5);
        const st = stockAt[c + ',' + r];
        if (st) {
          let i = 0;
          for (const [n, color] of [[st.s, '#f3d34a'], [st.p, '#b97a45']]) {
            for (let k = 0; k < n && i < 10; k++, i++) {
              const px = x + cell * 0.16 + (i % 5) * cell * 0.17;
              const py = y + cell * (i < 5 ? 0.72 : 0.5);
              ctx.fillStyle = color;
              ctx.beginPath(); ctx.arc(px, py, cell * 0.06, 0, 7); ctx.fill();
            }
          }
        }
      } else if (ch === 'N') {
        ctx.strokeStyle = '#e8a0bf'; ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, cell - 5, cell - 5);
      } else if (ch === 'G') {
        ctx.strokeStyle = '#9a7ab0'; ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, cell - 5, cell - 5);
        const gd = gardenAt[c + ',' + r];
        if (gd) drawGarden(gd, x, y, cell);
      }
    }
  }

  // the two climate lines — the whole strategy on two moving rulers
  const fy = oy + s.frostRow * cell;
  const dy = oy + s.dampRow * cell;
  // soft tints so rooms and tunnels stay readable underneath the bands
  ctx.fillStyle = 'rgba(220,235,248,0.20)';
  ctx.fillRect(ox, oy, gw, Math.max(0, fy - oy));
  ctx.fillStyle = 'rgba(70,120,170,0.20)';
  ctx.fillRect(ox, dy, gw, Math.max(0, oy + s.gridDim.rows * cell - dy));
  ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
  ctx.strokeStyle = 'rgba(230,240,250,0.95)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(ox, fy); ctx.lineTo(ox + gw, fy); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,180,225,0.95)';
  ctx.beginPath(); ctx.moveTo(ox, dy); ctx.lineTo(ox + gw, dy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(235,244,252,0.95)';
  ctx.fillText(seasonName === 'Winter' ? '❄ FROST — it creeps down all winter'
    : (s.drought ? '☀ DRY — the drought bakes the shallows' : '❄ frost line'), ox + gw - 4, fy - 3);
  ctx.fillStyle = 'rgba(180,215,240,0.95)';
  ctx.fillText(seasonName === 'Spring' ? '💧 DAMP — it rises with the melt' : '💧 damp line', ox + gw - 4, dy - 3);

  // dig / fill orders
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  for (const d of s.digs) {
    const x = ox + d.c * cell, y = oy + d.r * cell;
    ctx.strokeStyle = d.f ? 'rgba(200,140,80,0.95)' : 'rgba(255,255,255,0.7)';
    ctx.strokeRect(x + 3, y + 3, cell - 7, cell - 7);
    if (d.f) {
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + cell - 8, y + cell - 8);
      ctx.moveTo(x + cell - 8, y + 6); ctx.lineTo(x + 6, y + cell - 8);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // eggs: progress ring; 💤 out of warmth, ❄/💧 out of comfort, 🍼 hungry
  const hungryCells = new Set();
  for (const e of s.eggs) {
    const siblings = s.eggs.filter(x => x.c === e.c && x.r === e.r);
    const idx = siblings.indexOf(e);
    const x = ox + e.c * cell + cell * 0.25 + idx * cell * 0.25;
    const y = oy + e.r * cell + cell * 0.68;
    const stalled = !e.w || !e.f || !e.ok;
    if (!e.f) hungryCells.add(e.c + ',' + e.r);
    ctx.globalAlpha = stalled ? 0.45 : 1;
    ctx.fillStyle = '#f5efdc';
    ctx.beginPath(); ctx.ellipse(x, y, cell * 0.1, cell * 0.15, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#e8a0bf'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, cell * 0.18, -Math.PI / 2, -Math.PI / 2 + (e.t / 20) * Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (stalled && e.f) {
      ctx.fillStyle = 'rgba(200,225,245,0.95)'; ctx.font = `${Math.floor(cell * 0.3)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(!e.ok
        ? (e.r < s.frostRow ? (seasonName === 'Winter' ? '❄' : '☀') : '💧')
        : (!e.w ? '💤' : ''), x, y - cell * 0.25);
    }
  }
  for (const key of hungryCells) {
    const [c, r] = key.split(',').map(Number);
    const x = ox + c * cell, y = oy + r * cell;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
    ctx.strokeStyle = `rgba(243,211,74,${0.35 + 0.55 * pulse})`; ctx.lineWidth = 3;
    ctx.strokeRect(x + 1, y + 1, cell - 3, cell - 3);
    ctx.font = `${Math.floor(cell * 0.5)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('🍼', x + cell / 2, y + cell * 0.45);
  }

  // the queen
  {
    const qx = ox + s.queen.x * cell, qy = oy + s.queen.y * cell;
    if (queenSel) {
      ctx.strokeStyle = 'rgba(232,160,191,0.55)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(qx, qy, 3.5 * cell, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#f3d34a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(qx, qy, cell * 0.6 + 2 * Math.sin(performance.now() / 200), 0, 7); ctx.stroke();
      ctx.fillStyle = '#fff7e6'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('tap a chamber to carry the queen there', ox + gw / 2, oy + cell * 0.6);
    }
    ctx.fillStyle = s.queenStress && Math.floor(performance.now() / 250) % 2 ? '#c03030' : '#5a3050';
    ctx.beginPath(); ctx.ellipse(qx, qy, cell * 0.38, cell * 0.27, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f3d34a'; ctx.font = `${Math.floor(cell * 0.42)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('♛', qx, qy - cell * 0.15);
    if (s.queenHP < 100) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(qx - cell * 0.5, qy - cell * 0.66, cell, 5);
      ctx.fillStyle = s.queenHP > 50 ? '#7ba05b' : '#c05030';
      ctx.fillRect(qx - cell * 0.5, qy - cell * 0.66, cell * s.queenHP / 100, 5);
    }
  }

  for (const a of s.ants) {
    if (a.s !== 0) continue;
    const x = ox + a.x * cell, y = oy + a.y * cell;
    ctx.fillStyle = '#2e2018';
    ctx.beginPath(); ctx.arc(x, y, cell * 0.12, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x - cell * 0.13, y, cell * 0.08, 0, 7); ctx.fill();
    if (a.c & 1) {
      ctx.fillStyle = '#f3d34a';
      ctx.beginPath(); ctx.arc(x + cell * 0.1, y - cell * 0.13, cell * 0.09, 0, 7); ctx.fill();
    }
    if (a.c & 2) {
      ctx.fillStyle = '#8a5a30';
      ctx.beginPath(); ctx.arc(x - cell * 0.05, y - cell * 0.16, cell * 0.09, 0, 7); ctx.fill();
    }
  }

  if (hover && hover.c >= 0 && hover.r >= 0 && hover.c < s.gridDim.cols && hover.r < s.gridDim.rows) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.strokeRect(ox + hover.c * cell + 1, oy + hover.r * cell + 1, cell - 3, cell - 3);
  }
}

// a garden cell: bare soil → sprouting caps → ripe glow (tap to harvest)
function drawGarden(gd, x, y, cell) {
  const cx = x + cell / 2;
  if (gd.st === 0 && gd.pc === 0) {
    // tilled, unseeded — dark furrows
    ctx.strokeStyle = 'rgba(150,120,160,0.5)'; ctx.lineWidth = 1.5;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(x + 5, y + (cell * i) / 4); ctx.lineTo(x + cell - 6, y + (cell * i) / 4); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(220,200,230,0.8)'; ctx.font = `${Math.floor(cell * 0.34)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('🍄?', cx, y + cell * 0.62);
    return;
  }
  const ripe = gd.st >= 4;
  const n = Math.min(3, Math.max(1, gd.st));         // caps shown
  const size = cell * (0.10 + 0.05 * gd.st);         // caps grow with stage
  for (let i = 0; i < n; i++) {
    const px = x + cell * (0.28 + i * 0.24);
    const py = y + cell * 0.66;
    ctx.strokeStyle = '#d8cfc0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - size); ctx.stroke();
    ctx.fillStyle = ripe ? '#d8905a' : '#b0889a';
    ctx.beginPath(); ctx.arc(px, py - size, size * 0.8, Math.PI, 0); ctx.fill();
  }
  if (ripe) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
    ctx.strokeStyle = `rgba(243,211,74,${0.3 + 0.5 * pulse})`; ctx.lineWidth = 3;
    ctx.strokeRect(x + 1, y + 1, cell - 3, cell - 3);
  } else if (gd.st > 0 && !gd.ok) {
    ctx.font = `${Math.floor(cell * 0.32)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('⏸', cx, y + cell * 0.3);
  }
  // harvested pieces waiting for a hauler
  ctx.fillStyle = '#b97a45';
  for (let i = 0; i < gd.pc; i++) {
    ctx.beginPath(); ctx.arc(x + cell * 0.2 + i * cell * 0.15, y + cell * 0.85, cell * 0.06, 0, 7); ctx.fill();
  }
}
