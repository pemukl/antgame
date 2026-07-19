# Bloom & Burrow — Plan for the fun cut (v7)

**Target: Cooperative · Cozy · Colony.**
Bloom is a *smart graph-building* game (Mini Metro energy). Burrow is a
*seed–grow–harvest* game (Stardew/Harvest-Moon energy). The shared payoff is
watching the colony **grow because of what you built together** — more ants,
more traffic, a bigger nest, a cultivated meadow — not surviving one more
punishment year.

This document is (1) a precise analysis of what v6.1 actually plays like,
(2) the redesign, and (3) an iteration plan with measurable acceptance
criteria per phase, verified through the headless harness before any
human playtest.

---

## 1. Where the game is today — precise analysis

### What already works (keep, protect)

- **The iteration infrastructure.** `server/game.js` is a pure, deterministic
  sim; `bot.js` plays both roles; `harness.js` runs 8-year seasons headlessly.
  This is the single most valuable asset in the repo — every phase below ends
  with a harness gate.
- **Information asymmetry.** Bloom sees the forecast, Burrow sees the nest.
  This reliably produces table-talk and is the co-op soul of the game.
- **The dock as the single interface.** One shared touchpoint, visible from
  both sides, that jams visibly. Perfect. (It's currently one-directional —
  fixed in §3.3.)
- **Two typed foods with different sinks.** Sugar = fuel, protein = growth.
  Simple, legible, creates the "what do we need right now?" conversation.
- **Portrait-first, letterboxed, zero-dependency client.** Works on phones.

### Bloom: the graph fantasy is fighting the mechanics

The README promises Mini Metro. What actually happens:

1. **Nothing you build persists.** An untouched trail dies in ~55 s
   (`TRAIL_DECAY 0.018`), rain instantly cuts 35 %, drought triples decay, and
   **winter deletes the entire network and all sources** every year. Mini
   Metro's joy is *refining a persistent network* — remove a line, reroute,
   watch throughput improve. Here the player's dominant verb is *redraw the
   same twig again*, which is a chore, not a decision.
2. **The self-reinforcement loop erases the player.** Busy trails maintain
   themselves (no decision needed), dead trails need redrawing (no decision
   either — just labor). The stigmergy is thematically lovely but it
   automates exactly the part that should be gameplay and leaves the player
   the part that should be automated.
3. **Freehand drawing is the wrong input for a graph game.** Precision
   dragging on a phone, a 40 px pickup radius, a snap-magnet patch on top —
   all symptoms. Graph building wants *node-to-node* connection: tap A, tap
   B, edge exists.
4. **No topology scarcity.** Pheromone budget mostly taxes *redrawing*, not
   *network shape*. Mini Metro's tension comes from scarce lines/tunnels that
   force refactoring ("if I extend here I must abandon there"). TRAIL_MAX=12
   is a ceiling, not a currency.
5. **Bloom has a dead season.** Winter = no sources, no trails, nothing to do
   but press Warn once.
6. **No agency over the world.** Sources spawn by RNG; Bloom reacts. A
   builder wants to *shape demand*, not chase it.

### Burrow: defense verbs, not growing verbs

The README promises seed/harvest/grow. The actual verb list is: dig, sump,
gate, backfill, move queen, toggle brood, tap 🍼. Of those, only the last two
touch growth — everything else is *preventing loss to water and frost*.

1. **The only crop is eggs**, and the loop is thin: protein arrives → workers
   auto-ferry → queen auto-lays → tap twice → ant. The player's growth
   decisions are one toggle and one tap. There is no *plant something, tend
   it through visible stages, harvest the yield* loop anywhere — the fungus
   garden (README stage 6) was never built, and it is exactly the missing
   mechanic.
2. **The cellular water sim is ~150 lines of simulation buying opacity.**
   Percolation shares, depth fades, spread flip-flopping, evaporation curves,
   soak-below-the-table — players can't predict it, they just learn "dig the
   bot's sump shape." The *good* thing it produces is the seasonal queen
   migration (frost pushes down, melt pushes up). That loop can be kept with
   a far simpler, fully readable model (§3.2).
3. **Once the nest works, Burrow is done.** One sump + one bunker + storage =
   solved; after year 2 the player watches. A renewable garden that wants
   seasonal replanting and tending is the recurring loop Burrow lacks.

### Shared / systemic

1. **The failure model is survival-horror, not cozy.** Queen drowns in 8 s,
   frost kills eggs instantly, famine kills a worker every 15 s, queen HP
   death spiral. Cozy games fail *soft*: things stall, wilt, and recover;
   you lose progress, not the session. Right now the score is literally
   "years survived against escalating punishment" (+35 % rain/year), which
   frames the whole game as endurance.
