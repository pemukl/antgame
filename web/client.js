// Bloom & Burrow client, prototype 3.
// Bloom: drag to paint pheromone trails. Burrow: dig against flowing water.

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
};
$('muteBtn').onclick = () => { muted = !muted; $('muteBtn').textContent = muted ? '🔇' : '🔊'; };
// mobile browsers keep audio suspended until a user gesture
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
  $('shareUrl').textContent = location.href;
  layoutCanvas();
  // bars fill with content over the next frames — refit once they settle
  setTimeout(layoutCanvas, 300);
  setTimeout(layoutCanvas, 1200);
}
function cmd(obj) {
  fetch('/cmd', { method: 'POST', body: JSON.stringify({ token, ...obj }) });
}

$('joinBloom').onclick = () => join('bloom');
$('joinBurrow').onclick = () => join('burrow');
$('botBtn').onclick = () => cmd({ type: 'bot' });
// ?role=bloom auto-joins; add &bot=1 to also summon a bot partner — handy for
// solo dev-testing (e.g. /?role=burrow&bot=1)
{
  const params = new URLSearchParams(location.search);
  const want = params.get('role');
  if (want === 'bloom' || want === 'burrow') {
    join(want).then(() => { if (params.get('bot') && token) cmd({ type: 'bot' }); });
  }
}
$('restartBtn').onclick = () => cmd({ type: 'restart' });
$('recallBtn').onclick = () => cmd({ type: 'recall' });
let eraseMode = false;
$('eraseBtn').onclick = () => {
  eraseMode = !eraseMode;
  $('eraseBtn').classList.toggle('on', eraseMode);
  $('eraseBtn').textContent = eraseMode ? '✕ Erasing — tap a trail' : '✕ Erase';
};
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
      const status = s.roles[role];   // 'free' | 'bot' | 'human'
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
function onState() {
  const s = curr;
  const showWaiting = s.paused && !s.gameOver;
  $('overlay').classList.toggle('hidden', !showWaiting && !s.gameOver);
  $('waiting').classList.toggle('hidden', !showWaiting);
  $('gameover').classList.toggle('hidden', !s.gameOver);
  $('lobby').classList.add('hidden');
  if (s.gameOver) $('overMsg').textContent = s.overMsg;

  const seasonName = s.seasons[s.seasonIdx].name;
  const pill = $('seasonPill');
  pill.textContent = `${seasonName} · Year ${s.year}`;
  const cols = { Spring: '#8fbf6b', Summer: '#e8c95a', Autumn: '#d98e4a', Winter: '#a9c4d8' };
  pill.style.background = cols[seasonName];
  $('seasonFill').style.width = (100 * s.seasonT / s.seasonLen) + '%';
  $('seasonFill').style.background = cols[seasonName];
  const out = s.ants.filter(a => a.s === 1).length;
  const botPartner = s.roles && s.roles[myRole === 'bloom' ? 'burrow' : 'bloom'] === 'bot';
  const dockT = s.dock.sugar + s.dock.protein;
  if (window.innerWidth < 560) {
    // compact HUD: every pixel of a phone screen belongs to the world
    $('antInfo').textContent = `🐜${s.ants.length} · ${out} out` +
      (s.recall ? ' · ⛑' : '') + (botPartner ? ' · 🤖' : '');
    $('dockInfo').textContent = `⚓${dockT}/${s.dockCap}` + (dockT >= s.dockCap ? '⚠' : '');
  } else {
    $('antInfo').textContent = `🐜 ${s.ants.length} — ${out} out / ${s.ants.length - out} in` +
      (s.recall ? ' · RECALL' : ` · target ${s.desiredOutside}`) + (botPartner ? ' · partner 🤖' : '');
    $('dockInfo').textContent = `Dock ${dockT}/${s.dockCap}` + (dockT >= s.dockCap ? ' ⚠ JAM' : '');
  }
  $('scoreInfo').textContent = `⭐ ${s.score}`;

  if (myRole === 'bloom') {
    $('recallBtn').textContent = s.recall ? 'Recall ON — lift it' : 'Recall foragers';
    $('recallBtn').classList.toggle('on', s.recall);
    $('forecast').textContent = forecast(s, seasonName);
    $('pherFill').style.width = (100 * s.pher / s.pherMax) + '%';
    $('pherVal').textContent = s.pher;
    // delivery blip when goods land on the dock
    if (lastDockTotal >= 0 && dockT > lastDockTotal && performance.now() - lastDeliverBeep > 150) {
      snd.deliver(); lastDeliverBeep = performance.now();
    }
  } else {
    $('storeInfo').innerHTML =
      `🍯 <b>${s.store.sugar}</b> · 🥩 <b>${s.store.protein}</b> · storage ${s.store.sugar + s.store.protein}/${s.cap}`;
    $('queenInfo').innerHTML = `👑 ${s.queenHP}%` +
      (s.queenDanger ? ' <b style="color:#a02020">DROWNING!</b>' : '') +
      (s.starving ? ' <b style="color:#a02020">STARVING</b>' : '') +
      ` · 🥚 ${s.eggs.length} · 🚪 ${s.gates.count}/${s.gates.max}`;
    const slider = $('allocSlider');
    slider.max = Math.max(1, s.ants.length);
    if (document.activeElement !== slider) {
      slider.value = s.desiredOutside;
      $('allocVal').textContent = s.desiredOutside;
    }
  }

  if (lastAnts >= 0 && s.ants.length > lastAnts) snd.hatch();
  if (s.raining && !lastRaining) snd.rain();
  lastAnts = s.ants.length; lastDockTotal = dockT; lastRaining = s.raining;

  for (const t of s.toasts) {
    if (seenToasts.has(t.id)) continue;
    seenToasts.add(t.id);
    if (t.role !== 'all' && t.role !== myRole) continue;
    const div = document.createElement('div');
    div.className = 'toast' + (t.bad ? ' bad' : '');
    div.textContent = t.msg;
    $('toasts').appendChild(div);
    setTimeout(() => div.remove(), 5000);
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
  if (seasonName === 'Autumn') return `🍂 Stormy.${evTxt} · ⚠ WINTER in ${left}s — recall in time!`;
  return `❄️ ${left}s of frost left. Any ant outside is dying.`;
}

// ---------- orientation & canvas layout ----------
// In portrait, Bloom's world is rotated 90° clockwise so the dock (the ant
// pit) sits at the BOTTOM and the meadow stretches upward. Server coordinates
// never change — this is pure presentation, so the two players can even use
// different orientations.
let portrait = false;
function layoutCanvas() {
  portrait = window.innerHeight > window.innerWidth;
  if (!myRole) return;
  let w, h;
  if (myRole === 'bloom') { w = portrait ? 620 : 1000; h = portrait ? 1000 : 620; }
  else { w = 464; h = 714; }   // 12×18 deep nest at 36px cells — portrait-shaped everywhere
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  fitCanvas();
}
// letterbox the canvas into whatever the bars leave visible — the whole world
// (especially the pit) must ALWAYS be on screen, never below the fold.
// visualViewport is the truthful size inside in-app browsers (Telegram, iOS
// Safari with collapsing chrome); innerHeight lies there.
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
// bars can grow/shrink (text wrap, season change) without any window resize
let lastBarsH = -1;
setInterval(() => {
  if (!myRole) return;
  const h = barsHeight();
  if (h !== lastBarsH) { lastBarsH = h; fitCanvas(); }
}, 500);
const rotBloom = () => portrait && myRole === 'bloom';
function P(x, y) { return rotBloom() ? { x: 620 - y, y: x } : { x, y }; }        // world -> canvas
function Winv(cx, cy) { return rotBloom() ? { x: cy, y: 620 - cx } : { x: cx, y: cy }; } // canvas -> world

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

let lastWin = '';
function frame() {
  requestAnimationFrame(frame);
  const s = lerpState();
  if (!s || !myRole) return;
  const win = window.innerWidth + 'x' + window.innerHeight;
  if (win !== lastWin) { lastWin = win; layoutCanvas(); }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (myRole === 'bloom') drawBloom(s);
  else drawBurrow(s);
}
requestAnimationFrame(frame);

// ----- Bloom -----
let stroke = null; // {pts:[[x,y],...] in WORLD coords, attachId, attachIdx, len}
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
function nearestTrailPoint(s, x, y, maxD) {
  // only a stroke's OWN segment counts — branches copy their parent's prefix,
  // and clicking the shared part should hit the parent, not the branch
  let best = null, bestD = maxD;
  for (const t of s.trails) {
    for (let i = Math.max(0, (t.ownStart || 1) - 1); i < t.pts.length; i++) {
      const p = t.pts[i];
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bestD) { bestD = d; best = { id: t.id, idx: i, x: p[0], y: p[1] }; }
    }
  }
  return best;
}

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || !curr) return;
  if (myRole !== 'bloom') return;
  ev.preventDefault();
  const { x, y } = worldXY(ev);
  if (eraseMode) {
    const at = nearestTrailPoint(curr, x, y, 26);
    if (at) cmd({ type: 'erase', id: at.id });
    return;
  }
  const dock = { x: curr.world.w - 25, y: 310 };
  if (Math.hypot(x - dock.x, y - dock.y) < 55) {
    stroke = { pts: [[dock.x, dock.y]], attachId: null, attachIdx: 0, len: 0 };
  } else {
    const at = nearestTrailPoint(curr, x, y, 28);   // generous for fingers
    if (at) stroke = { pts: [[at.x, at.y]], attachId: at.id, attachIdx: at.idx, len: 0 };
    else return;
  }
  canvas.setPointerCapture(ev.pointerId);
  snd.draw();
});
canvas.addEventListener('pointermove', (ev) => {
  if (myRole !== 'bloom' || !stroke) return;
  const { x, y } = worldXY(ev);
  const last = stroke.pts[stroke.pts.length - 1];
  const d = Math.hypot(x - last[0], y - last[1]);
  if (d >= 12) {
    stroke.pts.push([Math.round(x), Math.round(y)]);
    stroke.len += d;
  }
});
canvas.addEventListener('pointerup', () => {
  if (myRole !== 'bloom' || !stroke) return;
  if (stroke.pts.length >= 3) {
    // magnet: if the stroke ends near a source, snap the tip onto it so the
    // trail never misses its target by a few pixels
    const last = stroke.pts[stroke.pts.length - 1];
    let best = null, bd = 55;
    for (const src of (curr ? curr.sources : [])) {
      const d = Math.hypot(src.x - last[0], src.y - last[1]);
      if (d < bd) { bd = d; best = src; }
    }
    if (best) stroke.pts.push([Math.round(best.x), Math.round(best.y)]);
    cmd({
      type: 'trail',
      pts: stroke.pts.slice(1),          // server re-adds the anchor point
      attachId: stroke.attachId,
      attachIdx: stroke.attachIdx,
    });
  }
  stroke = null;
});
canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  if (myRole !== 'bloom' || !curr) return;
  const { x, y } = worldXY(ev);
  const at = nearestTrailPoint(curr, x, y, 18);
  if (at) cmd({ type: 'erase', id: at.id });
});

