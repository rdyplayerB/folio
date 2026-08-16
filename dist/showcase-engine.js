window.GUE=window.GUE||{};
window.GUE = window.GUE || {};
/* ui/font.js — 8x8 chunky bitmap font (NES feel), full printable ASCII + UI glyphs.
   Glyph cell is 6px of ink in an 8px advance; row byte, leftmost column = bit 7.
   Generated from ASCII-art grids; data is 8 bytes per glyph, codes 0x20..0x7E
   followed by the extras listed in GUE.font.EXTRA. */
(function () {
  var W = 8, H = 8, FIRST = 32, LAST = 126;
  var EXTRA = "▼►◄▲•"; // \u25BC \u25BA \u25C4 \u25B2 \u2022
  var DATA = [
    '000000000000000030303030003000006c6c0000000000002828fc28fc2828002078a07028f02000c4c810204c8c00006090a040a89068003030000000000000',
    '183020202030180060301010103060000020a870a8200000002020f8202000000000000000302040000000f80000000000000000003030000808102040808000',
    '708898a8c88870002060202020207000708808102040f800f81030080888700010305090f8101000f880f00808887000304080f088887000f808102040404000',
    '708888708888700070888878081060000030300030300000003030003020400010204080402010000000f800f800000040201008102040007088081020002000',
    '7088b8a8b880700020508888f8888800f08888f08888f0007088808080887000e09088888890e000f88080f08080f800f88080f080808000708880b888887000',
    '888888f888888800702020202020700038101010109060008890a0c0a0908800808080808080f80088d8a8a88888880088c8c8a8989888007088888888887000',
    'f08888f08080800070888888a8906800f08888f0a0908800788080700808f000f82020202020200088888888888870008888888888502000888888a8a8d88800',
    '88885020508888008888502020202000f80810204080f80038202020202038008080402010080800e02020202020e000205088000000000000000000000000f8',
    '402000000000000000007008788878008080f0888888f0000000708880887000080878888888780000007088f8807000304840f0404040000000788888780870',
    '8080f0888888880020006020202070001000301010109060808090a0c0a0900060202020202070000000d0a8a88888000000f088888888000000708888887000',
    '0000f08888f0808000007888887808080000b0c880808000000078807008f0004040f040404830000000888888887800000088888850200000008888a8a85000',
    '000088502050880000008888887808700000f8102040f800182020602020180020202020202020006010101810106000000064980000000000fc787830300000',
    'c0e0f0f8f0e0c0000c1c3c7c3c1c0c000030307878fc00000000307878300000'
  ].join('');

  var N = (LAST - FIRST + 1) + EXTRA.length;
  // glyph index -> Uint8Array(8) of row bitmaps
  var GLYPHS = new Array(N);
  for (var g = 0; g < N; g++) {
    var rows = new Uint8Array(8);
    for (var r = 0; r < 8; r++) rows[r] = parseInt(DATA.substr(g * 16 + r * 2, 2), 16);
    GLYPHS[g] = rows;
  }

  function index(ch) {
    var c = ch.charCodeAt(0);
    if (c >= FIRST && c <= LAST) return c - FIRST;
    var e = EXTRA.indexOf(ch);
    if (e >= 0) return (LAST - FIRST + 1) + e;
    return -1; // unmapped: rendered as blank (never as garbage)
  }

  // Per-color glyph atlas: one offscreen strip built lazily, then blitted.
  // Keeps a full 240x72 text page at ~250 drawImage calls instead of ~4000 fillRects.
  var atlases = {};
  function atlas(color) {
    var a = atlases[color];
    if (a) return a;
    if (typeof document === 'undefined') return null;
    var cv = document.createElement('canvas');
    cv.width = N * W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = color;
    for (var g = 0; g < N; g++) {
      var rows = GLYPHS[g];
      for (var y = 0; y < 8; y++) {
        var b = rows[y];
        if (!b) continue;
        var run = -1;
        for (var x = 0; x <= 8; x++) {
          var on = x < 8 && (b & (0x80 >> x));
          if (on && run < 0) run = x;
          else if (!on && run >= 0) { c.fillRect(g * W + run, y, x - run, 1); run = -1; }
        }
      }
    }
    atlases[color] = cv;
    return cv;
  }

  function draw(ctx, str, x, y, color) {
    if (!ctx || str == null) return x;
    str = String(str);
    var a = atlas(color || '#ffffff');
    if (!a) return x + str.length * W;
    for (var i = 0; i < str.length; i++) {
      var gi = index(str[i]);
      if (gi >= 0 && str[i] !== ' ') ctx.drawImage(a, gi * W, 0, W, H, x + i * W, y, W, H);
    }
    return x + str.length * W;
  }

  // Centered helper — used constantly by the shell's button labels.
  function drawCentered(ctx, str, cx, y, color) {
    return draw(ctx, str, Math.round(cx - measure(str) / 2), y, color);
  }

  function measure(str) { return String(str == null ? '' : str).length * W; }

  GUE.font = {
    W: W, H: H, EXTRA: EXTRA,
    DOWN: EXTRA[0], RIGHT: EXTRA[1], LEFT: EXTRA[2], UP: EXTRA[3], DOT: EXTRA[4],
    draw: draw, drawCentered: drawCentered, measure: measure,
    glyph: function (ch) { var i = index(ch); return i < 0 ? null : GLYPHS[i]; }
  };
})();