2. **The callout pace-scaling is clever but imperceptible.** A player cannot
   feel "the season is running at 0.55×." It's a hidden global multiplier —
   exactly the kind of meta-rule that adds code and explanation burden
   without a visible in-world effect. The *button* (relaying private info) is
   good; the invisible consequence isn't.
3. **Too many economy valves.** Protein rot, typed-stockpile flipping,
   hauler-per-load matching rules, gate sugar cost + yearly gate cap, dock
   overflow loss. Each was a patch for a jam; together they're plumbing the
   player must reverse-engineer.
4. **Coupling is one-directional.** Food flows in; nothing flows out.
   Burrow can signal Bloom only by *jamming*. A gift that flows outward
   (seeds, §3.3) makes the dock a two-way conversation and gives both
   players a reason to celebrate each other's work.

---

## 2. Design thesis

> **Two interlocking growth engines, one visible living colony.**
> Bloom grows a *network*; Burrow grows a *garden and a brood*; each feeds
> the other through the dock. Seasons set rhythm, not executions. The score
> is how much the colony has *bloomed*, and every year ends with a visible
> celebration of what grew.

Three rules for every mechanic that stays or gets added:

1. **Growth verb over defense verb.** If a mechanic's verb is "prevent loss,"
   it must be demoted to a soft setback or cut.
2. **Persistent, refactorable structure.** What players build stays built;
   pressure comes from *demand shifting*, never from erasure.
3. **Readable at a glance.** No hidden multipliers, no fluid dynamics —
   a player should predict every consequence from what's on screen.

---

## 3. The redesign

### 3.1 Bloom → a real graph game ("living Mini Metro")

**Input model: nodes and edges, not strokes.**

- Sources and the dock are **nodes**. Tap a node, tap another node (or drag
  between them): an **edge** appears as a gentle curve. No freehand paths,
  no pickup radius, no snap magnet — connection is exact by construction.
- The network stays a **tree rooted at the dock** (keeps routing semantics
  trivial, keeps "prune a trunk = lose the subtree" as a real decision, and
  keeps the existing reinforce/traffic code largely reusable). Any node
  already in the tree is a valid attach point, so through-routes (one edge
  chain passing both a flower and a carcass — the double-paw play) survive
  and get *easier* to build deliberately.

**Scarcity: segments, not evaporation.**

- Trails **never evaporate**. Bloom owns a pool of **trail segments**
  (start: 8). Each edge costs segments proportional to length (≈1 per 150 px).
  Erasing an edge refunds its segments after a short delay. Milestones
  (§3.4) grant more segments. This is Mini Metro's line economy: to reach the
  rich far feast you must *decide what to abandon*, not grind pheromone.
- The pheromone budget, decay, rain-slash, drought-decay, and the
  winter trail wipe are **all cut**.

**Pressure: demand shifts, weather modulates.**

- Wild sources still spawn and **deplete** → the refactor pressure. Depleted
  node with no other purpose = dead weight on the tree, reclaim it.
- Rain doesn't destroy edges; it **muddies** them (traffic at half speed on
  muddied edges for the rain's duration, shown as darkened edge). Drought
  makes distant sources richer (flowers concentrate nectar). Weather becomes
  *modulation you route around*, not erasure.
- **Winter keeps Bloom in the game:** foraging stops, but the network stays
  visible under snow, and winter is **planning season** — Bloom places
  **seed markers** (from banked seeds, §3.3) where spring flowers should
  sprout, and prunes/reshapes the tree at zero cost. Spring starts with
  *your* flowers exactly where *your* network wants them.
- Traffic still thickens edges visually (pure cosmetics now — the beloved
  "living network" look without the erasure treadmill). Ants still fill
  both paws along through-routes; ant *count* is still Burrow's allocation
  slider — that shared lever ("west line is rich, send me more foragers")
  is a deliberate coupling conversation.

**What Bloom optimizes (the "smarts"):** total carry-rate per segment spent —
tree depth vs breadth, through-routes vs spokes, when to abandon a depleted
limb, where to plant next year's sources so one trunk serves them all.

### 3.2 Burrow → seed, grow, harvest

**The fungus garden — Burrow's crop loop (new, the centerpiece).**

- New room: **Garden** 🍄. Build in a dug cell in the **damp band** (see
  climate model below). Seed it with 1 protein + 1 sugar ("compost").
- The garden grows through **4 visible stages** (~half a season total).
  A ripe garden is harvested by tap (Harvest-Moon hand-verb, like 🍼) and
  yields **3–4 protein directly into the stores**, then needs reseeding.
  Renewable protein — but it costs planning, tending, and the right depth.
