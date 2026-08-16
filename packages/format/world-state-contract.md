# The World State Contract

**Status:** v0.1 — descriptive, not speculative.
**Derived from:** the working implementation in `engine/bridge.js` of the origin project, verified against a 428-command Zork I playthrough that reaches 350 points and is cross-validated against dfrotz.

---

## What this is

The contract is Folio's constitution. It is the *only* thing the presentation layer may read, and the only thing a logic backend must produce. Everything above the line — verb grid, compass, inventory, scene renderer, text pane, audio — is written against this object and nothing else. Everything below the line — a Z-machine interpreter running a 1988 binary, or the declarative world interpreter running a JSON game — must emit it.

This is what makes two completely different logic engines interchangeable, and it is what makes the same shell able to render a game nobody has written yet.

**The contract is read-only.** The view never writes to it. Commands go the other way, through `submit()`. In the origin implementation the binary is the referee and the projection never mutates interpreter memory; that property is load-bearing and must survive extraction.

---

## The state object

Emitted fresh after every turn.

```js
{
  roomId:     "LIVING-ROOM",   // stable string id, or null if unmapped
  roomName:   "Living Room",   // display name from the logic layer
  score:      35,              // signed
  moves:      13,
  dark:       false,           // computed: is the player's location lit
  objects:    ["LAMP","SWORD","RUG","TRAP-DOOR"],   // visible in the room
  inventory:  ["LAMP","ADVERTISEMENT"],             // carried
  contents:   { "MAILBOX": ["ADVERTISEMENT"] },     // one level into open containers
  flags:      { "LAMP": { ONBIT:true, TAKEBIT:true, ... } },  // per-object attribute bits
  exits:      { NORTH:"NORTH-OF-HOUSE", WEST:"FOREST-1", IN:"KITCHEN" },  // map, not list
  globals:    { ... },         // world-state flags: dam gates, rainbow, troll…
  fighting:   false,           // is something hostile present
  lampTurns:  180              // resource counters; null until meaningful
}
```

### Field rules

| Field | Rule |
|---|---|
| `roomId` | Stable across saves and versions. A backend that cannot name a location emits `null`; the view must tolerate it and fall back to `roomName`. |
| `objects` | What a scene should draw. Excludes the player. Descends one level into open or transparent containers so a lit lamp inside a bag is visible — but **never into actors**, or a thief's stolen hoard spills onto the floor. |
| `contents` | One level deep, keyed by container id. Deeper nesting is deliberately not modelled; scenes do not need it and it invites cycles. |
| `flags` | The attribute bits the view is allowed to care about (open/closed, on/off, takeable, container…). Backends without a bit simply omit it; the view must treat absent as false. |
| `exits` | **A map keyed by direction**, not a list — direction is the natural key and duplicates are meaningless. Values have **three** states, and the middle one is the point: a room id means *passable now*; `false` means *the passage exists but is blocked* (a locked door, a boarded window); *absent* means there is no passage at all. `false` is what lets the compass grey out a door the player can see but cannot yet use, which is information the player needs. Live, not authored: computed from the logic layer's current truth, so a passage that opens mid-game appears without the presentation package being told. A backend that cannot compute live exits returns `{}` rather than throwing, and the view falls back to the game's static exit table. |
| `globals` | Backend-specific world flags, namespaced. The view may read them for scene variants; it must degrade gracefully when absent. |
| `lampTurns` | Representative of a general class: resource counters that are `null` until they become meaningful. Never `0` as a stand-in for "unknown". |

### Versioning

Adding a field is a minor version. Changing or removing one is major. The shell declares the range it supports; the loader refuses a game outside that range with a readable message rather than glitching. Undefined behaviour is defined out of existence at v1 — "left to the implementation" becomes four incompatible behaviours within a decade, as the Z-machine standard's own history demonstrates.

---

## Lifecycle

A backend is **constructed** with its logic payload plus its presentation binding, and is **started** before it is readable. Construction alone executes no game code, so an unstarted backend would project an empty world at score zero — technically true and useless. `createBackend()` therefore starts the machine and returns the opening banner alongside it.

The presentation binding (the map from the logic layer's internal object numbers to stable string ids) is **game data, not engine data**. It ships inside the `.folio` package. The engine must be handed it and must refuse to run without it — a rule discovered the hard way during extraction, where the original code reached for a hardcoded relative path to the game's own files.

## The command interface

```js
submit(verb, noun, indirect?) -> { prose: string, state: StateObject }
```

`prose` is verbatim from the logic layer — never paraphrased, never generated. In the Z-machine path this is Infocom's own text; in the declarative path it is the author's. The view's job is to display it, not to improve it.

---

## Conformance

A backend conforms when it passes the conformance fixtures (`/conformance`) — minimal games each exercising one feature, with expected transcripts. Two suites matter:

1. **Backend conformance** — any implementation claiming to be a Folio logic layer passes the same fixtures.
2. **Cross-path parity** — paired fixtures implement the same scenario on both the Z-machine and declarative paths and assert equivalent state through this contract. Because both paths are developed in parallel, this runs on a recurring schedule; drift is caught in days, not at integration.

The golden test that gates all of it: a full Zork I playthrough must reproduce byte-exact, and every published game's walkthrough joins the regression corpus. A change that breaks any of them cannot ship.
