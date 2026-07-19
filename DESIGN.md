# Bloom & Burrow — v7 "the growing cut" (current)

Playable at **http://taylor.shnei.de:8420/** (or via https://shnei.de/antgame/, which
forwards there). Open it in two browsers; each player claims a role.

## v7 — the growing cut (current)

Full redesign per PLAN.md: two interlocking growth engines replace the
survival game. Everything outside comfort STALLS instead of dying; only the
queen can die, slowly, against a visible meter.

**Bloom is a graph game now.** Freehand strokes, pheromone budget, trail
evaporation, rain-slash, and the winter wipe are gone. Tap a node, tap
another node (or drag): a permanent trail edge. The network is a tree rooted
at the dock; ants harvest at every node they pass (both paws). Scarcity is
**segments** (8 + 2/milestone; 1 per 150 px, max 600 px/edge — trunks hop
through nodes). Erasing refunds after 5 s; orphaned subtrees gray out for
10 s and can be re-parented with one new edge. Rain **muddies** (half speed),
drought enriches far spawns; weather modulates, never erases. Winter is
planning season: instant refunds, seed markers that sprout at the thaw.
Depleted wilds with edges remain as **husk junctions** — dead geography
you're paying segments for, the refactor pressure.

**Burrow farms.** The cellular water sim, gates, sumps, and typed stockpiles
are gone. Climate is two visible lines: ❄ frost (row 2 → 7.5+0.25/yr in
winter, 4 in droughts) and 💧 damp (row 14 → 7.5 at the melt peak, +2 in
autumn rain). The peaks OVERLAP — no row is safe all year, so the nest grows
a summer wing and a winter wing and everything breathes yearly. **Gardens**:
seed 1🍯+1🥩 → 4 stages × 12 s in comfort → tap-harvest 3🥩; every 2nd
harvest yields a 🌰 seed. Garden slots = 1 + milestone. Stockpiles hold both
foods mixed; damp cells leak 1/10 s. Queen outside comfort loses
2+1.2/extra-row HP/s (regens +3 in comfort) — sustained neglect kills,
a near-miss scars.