- **Tending:** a garden in the wrong climate band doesn't die — it **stalls**
  and shows why (❄ too cold / ☀ too dry / 💧 too wet). Gardens want the mid
  band; that band *moves with the seasons*, so a serious farmer maintains
  gardens at two depths and shifts effort seasonally — the same up/down
  seasonal breath as the queen.

**Climate bands replace the cellular water sim.**

Delete the fluid grid (percolation, spread, soak, evaporation — all of it).
The nest cross-section has three depth bands, all drawn on screen at all
times, moving with season + weather:

- **Frost/dry band** (from the top): deepens through winter (rows 0→~7, the
  existing `frostDepth` curve), also grows slightly in drought. Brood stalls,
  gardens stall, queen slowly *chills* (weakens, recovers — never dies fast).
- **Comfort band** (middle): everything works. Nursery wants the top of it,
  gardens the bottom of it.
- **Damp band** (from the bottom): rises with the spring melt and during
  heavy autumn rain (the existing `waterTable` curve + a temporary rain
  surge). Rooms inside it **soak**: stockpiles leak 1 piece per 10 s (slow
  drip, not instant spill), gardens stall, eggs stall, the queen slowly
  weakens. Nothing drowns in seconds.

This keeps 100 % of the strategic content the water sim actually delivered —
"the queen and the gardens migrate up and down with the year, dig your nest
to give them somewhere to go" — with zero opacity, ~120 fewer lines, and no
instant deaths. Gates, sumps, and the entrance flood special-casing are cut.
(Digging deep is now purely about reaching winter shelter and damp-band
gardens; every dig is still a real decision on the coarse 12×18 grid.)

**Brood stays, slightly enriched, still cozy.**

- Keep: protein-to-queen ferrying, adjacent nursery, tap-feed 🍼, brood
  toggle, queen carried between chambers. This is already a decent
  tend-the-crop loop.
- Change: eggs in the frost band **stall** instead of dying; the queen in the
  wrong band **weakens slowly** (visible 👑 meter, recovers fully in comfort).
  Game over only at queen 0 % — reachable only through sustained neglect,
  not one missed rainstorm.

**Storage simplification.**