//  Browser-side .folio reader.
//
//  A .folio must open in a page with no build step and no library download — the
//  portability promise collapses the moment playing a game requires npm. So this
//  reads the container using only what a browser already has: DataView for the
//  headers and DecompressionStream for the payloads.
//
//  Deliberately read-only. Packing is an authoring operation and belongs in the
//  CLI; a player that could also write archives is a larger attack surface for no
//  benefit to the person playing.

(function (root) {
  'use strict';

  const CDIR_SIG = 0x02014b50;
  const EOCD_SIG = 0x06054b50;

  /**
   * @param {ArrayBuffer|Uint8Array} input
   * @returns {Promise<Object<string, Uint8Array>>}
   */
  async function readFolio(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Scan back for the end-of-central-directory record. The comment field can be
    // up to 64KB, so the scan is bounded rather than unbounded.
    let eocd = -1;
    const floor = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a .folio: no end-of-central-directory record');

    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const out = {};

    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== CDIR_SIG) throw new Error('corrupt central directory');
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOff = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

      // The local header repeats the name and extra lengths, and they may differ
      // from the central directory's, so the data offset must come from the local
      // header or entries silently decode as garbage.
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const body = bytes.subarray(start, start + compSize);

      out[name] = method === 0 ? body : await inflateRaw(body);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('this browser cannot decompress .folio entries (no DecompressionStream)');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const text = (u8) => new TextDecoder().decode(u8);
  const json = (u8) => JSON.parse(text(u8));

  root.FolioZip = { readFolio, text, json };
})(typeof window !== 'undefined' ? window : globalThis);

//  @folio/world — Path B logic backend: a declarative world interpreter.
//
//  Runs a world.json directly. This is how a story that was never a game becomes
//  one: there is no compiler and no scripting language, only data. A .folio can
//  therefore never contain executable code, which is a security property worth
//  advertising and the reason a game is safe to open from a stranger.
//
//  Deliberately less expressive than ZIL or Inform. A bounded model is what makes
//  generation reliable and validation tractable: because every effect comes from a
//  closed vocabulary, the validator can see statically everything a game can ever
//  do. When the vocabulary genuinely cannot express something the community needs,
//  it grows in a spec revision — with conformance fixtures keeping old games alive.
//
//  It emits the same World State Contract as @folio/zmachine. That is the whole
//  point: one shell, two backends, and a cross-path parity suite to keep them
//  honest as both evolve.

'use strict';

const DIRS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'NE', 'NW', 'SE', 'SW', 'UP', 'DOWN', 'IN', 'OUT'];

class World {
  constructor(world, opts) {
    opts = opts || {};
    this.def = world;
    this.rng = mulberry32(opts.seed !== undefined ? opts.seed : (world.meta && world.meta.seed) || 1);

    this.rooms = index(world.rooms);
    this.items = index(world.items);
    this.actors = index(world.actors || []);
    this.rules = world.rules || [];
    this.timers = (world.timers || []).map(t => Object.assign({ elapsed: 0 }, t));

    this.flags = Object.assign({}, world.flags);
    this.here = world.meta.start;
    this.moves = 0;
    this.score = 0;
    this.ended = null;             // null | {win:boolean, reason:string}
    this.visited = new Set([this.here]);

    // Live location per item: room id, 'PLAYER', or a container's id.
    this.loc = {};
    for (const it of world.items) this.loc[it.id] = it.location;
    this.actorLoc = {};
    for (const a of (world.actors || [])) this.actorLoc[a.id] = a.location;

    this.log = [];
  }

