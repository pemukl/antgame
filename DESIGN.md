# Bloom & Burrow — Prototype 3 (living flows)

Playable at **http://taylor.shnei.de:8420/** (or via https://shnei.de/antgame/, which
forwards there). Open it in two browsers; each player claims a role.

## Prototype 3: the fun bet — both players sculpt living flows

Prototype 2 was fun for minutes, then hollow: Bloom clicked every source once,
Burrow dug a bit, then both watched. The fix is a deeper core verb per side —
one mechanic each, pushed hard:

**Bloom: hand-drawn stigmergic trails.** You *drag* pheromone trails from the dock
(they cost budget that regenerates). Trails evaporate constantly — but every ant
that delivers food reinforces the trail it used. Busy trails glow and persist;
useless ones fade and die. Rain slashes them, drought triples evaporation, winter
wipes them, and food spawns farther away every year while distant sources are
richer. You garden a living road network under weather pressure — the game is
*where you commit pheromone*, not clicking.

**Geometry is the skill (v3.1).** Trails form a tree rooted at the dock, and a
delivery reinforces *every stroke on the ant's way home* — so a trunk fed by
several twigs stays strong almost for free, while the twigs live and die with
their food. Erasing (or losing) a trunk takes its whole subtree. Ants also have
two typed paws — one sugar, one protein — and fill both along a single route, so
a line drawn *through* a flower and a carcass doubles per-trip throughput; the
spawner deliberately seeds opposite-type sources near existing ones to offer
those routes. With the tightened budget (1.8/s regen), measured results: a
through-route beats two spokes on cost AND throughput, and in 5-year headless
runs the spoke-drawing player starves in year 5 while the identical
branching-network player finishes healthy. Mini-Metro-style depth — but the
network is alive: it prunes itself, and traffic is the glue.

**Burrow: real water physics.** Rain pours in at the entrance and *flows* — falls,
pools, spreads through whatever you dug. Your architecture is the mechanic: drop
shafts and sumps route water away from the throne room; toggleable gates (limited,
cost sugar) seal corridors like airlocks; but anything dug below the groundwater
line seeps in spring, so deep sumps must be gated seasonally. Flooded stockpiles
spill, eggs drown, and the queen herself drowns after 8 seconds under water —
verified: ignoring the water kills you in year 1's third rainstorm; a few sump
cells dug in time keep you dry for years.

**Coupling stayed, and got sharper.** Haulers refuse to pantry-hoard protein past
60% of storage, so excess protein piles up on the dock and jams it — a *visible
signal* from Burrow to Bloom: "stop trailing carcasses, I need sugar." Bloom alone
sees the per-second weather forecast; Burrow alone sees the water creeping. Score
grows per year survived; every year the rain hits ~35% harder.

Balance was tuned headlessly: attentive scripted players survive 5+ escalating
years; skipping sump work drowns the queen in year 1, and greedy breeding starves
the colony in year 2.

## Why networked two-browser (prototype 2 rationale)

Prototype 1 put both players on one keyboard and one screen. Prototype 2 gives each
player their own browser — and that unlocks the thing asymmetric co-op is actually
about (see *Keep Talking and Nobody Explodes*): **information asymmetry**.

- **Bloom** sees only the meadow — food sources, pheromone trails, the dock from
  above, and the *weather forecast* ("rain in ~8s", "winter in 20s").
- **Burrow** sees only the nest — tunnels, stores, queen health, eggs, and the dock
  from below.

Neither can see the other's screen, so the game forces the conversation the README
calls "acting on partner's forecasts": Bloom must warn about weather; Burrow must ask
for protein before laying eggs and report when the stores run low.

## Architecture

```
server/game.js    authoritative simulation (pure JS module, no deps, unit-testable)
server/server.js  zero-dependency Node http server: static client, role assignment,
                  POST /join + /cmd, SSE stream /events (20 Hz state broadcasts)
web/              canvas client — renders only YOUR world, sends mouse commands
```

- Server-authoritative: both browsers receive the same state; clients are dumb views.
  Ant positions interpolate between frames (~2.7 KB/frame at 20 Hz).
