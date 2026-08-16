# Folio

**Every text adventure deserves the NES port it never got.**

Folio is an open engine, a portable game format, and a place to keep the games.
It renders text adventures — the 1980s classics, modern interactive fiction, or a
story someone wrote last week — as NES-era point-and-click graphic adventures: a
pixel scene of the room, a grid of verbs, a compass, an inventory. Nobody types.

Games ship as a single `.folio` file. It opens in a browser with no install, no
build step, and no library download.

```sh
folio pack my-game/ my-game.folio     # assemble
folio validate my-game.folio          # prove it works
folio play my-game.folio              # play it in the terminal
open dist/player.html                 # or in a browser
```

---

## Why the file matters

The prior art here is unanimous and unkind. PuzzleScript's entire library is
unreachable today because sharing depended on somebody else's free API.
LittleBigPlanet lost over ten million levels for want of an export button. Dreams
promised export in 2019 and shipped video-only.

**What lives inside the file survives. What lives outside it rots.** So a `.folio`
carries everything: logic, presentation, audio, the manifest, and its own
walkthrough. Download it and you have the game, permanently, whatever happens to
us.

---

## Two logic paths, one contract

| | Path A | Path B |
|---|---|---|
| Runs | An unmodified Z-machine story file | A declarative `world.json` |
| For | Zork, Infocom, modern Inform games | Original stories, compiled sources |
| Referee | The 1988 binary itself | The world interpreter |

Both emit the same **World State Contract**, which is the only thing the renderer
ever reads. That is what lets one shell draw a game from 1988 and a game compiled
from a novel last week, and it is enforced by a cross-path parity suite rather
than by good intentions.

---

## Certification

A game is checked before it can claim anything, and the badge says only what was
actually verified.

| Tier | Proves |
|---|---|
| **T0** schema | The manifest is complete and well-formed |
| **T1** integrity | Every reference resolves; assets decode; capabilities are supported |
| **T2** graph | **No dead ends exist** — computed, not asserted |
| **T3** replay | **One path completes** — from a cold start, no state injection, no privileged verbs |
| **T4** design | It is a *game*: chain depth, item economy, map shape, pacing |

T2 and T3 are complementary and neither implies the other. T3's cold-start rule is
the whole difference between a badge that means something and one that does not:
Inform's twenty-year-old `TEST ME` allows teleporting the player and conjuring
objects, so a green run there proves a vignette works from a fabricated state.

**"Playable" means a path exists. It does not mean a human can find it.** That is a
separate question, and the badge does not pretend otherwise.

---

## The dials

Difficulty is not one quantity. It is chain depth, clue explicitness, how far a key
sits from its lock, and how long the game dares to go without paying out. So you
state intent and the brief resolves it:

```json
{ "length": "epic", "difficulty": "cruel", "deadliness": "classic",
  "sprawl": "open", "density": "balanced" }
```

Anchored on Zork I, **measured** rather than estimated — 82 rooms, 0.67 loops per
room, a 43% take rate, a reward every 11.5 moves, and one 69-move stretch with no
reward at all. Run `folio profile` on any game to derive its recipe.

The same resolved brief is both the generation target and the validation
threshold. Keep those apart and a difficulty setting quietly becomes decorative.

---

## Layout

```
packages/
  engine/      the shell, browser reader, player
  zmachine/    Path A backend
  world/       Path B backend
  format/      the .folio container, the contract, the dials
  validator/   T0-T4, the corpus profiler
  cli/         folio
conformance/   fixture games, cross-path parity, the corpus
```

## Running it

```sh
npm test          # everything: both backends, container, validator, parity
npm run build     # the self-contained browser player
```

---

MIT licensed. A [Mochi Labs](https://mochilabs.xyz) project.

Zork I is © Infocom / Activision / Microsoft and was released under MIT in
November 2025. "Zork" and "Infocom" are trademarks, and no rights to them are
granted or claimed here. Folio runs Z-machine games you supply.