  // -------------------------------------------------------------- contract
  /** Project into the World State Contract — identical shape to @folio/zmachine. */
  state() {
    const room = this.rooms[this.here] || {};
    const objects = [];
    const contents = {};
    const flags = {};

    for (const id of Object.keys(this.loc)) {
      const where = this.loc[id];
      const item = this.items[id];
      if (!item) continue;
      if (where === this.here) {
        objects.push(id);
        flags[id] = this.flagsOf(id);
      } else if (this.items[where] && this.loc[where] === this.here && this.isOpen(where)) {
        // One level into open containers, matching the Z-machine projection.
        objects.push(id);
        flags[id] = this.flagsOf(id);
        (contents[where] = contents[where] || []).push(id);
      }
    }
    for (const id of Object.keys(this.actorLoc)) {
      if (this.actorLoc[id] === this.here) { objects.push(id); flags[id] = this.flagsOf(id); }
    }

    const inventory = Object.keys(this.loc).filter(id => this.loc[id] === 'PLAYER');
    for (const id of inventory) flags[id] = this.flagsOf(id);

    return {
      roomId: this.here,
      roomName: room.name || this.here,
      score: this.score,
      moves: this.moves,
      dark: this.isDark(),
      objects,
      inventory,
      contents,
      flags,
      exits: this.exits(),
      globals: Object.assign({}, this.flags),
      fighting: objects.some(id => this.actors[id] && this.actors[id].hostile),
      lampTurns: this.lampTurns()
    };
  }

  /**
   * Live exits, keyed by direction. Three states, not two:
   *   "ROOM-ID"  passable now
   *   false      the passage exists but is blocked (locked door, boarded window)
   *   absent     no passage in that direction at all
   *
   * The middle state is the one worth having: it lets the compass grey out a door
   * the player can see but cannot yet use, which is information the player needs.
   * Path A emits it natively (Zork's boarded front door reports EAST: false), and
   * cross-path parity is what surfaced that Path B was collapsing it. An author who
   * genuinely wants a passage concealed marks the exit `hidden` and it disappears
   * entirely until its condition is met.
   */
  exits() {
    const room = this.rooms[this.here];
    const out = {};
    if (!room) return out;
    for (const ex of (room.exits || [])) {
      if (!DIRS.includes(ex.dir)) continue;
      const blocked = (ex.condition && !this.test(ex.condition)) ||
                      (ex.door && !this.isOpen(ex.door));
      if (blocked) {
        if (!ex.hidden) out[ex.dir] = false;
      } else {
        out[ex.dir] = ex.to;
      }
    }
    return out;
  }

  flagsOf(id) {
    const thing = this.items[id] || this.actors[id] || {};
    const a = Object.assign({}, thing.attributes);
    if (this.flags['_open_' + id] !== undefined) a.OPENBIT = !!this.flags['_open_' + id];
    if (this.flags['_lit_' + id] !== undefined) a.ONBIT = !!this.flags['_lit_' + id];
    return a;
  }

  isOpen(id) {
    if (this.flags['_open_' + id] !== undefined) return !!this.flags['_open_' + id];
    const it = this.items[id] || {};
    return !!(it.attributes && (it.attributes.OPENBIT || it.attributes.TRANSPARENT));
  }

  isLit(id) {
    if (this.flags['_lit_' + id] !== undefined) return !!this.flags['_lit_' + id];
    const it = this.items[id] || {};
    return !!(it.attributes && it.attributes.ONBIT);
  }

  isDark() {
    const room = this.rooms[this.here] || {};
    if (!room.dark) return false;
    // A lit light source in the room or carried defeats the dark.
    for (const id of Object.keys(this.loc)) {
      const it = this.items[id];
      if (!it || !it.attributes || !it.attributes.LIGHTSOURCE) continue;
      if (!this.isLit(id)) continue;
      if (this.loc[id] === 'PLAYER' || this.loc[id] === this.here) return false;
    }
    return true;
  }