- Roles: first browser to claim Bloom/Burrow holds it while its stream is open;
  disconnect frees the role, so a refresh rejoins cleanly. Simulation **pauses unless
  both players are connected** (cozy rule: the world waits for you).
- Everything crosses the dock: foragers drop goods outside (15-unit buffer that
  visibly jams), Burrow's ants haul it in. Sugar feeds everyone, protein makes ants.
- Same seasonal year as prototype 1 (validated by headless multi-year playthroughs):
  spring/autumn floods below the water line, autumn rain washes trails, winter
  fast-forward with frost. Queen starves → game over, either player can restart.

## Orientation

Portrait is the primary layout. Bloom's world renders rotated 90° in portrait —
the pit (a proper dark hole in the earth) sits at the bottom of the screen and the
meadow rises above it; you draw trails upward from the hole. The rotation is pure
client-side presentation (server coordinates never change), so one player can be
on a portrait phone while the other plays landscape on a laptop.

The nest itself is portrait-SHAPED: 16 cells wide × 24 deep — a vertical cut
through the anthill, per the README. It fills a phone held upright and reads as an
ant-farm terrarium centered on a desktop.

The canvas always letterboxes into whatever space the toolbars leave
(`fitCanvas()` in client.js): the whole world — especially the pit — is always on
screen, never below the fold. No scrolling, ever.

## The queen's year (v4) — Burrow's recurring loop

Burrow used to go quiet once the base was built. Now the queen is a movable
piece and the seasons pull her in opposite directions, forever:

- **Eggs develop only within 3.5 cells of the queen**, and hatch 40% faster in
  the warm top rows — so in spring/summer she belongs UP by the nursery.
- **In winter the frost creeps downward** (row 2 → ~7 over the season); a queen
  above the line freezes fast — so she must be carried DOWN into a bunker.
- Spring melt still floods below row 14, so the bunker band (rows ~8–13) is
  earned by digging, and deep chambers need gates against the melt.

Tap the queen, tap a chamber: workers carry her (slowly — plan ahead of the
weather). The grid is now a coarse 12×18: fewer, fatter cells, each dig a
real decision. Other ideas considered for Burrow depth, not yet built: fungus
contamination arriving via dock goods (quarantine gates), brood nurses, pests,
and a fungus-garden economy (README stage 6).

## Solo testing: the bot partner

Join a role, then click "🤖 Play with a bot partner" on the waiting screen — or
open `/?role=bloom&bot=1` directly. A server-side bot (`server/bot.js`) plays the
other role using the strategies from the balance harness: the Bloom bot builds
branching trail networks and recalls before winter; the Burrow bot manages labor
allocation, digs sumps ahead of the rains, expands storage, and breeds. A human
joining a bot-held role takes over seamlessly; the lobby shows "🤖 bot playing —
join to take over". The game still pauses when no human is connected.

## Controls

- **Bloom:** click a source to toggle its trail; buttons for *Recall* and *Clear trails*.
- **Burrow:** tool palette (Dig / Stockpile / Nursery / Egg) + click a cell; slider
  sets how many workers go outside.

## Deploy notes

- Start/restart: `server/run.sh` (nohup on port 8420). Not yet persisted across
  reboots — add `@reboot /home/marc/antgame/server/run.sh` to `crontab -e` if wanted.
- `/var/www/html/antgame → /home/marc/antgame/web`; apache serves the client over
  https, but the page immediately hops to `http://<host>:8420/` so the SSE/API is
  same-origin (browsers block plain-http API calls from an https page). For a proper
  `https://antgame.shnei.de`, copy the proxy pattern from
  `/etc/apache2/sites-enabled/python.conf` pointing at `127.0.0.1:8420` (needs sudo).

## What to playtest

1. Do the hidden halves actually produce table-talk, or do players just grind silently?
2. Is the pause-when-alone rule right, or should the world keep humming?
3. Does Bloom have enough to *do* compared to Burrow's builder toolkit?

## Cut for now

Bigs/repletes/aphids/fungus, research order, surface terraforming, queen relocation,
rooms/multiple games per server, chat (assume voice or same room), sound, HTTPS.
