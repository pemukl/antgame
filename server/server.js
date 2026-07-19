// Bloom & Burrow — game server. Zero dependencies.
// Serves the web client, assigns the two roles, runs the authoritative
// simulation, and streams state to both browsers via Server-Sent Events.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGame, tick, command, publicState } = require('./game');
const bot = require('./bot');

const PORT = process.env.PORT || 8420;
const WEB = path.join(__dirname, '..', 'web');
const TICK = 0.05;           // 20 Hz simulation
const BROADCAST_EVERY = 1;   // broadcast every tick
// dev flags for visual testing: DEMO=1 runs bots on BOTH roles (alongside any
// humans — watch or interfere), SPEED=N fast-forwards the simulation clock
const DEMO = !!process.env.DEMO;
const SPEED = Math.max(0.1, +(process.env.SPEED || 1));

let game = createGame();
// role -> { token, res (open SSE response or null), joinedAt, everConnected }
//        | { bot: true }   — a bot partner playing that role
// A human role is reserved from /join onward; if the browser never opens its
// SSE stream the reservation lapses after 10s. After a disconnect the role
// frees immediately so a page refresh can rejoin. A human joining a bot-held
// role takes over from the bot.
const players = { bloom: null, burrow: null };
const botStates = { bloom: null, burrow: null };
let wasBothConnected = false;
let lastPairToast = 0;
const JOIN_GRACE_MS = 10000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function connected(role) { return !!(players[role] && players[role].res); }
function roleStatus(role) {
  const p = players[role];
  if (!p) return 'free';
  if (p.bot) return 'bot';
  if (p.res) return 'human';
  if (!p.everConnected && (Date.now() - p.joinedAt) < JOIN_GRACE_MS) return 'human';
  return 'free';
}
function addBot(role) {
  players[role] = { bot: true };
  botStates[role] = bot.newBotState();
  game.toasts.push({ id: Date.now(), msg: `A 🤖 bot has taken over ${role.toUpperCase()} — a human can join anytime.`, bad: false, role: 'all' });
  if (game.toasts.length > 12) game.toasts.shift();
}
function roleByToken(token) {
  if (!token) return null;   // bots have no token — never match them
  for (const role of ['bloom', 'burrow']) {
    if (players[role] && !players[role].bot && players[role].token === token) return role;
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (ch) => { data += ch; if (data.length > 10000) req.destroy(); });
    req.on('end', () => resolve(data));
  });
}
function sendJSON(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ---- join: claim a role ----
  if (req.method === 'POST' && url.pathname === '/join') {
    let body = {};
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { /* fall through */ }
    const role = body.role;
    if (role !== 'bloom' && role !== 'burrow') return sendJSON(res, 400, { error: 'bad role' });
    if (roleStatus(role) === 'human') return sendJSON(res, 409, { error: 'role taken' });
    if (roleStatus(role) === 'bot') botStates[role] = null;   // human takes over
    const token = crypto.randomBytes(12).toString('hex');
    players[role] = { token, res: null, joinedAt: Date.now(), everConnected: false };
    return sendJSON(res, 200, { token, role });
  }

  // ---- commands ----
  if (req.method === 'POST' && url.pathname === '/cmd') {
    let body = {};
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { /* fall through */ }
    const role = roleByToken(body.token);
    if (!role) return sendJSON(res, 403, { error: 'unknown token' });
    if (body.type === 'restart') {
      if (game.gameOver) {
        game = createGame();
        for (const r of ['bloom', 'burrow']) if (players[r] && players[r].bot) botStates[r] = bot.newBotState();
      }
    } else if (body.type === 'bot') {
      // summon a bot partner for the OTHER role (if no human holds it)
      const other = role === 'bloom' ? 'burrow' : 'bloom';
      if (roleStatus(other) !== 'human' && roleStatus(other) !== 'bot') addBot(other);
    } else {
      command(game, role, body);
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---- SSE state stream ----
  if (req.method === 'GET' && url.pathname === '/events') {
    const role = roleByToken(url.searchParams.get('token'));
    if (!role) return sendJSON(res, 403, { error: 'unknown token' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write(': hello\n\n');
    if (players[role].res) { try { players[role].res.end(); } catch (e) {} }
    players[role].res = res;
    players[role].everConnected = true;
    req.on('close', () => {
      if (players[role] && players[role].res === res) players[role].res = null;
    });
    return;
  }

  // ---- lobby/debug state ----
  if (req.method === 'GET' && url.pathname === '/state') {
    return sendJSON(res, 200, {
      roles: { bloom: roleStatus('bloom'), burrow: roleStatus('burrow') },
      gameOver: game.gameOver,
      edges: game.edges.length, ants: game.ants.length, // handy for headless tests
    });
  }

  // ---- static client ----
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(WEB, p);
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- main loop ----
setInterval(() => {
  const sb = roleStatus('bloom'), su = roleStatus('burrow');
  // run when both seats are filled AND at least one is a live human
  const anyHuman = connected('bloom') || connected('burrow');
  const both = DEMO ? anyHuman : (sb !== 'free' && su !== 'free' && anyHuman);
  if (both && !wasBothConnected && !game.gameOver && Date.now() - lastPairToast > 30000) {
    lastPairToast = Date.now();
    game.toasts.push({ id: Date.now(), msg: 'Both players connected — the colony stirs!', bad: false, role: 'all' });
    if (game.toasts.length > 12) game.toasts.shift();
  }
  wasBothConnected = both;
  if (both && !game.gameOver) {
    // SPEED fast-forwards by running whole sub-ticks — same fidelity as 1×
    for (let i = 0; i < Math.round(SPEED) && !game.gameOver; i++) {
      for (const r of ['bloom', 'burrow']) {
        if (DEMO && !botStates[r]) botStates[r] = bot.newBotState();
        if ((DEMO || (players[r] && players[r].bot)) && botStates[r]) bot.act(game, r, botStates[r], TICK);
      }
      tick(game, TICK);
    }
  }

  const state = publicState(game);
  state.paused = !both;
  state.roles = { bloom: sb, burrow: su };
  const msg = `data: ${JSON.stringify(state)}\n\n`;
  for (const role of ['bloom', 'burrow']) {
    if (players[role] && players[role].res) {
      try { players[role].res.write(msg); } catch (e) { players[role].res = null; }
    }
  }
}, TICK * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bloom & Burrow server on http://0.0.0.0:${PORT}`);
});