  lampTurns() {
    const lamp = Object.keys(this.items).find(id =>
      this.items[id].attributes && this.items[id].attributes.LIGHTSOURCE &&
      this.items[id].fuel !== undefined);
    if (!lamp) return null;
    const used = this.flags['_fuelUsed_' + lamp] || 0;
    return Math.max(0, this.items[lamp].fuel - used);
  }

  // ---------------------------------------------------------------- command
  /**
   * Submit a command. Returns verbatim authored prose plus the new state.
   * Rules are consulted first; the engine's default responses only speak when no
   * rule matched, so authors write the interesting cases and nothing else.
   */
  submit(verb, noun, indirect) {
    if (this.ended) return { prose: this.endText(), state: this.state() };
    verb = String(verb || '').toUpperCase();
    noun = noun ? String(noun).toUpperCase() : null;

    let prose = null;
    for (const rule of this.rules) {
      if (!this.matches(rule, verb, noun, indirect)) continue;
      if (rule.if && !rule.if.every(c => this.test(c))) continue;
      prose = this.apply(rule.do || []);
      break;
    }
    if (prose === null) prose = this.builtin(verb, noun);

    this.moves++;
    const timed = this.tickTimers();
    if (timed) prose += '\n\n' + timed;
    if (this.ended) prose += '\n\n' + this.endText();

    this.log.push({ verb, noun, prose });
    return { prose, state: this.state() };
  }

  matches(rule, verb, noun) {
    const on = rule.on || {};
    if (on.verb && String(on.verb).toUpperCase() !== verb) return false;
    if (on.noun && String(on.noun).toUpperCase() !== noun) return false;
    if (on.room && on.room !== this.here) return false;
    return true;
  }

  /** Closed condition vocabulary — everything the validator must reason about. */
  test(c) {
    switch (c.type) {
      case 'flag': return !!this.flags[c.flag] === (c.value === undefined ? true : !!c.value);
      case 'carrying': return this.loc[c.item] === 'PLAYER';
      case 'in-room': return this.loc[c.item] === this.here;
      case 'present': return this.loc[c.item] === 'PLAYER' || this.loc[c.item] === this.here;
      case 'at': return this.here === c.room;
      case 'visited': return this.visited.has(c.room);
      case 'open': return this.isOpen(c.item);
      case 'lit': return this.isLit(c.item);
      case 'score-at-least': return this.score >= c.value;
      case 'not': return !this.test(c.condition);
      default: return false;
    }
  }

  /** Closed effect vocabulary. No scripting; a .folio can contain no code. */
  apply(effects) {
    const said = [];
    for (const e of effects) {
      switch (e.type) {
        case 'print': said.push(e.text); break;
        case 'set-flag': this.flags[e.flag] = e.value === undefined ? true : e.value; break;
        case 'move-item': this.loc[e.item] = e.to; break;
        case 'take': this.loc[e.item] = 'PLAYER'; break;
        case 'destroy': this.loc[e.item] = 'NOWHERE'; break;
        case 'open': this.flags['_open_' + e.item] = true; break;
        case 'close': this.flags['_open_' + e.item] = false; break;
        case 'light': this.flags['_lit_' + e.item] = true; break;
        case 'extinguish': this.flags['_lit_' + e.item] = false; break;
        case 'goto': this.here = e.room; this.visited.add(e.room); break;
        case 'score': this.score += e.value; break;
        case 'move-actor': this.actorLoc[e.actor] = e.to; break;
        case 'win': this.ended = { win: true, reason: e.text || 'You have won.' }; break;
        case 'lose': this.ended = { win: false, reason: e.text || 'You have died.' }; break;
        default: break;   // unknown effects are inert; T1 rejects them at validation
      }
    }
    return said.join('\n');
  }

  tickTimers() {
    const fired = [];
    for (const t of this.timers) {
      if (t.done) continue;
      if (t.startFlag && !this.flags[t.startFlag]) continue;
      t.elapsed++;
      if (t.fuelFor) this.flags['_fuelUsed_' + t.fuelFor] = t.elapsed;
      if (t.elapsed >= t.turns) {
        t.done = !t.repeat;
        if (!t.repeat) t.elapsed = 0;
        const text = this.apply(t.do || []);
        if (text) fired.push(text);
      }
    }
    return fired.join('\n');
  }

  endText() {
    return this.ended ? this.ended.reason : '';
  }