**The seed loop couples both ways.** Workers ferry seeds to a 3-slot dock
LEDGE (separate from the pile, so jams can't block gifts). Bloom plants them
(≥250 px from the pit — barren ring; ≥80 px spacing): a renewable flower
(6 cap, +1/8 s in spring/summer, dormant otherwise, dies at age 2) that is
ALSO a junction node — Burrow grows the seeds, Bloom decides the network's
skeleton. Foragers also find a seed per 25 nectar delivered, so the meadow
farm never fully depends on the gardens.

**Self-regulating economy.** Foragers walk past a food type when the dock
holds ≥6 of it (visible demand signal); haulers grab whichever good the
stores are shorter on; when sugar runs out the colony grimly eats protein
at 2:1 — a glut is dreary, never deadly.

**Progression = celebration.** Milestones at 10/14/18/24 ants, then every
+8, each granting +2 segments and +1 garden slot. Colony Bloom score:
ants×2 + harvests×3 + flowers×4 + stores/5. A year-end **postcard** both
players see. Warn (autumn→winter, winter→melt) is Burrow's only forecast and
makes the whole colony work 15 % faster for the season — the pace-scaling
meta-rule is gone.

Balance verified headlessly (`node server/harness.js 8 8` and 12-year runs):
8/8 bot couples survive 8 years growing 12→63 ants with milestones ~1/year
and ~0 s of queen danger; a do-nothing Bloom starves the colony in year 1; a
do-nothing Burrow loses the queen to the first winter's frost. The harness
now prints fun proxies per run: actions/min per role, idle seasons, queen
danger time, growth curve, harvests, flowers planted.

## v7.1 — feel & fairness

**Winter planning is real now.** A seed planted in winter is tucked under
the snow as a DORMANT NODE immediately — Bloom can wire next spring's whole
tree to it while the world sleeps, and it sprouts at the thaw. (Markers as a
separate write-only concept are gone.)

**No unfair deaths.** Outside ants sprint 1.45× for the entrance in winter
and the freeze limit is 8 s — a reasonable recall loses nobody; only true
stragglers freeze. Burrow gets *predictive* line warnings ("the frost is
creeping toward the queen") ~2 rows before contact, once per ~18 s — a
heads-up to act on, not a punishment to react to.

**Juice.** Canvas particles + floating text: garden harvest (+3 🥩 puff),
seeding, tap-feeds, planting, hatches (+1 🐜 burst at the queen), erase
refunds (+N 〰). Milestones fire confetti and a banner on BOTH screens;
season turns get a soft center banner (winter tells Bloom "planning season —
replanning is free"). Queen wears an HP bar when hurt. Unconnected food
pulses softly on Bloom's map — the to-do list at a glance. The Garden tool
pulses until the first garden is built (year 1 only).

Re-verified after the changes: 10/10 runs survive 8 years (avg ⭐403,
harvests up ~25 % thanks to fewer freeze deaths), both lazy modes still die
in year 1.

## v7.2 — seen with real eyes (headless-browser pass)

A puppeteer rig (`~/.antgame-pptr/`, node 20 via nvm) now drives the actual
client: real mouse taps on the canvas, both roles, portrait + landscape,
screenshots of winter/postcard/milestone/drought moments. New dev flags make
this possible: `DEMO=1` runs bots on BOTH roles alongside any humans,
`SPEED=N` fast-forwards (as N whole sub-ticks per frame, so fidelity is
identical to 1×). E.g. `PORT=8432 DEMO=1 SPEED=4 node server.js`.

What the browser pass caught and fixed:

- **moveToward oscillation** (real latent bug): a step larger than the
  remaining distance overshot the waypoint and could bounce forever — at 4×
  it starved a whole colony. Movement now clamps to the target; harness
  growth actually improved at 1×.
- **Queen drought panic**: the summer dry band used to stress the QUEEN at
  her summer spot — two alarm fits per summer, with "frost" wording during a
  heat event. The queen now ignores surface droughts (eggs and gardens still
  stall); the band label reads "☀ DRY" during droughts, and stalled eggs
  show ☀ instead of ❄ outside winter.
- **Bot over-building**: the Burrow bot rushed its whole pantry plan (150
  cap in year 1). Stockpile steps now wait until caps < 24 + 2·ants.
- Frost/damp band tints were too heavy over rooms (0.30 → 0.20), the
  rotated pit label overflowed the canvas, and the segment meter now reads
  "N free of M".

Verified renders: Bloom landscape + portrait (rotation, edges with marching
dots, pulsing unconnected-source rings, sprout countdowns, planted-flower
stems), Burrow (bands + labels, gardens by stage, mixed stockpile dots,
queen HP bar), milestone confetti + banner, year postcard, winter planning
view (network under snow, "under the snow" planting, ⚡ prepared pill,
melt countdown). All interactions exercised through genuine pointer events:
tap-tap edge, plant, dig, garden seed. Zero page errors.

---

# Prototype history (superseded)

## v6 — the calm cut

Playtesting v5.3 showed the game had drifted from cozy to stressful: clay was
opaque, thirst hit out of nowhere, and half the workforce was permanently off
eating, drinking, or mopping instead of working. v6 cuts all of that and
returns to the humming, growth, resource-driven core:

- **Clay geology, soaked earth, and soil saturation are gone.** The ground is
  plain earth again; every dig takes the same 2 seconds. Rain percolates only
  into SHALLOW tunnels (nothing below row 8 collects rain except through the
  entrance), so "dig deep to stay dry" is the whole lesson.
- **Thirst, drinking, and parched ants are gone.** Water is weather, not a
  resource.
- **Bailing is gone.** Pools evaporate near the surface and soak into the
  earth below them all year round (fastest in summer). Sumps empty
  themselves; your job is shaping where water goes, never mopping it up.
- **Per-ant hunger and meal trips are gone.** The colony eats from the
  stores automatically — a steady sugar drain per ant (2.5× in winter), no
  walking. Empty stores mean the queen weakens and workers start dying, so
  the hoard still matters; the errands don't.
- **Larva hand-feeding is gone.** Workers still ferry protein to the queen
  (4 pieces per egg — growth still costs resources and labor), but a laid egg
  simply develops in her warmth. The 🍼 Brood toggle still pauses growth.
- Rain escalation went back up to **+35%/year** to compensate for the free
  drainage: bot-vs-bot runs now survive 8+ years with the first real queen
  scares around year 8, while a do-nothing Burrow drowns or starves the queen
  by year 2–3 and a do-nothing Bloom starves the colony in year 1.

What remains is exactly the loop the README promises: Bloom gardens a living
trail network against the weather; Burrow digs, stores, breeds, and walks the
queen down ahead of the frost and up ahead of the melt; sugar feeds everyone,
protein becomes ants, and everything crosses the dock.

## v6.1 — tend & tell (current)

Two additions on top of the calm cut, aimed at Burrow's Harvest-Moon feel and
at rewarding table-talk:

**Tap-feed the brood.** A growing egg gets hungry every ~8s: the nursery
pulses and raises a 🍼, and Burrow TAPS it to feed every hungry egg in the
cell (1 sugar each, straight from the stores — your hand does it, no worker
trip). Hungry eggs stall but never die; ~2 taps raise one ant. Together with
protein ferrying this makes Burrow a collect-and-grow economy: keep the
pantry stocked, tap the chirping nursery, watch the colony swell.

**Callouts (📢 Warn).** Bloom alone sees the forecast, and now relaying it is
a game verb: during autumn the Warn button calls out the coming winter,
during winter the coming melt. Burrow gets a loud toast plus a live countdown
in their toolbar — their ONLY advance warning, since the automatic season
warnings are gone. There is deliberately no explicit reward for it —
communication pays for itself through the simulation:

- A timely callout (≥15s notice) simply lets the season run at full pace: the
  colony was ready, winter is short, the hoard survives.
- A late or missing callout makes the threat itself **slow down** — the frost
  creeps and the groundwater rises in slow motion (season pace 0.55 at zero
  notice, scaling back to 1.0 at 15s). Mercy, not punishment: you always have
  time to react, but the season *drags* — an unwarned winter lasts ~1.8× as
  long, eats the hoard on real time the whole while, and slow years mean the
  score (which grows per year survived) climbs slower per minute played.

**Toast diet.** With the callout channel in place, the toast stream was cut
hard: no season flavor text, no rain announcements (the screen shows rain),
no laid/hatched/faded/picked-clean notices (all visible), no confirmations
of your own button presses (the button shows its state). What remains:
one year/score line, the callout and its off-guard consequence, queen-level
emergencies (drowning, freezing, colony starving — the only messages both
players see), per-role losses (drowned/starved/frozen workers, spilled or
rot-jammed goods, throttled to once per episode), and error feedback for
your own clicks. The client shows at most 3 toasts at once; info fades in
4s, warnings in 6s. A full bot-vs-bot year generates ~6 toasts per player.

Both bots play along: the Bloom bot warns with >20s notice each autumn and
winter, and the Burrow bot tap-feeds hungry eggs promptly, so the balance
harness exercises the well-communicated path. Verified headlessly: chatty
bot couples still survive 8+ years; a silenced Bloom bot stretches six
winters from 150s to 273s of real time, but the colony survives — exactly
the intended gradient.

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

**Coupling stayed, and got sharper.** Haulers only bring in goods that have a
matching typed stockpile cell with room (v5), so excess protein piles up on the
dock, jams it, and eventually rots — a *visible signal* from Burrow to Bloom:
"stop trailing carcasses, I need sugar." Bloom alone sees the per-second weather
forecast; Burrow alone sees the water creeping. Score grows per year survived;
every year the rain hits ~35% harder.

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

Tap the queen, tap a chamber: workers carry her (slowly — plan ahead of the
weather). The grid is now a coarse 12×18: fewer, fatter cells, each dig a
real decision.

## Burrow rework (v5, trimmed in v6) — flowing water, brood as labor

Playtesting showed Burrow went stale after one good setup: a single sump at the
entrance beat the water forever, eggs were a button, and once the pit stood
there was nothing left to do. v5 attacked all three (v6 later pruned the
excesses):

**Rain reaches only the shallows.** The entrance hole drinks the surface
stream directly; every other column seeps rain into its topmost open cell,
fading with depth and stopping entirely below row 8. Closed gates are roofs
and shed everything. Pools evaporate near the surface and soak into the earth
below them all year round, so sumps drain themselves.

**The groundwater rises in spring.** `waterTable()` swells from row 14 up to
~row 8.5 mid-spring and recedes. The deep winter bunker floods from below every
year: frost pushes the queen down each winter, the melt pushes her back up each
spring. There is no permanently safe depth — the migration IS the game.

**Reproduction is labor, not a button.** The egg tool is gone. Workers carry
protein to the queen (4 pieces per egg); when fed she lays automatically into
an **adjacent nursery** — and only there — and the egg develops in her warmth,
pausing to raise a 🍼 whenever it wants a tap-feed (see v6.1). A 🍼 Brood
toggle pauses the protein ferrying when you don't want growth. Feeding the
colony itself is automatic: sugar drains steadily from the stores per ant
(2.5× in winter), and empty stores mean a weakening queen and dying workers.

**Typed, scarce storage.** A stockpile cell holds 10 pieces of ONE type; tap it
again with the stockpile tool to flip it sugar↔protein (when empty). Haulers
only bring in what has a matching dry cell — protein backing up on the dock is
the visible "stop trailing carcasses" signal, and past 5 pieces it *rots* (a
pressure valve so a jam can't be permanent). The 60%-protein hauler rule died;
you shape the ratio by building cells.

**Deconstruction.** The Fill tool removes a room (first tap; spilling its
contents) and backfills a plain tunnel (second tap, done by a worker). Filling
shrinks your rain-catching surface, reroutes water, and un-digs mistakes.

**Tried and cut again (v5.1–5.3 → v6).** A whole survival layer lived here
for a while: random clay geology, soaked earth that dug slower, ant thirst
with drinking reservoirs, per-ant meal trips, and player-ordered bailing.
It made the game stressful and opaque rather than deep — see "v6 — the calm
cut" at the top. Rock pockets had already been cut in v5.2 for the same
reason.

Balance is verified headlessly (`node server/harness.js 8 10`): bot-vs-bot
runs survive 8+ years with the first queen scares around year 8, a do-nothing
Burrow drowns or starves the queen by year 2–3, and a do-nothing Bloom
starves the colony in year 1.

Other ideas considered for Burrow depth, not yet built: fungus contamination
arriving via dock goods (quarantine gates), pests, and a fungus-garden economy
(README stage 6).

## Solo testing: the bot partner

Join a role, then click "🤖 Play with a bot partner" on the waiting screen — or
open `/?role=bloom&bot=1` directly. A server-side bot (`server/bot.js`) plays the
other role using the strategies from the balance harness: the Bloom bot builds
branching trail networks and recalls before winter; the Burrow bot manages labor
allocation, digs sumps ahead of the rains, expands storage, and breeds. A human
joining a bot-held role takes over seamlessly; the lobby shows "🤖 bot playing —
join to take over". The game still pauses when no human is connected.

## Controls

- **Bloom:** drag trails from the dock; buttons for *Recall*, *Erase*, and
  *📢 Warn* (autumn: winter callout; winter: melt callout).
- **Burrow:** tool palette (Dig / Stockpile / Nursery / Gate / Fill) + click a
  cell; 🍼 Brood toggle; slider sets how many workers go outside. Tap the queen,
  then a chamber, to move her. Tap a pulsing 🍼 nursery to feed its eggs.

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