function polyPath(pts, from) {
  // pts are world [x,y] pairs; map each through P()
  const q0 = P(pts[from][0], pts[from][1]);
  ctx.beginPath();
  ctx.moveTo(q0.x, q0.y);
  for (let i = from; i < pts.length; i++) {
    const q = P(pts[i][0], pts[i][1]);
    ctx.lineTo(q.x, q.y);
  }
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

  const dock = { x: s.world.w - 25, y: 310 };
  const rot = rotBloom();

  // trails: each stroke draws only its OWN segment with its own strength, so
  // a well-fed trunk visibly thickens under the twigs that feed it
  for (const t of s.trails) {
    const from = Math.max(0, (t.ownStart || 1) - 1);
    const alpha = 0.15 + 0.75 * Math.max(0, t.strength);
    ctx.strokeStyle = t.food ? `rgba(120,60,140,${alpha})` : `rgba(110,90,90,${alpha * 0.8})`;
    ctx.lineWidth = 2 + 5 * Math.max(0, t.strength);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    polyPath(t.pts, from);
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([3, 14]);
    ctx.lineDashOffset = -performance.now() / 25;
    ctx.strokeStyle = `rgba(255,240,255,${alpha * 0.8})`;
    ctx.lineWidth = 2;
    polyPath(t.pts, from);
    ctx.stroke();
    ctx.restore();
  }
  // while drawing, show each source's pickup radius — anything inside counts
  if (stroke) {
    ctx.strokeStyle = 'rgba(120,60,140,0.35)';
    ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5;
    for (const src of s.sources) {
      const q = P(src.x, src.y);
      ctx.beginPath(); ctx.arc(q.x, q.y, 40, 0, 7); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // stroke preview (stroke.pts are world coords)
  if (stroke) {
    const cost = Math.ceil(stroke.len / 10);
    const ok = cost <= s.pher;
    ctx.strokeStyle = ok ? 'rgba(120,60,140,0.9)' : 'rgba(200,60,40,0.9)';
    ctx.setLineDash([6, 6]); ctx.lineWidth = 3;
    polyPath(stroke.pts, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    const tipW = stroke.pts[stroke.pts.length - 1];
    const tip = P(tipW[0], tipW[1]);
    ctx.fillStyle = ok ? '#3a2e22' : '#a02020';
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${cost} 🟣`, tip.x, tip.y - 12);
  }

  // sources
  for (const src of s.sources) {
    const q = P(src.x, src.y);
    if (src.type === 'nectar') {
      ctx.fillStyle = '#e8a0bf';
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(q.x + Math.cos(ang) * 8, q.y + Math.sin(ang) * 8, 6, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#f3d34a';
      ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = '#6b4a2f';
      ctx.beginPath(); ctx.ellipse(q.x, q.y, 14, 8, 0.4, 0, 7); ctx.fill();
      ctx.strokeStyle = '#4d3520'; ctx.lineWidth = 1.5;
      for (let l = -1; l <= 1; l++) {
        ctx.beginPath(); ctx.moveTo(q.x + l * 5, q.y - 4); ctx.lineTo(q.x + l * 8, q.y - 13); ctx.stroke();
      }
    }
    ctx.fillStyle = '#3a2e22'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(src.amt, q.x, q.y + 32);
  }

  // dock — right edge in landscape, BOTTOM (the ant pit) in portrait
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
  // the pit itself — an unmissable hole into the earth where all trails start
  const dq = P(dock.x, dock.y);
  ctx.fillStyle = '#9a7a4a';
  ctx.beginPath(); ctx.ellipse(dq.x, dq.y, 30, 22, 0, 0, 7); ctx.fill();      // dirt mound
  ctx.fillStyle = '#6b4a2f';
  ctx.beginPath(); ctx.ellipse(dq.x, dq.y, 22, 15, 0, 0, 7); ctx.fill();      // inner rim
  ctx.fillStyle = '#241609';
  ctx.beginPath(); ctx.ellipse(dq.x, dq.y, 15, 10, 0, 0, 7); ctx.fill();      // the hole
  ctx.strokeStyle = 'rgba(120,60,140,0.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(dq.x, dq.y, 34 + 5 * Math.sin(performance.now() / 400), 0, 7); ctx.stroke();
  ctx.fillStyle = '#3a2e22'; ctx.font = 'bold 14px sans-serif';
  if (rot) {
    // label sits just ABOVE the dock strip so it never covers the hole
    ctx.textAlign = 'center';
    ctx.fillText('drag from the hole to draw a trail ⤵', canvas.width / 2, canvas.height - 58);
  } else {
    ctx.save();
    ctx.translate(canvas.width - 14, 350); ctx.rotate(Math.PI / 2); // starts below the hole
    ctx.textAlign = 'left';
    ctx.fillText('THE PIT — drag from the hole to draw a trail', 0, 0);
    ctx.restore();
  }
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

// ----- Burrow -----
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
  // tapping the queen selects her; the next tap sends her to a new chamber
  const qd = Math.hypot(c + 0.5 - curr.queen.x, r + 0.5 - curr.queen.y);
  if (queenSel) {
    queenSel = false;
    if (qd > 0.8) { cmd({ type: 'moveQueen', c, r }); snd.gate(); }
    return;
  }
  if (qd <= 0.8) { queenSel = true; return; }
  const ch = curr.grid[r][c];
  if (ch === 'D' || ch === 'O') { cmd({ type: 'gate', c, r }); snd.gate(); return; }
  if (tool === 'dig') cmd({ type: 'dig', c, r });
  else if (tool === 'egg') cmd({ type: 'egg', c, r });
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

  ctx.fillStyle = '#8a6844';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = seasonName === 'Winter' ? '#dfe9f2' : (s.raining ? '#8fa8bd' : '#bcd6e8');
  ctx.fillRect(0, 0, canvas.width, oy);
  // the entrance shaft — visually punches through the sky strip
  ctx.fillStyle = '#241609';
  ctx.fillRect(ox + 2, oy - 14, cell - 4, 15);
  ctx.fillStyle = '#3a2e22'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('⬆ DOCK' + (s.raining ? ' — 🌧 WATER COMING IN' : ''), ox + cell + 6, oy - 8);

  for (let r = 0; r < s.gridDim.rows; r++) {
    for (let c = 0; c < s.gridDim.cols; c++) {
      const ch = s.grid[r][c];
      const x = ox + c * cell, y = oy + r * cell;
      if (ch === '#') {
        ctx.fillStyle = r >= s.meltRow ? '#66492e' : '#7a5b3c';
        ctx.fillRect(x, y, cell - 1, cell - 1);
        continue;
      }
      ctx.fillStyle = '#453121';
      ctx.fillRect(x, y, cell - 1, cell - 1);
      // water level fills from the bottom
      const w = (+s.water[r][c]) / 9;
      if (w > 0.02) {
        ctx.fillStyle = 'rgba(64,130,180,0.85)';
        const h = Math.min(1, w) * (cell - 1);
        ctx.fillRect(x, y + (cell - 1) - h, cell - 1, h);
      }
      if (ch === 'S') {
        ctx.strokeStyle = '#f3d34a'; ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, cell - 5, cell - 5);
      } else if (ch === 'N') {
        ctx.strokeStyle = '#e8a0bf'; ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, cell - 5, cell - 5);
      } else if (ch === 'D' || ch === 'O') {
        ctx.strokeStyle = '#c8a86a'; ctx.lineWidth = 3;
        if (ch === 'D') {
          ctx.fillStyle = '#9a7a4a';
          ctx.fillRect(x + 3, y + 2, cell - 7, cell - 5);
          ctx.strokeRect(x + 3, y + 2, cell - 7, cell - 5);
          ctx.strokeStyle = '#6b4a2f';
          ctx.beginPath(); ctx.moveTo(x + 4, y + cell / 2); ctx.lineTo(x + cell - 5, y + cell / 2); ctx.stroke();
        } else {
          ctx.strokeRect(x + 3, y + 2, cell - 7, cell - 5);
        }
      }
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  for (const d of s.digs) {
    ctx.strokeRect(ox + d.c * cell + 3, oy + d.r * cell + 3, cell - 7, cell - 7);
  }
  ctx.setLineDash([]);

  // eggs (progress ring; dimmed + 💤 when outside the queen's warmth)
  for (const e of s.eggs) {
    const siblings = s.eggs.filter(x => x.c === e.c && x.r === e.r);
    const idx = siblings.indexOf(e);
    const x = ox + e.c * cell + cell * 0.25 + idx * cell * 0.25;
    const y = oy + e.r * cell + cell * 0.68;
    ctx.globalAlpha = e.w ? 1 : 0.45;
    ctx.fillStyle = '#f5efdc';
    ctx.beginPath(); ctx.ellipse(x, y, cell * 0.1, cell * 0.15, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#e8a0bf'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, cell * 0.18, -Math.PI / 2, -Math.PI / 2 + (e.t / 20) * Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (!e.w) {
      ctx.fillStyle = 'rgba(200,225,245,0.95)'; ctx.font = `${Math.floor(cell * 0.3)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('💤', x, y - cell * 0.25);
    }
  }

  // the queen — a movable sprite: tap her, then tap a chamber to carry her
  {
    const qx = ox + s.queen.x * cell, qy = oy + s.queen.y * cell;
    if (queenSel) {
      ctx.strokeStyle = 'rgba(232,160,191,0.55)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(qx, qy, 3.5 * cell, 0, 7); ctx.stroke();  // brood-warmth radius
      ctx.setLineDash([]);
      ctx.strokeStyle = '#f3d34a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(qx, qy, cell * 0.6 + 2 * Math.sin(performance.now() / 200), 0, 7); ctx.stroke();
      ctx.fillStyle = '#fff7e6'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('tap a chamber to carry the queen there', ox + s.gridDim.cols * cell / 2, oy + cell * 0.6);
    }
    ctx.fillStyle = s.queenDanger && Math.floor(performance.now() / 250) % 2 ? '#c03030' : '#5a3050';
    ctx.beginPath(); ctx.ellipse(qx, qy, cell * 0.38, cell * 0.27, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f3d34a'; ctx.font = `${Math.floor(cell * 0.42)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('♛', qx, qy - cell * 0.15);
  }

  // guide lines — the frost line creeps downward through winter
  const fy = oy + s.frostDepth * cell;
  ctx.strokeStyle = 'rgba(230,240,250,0.9)'; ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(ox, fy); ctx.lineTo(ox + s.gridDim.cols * cell, fy); ctx.stroke();
  const my = oy + s.meltRow * cell;
  ctx.strokeStyle = 'rgba(140,190,225,0.9)';
  ctx.beginPath(); ctx.moveTo(ox, my); ctx.lineTo(ox + s.gridDim.cols * cell, my); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(235,244,252,0.95)';
  ctx.fillText(seasonName === 'Winter' ? 'FROST — keep the queen & eggs below!' : 'frost line — creeps down in winter',
    ox + s.gridDim.cols * cell - 4, fy - 3);
  ctx.fillStyle = 'rgba(180,215,240,0.95)';
  ctx.fillText('groundwater — digs below here seep in spring', ox + s.gridDim.cols * cell - 4, my - 3);

  if (seasonName === 'Winter') {
    ctx.fillStyle = 'rgba(220,235,248,0.35)';
    ctx.fillRect(ox, oy, s.gridDim.cols * cell, s.frostDepth * cell);
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