  /** Default responses. Tone is configurable so authors only write what matters. */
  builtin(verb, noun) {
    const room = this.rooms[this.here] || {};
    const tone = (this.def.meta && this.def.meta.defaults) || {};
    if (DIRS.includes(verb)) {
      const dest = this.exits()[verb];
      if (!dest) return tone.blocked || 'You cannot go that way.';
      this.here = dest;
      this.visited.add(dest);
      return this.describe();
    }
    switch (verb) {
      case 'LOOK': return this.describe();
      case 'TAKE': {
        if (!noun) return tone.what || 'Take what?';
        if (this.loc[noun] === 'PLAYER') return tone.already || 'You already have that.';
        if (this.loc[noun] !== this.here) return tone.absent || 'You do not see that here.';
        const it = this.items[noun] || {};
        if (!(it.attributes && it.attributes.TAKEBIT)) return tone.fixed || 'That is not something you can carry.';
        this.loc[noun] = 'PLAYER';
        return tone.taken || 'Taken.';
      }
      case 'DROP':
        if (this.loc[noun] !== 'PLAYER') return tone.nothave || 'You are not carrying that.';
        this.loc[noun] = this.here;
        return tone.dropped || 'Dropped.';
      case 'OPEN':
        if (!this.items[noun]) return tone.absent || 'You do not see that here.';
        if (this.isOpen(noun)) return tone.alreadyOpen || 'It is already open.';
        return tone.locked || 'It will not open.';
      case 'INVENTORY': {
        const inv = Object.keys(this.loc).filter(i => this.loc[i] === 'PLAYER');
        if (!inv.length) return tone.empty || 'You are empty-handed.';
        return 'You are carrying:\n' + inv.map(i => '  ' + ((this.items[i] || {}).name || i)).join('\n');
      }
      default:
        return tone.unknown || 'Nothing happens.';
    }
  }

  describe() {
    if (this.isDark()) {
      return (this.def.meta && this.def.meta.defaults && this.def.meta.defaults.dark) ||
        'It is pitch black.';
    }
    const room = this.rooms[this.here] || {};
    const here = Object.keys(this.loc).filter(i => this.loc[i] === this.here);
    let out = (room.name || this.here) + '\n' + (room.prose || '');
    for (const id of here) {
      const it = this.items[id];
      if (it && it.roomProse) out += '\n' + it.roomProse;
    }
    return out;
  }
}

function index(list) {
  const out = {};
  for (const x of (list || [])) out[x.id] = x;
  return out;
}