- Stockpile cells hold **both foods** (single cap of 10, mixed freely, drawn
  as mixed dots). Typed cells, the flip gesture, the "hauler needs a matching
  typed dry cell" rule, and protein rot are all cut. The dock signal becomes
  simply *the dock is full* — same conversation ("stop sending, build more
  storage"), half the rules.

### 3.3 The seed loop — coupling that flows both ways (new)

The single most important addition for "growing the colony **together**":

- Harvesting a **ripe garden** sometimes yields a **seed** 🌰 (and every
  N-th nectar delivery banks seed progress — tunable; start: each garden
  harvest yields 1 seed).
- Seeds are goods: workers carry them **out** across the dock — the first
  outbound cargo. They appear on the dock's meadow side for everyone to see.
- Bloom **plants** them (tap a seed, tap a meadow spot; in winter, place
  markers that sprout at thaw). A planted flower grows in ~20 s into a
  **renewable nectar source**: regenerates each spring, never fully depletes,
  slightly less instantaneous yield than a wild feast.
- Endgame shape this creates: early years chase RNG wild sources; by year 3
  the meadow is a **planted farm laid out to fit the trail tree**, wild
  spawns are gravy, and both players literally see their joint work bloom.
  Burrow's gardens feed Bloom's meadow; Bloom's meadow feeds Burrow's
  gardens. That's the fantasy in the title.

### 3.4 Cozy progression: milestones, celebration, soft failure

- **Score reframed as Colony Bloom**, not years endured: population + gardens
  harvested + flowers planted + stores at year's end. Escalating rain
  (+35 %/yr) is cut; later years instead spawn wild sources *farther out*
  (Bloom needs reach) and deepen winter frost slightly (Burrow needs depth) —
  growth-shaped difficulty, gentle slope.
- **Milestones unlock capacity, announced as celebrations** ("The colony
  thrives! +2 trail segments · gardens grow 20 % faster"): at 10/14/18/24
  ants grant Bloom trail segments and Burrow build options. Growth begets
  tools — the engine-building payoff both players share.
- **Year-end postcard:** at each spring, a 6-second overlay both players see:
  "Year 3 — we grew from 11 → 16 ants, harvested 7 gardens, planted 4
  flowers." One shared beat of *look what we did*. (Replaces the score toast.)
- **Soft failure everywhere:** stall/wilt/weaken instead of die. Worker loss
  only from true famine (kept, but slowed) and from being caught outside in
  winter (kept — Recall matters and it's Bloom's responsibility, a good
  co-op stake). Queen death remains the only game over.
- **Warn button stays, consequence simplified:** cut the season pace-scaling
  entirely. The callout is Burrow's *only* forecast (already true) — that is
  its own reward. Optional cozy bonus, cheap to add: a warned colony
  "prepares" (workers walk 15 % faster until the season turns). Visible,
  positive, no hidden clocks.

### 3.5 Explicit cut list (with what replaces each)

| Cut | Why | Replaced by |
|---|---|---|
| Trail evaporation, decay, rain-slash, winter wipe | redraw treadmill | permanent edges + segment economy |
| Pheromone budget | taxes labor, not decisions | segment pool with refunds |
| Freehand stroke input | fiddly, anti-graph | node-tap/drag edges |
| Cellular water sim, gates, sumps, entrance flood | opaque, defense-verb | 3 climate bands, always visible |
| Queen 8-s drowning, instant egg death, spill-all | horror, not cozy | stall / slow-weaken / slow-leak |
| Typed stockpiles + flip + rot + matching-haul rule | plumbing | mixed stockpiles, dock-full signal |
| Callout pace-scaling (LATE_PACE) | imperceptible meta | Warn stays as info (+ small visible prep bonus) |
| +35 %/yr rain escalation | endurance framing | distance/frost growth-shaped difficulty |
| Score = years survived | endurance framing | Colony Bloom score + milestones + postcard |

### 3.6 Deliberately unchanged

Server-authoritative architecture, SSE protocol shape, role lobby, bot
takeover, pause-when-alone, portrait rotation, dock buffer + allocation
slider, two foods, seasons/clock, queen carrying, tap-feed 🍼, toast diet,
audio blips. The client's Burrow grid renderer and Bloom world renderer are
adapted, not rewritten.

---

## 4. Iteration plan

Each phase is independently shippable, ends with **bots updated + harness
gate green + DESIGN.md updated**, and only then moves on. Playtest questions
listed per phase are for the humans (you two) between phases.

### Phase 0 — Measure fun proxies in the harness (½ day)

The harness currently measures survival only. Add per-role counters to
`tick`/harness output:

- **actions/min per role** (commands issued by bots ≈ available decisions)
- **idle seasons** (seasons where a role issued < 3 commands)
- **redraw ratio** (Bloom edges rebuilt over identical routes — should → 0)
- **near-death events/yr** (queen danger seconds — should → rare)
- **growth curve** (ants + gardens + planted flowers by year)

*Gate:* baseline numbers for v6.1 recorded in DESIGN.md so every later phase
shows a before/after.

### Phase 1 — Bloom graph rework (1–2 days)

Node/edge model, segment economy, no decay, muddy-rain, winter planning mode
(pruning free; seed markers stubbed until Phase 3). Rewrite the Bloom bot to
build/refactor a tree over nodes; client input becomes tap-tap / drag with
edge preview + segment cost.

*Gate:* harness — segment-constrained bot outperforms spoke bot on carry rate;
redraw ratio ≈ 0; Bloom actions/min ≥ v6.1 baseline (decisions replaced
labor, not vanished); 8-year survival unchanged.
*Playtest Q:* does refactoring the tree feel like Mini Metro? Is erase-refund
timing right?

### Phase 2 — Climate bands + soft failure (1 day)

Delete water grid/gates/sumps; implement three bands driven by existing
`frostDepth`/`waterTable` curves + rain surge; stall/weaken/leak rules;
starter nest & Burrow bot adjusted (no more SUMP_PLAN — bunker + depth plans
stay).

*Gate:* harness — do-nothing Burrow still loses (slowly, by neglect);
attentive bot never sees queen < 60 %; near-death events/yr ≈ 0 for
competent play. Sim LOC shrinks.
*Playtest Q:* is the damp/frost movement readable at a glance? Does losing
the sump game remove anything you miss?

### Phase 3 — Gardens + seed loop (1–2 days)

Garden room, 4 growth stages, harvest tap, reseed cost; seed goods crossing
the dock outbound; Bloom planting + winter markers; renewable planted
flowers. Burrow bot farms 2 gardens; Bloom bot plants seeds near its trunk.

*Gate:* harness — a farming colony out-grows a non-farming one by year 4
(ants + score); planted flowers ≥ 40 % of Bloom deliveries by year 5; Burrow
idle seasons = 0; the outbound dock lane works under jam conditions.
*Playtest Q:* is the garden tend-rhythm pleasant or a chore? Seed rate right?

### Phase 4 — Progression, celebration, score (½–1 day)

Colony Bloom score, milestones with capacity unlocks, year-end postcard
overlay, Warn prep-bonus, distance/frost difficulty slope replacing rain
escalation.

*Gate:* harness — milestone cadence ≈ 1 per 1–2 years through year 6; growth
curve rises monotonically for competent bots; no-warn runs merely grow slower.
*Playtest Q:* do milestones land as shared celebration? Is endless play
appealing after year 6?

### Phase 5 — Balance + polish sweep (1 day, then loop)

Tune every constant in §5 via harness sweeps (survival isn't the metric
anymore — growth-curve shape is). Toast diet re-audit, client affordances
(segment pips, band edges, garden stage art, postcard), mobile pass.
Then: human playtest, feed notes back into a v7.1 list, repeat.

**Sequencing note:** Phases 1 and 2 touch disjoint halves of `game.js` and
could go in either order; gardens (3) depend on bands (2), planting (3)
depends on the node model (1). Nothing depends on 4.

---

## 5. Initial tuning values (all subject to Phase-5 sweeps)

Superseded in detail by §7 (the full spec) — headline numbers, kept in sync:

- Segments: start 8, +2 per milestone, cost ceil(len/150 px), refund after 5 s.
- Muddy edges: 0.5× ant speed during rain, +5 s after.
- Garden: seed cost 1🥩+1🍯, 4 stages × 12 s in comfort, harvest 3🥩; every
  2nd harvest per garden also yields a 🌰 seed; stalls outside the band.
  Garden count capped at 1 + milestones reached.
- Bands: frost row 2→7.5 over winter; damp row 14→7.5 at mid-spring peak
  (the curves overlap — there is deliberately NO permanently safe row);
  damp +2 rows for the duration of each autumn rain burst; summer drought
  pushes a dry band down to row 4 for its duration.
- Queen: −2 HP/s in frost or damp band, +3 HP/s in comfort; famine −3.5 HP/s;
  worker famine death every 25 s (was 15).
- Soak leak: 1 piece / 10 s per soaked stockpile.
- Planted flower: sprouts 20 s, holds 6 nectar, regrows 1 per 8 s in
  spring/summer, dormant (visible) in autumn/winter, dies of old age after
  2 full years (replant need); min 250 px from the dock (barren ring),
  min 80 px between flowers; banked seeds cap at 3 (excess harvests yield
  +1🥩 instead).
- Colony Bloom score: ants×2 + gardensHarvested×3 + flowersPlanted×4 +
  floor(stores/5), milestones at 10/14/18/24 ants.

## 6. Open questions (decide during playtests, defaults chosen)

1. **Tree vs free graph for trails** — default *tree* (simpler routing,
   subtree stakes). Revisit only if playtesters fight the constraint.
2. **How much water charm to keep visually** — bands are the sim; we can
   still render rain trickling at the entrance as pure cosmetics. Default:
   yes, cosmetics only.
3. **Winter length/activity** — with planning mode + melt Warn, is 25 s
   right? Default: keep, revisit in Phase 5.
4. **Endless vs arc** — default endless with postcards; consider an optional
   "8-year album" ending later.
5. **Bigs/aphids/repletes (README stages 3–5)** — stay cut until the v7 core
   proves fun; aphids are the natural next crop after fungus.

---

## 7. Detailed mechanics spec — how it all actually works

This section closes every loop from §3 at the level of "what happens on this
tick / this tap." Where it refines a §3 number, this section wins. It ends
with the economy math and the degenerate-strategy audit that shaped these
choices.

### 7.1 The one-page economy (read this first)

Every unit in the game and its full life:

```
SUGAR    wild flower / planted flower 🌼 ──forager──▶ dock ──hauler──▶ stores
         stores ──▶ eaten (0.01/s per mouth, ×2.5 winter)
                ──▶ tap-feed 🍼 (1 per hungry egg)
                ──▶ garden compost (1 per seeding)

PROTEIN  wild carcass ──forager──▶ dock ──hauler──▶ stores
         ripe garden 🍄 ──tap──▶ pieces in cell ──hauler──▶ stores
         stores ──worker ferry──▶ queen (4 = 1 egg)
                ──▶ garden compost (1 per seeding)

SEED     every 2nd garden harvest ──worker──▶ dock ledge (outbound, cap 3)
         ledge ──Bloom taps seed+spot──▶ ant walks out, plants ──▶ 🌼
         🌼 = renewable sugar node AND a permanent graph waypoint

ANTS     egg (4🥩 + ~2🍯 taps + warmth) ──▶ worker ──▶ more of everything
```

Three closed feedback loops, one per player plus one shared:

- **Bloom's loop:** better tree → more sugar/protein per trip → colony grows.
- **Burrow's loop:** gardens → protein + seeds → eggs → workers → more
  digging/hauling capacity → more gardens.
- **The shared loop (the game):** gardens make seeds → seeds make flowers →
  flowers make the meadow farmable *and* give the tree its hub nodes → more
  throughput feeds more gardens. Neither player can run their loop without
  the other's output. This is "growing the colony together" as literal
  systems coupling, not flavor.

Rates that make it balance (derivations in §7.8): a colony of N ants+queen
burns ~0.01·N sugar/s; one planted flower supplies ~13 sugar/year; one
garden cycle nets +2🥩 per 48 s. So ~1 flower per 4 mouths and ~1 garden per
2 eggs/year — the farm scales linearly with the colony, and milestones
(which gate garden count and segments) keep the two players' capacity
growing in lockstep. Neither side can race ahead of the other by more than
one milestone's worth.

### 7.2 Bloom — exact graph rules

**Nodes.** The dock, every wild source, every planted flower, and every
*husk* (see below) are nodes. There are no abstract waypoints: **planted
flowers are the waypoints**. If Bloom wants a trunk junction in empty
meadow, the way to get one is to plant a flower there — seeds are topology
pieces, not just food. (This is deliberate and load-bearing: it gives seeds
lasting value even after the sugar economy is saturated, and it makes the
meadow's *shape* a joint project — Burrow grows the seeds, Bloom decides
where the network's skeleton goes.)

**Edges.** Tap node A, tap node B (or drag A→B): a curved edge appears.
Constraint: one endpoint must already be connected to the dock's tree
(the dock itself counts), so the network is always a single tree rooted at
the dock. Cost: `ceil(len/150px)` segments from the segment pool. The edge
preview shows the cost and turns red if unaffordable — same affordance as
the current stroke preview. No edge may exceed 600 px (forces multi-hop
trunks through nodes — i.e., through flowers — rather than one mega-edge).

**Segments.** Pool starts at 8, +2 per milestone. Erasing an edge refunds
its full cost after 5 s (the delay stops erase-redraw twitching from being
free mid-rain). Erasing an edge orphans its subtree: orphaned edges gray
out and auto-refund after 10 s unless reconnected — softer than v6's
instant subtree deletion, and it makes *re-parenting* a real move: cut a
twig, immediately draw a cheaper edge from a nearer node, subtree survives.

**Husks.** A wild source that depletes while connected stays as a **husk
node**: it holds no food but still functions as a junction. A husk with no
edges fades in 10 s. Husks are the refactor pressure made visible — a tree
threaded through three husks is *paying segments for dead geography*, and
the fix (erase, re-parent onto a planted flower) is exactly the Mini Metro
"redraw the map around the new station" moment.

**Ant behavior on the tree.** An idle forager at the dock picks a leaf that
currently offers food it has a free paw for (weighted by total food along
the root-to-leaf path), walks the unique root→leaf path, harvesting at every
node it passes (1.5 s per pickup, one paw per food type — unchanged), turns
around at the leaf or when both paws are full, and unloads at the dock.
All the existing paw/through-route logic survives; `srcS` scanning is
replaced by "the nodes on the path," which is simpler and exact.

**Weather on the graph.** Rain muddies all edges (0.5× ant speed, edges
drawn dark) for its duration +5 s. Drought doubles the *regrow* rate pause
of planted flowers (they go dormant during the event) and makes newly
spawned wild sources 25 % richer (concentrated nectar) — drought is a push
toward the far wilds, rain a push to consolidate. Neither ever deletes
anything.

**Winter.** Foraging stops (foragers auto-return; Recall stays as a manual
override for stragglers — a worker caught outside when snow falls still
freezes after 6 s, the one hard co-op stake Bloom owns). The network stays,
drawn under snow. Winter verbs: erase/re-parent at zero cost (planning
season — refunds are instant), and place **seed markers** from banked seeds;
markers auto-plant at the thaw. Plus the melt Warn. Bloom's winter is
short, thoughtful, and busy — no dead season.

**Planting rules.** A seed on the dock ledge + a tap on a legal spot
(≥250 px from the dock — a visible barren ring of trampled earth around the
pit — and ≥80 px from any flower) sends the nearest idle outside ant walking
to plant it; the sprout takes 20 s. Planted flowers hold 6 nectar, regrow
1 per 8 s in spring/summer, go visibly dormant in autumn/winter, and die of
old age after 2 full years (a gentle replant rhythm so seeds never stop
mattering). The barren ring is the anti-degenerate rule: without it,
flowers next to the dock would delete the routing game.

### 7.3 Burrow — exact garden & band rules

**The two boundary rows.** All climate is two numbers, both drawn as soft
horizontal gradient lines with icons, both moving slowly and visibly:

- `frostRow(t)`: baseline 2 (rows 0–1 are always too exposed — this is why
  the entrance corridor was never living space). Winter: 2 → 7.5 across the
  season. Summer drought events: temporarily 4 (a dry band, ☀ icon).
- `dampRow(t)`: baseline 14 (rows 14–17 are permanent groundwater — the
  nest's floor). Spring: sinks 14 → 7.5 at mid-season → back (existing sine).
  Autumn: +2 rows upward for each rain burst's duration, relaxing back after.

**Comfort = strictly between the lines.** The peak curves *overlap* at 7.5
on purpose: at winter's deepest and spring's highest there is **no row that
is always safe** — so the nest must have a **summer wing** (rows ~3–6) and a
**winter wing** (rows ~9–12), and the queen, the active nursery, and the
gardens all breathe up and down the shaft once a year. This keeps 100 % of
the migration gameplay the water sim used to force, with two readable lines
instead of a fluid grid.

**Effects of being outside comfort — everything stalls, nothing dies:**

| Thing | in frost/dry band | in damp band |
|---|---|---|
| Egg | stalls (❄ shown) | stalls (💧 shown) |
| Garden | stalls | stalls |
| Stockpile | fine | leaks 1 piece / 10 s (drip animation) |
| Queen | −2 HP/s | −2 HP/s |
| Worker | fine (they're ants) | fine, walks through |

Queen regenerates +3 HP/s in comfort; she dies only at 0 — which takes 50 s
of continuous neglect *against* a visible meter and a visible line, and is
the game's only game-over.

**Garden lifecycle.** Build (Garden tool on a dug empty cell) → **seed it**
(tap; pays 1🥩+1🍯 from stores instantly — Burrow's hands do farming, like
tap-feed) → 4 visible stages, 12 s each while in comfort → ripe (glows,
gentle chime) → **harvest** (tap; 3🥩 pieces drop *in the cell*, plus a 🌰
on every 2nd harvest of that garden) → haulers carry the pieces to
stockpiles → reseed. If the stores are full, pieces wait in the garden cell
and it can't be reseeded — the same visible "build more storage" jam signal
as the dock, no rot rule needed. A ripe garden never spoils; harvesting is
never urgent, only wanted. Garden count is capped at 1 + milestones reached
(the progression lever that keeps carcass-trailing relevant early).

**Brood (unchanged mechanics, softened consequences).** Protein ferry →
queen lays into adjacent nursery → 🍼 tap-feeds from stores → hatch. Eggs
stall in bad bands instead of dying; hatch bonus in shallow rows is replaced
by "hatch 25 % faster in comfort *above* row 6" so the summer nursery still
wants to be high.

**Worker job priority (inside), replacing the v6 list:** 1 dig/fill jobs →
2 protein-to-queen ferry → 3 seed-to-dock ferry (when a 🌰 is in stores and
the ledge has room) → 4 haul dock goods to stores → 5 haul garden pieces to
stores → 6 wander near queen. One new job type (seed ferry); gate/bail jobs
are gone, so the list is *shorter* than v6's.

### 7.4 The dock — now a two-way membrane

- **Inbound pile** (cap 15, unchanged): foragers drop, haulers collect.
  Full pile = foragers wait visibly = "stop sending / build storage."
- **Outbound ledge** (cap 3, new, drawn on the meadow side): seed-ferry
  workers place 🌰 here; Bloom sees them appear — a little gift arriving
  from below, the reciprocal of food going down. The ledge is separate from
  the pile so an inbound jam can never block seeds (and vice versa).
- Both sides render on both screens (the dock is the one shared pixel-space)
  — Bloom watching their sugar vanish downward and seeds pop up is the
  heartbeat of the co-op.

### 7.5 Asymmetric information, restated for v7

- Bloom alone sees: weather forecast (rain/drought timers, season countdown),
  the meadow, wild spawns.
- Burrow alone sees: band positions and drift, stores, queen meter, garden
  stages, brood state.
- Warn stays exactly two buttons deep (autumn→winter, winter→melt), is
  Burrow's only forecast, and grants the visible "prepared" bonus (+15 %
  worker walk speed until the season turns). No hidden pace multipliers.
- New natural table-talk the seed loop adds, for free: "seed's on the ledge
  — where do you want your next hub?" / "plant me something west, the wilds
  there are rich but my trunk can't reach." This is the conversation the
  game is *for*, and it now has a concrete object.

### 7.6 One year in the life (moment-to-moment, year ~3)

**Spring (55 s).** Postcard fades. Damp line starts climbing toward the
winter wing. Burrow: harvest the two deep gardens *before the damp swallows
them* (they'd only stall, but that's a season of lost yield), carry the
queen up to the summer wing, reseed the shallow gardens. Bloom: markers
sprout into flowers, thaw reveals the tree; re-parent the two edges that
orphaned when autumn's wilds depleted; first wild feasts spawn far out.
Eggs from winter's ferrying hatch — hatch chime, +2 ants at the slider.

**Summer (55 s).** Peak flow. Both droughts push Bloom to spend her new
milestone segments on a long trunk to a rich far feast, chained through the
flower she planted last winter exactly for this. Burrow digs the winter
wing one cell deeper (frost crept to 7.5 last year; the postcard said so),
builds a third stockpile, taps 🍼 twice, seeds gardens on cooldown. The
seed ledge fills; Bloom banks one for winter planning.

**Autumn (45 s).** Rain bursts muddy the network — throughput halves in
waves, damp line jumps 2 rows with each burst, previewing spring. Burrow
slides the alloc slider up for the hoard push, pauses brood, reseeds the
*deep* gardens (they'll ripen in the winter comfort window), harvests
anything ripe up top. Bloom prunes the two spent wild limbs (segments
refund), keeps sugar lines hot, hits **📢 Warn** with 20 s to spare —
workers speed up — then Recall as the last burst ends.

**Winter (25 s).** Frost creeps down; Burrow carries the queen to the
winter wing, ferries protein there, tap-feeds under the frost line, and
harvests the deep gardens mid-season. Bloom, under snow: erases the whole
east limb for free, sketches next year's tree, places two seed markers at
its future junctions, warns the melt. Postcard: "Year 3 — 11 → 16 ants ·
7 gardens harvested · 4 flowers planted." Both players see it. That's the
loop.

### 7.7 Degenerate-strategy & failure-mode audit

Checked deliberately; each has a specific counter already in the rules:

1. **Plant flowers at the dock, trivialize routing** → barren ring (250 px)
   + wild richness still scales with distance, so the wilds always out-pay
   the farm per trip and pull the tree outward.
2. **Seed flood makes seeds meaningless** → every-2nd-harvest rate, ledge
   cap 3, banked cap 3 (excess → +1🥩), and flowers dying at age 2 create a
   permanent gentle demand. Seeds also never stop being *waypoints*.
3. **Garden spam makes Bloom's protein irrelevant** → garden cap = 1 +
   milestones; compost costs protein, so gardens can't bootstrap from
   nothing — the first eggs and first gardens need Bloom's carcasses.
4. **One deep row safe from both frost and damp** → curves overlap at 7.5;
   verified no integer row is inside comfort at both extremes.
5. **Turtle (never grow, never risk)** → score and unlocks are growth-based;
   a static colony's postcard literally flatlines. No death spiral though —
   turtling is *boring*, not punished. Cozy.
6. **Runaway growth outracing sugar** → eating scales with N but flower
   count is seed-gated and storage is dig-gated; the colony's own hunger is
   the natural soft cap. Famine still only kills 1 worker / 25 s with loud
   warnings — a bad year shrinks the colony back one milestone, it doesn't
   end the game.
7. **Bloom griefs/idles** → Burrow's carcass+garden loop keeps a slow game
   alive (queen fed from garden protein, stores from dock scraps), but
   without sugar inflow famine arrives in ~2 seasons — mutual dependence
   intact, just on a forgiving clock.
8. **Erase-abuse during rain** (erase muddy edge, redraw after) → 5 s refund
   delay makes it strictly worse than waiting out the mud.

### 7.8 The math (so Phase 5 sweeps start from a solved baseline)

- **Eating:** `0.01 sugar/s per mouth`; 13 mouths ≈ 0.13/s; a 180 s year
  with winter ×2.5 ≈ **28 sugar/year**, +~6 tap-feeds +~4 compost ≈ **38**.
- **Foraging:** round trip to a 500 px source ≈ 9 s walk + 3 s harvest =
  12 s for 2 pieces → **0.17 pieces/s per forager**. 5–6 foragers saturate a
  13-mouth colony's needs with headroom — abundance in season, scarcity only
  where it's cozy (the winter hoard).
- **Flowers:** 1/8 s regen over ~110 s of spring+summer ≈ **13 sugar/yr
  each** → 3–4 flowers ≈ the whole sugar budget at 13 mouths; ~1 more flower
  per 4 additional mouths.
- **Gardens:** cycle = 48 s + handling ≈ 60 s → net **+2🥩/cycle**; 2 gardens
  ≈ 1 egg (4🥩) per ~60 s of comfort time ≈ **2–3 ants/year** — which walks
  the milestone ladder (10/14/18/24) at ≈ 1 milestone per 1–2 years. Matches
  the Phase 4 gate.
- **Winter hoard target:** 25 s × mouths × 0.025 ≈ **8 sugar at 12 ants**
  plus spring ramp ≈ 2 stockpile cells — small, achievable, and exactly the
  size of ask that makes autumn feel like harvest-festival prep instead of
  doomsday prepping.

### 7.9 What this changes in the phase plan

Nothing structural; three refinements: Phase 1 gains husks, orphan-refund,
and the 600 px edge cap; Phase 3 gains the outbound ledge, seed-ferry job,
flower old-age, and the garden cap; Phase 4's milestone unlocks now also
raise the garden cap. The §5 headline numbers have been updated to match
this section.