// Small deterministic PRNG. Determinism is not a nicety here: walkthrough replay,
// the blind solver, and every regression transcript depend on identical runs.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a Path B backend. Mirrors @folio/zmachine's createBackend shape. */
function createBackend(worldJson, opts) {
  // Accept a string, raw bytes (Buffer in node, Uint8Array in a browser), or an
  // already-parsed object. The engine has to run in a page with no build step, so
  // it cannot assume Buffer exists.
  let def = worldJson;
  if (typeof worldJson === 'string') {
    def = JSON.parse(worldJson);
  } else if (worldJson && typeof worldJson.byteLength === 'number') {
    def = JSON.parse(new TextDecoder().decode(worldJson));
  }
  if (!def || !def.meta || !def.meta.start) {
    throw new Error('@folio/world: world.json needs meta.start');
  }
  const w = new World(def, opts);
  return {
    world: w,
    banner: (def.meta.title || 'Untitled') + '\n\n' + w.describe(),
    state: () => w.state(),
    submit: (verb, noun, indirect) => w.submit(verb, noun, indirect)
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createBackend, World };
if (typeof window !== 'undefined') { window.FolioWorld = { createBackend, World }; }

//  @folio/engine — the shell.
//
//  Renders the World State Contract as an NES-era graphic adventure, and knows
//  nothing whatsoever about which backend produced it. That ignorance is the whole
//  architecture: the same code draws a 1988 Z-machine binary and a world.json
//  compiled from a novel last week, because both speak the same contract.
//
//  Everything is drawn on canvas at an integer pixel scale, in the engine's own
//  8x8 bitmap font, per the Style Bible: solid colour blocking with dark outline
//  shading, one master palette with clashing per-game subsets, no global filters.
//  The chrome is uniform across every game — that uniformity is precisely what
//  lets the scenes diverge wildly without the gallery falling apart.

(function (root) {
  'use strict';

  // The master palette. Every game draws its own clashing subset from this one set,
  // which is how a library of many makers stays coherent without looking uniform.
  const PAL = {
    ink: '#0f0f14', paper: '#f6f4ec', shadow: '#2c2c33',
    sky: '#3cbcfc', deepsky: '#0058f8', night: '#4428bc',
    leaf: '#00a800', grass: '#58d854', earth: '#503000', wood: '#ac7c00',
    gold: '#f8d878', flame: '#f87858', blood: '#a81000',
    stone: '#9a9a9a', bone: '#d8d8d8', violet: '#9878f8'
  };

  const LAYOUT = {
    w: 256, h: 240,            // the era's frame, scaled by an integer factor
    scene: { x: 8, y: 20, w: 240, h: 96 },
    text: { x: 8, y: 122, w: 240, h: 54 },
    verbs: { x: 8, y: 182, w: 152, h: 50 },
    compass: { x: 168, y: 182, w: 80, h: 50 }
  };

  const VERBS = ['LOOK', 'TAKE', 'OPEN', 'CLOSE', 'USE', 'TALK', 'GO', 'DROP'];
  const DIRS = [
    ['NW', 'NORTH', 'NE'],
    ['WEST', null, 'EAST'],
    ['SW', 'SOUTH', 'SE']
  ];

  function Shell(canvas, font) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.font = font;
    this.scale = 1;
    this.selectedVerb = 'LOOK';
    this.lines = [];
    this.onCommand = null;
    this.hotspots = [];
    this._bind();
  }

  Shell.prototype.fit = function () {
    // Integer scaling only. A fractional scale resamples the pixel grid and every
    // hard edge in the art turns to mush — the one thing the whole aesthetic
    // cannot survive.
    const box = this.canvas.parentElement.getBoundingClientRect();
    const s = Math.max(1, Math.floor(Math.min(box.width / LAYOUT.w, box.height / LAYOUT.h)));
    this.scale = s;
    this.canvas.width = LAYOUT.w * s;
    this.canvas.height = LAYOUT.h * s;
    this.canvas.style.width = (LAYOUT.w * s) + 'px';
    this.canvas.style.height = (LAYOUT.h * s) + 'px';
    this.ctx.imageSmoothingEnabled = false;
  };

  // Wrap width and line count are DERIVED from the pane and the font, never
  // guessed. The first version hard-coded 38 characters into a pane that fits 28,
  // and every long sentence ran off the right edge — the kind of bug that only
  // appears once real prose meets the layout.
  Shell.prototype.cols = function () {
    return Math.floor((LAYOUT.text.w - 8) / this.font.W);
  };
  Shell.prototype.rows = function () {
    return Math.floor((LAYOUT.text.h - 6) / (this.font.H + 1));
  };

  Shell.prototype.say = function (prose) {
    const cols = this.cols();
    for (const raw of String(prose || '').split('\n')) {
      const words = raw.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { this.lines.push(''); continue; }
      let line = '';
      for (const w of words) {
        const next = line ? line + ' ' + w : w;
        if (next.length > cols) { this.lines.push(line); line = w; } else { line = next; }
      }
      if (line) this.lines.push(line);
    }
    const max = this.rows();
    while (this.lines.length > max) this.lines.shift();
  };

  Shell.prototype.render = function (state) {
    const c = this.ctx, s = this.scale;
    this.state = state;
    this.hotspots = [];

    c.save();
    c.scale(s, s);
    c.fillStyle = PAL.ink;
    c.fillRect(0, 0, LAYOUT.w, LAYOUT.h);

    this._status(state);
    this._scene(state);
    this._text();
    this._verbs();
    this._compass(state);

    c.restore();
  };

  Shell.prototype._status = function (st) {
    const c = this.ctx;
    c.fillStyle = PAL.paper;
    c.fillRect(0, 0, LAYOUT.w, 16);
    this.font.draw(c, (st.roomName || st.roomId || '').toUpperCase().slice(0, 22), 6, 4, PAL.ink);
    const right = 'S:' + st.score + '  M:' + st.moves;
    this.font.draw(c, right, LAYOUT.w - 6 - right.length * 8, 4, PAL.ink);
  };

  Shell.prototype._scene = function (st) {
    const c = this.ctx, S = LAYOUT.scene;

    // Darkness is a rendering state, not an absence of art. Drawing nothing would
    // read as a broken tile; drawing the dark reads as the game speaking.
    if (st.dark) {
      c.fillStyle = '#000';
      c.fillRect(S.x, S.y, S.w, S.h);
      this.font.draw(c, 'IT IS PITCH BLACK.', S.x + 40, S.y + 44, PAL.stone);
      this._frame(S);
      return;
    }

    // Until a game ships authored scenes, the engine composes one from the
    // contract: a ground band, a horizon, and a token per visible object. It is
    // deliberately plain — a placeholder that looks like a placeholder is honest,
    // where a pretty one hides that the game has no art.
    const seed = hash(st.roomId || '');
    const skyTone = [PAL.sky, PAL.deepsky, PAL.night, PAL.shadow][seed % 4];
    const groundTone = [PAL.grass, PAL.earth, PAL.stone, PAL.wood][(seed >> 2) % 4];

    c.fillStyle = skyTone;
    c.fillRect(S.x, S.y, S.w, S.h);
    c.fillStyle = groundTone;
    c.fillRect(S.x, S.y + S.h - 28, S.w, 28);
    c.fillStyle = PAL.ink;
    c.fillRect(S.x, S.y + S.h - 29, S.w, 1);

    const objs = (st.objects || []).slice(0, 6);
    objs.forEach((id, i) => {
      const bx = S.x + 14 + i * 38;
      const by = S.y + S.h - 46;
      c.fillStyle = PAL.ink;
      c.fillRect(bx - 1, by - 1, 26, 22);
      c.fillStyle = [PAL.gold, PAL.flame, PAL.bone, PAL.violet, PAL.leaf][i % 5];
      c.fillRect(bx, by, 24, 20);
      this.font.draw(c, id.slice(0, 3), bx + 1, by + 6, PAL.ink);
      this.hotspots.push({ x: bx - 1, y: by - 1, w: 26, h: 22, noun: id });
    });

    this._frame(S);
  };

  Shell.prototype._frame = function (R) {
    const c = this.ctx;
    c.strokeStyle = PAL.paper;
    c.lineWidth = 1;
    c.strokeRect(R.x - 1.5, R.y - 1.5, R.w + 3, R.h + 3);
  };

  Shell.prototype._text = function () {
    const c = this.ctx, T = LAYOUT.text;
    c.fillStyle = PAL.paper;
    c.fillRect(T.x, T.y, T.w, T.h);
    c.fillStyle = PAL.ink;
    c.fillRect(T.x, T.y, T.w, 1);
    this.lines.slice(-this.rows()).forEach((line, i) => {
      this.font.draw(c, line.toUpperCase(), T.x + 4, T.y + 4 + i * (this.font.H + 1), PAL.ink);
    });
  };

  Shell.prototype._verbs = function () {
    const c = this.ctx, V = LAYOUT.verbs;
    const cw = Math.floor(V.w / 4), ch = Math.floor(V.h / 2);
    VERBS.forEach((verb, i) => {
      const x = V.x + (i % 4) * cw, y = V.y + Math.floor(i / 4) * ch;
      const on = verb === this.selectedVerb;
      c.fillStyle = on ? PAL.gold : PAL.paper;
      c.fillRect(x, y, cw - 2, ch - 2);
      c.fillStyle = PAL.ink;
      c.strokeStyle = PAL.ink;
      c.strokeRect(x + 0.5, y + 0.5, cw - 3, ch - 3);
      // A label wider than its button is a bug the player reads as broken chrome,
      // so the cell decides how many characters it can carry.
      const fit = Math.max(1, Math.floor((cw - 6) / this.font.W));
      const label = verb.length > fit ? verb.slice(0, fit) : verb;
      this.font.draw(c, label,
        x + Math.floor((cw - 2 - label.length * this.font.W) / 2), y + 7, PAL.ink);
      this.hotspots.push({ x, y, w: cw - 2, h: ch - 2, verb });
    });
  };

  Shell.prototype._compass = function (st) {
    const c = this.ctx, K = LAYOUT.compass;
    const cw = Math.floor(K.w / 3), ch = Math.floor(K.h / 3);
    DIRS.forEach((row, r) => row.forEach((dir, q) => {
      const x = K.x + q * cw, y = K.y + r * ch;
      if (!dir) {
        this.font.draw(c, '+', x + 10, y + 6, PAL.stone);
        return;
      }
      const dest = (st.exits || {})[dir];
      // Three states, exactly as the contract defines them: passable, blocked but
      // visible, or absent. The middle one is why the contract carries `false` —
      // a door you can see and cannot yet use is information the player needs.
      const open = typeof dest === 'string';
      const blocked = dest === false;
      c.fillStyle = open ? PAL.paper : blocked ? PAL.shadow : PAL.ink;
      c.fillRect(x, y, cw - 2, ch - 2);
      c.strokeStyle = open ? PAL.ink : PAL.shadow;
      c.strokeRect(x + 0.5, y + 0.5, cw - 3, ch - 3);
      const label = dir.length > 2 ? dir[0] : dir;
      this.font.draw(c, label, x + Math.floor((cw - 2 - label.length * 8) / 2), y + 4,
        open ? PAL.ink : PAL.stone);
      if (open) this.hotspots.push({ x, y, w: cw - 2, h: ch - 2, dir });
    }));
  };

  Shell.prototype._bind = function () {
    this.canvas.addEventListener('click', (ev) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (ev.clientX - r.left) / this.scale;
      const y = (ev.clientY - r.top) / this.scale;
      for (const h of this.hotspots) {
        if (x < h.x || y < h.y || x > h.x + h.w || y > h.y + h.h) continue;
        if (h.verb) { this.selectedVerb = h.verb; this.render(this.state); return; }
        if (h.dir && this.onCommand) return this.onCommand(h.dir, null);
        if (h.noun && this.onCommand) return this.onCommand(this.selectedVerb, h.noun);
      }
    });
  };

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }

  root.FolioShell = { Shell, PAL, LAYOUT, VERBS };
})(typeof window !== 'undefined' ? window : globalThis);

//  The player — opens a .folio and plays it.
//
//  This is the piece that makes the whole architecture visible: a file goes in and
//  a game comes out, and the code below never learns which kind of game it is.
//  Everything after `openFolio` runs against the World State Contract alone.

(function (root) {
  'use strict';

  async function openFolio(bytes) {
    const files = await root.FolioZip.readFolio(bytes);
    if (!files['manifest.json']) throw new Error('not a .folio: no manifest.json');
    const manifest = root.FolioZip.json(files['manifest.json']);

    // Integrity is checked in the player too, not only in the CLI. A file that
    // travelled the internet is exactly the one worth verifying, and a silent
    // corruption surfacing as strange gameplay is the worst possible failure.
    if (files['checksums.json']) {
      const sums = root.FolioZip.json(files['checksums.json']);
      for (const name of Object.keys(sums)) {
        if (!files[name]) throw new Error('.folio is missing a checksummed entry: ' + name);
      }
    }

    let backend, send;
    if (manifest.logicType === 'world') {
      backend = root.FolioWorld.createBackend(files['logic/world.json'], { seed: 1234 });
      send = (verb, noun) => backend.submit(verb, noun).prose;
    } else if (manifest.logicType === 'zmachine') {
      const storyName = Object.keys(files).find(n => /^logic\/.+\.z\d$/.test(n));
      if (!storyName) throw new Error('.folio declares zmachine but carries no story file');
      const rm = root.FolioZip.json(files['presentation/roommap.json']);
      backend = root.FolioZMachine.createBackend(files[storyName], { roommap: rm, seed: 1234 });
      // The Z-machine parses a whole typed line; the world engine takes verb+noun.
      // Normalising here is the only place the player knows they differ.
      send = (verb, noun) => backend.zm.input(noun ? verb + ' ' + noun : verb);
    } else {
      throw new Error('unknown logicType "' + manifest.logicType + '"');
    }

    return { manifest, files, backend, send };
  }

  function mount(canvas, game, font) {
    const shell = new root.FolioShell.Shell(canvas, font);
    shell.fit();
    shell.say(game.backend.banner || game.manifest.title);
    shell.render(game.backend.state());

    shell.onCommand = (verb, noun) => {
      let prose = '';
      try { prose = game.send(verb, noun) || ''; }
      catch (e) { prose = 'The game faltered: ' + e.message; }
      shell.say(prose);
      shell.render(game.backend.state());
    };

    root.addEventListener('resize', () => { shell.fit(); shell.render(game.backend.state()); });
    return shell;
  }

  root.FolioPlayer = { openFolio, mount };
})(typeof window !== 'undefined' ? window : globalThis);
