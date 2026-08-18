window.GUE = window.GUE || {};
/* ui/shell.js — the conductor.
   256x240 NES screen, MacVenture verb/hotspot interaction, verbatim paginated prose.
   Owns: boot, the 30fps render loop, all input routing, save/restore, end-of-game detection.
   Every GUE.* collaborator is feature-checked: the shell must still boot and be playable
   when art/audio/chrome/verbmap are missing or half-built. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- layout
  // Two layouts, one game. The landscape/square board is the original
  // 256x240 arrangement from CONTRACTS.md and is what desktops and tablets get.
  // A phone in portrait is a different shape entirely — square art letterboxed
  // in a 390x844 screen wastes 60% of the display — so it gets a taller board
  // where the panes stack and, crucially, the picture is drawn at 2x. Scene art
  // is authored for 144x104; doubling it is an INTEGER scale, so the pixels stay
  // square and the picture nearly doubles in size instead of being blown up soft.
  var W, H, STATUS, SCENE, COMPASS, VERBS, TEXT, INV, COLS, ROWS, LH;
  var PORTRAIT = false;
  var SCENE_SCALE = 1;          // logical px per unit of scene art
  var SCENE_ART = { w: 144, h: 104 };
  var TPAD_X = 5, TPAD_Y = 3;      // breathing room inside the text pane

  function applyLayout(portrait) {
    PORTRAIT = !!portrait;
    if (PORTRAIT) {
      // The phone board is WIDTH-limited, so height is free: a taller board
      // costs nothing on screen and every extra row goes into the controls,
      // which is what fingers actually need. 636 fills a 390x844 phone exactly.
      W = 288; H = 636;
      SCENE_SCALE = 2;
      STATUS  = { x: 0,   y: 0,   w: W,   h: 22  };
      SCENE   = { x: 0,   y: 24,  w: 288, h: 208 };   // 144x104 at 2x, edge to edge
      TEXT    = { x: 6,   y: 240, w: 276, h: 92  };
      INV     = { x: 6,   y: 338, w: 276, h: 34  };
      VERBS   = { x: 6,   y: 378, w: 276, h: 148 };   // 2x4 cells ~138x37
      COMPASS = { x: 6,   y: 532, w: 276, h: 100 };   // pad cells ~57x33
      LH = 9;
      saveBtn = { x: W - 52, y: 5, w: 48, h: 14 };
      KB      = { x: 4,  y: 300, w: 280, h: 300 };
      SAVEUI  = { x: 10, y: 150, w: 268, h: 300 };
    } else {
      W = 256; H = 240;
      SCENE_SCALE = 1;
      STATUS  = { x: 0,   y: 0,   w: 256, h: 16  };
      SCENE   = { x: 8,   y: 16,  w: 144, h: 104 };
      COMPASS = { x: 160, y: 16,  w: 88,  h: 48  };
      VERBS   = { x: 160, y: 68,  w: 88,  h: 56  };
      TEXT    = { x: 8,   y: 128, w: 240, h: 74  };
      INV     = { x: 8,   y: 206, w: 240, h: 30  };
      LH = 9;
      saveBtn = { x: 216, y: 3,   w: 34,  h: 11  };
      KB      = { x: 4,   y: 104, w: 248, h: 132 };
      SAVEUI  = { x: 18,  y: 12,  w: 220, h: 216 };
    }
    // text metrics follow the pane, minus the padding that keeps prose off the
    // border (the old fixed 30x8 only ever suited one board)
    COLS = Math.max(8, ((TEXT.w - TPAD_X * 2) / 8) | 0);
    ROWS = Math.max(1, ((TEXT.h - TPAD_Y * 2) / LH) | 0);
    if (canvas) {
      canvas.width = W; canvas.height = H;         // resets ctx state
      ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = false;
    }
    // the page shell sizes itself from the board's dimensions
    try {
      var root = document.documentElement;
      root.style.setProperty('--gue-cw', String(W));
      root.style.setProperty('--gue-ch', String(H));
    } catch (e) {}
    if (GUE.chrome && typeof GUE.chrome.fit === 'function') safe(function () { GUE.chrome.fit(); });
    // the text pane changed width, so re-wrap what is on screen to the new
    // column count and keep the reader on the page they were reading
    if (lastPaginated != null) {
      var keep = page;
      paginate(lastPaginated);
      page = Math.min(keep, pages.length - 1);
    }
  }

  // A phone, not merely a small window: portrait-ish and hand-held. A tablet is
  // roomy enough for the original board, and a narrow desktop window is still a
  // desktop, so neither gets the stacked layout.
  function wantsPortrait() {
    var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    var coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
    return coarse && vh > vw * 1.15 && vw < 620;
  }

  // NES-legal colors (2C02). Kept local so the shell renders before art/kit.js exists.
  var COL = {
    bg:    '#000000',
    ink:   '#fcfcfc',
    dim:   '#7c7c7c',
    dark:  '#545454',
    sel:   '#fcfcfc',
    selInk:'#000000',
    gold:  '#f8b800',
    blue:  '#3cbcfc',
    red:   '#f83800',
    green: '#00b800'
  };

  var VERB_LIST = ['LOOK', 'TAKE', 'DROP', 'OPEN', 'CLOSE', 'USE', 'HIT', 'SPEAK'];
  var TWO_OBJ   = { USE: 1, HIT: 1 };

  // compass: 3x3 pad + a stacked UP/DOWN/IN/OUT column
  var PAD = [
    ['NW', 'NW'], ['N', 'NORTH'], ['NE', 'NE'],
    ['W', 'WEST'], [null, null],  ['E', 'EAST'],
    ['SW', 'SW'], ['S', 'SOUTH'], ['SE', 'SE']
  ];
  var STACK = [['UP', 'UP'], ['DWN', 'DOWN'], ['IN', 'IN'], ['OUT', 'OUT']];
  var DIR_WORD = {
    NORTH: 'north', SOUTH: 'south', EAST: 'east', WEST: 'west',
    NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest',
    UP: 'up', DOWN: 'down', IN: 'in', OUT: 'out', LAND: 'land'
  };
  // Scene exit hotspots are ids like '__go_ne'; accept any spelling and fold to a DIR_WORD key.
  var GO_RE = /^_*go[_-]?(.+)$/i;
  var DIR_ALIAS = {
    N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST', U: 'UP', D: 'DOWN',
    NORTH: 'NORTH', SOUTH: 'SOUTH', EAST: 'EAST', WEST: 'WEST',
    NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
    NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
    UP: 'UP', DOWN: 'DOWN', IN: 'IN', ENTER: 'IN', OUT: 'OUT', EXIT: 'OUT', LAND: 'LAND'
  };
  function normDir(d) {
    return DIR_ALIAS[String(d).toUpperCase().replace(/[^A-Z]/g, '')] || null;
  }
  // A hotspot is an exit if it says so (dir/go/exit) or its id is the '__go_<dir>' pseudo-noun.
  function exitDirOf(h) {
    if (!h) return null;
    var raw = h.dir || h.go || h.exit;
    if (!raw) {
      var m = GO_RE.exec(String(h.obj || h.id || ''));
      if (m) raw = m[1];
    }
    return raw ? normDir(raw) : null;
  }

  // ---------------------------------------------------------------- state
  var canvas = null, ctx = null;
  var zm = null, story = null;
  var S = blankState();
  var mode = 'boot';            // boot | chrome | play | keys | saves  (chrome = someone else owns the canvas)
  var t = 0, rafLast = 0;

  var pages = [], page = 0;     // paginated verbatim output
  var pendingEnd = null;        // {kind:'death'|'win', text, resurrected}
  var selectedVerb = 'LOOK';
  var pendingVerb = null, pendingObj = null;   // two-object verb in flight
  var selectedItem = null;
  var invPage = 0;
  var hint = '';
  var hover = null;                 // the hotspot under the cursor, if any
  // POINTER HINTS. Off by default, on purpose: in Uninvited nothing told you which
  // pixels were live, and finding out was the game. Players who want the modern
  // affordance can switch it on; the default stays faithful.
  var hints = false;
  // A fingertip is not a mouse pointer. Once a tap happens we widen every hit
  // test for the rest of that gesture: a 16px sprite in a 144x104 pane is about
  // 24 device px on a phone, well under the ~44px a finger can reliably hit.
  var touching = false;
  var TOUCH_SLOP = 7;               // logical px of forgiveness around a target
  var asked = false;            // the parser asked a question and is waiting on a bare noun
  var blocked = false;          // machine is sitting on "(Type RESTART, RESTORE, or QUIT):"
  // Permadeath (3rd death): the game does NOT quit, it blocks on this prompt and will accept
  // nothing else. Commas move around between builds, so match loosely.
  var PROMPT_RE = /(?:type\s+)?restart\s*,\s*restore\s*,?\s*(?:or\s+)?quit/i;
  var PROMPT_WORDS = /^(restart|restore|quit)$/i;
  var typed = '', keysCb = null;
  var savesMode = 'save';
  var lastDeath = null;         // kept so the permadeath card can be re-raised on cancel
  var lastScore = 0;
  var warned = {};
  var audioReady = false, booted = false;
  var clickTimer = null, lastHitObj = null, lastHitAt = 0;

  function blankState() {
    return { roomId: '', roomName: '', score: 0, moves: 0, dark: false,
             objects: [], inventory: [], flags: {}, fighting: false };
  }

  // ---------------------------------------------------------------- tiny draw helpers
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function frame(x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  }
  // Whole pixels only. A glyph drawn at y=2.5 loses its top row to the raster,
  // which is what made every label look cropped and off-centre.
  function text(str, x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (GUE.font && GUE.font.draw) return GUE.font.draw(ctx, str, x, y, c || COL.ink);
    return x;
  }
  function textC(str, cx, y, c) {
    cx = Math.round(cx); y = Math.round(y);
    if (GUE.font && GUE.font.drawCentered) return GUE.font.drawCentered(ctx, str, cx, y, c || COL.ink);
    return text(str, cx - String(str).length * 4, y, c);
  }
  // Integer tiling: cell i of n spanning `total` px from `origin`. Rounding the
  // cumulative edges (not the width) keeps cells flush with no drift or slack.
  function cell(origin, total, i, n) {
    var a = Math.round(i * total / n), b = Math.round((i + 1) * total / n);
    return { p: origin + a, s: b - a };
  }
  function glyphDown()  { return (GUE.font && GUE.font.DOWN)  || 'v'; }
  function glyphRight() { return (GUE.font && GUE.font.RIGHT) || '>'; }
  function hit(r, x, y) {
    var p = touching ? TOUCH_SLOP : 0;
    return x >= r.x - p && x < r.x + r.w + p && y >= r.y - p && y < r.y + r.h + p;
  }

  // ---------------------------------------------------------------- boot
  // Idempotent: the file auto-boots on load AND exports boot(), so a host that calls it
  // explicitly must not get a second interpreter and a wiped game.
  function boot() {
    if (booted) return;
    booted = true;
    buildCanvas();
    bindInput();

    try {
      story = b64ToBytes(GUE.STORY_BASE64 || '');
    } catch (e) {
      return fatal('STORY DATA UNREADABLE');
    }
    if (!story || !story.length) return fatal('NO STORY FILE');
    if (!GUE.ZMachine) return fatal('NO INTERPRETER');

    try {
      zm = new GUE.ZMachine(story);
    } catch (e) {
      return fatal('INTERPRETER FAILED: ' + (e && e.message));
    }
    safe(function () { GUE.bridge.init(zm); });
    loadHints();

    requestAnimationFrame(loop);

    var started = false;
    var go = function () { if (started) return; started = true; startGame(); };
    if (GUE.chrome && typeof GUE.chrome.boot === 'function') {
      mode = 'chrome';
      try { GUE.chrome.boot(canvas, go); } catch (e) { console.warn('[shell] chrome.boot failed', e); go(); }
    } else {
      go();
    }
  }

  function buildCanvas() {
    canvas = document.getElementById('gue-screen');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'gue-screen';
      var slot = document.getElementById('crt-slot') || document.body;
      slot.appendChild(canvas);
    }
    applyLayout(wantsPortrait());
    canvas.style.imageRendering = 'pixelated';
    canvas.style.display = 'block';
    canvas.tabIndex = 0;
    ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;
    rescale();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
  }

  // Rotating a phone, or dragging a desktop window narrow, can change which
  // board this game should be played on.
  var relayoutTimer = null;
  function onViewportChange() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(function () {
      var want = wantsPortrait();
      if (want !== PORTRAIT) applyLayout(want);
      rescale();
    }, 90);
    rescale();
  }

  // Integer scale only — a fractional scale would smear the pixel grid.
  // chrome/boot.js owns the page shell and sizes #gue-screen from CSS variables, so when
  // it is present we must NOT write inline width/height (inline beats its stylesheet).
  function rescale() {
    if (!canvas || GUE.chrome) return;
    var host = canvas.parentElement;
    var aw = (host && host.clientWidth)  || window.innerWidth  || W;
    var ah = (host && host.clientHeight) || window.innerHeight || H;
    if (host && (!host.clientHeight || host.clientHeight < 32)) ah = window.innerHeight || H;
    var s = Math.max(1, Math.min(Math.floor(aw / W), Math.floor(ah / H)));
    canvas.style.width = (W * s) + 'px';
    canvas.style.height = (H * s) + 'px';
  }

  function b64ToBytes(b64) {
    b64 = String(b64).replace(/\s+/g, '');
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  function fatal(msg) {
    mode = 'dead';
    if (!ctx) return console.error('[shell] ' + msg);
    rect(0, 0, W, H, COL.bg);
    textC('GUE - FAULT', W / 2, 100, COL.red);
    textC(String(msg).slice(0, 30), W / 2, 116, COL.ink);
    console.error('[shell] ' + msg);
  }

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  // ---------------------------------------------------------------- game turns
  function startGame() {
    mode = 'play';
    var out = '';
    try { out = zm.start() || ''; } catch (e) { return fatal('START FAILED'); }
    refresh();
    lastScore = S.score;
    paginate(stripBanner(out));
    hint = 'PICK A VERB';                    // clears on the first real action
    autosave();
  }
  // The binary opens with six lines of 1981 copyright. That is the right thing to
  // put on a title screen and the wrong thing to make a player page past before
  // they can read "West of House" — so it is lifted out of the play pane. The
  // banner still exists, unaltered, and the boot screen prints it.
  function stripBanner(out) {
    // The banner ends with the release/serial line; everything before it is masthead.
    var m = /Release\s+\d+\s*\/\s*Serial number\s*\d+/i.exec(out);
    var cut = m ? m.index + m[0].length : out.indexOf('All rights reserved.');
    if (cut < 0) return out;
    if (!m) cut += 'All rights reserved.'.length;
    var rest = out.slice(cut), nl = rest.search(/\S/);
    return nl < 0 ? out : rest.slice(nl);
  }

  function refresh() {
    var st = null;
    if (GUE.bridge && typeof GUE.bridge.state === 'function') { try { st = GUE.bridge.state(); } catch (e) {} }
    if (st && typeof st === 'object') {
      S = st;
      S.objects = S.objects || []; S.inventory = S.inventory || []; S.flags = S.flags || {};
      S.roomName = S.roomName || S.roomId || '';
    } else if (zm && typeof zm.getGlobal === 'function') {
      // bridge not up yet: globals still give us a status bar
      S = blankState();
      safe(function () { S.score = zm.getGlobal(1); S.moves = zm.getGlobal(2); });
    }
    if (S.inventory.indexOf(selectedItem) < 0) selectedItem = null;
    safe(function () { GUE.audio.update(S); });
  }

  function send(cmd, verb) {
    if (!zm || mode !== 'play') return;
    cmd = String(cmd || '').trim();
    if (!cmd) return;
    // Deadlock guard: while the machine sits on the permadeath prompt it accepts exactly three
    // words. Dropping everything else here covers every input path at once (verb, compass,
    // hotspot, inventory, keyboard, SPEAK) instead of guarding each one.
    if (blocked && !PROMPT_WORDS.test(cmd)) return;
    var before = S.score || 0, out = '';
    lastHitObj = null;            // a turn ends the double-click window; two clicks on the
                                  // same object either side of a move are not a double-click
    try {
      out = zm.input(cmd) || '';
    } catch (e) {
      console.warn('[shell] input failed', e);
      out = '[The dungeon shudders. (interpreter error)]';
    }
    // The parser can answer with a question ("What do you want to attack the troll with?").
    // While one is open the next object click must be a BARE noun, not a new verb phrase.
    asked = /\?\s*$/.test(String(out).replace(/\s+$/, ''));
    if (asked) hint = 'WHICH?';
    blocked = PROMPT_RE.test(out);
    if (blocked) { asked = false; hint = ''; }
    refresh();
    paginate(out);
    checkEnd(out);
    autosave();
    sfxFor(verb, out, (S.score || 0) - before);
    lastScore = S.score || 0;
  }

  function sfxFor(verb, out, dScore) {
    if (!GUE.audio || typeof GUE.audio.sfx !== 'function') return;
    var name = null;
    if (/\*{3,}|You have died|dungeon collapses/i.test(out)) name = 'death';
    else if (dScore > 0) name = 'treasure';
    else if (verb === 'TAKE') name = 'take';
    else if (verb === 'OPEN' || verb === 'CLOSE') name = 'open';
    else if (verb === 'HIT') name = 'sword';
    else if (verb === 'GO') name = S.dark ? 'grue' : 'door';
    if (name) safe(function () { GUE.audio.sfx(name); });
  }

  // ---------------------------------------------------------------- verbatim text pagination
  // Prose is never rewritten — only wrapped at 30 columns and cut into 8-line pages.
  function wrap(str) {
    var src = String(str == null ? '' : str).replace(/\r/g, '').split('\n');
    var out = [], blanks = 0;
    for (var i = 0; i < src.length; i++) {
      var line = src[i].replace(/\s+$/, '');
      if (!line) { blanks++; if (blanks <= 1 && out.length) out.push(''); continue; }
      blanks = 0;
      var lead = (line.match(/^ +/) || [''])[0];
      if (line.length <= COLS) { out.push(line); continue; }
      var words = line.slice(lead.length).split(/ +/), cur = lead;
      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        if (!cur.replace(/^ +/, '')) { cur += word; }
        else if (cur.length + 1 + word.length <= COLS) { cur += ' ' + word; }
        else { out.push(cur); cur = word; }
        while (cur.length > COLS) { out.push(cur.slice(0, COLS)); cur = cur.slice(COLS); }
      }
      if (cur.length) out.push(cur);
    }
    while (out.length && !out[0]) out.shift();
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }

  var lastPaginated = null;
  function paginate(str) {
    lastPaginated = str;
    var lines = wrap(str);
    pages = [];
    for (var i = 0; i < lines.length; i += ROWS) pages.push(lines.slice(i, i + ROWS));
    if (!pages.length) pages.push([]);
    page = 0;
    if (pendingEnd && pages.length === 1 && !pages[0].length) fireEnd();
  }

  function morePages() { return page < pages.length - 1; }
  function pageText() {
    var all = [];
    for (var i = 0; i < pages.length; i++) all = all.concat(pages[i]);
    return all.join('\n');
  }

  function advance() {
    if (morePages()) { page++; return true; }
    if (pendingEnd) { fireEnd(); return true; }
    return false;
  }

  // ---------------------------------------------------------------- death / victory
  function checkEnd(out) {
    if (/inside the barrow/i.test(out)) {
      pendingEnd = { kind: 'win', text: out };
      return;
    }
    // The prompt is authoritative on its own: it can arrive on a later turn than the
    // banner (e.g. after answering the reincarnate question), and it must always raise a card.
    if (blocked) {
      pendingEnd = { kind: 'death', text: out, resurrected: false, permadeath: true };
      return;
    }
    var died = /\*{3,}\s*You have died\s*\*{3,}/i.test(out) ||
               /You have died/.test(out) ||
               /The dungeon collapses/i.test(out);
    if (!died) return;
    // Resurrection is the norm — Zork drops you in the forest and play continues, so the
    // default is CONTINUE and only the confirmed permadeath markers take it away.
    // Deliberately text-only: the interpreter's `running`/`halted`-style flags mean
    // "parked waiting for input", which is every healthy turn, and reading them as death
    // mislabels ordinary deaths as permadeath and throws the player's game away.
    var over = /suicidal maniac/i.test(out) || PROMPT_RE.test(out);
    pendingEnd = { kind: 'death', text: out, resurrected: !over };
  }

  // At the permadeath prompt the ONLY way forward is the literal word — the machine is
  // parked inside its read loop, so a fresh interpreter would throw the real game away.
  function answerPrompt(word) {
    card = null;
    if (!blocked) {                       // card outlived the prompt: fall back to our own paths
      if (/^restart$/i.test(word)) return fullRestart();
      if (/^restore$/i.test(word)) return restoreUI();
      return;
    }
    mode = 'play';
    pendingEnd = null;
    send(String(word).toLowerCase(), 'ANSWER');   // re-prompts (and re-raises the card) if refused
  }

  function fireEnd() {
    var end = pendingEnd;
    pendingEnd = null;
    if (!end) return;
    if (end.kind === 'win') {
      if (GUE.chrome && typeof GUE.chrome.ending === 'function') {
        mode = 'chrome';
        try { GUE.chrome.ending(canvas, end.text, { restart: fullRestart }); return; }
        catch (e) { console.warn('[shell] chrome.ending failed', e); mode = 'play'; }
      }
      return localCard('YOU HAVE WON', end.text, [{ label: 'PLAY AGAIN', fn: fullRestart }]);
    }
    lastDeath = end;
    showDeath(end);
  }

  // Re-raisable: while the engine is parked on the permadeath prompt the card is the only
  // way out, so anything that dismisses it (cancelling the save picker) must put it back.
  function showDeath(end) {
    // Permadeath routes RESTART/RESTORE/QUIT back into the blocked machine as literal words;
    // an ordinary death still gets our own restart/battery-restore.
    var perma = !!end.permadeath;
    var opts = {
      restart: perma ? function () { answerPrompt('restart'); } : fullRestart,
      restore: perma ? function () { answerPrompt('restore'); } : restoreUI,
      resurrected: !!end.resurrected,
      permadeath: perma
    };
    if (perma) {
      opts.quit = function () { answerPrompt('quit'); };
      opts.restoreSlot = restoreUI;          // our localStorage battery saves, bypassing the prompt
    }
    if (end.resurrected) opts['continue'] = resumePlay;
    if (GUE.chrome && typeof GUE.chrome.death === 'function') {
      mode = 'chrome';
      try { GUE.chrome.death(canvas, end.text, opts); return; }
      catch (e) { console.warn('[shell] chrome.death failed', e); mode = 'play'; }
    }
    localCard('YOU HAVE DIED', end.text,
      end.resurrected ? [{ label: 'CONTINUE', fn: resumePlay }, { label: 'RESTORE', fn: restoreUI }]
      : perma ? [{ label: 'RESTART', fn: opts.restart },
                 { label: 'RESTORE', fn: opts.restore },
                 { label: 'QUIT', fn: opts.quit }]
      : [{ label: 'RESTART', fn: fullRestart }, { label: 'RESTORE', fn: restoreUI }]);
  }

  // Backing out of the save picker while parked would strand the player on a board where
  // nothing responds. Returns true if it took over (caller must not fall back to 'play').
  function reRaiseIfParked() {
    if (!blocked) return false;
    if (!lastDeath) lastDeath = { kind: 'death', text: pageText(), resurrected: false, permadeath: true };
    showDeath(lastDeath);
    return true;
  }

  // Fallback card, used only when chrome/boot.js is absent or threw.
  var card = null;
  function localCard(title, body, buttons) {
    mode = 'chrome';
    card = { title: title, lines: wrap(body).slice(-6), buttons: buttons, rects: [] };
    drawCard();
  }
  function drawCard() {
    if (!card) return;
    rect(0, 0, W, H, COL.bg);
    frame(16, 32, 224, 176, COL.dim);
    textC(card.title, W / 2, 48, COL.red);
    for (var i = 0; i < card.lines.length; i++) textC(card.lines[i], W / 2, 76 + i * LH, COL.ink);
    card.rects = [];
    for (var b = 0; b < card.buttons.length; b++) {
      var r = { x: 48, y: 148 + b * 20, w: 160, h: 16 };
      frame(r.x, r.y, r.w, r.h, COL.ink);
      textC(card.buttons[b].label, r.x + r.w / 2, r.y + 4, COL.gold);
      card.rects.push(r);
    }
  }
  function cardClick(x, y) {
    if (!card) return;
    for (var i = 0; i < card.rects.length; i++) {
      if (hit(card.rects[i], x, y)) { var fn = card.buttons[i].fn; card = null; fn(); return; }
    }
  }

  function resumePlay() { card = null; mode = 'play'; refresh(); }

  function fullRestart() {
    card = null; pendingEnd = null; pages = []; page = 0;
    pendingVerb = pendingObj = null; selectedItem = null; selectedVerb = 'LOOK';
    hint = ''; asked = false; blocked = false; lastDeath = null; lastHitObj = null; invPage = 0;
    try { zm = new GUE.ZMachine(story); } catch (e) { return fatal('RESTART FAILED'); }
    safe(function () { GUE.bridge.init(zm); });
    loadHints();
    startGame();
  }

  // ---------------------------------------------------------------- save / restore
  function slotKey(n) { return 'gue-save-' + n; }

  // zm.snapshot() holds typed arrays; JSON alone would round-trip them into
  // {"0":..} objects, so tag and base64 them.
  function encode(v) {
    if (v == null || typeof v !== 'object') return v;
    if (ArrayBuffer.isView(v)) {
      var u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), s = '', C = 0x8000;
      for (var i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C));
      return { $ta: v.constructor.name, d: btoa(s) };
    }
    if (Array.isArray(v)) return v.map(encode);
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = encode(v[k]);
    return o;
  }
  function decode(v) {
    if (v == null || typeof v !== 'object') return v;
    if (v.$ta) {
      var bin = atob(v.d), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var Ctor = window[v.$ta] || Uint8Array;
      return Ctor === Uint8Array ? u8 : new Ctor(u8.buffer, 0, u8.byteLength / (Ctor.BYTES_PER_ELEMENT || 1));
    }
    if (Array.isArray(v)) return v.map(decode);
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = decode(v[k]);
    return o;
  }

  function saveSlot(n) {
    if (!zm || typeof zm.snapshot !== 'function') return false;
    try {
      var snap = zm.snapshot();
      localStorage.setItem(slotKey(n), JSON.stringify({
        v: 1, at: Date.now(), room: S.roomName || S.roomId, score: S.score || 0,
        moves: S.moves || 0, snap: encode(snap)
      }));
      return true;
    } catch (e) { console.warn('[shell] save failed', e); return false; }
  }
  function readSlot(n) {
    try { var raw = localStorage.getItem(slotKey(n)); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function loadSlot(n) {
    var rec = readSlot(n);
    if (!rec || !zm || typeof zm.restore !== 'function') return false;
    try { zm.restore(decode(rec.snap)); } catch (e) { console.warn('[shell] restore failed', e); return false; }
    // A battery restore replaces the whole machine, so any parked/prompt state belonged to
    // the game we just threw away. Leaving `blocked` set would make send() silently swallow
    // every command in the restored game.
    pendingEnd = null; card = null; mode = 'play';
    pendingVerb = pendingObj = null;
    blocked = false; asked = false; hint = ''; lastDeath = null;
    refresh();
    paginate((S.roomName || 'Restored') + '\n\nRestored.');
    return true;
  }
  function autosave() { saveSlot(0); }
  function restoreUI() { card = null; openSaves('load'); }

  // The slot list is read once per open (and after a write) — the render loop must not
  // hit localStorage 120 times a second.
  var slotCache = [null, null, null, null];
  function audioVolume() {
    var A = GUE.audio;
    if (A && typeof A.getVolume === 'function') { var v = safe(function () { return A.getVolume(); }); if (typeof v === 'number') return v; }
    return 0.5;
  }
  function setAudioVolume(v) {
    var A = GUE.audio; if (!A) return;
    firstGesture();
    if (typeof A.setVolume === 'function') safe(function () { A.setVolume(v); });
    if (A.muted) setAudioMuted(false);
    try { localStorage.setItem('gue.volume', String(v)); } catch (e) {}
  }
  function audioMuted() { return !!(GUE.audio && GUE.audio.muted); }
  function setAudioMuted(m) {
    var A = GUE.audio; if (!A) return;
    firstGesture();
    if (typeof A.setMuted === 'function') safe(function () { A.setMuted(m); });
    else A.muted = m;
    try { localStorage.setItem('gue.muted', m ? '1' : '0'); } catch (e) {}
  }

  function openSaves(which) { mode = 'saves'; savesMode = which; refreshSlots(); }
  function refreshSlots() { for (var n = 0; n <= 3; n++) slotCache[n] = readSlot(n); }

  // ---------------------------------------------------------------- verbs -> parser commands
  function noun(objId) {
    if (GUE.verbmap && typeof GUE.verbmap.noun === 'function') {
      var n = safe(function () { return GUE.verbmap.noun(objId); });
      if (n) return n;
    }
    return String(objId || '').toLowerCase().replace(/-/g, ' ');
  }

  // S is part of the signature: it drives the lamp on/off toggle, door open/close, context nouns.
  function rawCmd(verb, obj, obj2) {
    if (GUE.verbmap && typeof GUE.verbmap.command === 'function') {
      try { return GUE.verbmap.command(verb, obj, obj2 || null, S); } catch (e) { return null; }
    }
    return null;
  }

  function fallbackCmd(verb, obj, obj2) {
    var n = noun(obj), n2 = obj2 ? noun(obj2) : null;
    switch (verb) {
      case 'LOOK':  return 'examine ' + n;
      case 'TAKE':  return 'take ' + n;
      case 'DROP':  return 'drop ' + n;
      case 'OPEN':  return 'open ' + n;
      case 'CLOSE': return 'close ' + n;
      case 'HIT':   return n2 ? ('attack ' + n + ' with ' + n2) : ('attack ' + n);
      case 'USE':   return n2 ? ('put ' + n2 + ' in ' + n) : ('move ' + n);
      default:      return verb.toLowerCase() + ' ' + n;
    }
  }

  function cmdFor(verb, obj, obj2) {
    var c = rawCmd(verb, obj, obj2);
    if (c) return applyTemplate(String(c), obj, obj2);
    return fallbackCmd(verb, obj, obj2);
  }

  function applyTemplate(c, obj, obj2) {
    return c.replace(/%1|\{1\}|\$1/g, noun(obj)).replace(/%2|\{2\}|\$2/g, obj2 ? noun(obj2) : '');
  }

  // USE is per-object (lamp = "turn on lamp", bolt = "turn bolt with wrench"), so the
  // verbmap decides: a null/templated command means "ask for a second object".
  function needsSecond(verb, obj) {
    if (GUE.verbmap && typeof GUE.verbmap.needsSecond === 'function') {
      var r = safe(function () { return GUE.verbmap.needsSecond(verb, obj); });
      if (r !== undefined) return !!r;
    }
    if (!TWO_OBJ[verb]) return false;
    if (verb === 'HIT') return (S.inventory || []).length > 0;
    var c = rawCmd('USE', obj);
    if (c == null) return !!GUE.verbmap;
    return /%2|\{2\}|\$2|\bwith$/.test(String(c).trim());
  }

  // Click arbitration. A single-object command is held for 240ms so a double-click can
  // cancel it and mean "examine" instead. A two-object verb is NOT held: its first click
  // only arms "WITH WHAT?" (no turn is spent), so holding it would let an impatient second
  // click race the timer and fire two separate one-object commands.
  function objectClicked(objId) {
    if (!objId) return;
    if (asked) {                       // answering the parser's question: bare noun only
      asked = false; hint = ''; lastHitObj = null;
      return send(noun(objId), 'ANSWER');
    }
    var now = Date.now();
    var dbl = (lastHitObj === objId && now - lastHitAt < 300);
    lastHitObj = objId; lastHitAt = now;
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    if (dbl) {
      pendingObj = pendingVerb = null; hint = ''; lastHitObj = null;
      return doVerb('LOOK', objId);                        // double-click = examine
    }
    if (pendingObj) return doVerb(selectedVerb, objId);     // commit the second object now
    if (selectedVerb === 'LOOK' || needsSecond(selectedVerb, objId)) return doVerb(selectedVerb, objId);
    clickTimer = setTimeout(function () { clickTimer = null; doVerb(selectedVerb, objId); }, 240);
  }

  function doVerb(verb, obj) {
    if (verb === 'SPEAK') return openKeyboard();
    if (pendingObj) {
      var first = pendingObj, v = pendingVerb;
      pendingObj = pendingVerb = null; hint = '';
      return issue(v, first, obj);
    }
    if (needsSecond(verb, obj)) {
      pendingVerb = verb; pendingObj = obj; hint = 'WITH WHAT?';
      return;
    }
    issue(verb, obj);
  }

  function issue(verb, obj, obj2) {
    hint = ''; selectedItem = null;
    send(cmdFor(verb, obj, obj2), verb);
  }

  function go(dir) {
    pendingObj = pendingVerb = null; hint = '';
    send(DIR_WORD[dir] || String(dir).toLowerCase(), 'GO');
  }

  // ---------------------------------------------------------------- render
  function loop(ts) {
    requestAnimationFrame(loop);
    if (ts - rafLast < 32) return;                        // ~30fps
    rafLast = ts;
    t++;
    if (mode === 'chrome') {
      // chrome/boot.js paints a 256x240 screen. On the taller phone board we
      // letterbox it rather than let it draw into a corner.
      if (card) drawCard();
      return;                                                  // someone else owns the canvas
    }
    if (mode === 'dead' || mode === 'boot') return;
    render();
  }

  function render() {
    // chrome hands the canvas back as it found it; if anything resized it, adopt
    // the board again rather than drawing into a mismatched surface
    if (canvas && (canvas.width !== W || canvas.height !== H)) applyLayout(PORTRAIT);
    // and no foreign transform may leak into the board
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    rect(0, 0, W, H, COL.bg);
    drawStatus();
    drawScene();
    drawCompass();
    drawVerbs();
    drawText();
    drawInv();
    if (mode === 'keys') drawKeyboard();
    if (mode === 'saves') drawSaves();
  }

  // --- status bar
  var saveBtn = { x: 216, y: 3, w: 34, h: 11 };
  // Score/moves are right-aligned and the room name takes whatever is left, so
  // "West of House" isn't clipped to "WEST OF HOUS" just to reserve room for 4-digit moves.
  function drawStatus() {
    var sh = STATUS.h;
    rect(0, 0, W, sh, COL.bg);
    rect(0, sh - 1, W, 1, COL.dim);
    frame(saveBtn.x, saveBtn.y, saveBtn.w, saveBtn.h, COL.dim);
    textC('MENU', saveBtn.x + saveBtn.w / 2, saveBtn.y + (saveBtn.h - 8) / 2, COL.ink);

    var edge = saveBtn.x;
    var lives = livesLeft();
    var midY = ((sh - 8) / 2) | 0;
    if (lives !== null) { edge -= 15; livesPips(edge + 1, midY + 2, lives); }

    var stats = 'S:' + (S.score | 0) + ' M:' + (S.moves | 0);
    var sx = edge - 6 - measure(stats);
    text(stats, sx, midY, COL.ink);

    var lamp = lampOn();
    if (lamp) lampIcon(sx - 12, midY - 1, lampFrac());
    var room = Math.max(0, (((lamp ? sx - 12 : sx) - 6) / 8) | 0);
    // Pointing at something outranks the room name: naming what is under the
    // cursor is how a player learns the picture is full of nouns.
    var pointed = hover ? hoverLabel(hover) : '';
    var left = pointed || hint || (pendingObj ? 'WITH WHAT?' : (S.roomName || '...'));
    var col = pointed ? COL.gold : (hint ? COL.gold : COL.ink);
    text(String(left).toUpperCase().slice(0, room), 4, midY, col);
  }

  // Third death is permanent, so how many are left is real information, not decoration.
  function livesLeft() {
    var g = S.globals;
    if (!g || typeof g.DEATHS !== 'number') return null;
    return Math.max(0, 3 - g.DEATHS);
  }
  function livesPips(x, y, left) {
    for (var i = 0; i < 3; i++) {
      var px = x + i * 5;
      if (i < left) rect(px, y, 3, 3, left === 1 ? COL.red : COL.ink);
      else { rect(px, y, 3, 1, COL.dark); rect(px, y + 2, 3, 1, COL.dark); }
    }
  }
  function lampFrac() {
    if (!GUE.bridge || typeof GUE.bridge.lampFraction !== 'function') return null;
    var f = safe(function () { return GUE.bridge.lampFraction(); });
    return (typeof f === 'number' && isFinite(f)) ? Math.max(0, Math.min(1, f)) : null;
  }
  function measure(s) { return (GUE.font && GUE.font.measure) ? GUE.font.measure(s) : String(s).length * 8; }
  function pad(n, w) { var s = String(n | 0); while (s.length < w) s = '0' + s; return s; }
  function lampOn() {
    var f = S.flags || {};
    var keys = ['LAMP', 'LANTERN', 'BRASS-LANTERN', 'TORCH', 'CANDLES', 'MATCH'];
    for (var i = 0; i < keys.length; i++) if (f[keys[i]] && f[keys[i]].on) return true;
    return false;
  }
  // The lamp IS the fuel gauge: the glass empties from the top as the battery drains, so it
  // costs no extra width. frac === null means "burning, amount unknown" -> full glass, never
  // an empty one (an empty lamp is the single most alarming thing this bar can say).
  function lampIcon(x, y, frac) {
    var rows = 5, lit = frac === null ? rows : Math.round(rows * frac);
    var low = frac !== null && frac <= 0.15;
    rect(x + 2, y, 4, 1, COL.dim);                       // bail
    frame(x + 1, y + 1, 6, 7, low && (t >> 2) % 2 ? COL.red : COL.dim);
    if (frac !== null && frac > 0 && lit === 0) lit = 1; // never read as dead while it burns
    if (lit <= 0) return;
    var glow = low ? ((t >> 2) % 2 ? COL.red : '#7c1800')     // flicker: the game is warning you
                   : ((t >> 3) % 2 ? COL.gold : '#fce4a0');
    rect(x + 2, y + 2 + (rows - lit), 4, lit, glow);
  }

  // --- scene window
  function drawScene() {
    frame(SCENE.x - 1, SCENE.y - 1, SCENE.w + 2, SCENE.h + 2, COL.dim);
    ctx.save();
    ctx.beginPath(); ctx.rect(SCENE.x, SCENE.y, SCENE.w, SCENE.h); ctx.clip();
    ctx.translate(SCENE.x, SCENE.y);
    // Scene art is authored for 144x104. On the phone board we draw it at an
    // integer 2x so the picture doubles without going soft; everything inside
    // this transform keeps using art coordinates and never knows the difference.
    if (SCENE_SCALE !== 1) ctx.scale(SCENE_SCALE, SCENE_SCALE);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, SCENE_ART.w, SCENE_ART.h);
    if (S.dark) drawDark();
    else {
      var sc = sceneFor(S.roomId);
      if (sc === AUTO_SCENE) warnOnce('scene-' + S.roomId, 'no scene for room ' + (S.roomId || '(unknown)'));
      try { sc.draw(ctx, S, t); }
      catch (e) { warnOnce('scene-err-' + S.roomId, 'scene draw threw for ' + S.roomId, e); drawFallbackScene(); }
      if (hover) drawHoverBox(hover);
    }
    ctx.restore();
  }

  // A marching-ants box around whatever the cursor names. Corners only, so it
  // frames the thing without painting over it.
  function drawHoverBox(h) {
    var x = h.x | 0, y = h.y | 0, w = h.w | 0, hh = h.h | 0;
    var c = exitDirOf(h) ? COL.gold : COL.white;
    var arm = Math.max(2, Math.min(5, Math.min(w, hh) >> 1));
    ctx.fillStyle = ((t >> 2) % 2) ? c : COL.dim;
    var seg = function (sx, sy, sw, sh) { ctx.fillRect(sx, sy, sw, sh); };
    seg(x, y, arm, 1);            seg(x, y, 1, arm);                     // top-left
    seg(x + w - arm, y, arm, 1);  seg(x + w - 1, y, 1, arm);             // top-right
    seg(x, y + hh - 1, arm, 1);   seg(x, y + hh - arm, 1, arm);          // bottom-left
    seg(x + w - arm, y + hh - 1, arm, 1); seg(x + w - 1, y + hh - arm, 1, arm);
  }

  function warnOnce(key, msg, err) {
    if (warned[key]) return;
    warned[key] = 1;
    console.warn('[shell] ' + msg, err || '');
  }

  //  A room nobody has drawn is still a room you have to be able to play.
  //
  //  Scene art supplies the hotspots, so a game with no art had nothing to click:
  //  the verb grid worked and had no target, the objects in the room were in the
  //  state and invisible, and the first room of a thirty-room game was a dead end.
  //  Not "no pictures yet" — unplayable, which is the one thing the board exists
  //  to prevent.
  //
  //  So an undrawn room now draws what is in it as a list of labelled strips and
  //  hands back a hotspot for each. It is plainly a placeholder rather than a
  //  picture, which is right: it should look like something waiting to be drawn,
  //  and it should be playable while it waits.
  var AUTO_ROWS = 6, AUTO_TOP = 30, AUTO_H = 11, AUTO_STEP = 12;
  var AUTO_X = 2, AUTO_W = 140, AUTO_CHARS = 17;

  function autoList(state) {
    var inv = {}, i;
    for (i = 0; i < (state.inventory || []).length; i++) inv[state.inventory[i]] = 1;
    var out = [];
    for (i = 0; i < (state.objects || []).length; i++) {
      var id = state.objects[i];
      if (inv[id]) continue;                       // already in the inventory strip
      if (String(id).charAt(0) === '_') continue;  // shell pseudo-objects
      out.push(id);
    }
    return out;
  }

  function autoHotspots(state) {
    var list = autoList(state), out = [];
    for (var i = 0; i < list.length && i < AUTO_ROWS; i++) {
      out.push({ x: AUTO_X, y: AUTO_TOP + i * AUTO_STEP, w: AUTO_W, h: AUTO_H, obj: list[i] });
    }
    return out;
  }

  var AUTO_SCENE = { draw: function () { drawFallbackScene(); }, hotspots: autoHotspots };

  /** The authored scene for a room, or a playable placeholder. */
  function sceneFor(id) {
    var sc = GUE.scenes && GUE.scenes[id];
    if (sc && typeof sc.draw === 'function') return sc;
    return AUTO_SCENE;
  }

  function drawFallbackScene() {
    var w = SCENE_ART.w, h = SCENE_ART.h;
    ctx.fillStyle = '#101010'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = COL.dark;
    ctx.fillRect(4, 4, w - 8, 1); ctx.fillRect(4, h - 5, w - 8, 1);
    ctx.fillRect(4, 4, 1, h - 8); ctx.fillRect(w - 5, 4, 1, h - 8);
    // The question block belongs to an EMPTY undrawn room. Once there is
    // something to point at, the list is the content and the block just sits on
    // top of it.
    var anything = autoList(S).length;
    if (!anything) {
      ctx.fillStyle = COL.dark; ctx.fillRect(w / 2 - 16, 40, 32, 32);
      ctx.fillStyle = '#000'; ctx.fillRect(w / 2 - 15, 41, 30, 30);
      textC('?', w / 2, 50, COL.gold);
    }
    // Wrapped to the SCENE's width, not the text pane's. wrap() measures against
    // the pane, which is far wider, so a long room name came back as one line and
    // was then hard-cut at 17 characters: "Inside the Fun-Vee" lost its tail and
    // read as a rendering fault rather than as a name. Every Path B game shows
    // this box until somebody draws the room, so it is the first thing a player
    // sees of a new game.
    var nm = (S.roomName || S.roomId || 'UNMAPPED').toUpperCase();
    var per = 17, words = nm.split(/\s+/), lines = [], line = '';
    for (var k = 0; k < words.length; k++) {
      var word = words[k];
      if (!line) { line = word.slice(0, per); continue; }
      if (line.length + 1 + word.length <= per) { line += ' ' + word; continue; }
      lines.push(line); line = word.slice(0, per);
      if (lines.length === 2) break;
    }
    if (line && lines.length < 2) lines.push(line);
    for (var i = 0; i < lines.length; i++) textC(lines[i], w / 2, 10 + i * LH, COL.dim);

    // Everything here, as something you can point at.
    var list = autoList(S);
    if (!list.length) {
      textC('NOTHING TO POINT AT', w / 2, 80, COL.dark);
      return;
    }
    for (var j = 0; j < list.length && j < AUTO_ROWS; j++) {
      var y = AUTO_TOP + j * AUTO_STEP;
      frame(AUTO_X, y, AUTO_W, AUTO_H, COL.dark);
      // No icon. It cost eleven characters of the name, and a name you cannot
      // read is the whole reason this box exists. A cut name ends in a dot so it
      // is plainly cut rather than plainly wrong; pointing at it gives the rest.
      text(fitLabel(list[j], AUTO_CHARS), AUTO_X + 3, y + 2, COL.dim);
    }
    if (list.length > AUTO_ROWS) {
      text('+' + (list.length - AUTO_ROWS) + ' MORE', AUTO_X + 3,
        AUTO_TOP + AUTO_ROWS * AUTO_STEP + 2, COL.dark);
    }
  }

  /**
   * A label that fits, keeping the part that identifies the thing.
   *
   * Cutting from the front leaves the least useful half: "Jimmy's camera" and
   * "your phone" became "JIMMY" and "YOUR", and Jimmy is also a person standing
   * in the room. English puts the head noun last, so when the whole name will not
   * fit, the last word on its own is nearly always the right answer.
   */
  function fitLabel(id, chars) {
    var full = labelOf(id);
    if (full.length <= chars) return full;
    var parts = full.split(/\s+/);
    var head = parts[parts.length - 1];
    if (head.length <= chars) return head;
    return full.slice(0, Math.max(1, chars - 1)) + '.';
  }

  /** What to call a thing on screen. The verb map owns display names. */
  function labelOf(id) {
    if (GUE.verbmap && typeof GUE.verbmap.noun === 'function') {
      var n = safe(function () { return GUE.verbmap.noun(id); });
      if (n) return String(n).toUpperCase();
    }
    return String(id).replace(/-/g, ' ').toUpperCase();
  }

  function drawDark() {
    var w = SCENE_ART.w, h = SCENE_ART.h;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    // faint silhouette of the adventurer
    ctx.fillStyle = '#101010';
    ctx.fillRect(w / 2 - 6, h - 44, 12, 14);
    ctx.fillRect(w / 2 - 4, h - 52, 8, 8);
    ctx.fillRect(w / 2 - 8, h - 30, 5, 14);
    ctx.fillRect(w / 2 + 3, h - 30, 5, 14);
    // grue eyes: a slow blink, offset per room so it isn't metronomic
    var seed = (S.roomId || '').length * 7;
    var phase = (t + seed) % 96;
    if (phase < 76) {
      var ex = 34 + ((seed * 13) % 60), ey = 30 + ((seed * 29) % 30);
      var c = phase > 66 ? '#780000' : COL.red;
      ctx.fillStyle = c;
      ctx.fillRect(ex, ey, 5, 3); ctx.fillRect(ex + 11, ey, 5, 3);
      ctx.fillStyle = '#000';
      ctx.fillRect(ex + 2, ey + 1, 1, 1); ctx.fillRect(ex + 13, ey + 1, 1, 1);
    }
    if ((t >> 4) % 2) textC('IT IS PITCH BLACK', w / 2, h - 14, '#3c3c3c');
  }

  // --- compass
  var compassRects = [];
  function drawCompass() {
    frame(COMPASS.x, COMPASS.y, COMPASS.w, COMPASS.h, COL.dim);
    compassRects = [];
    var exits = roomExits();
    var pad = 2;
    var gw = COMPASS.w - pad * 2, gh = COMPASS.h - pad * 2;
    var padW = Math.round(gw * 0.62), stackW = gw - padW;   // 3x3 rose, then UP/DWN/IN/OUT
    var gx = COMPASS.x + pad, gy = COMPASS.y + pad;
    for (var i = 0; i < 9; i++) {
      var d = PAD[i];
      var cx = cell(gx, padW, i % 3, 3), cy = cell(gy, gh, (i / 3) | 0, 3);
      var r = { x: cx.p, y: cy.p, w: cx.s, h: cy.s };
      if (!d[0]) { textC((GUE.font && GUE.font.DOT) || '.', r.x + r.w / 2, r.y + (r.h - 8) / 2, COL.dark); continue; }
      drawDirCell(r, d[0], d[1], exits);
    }
    for (var k = 0; k < STACK.length; k++) {
      var sy = cell(gy, gh, k, STACK.length);
      var rr = { x: gx + padW, y: sy.p, w: stackW, h: sy.s };
      drawDirCell(rr, STACK[k][0], STACK[k][1], exits);
    }
  }
  function drawDirCell(r, label, dir, exits) {
    var st = exitState(exitFor(exits, dir));
    if (st === 0) { textC(label, r.x + r.w / 2, r.y + (r.h - 8) / 2, '#242424'); return; }
    if (st === 2) frame(r.x, r.y, r.w, r.h, COL.dark);
    textC(label, r.x + r.w / 2, r.y + (r.h - 8) / 2, st === 2 ? COL.blue : COL.dark);
    compassRects.push({ x: r.x, y: r.y, w: r.w, h: r.h, dir: dir });
  }

  // S.exits is live from machine memory, so conditional exits (boarded door, trap door,
  // grate) are already correct; GUE.WORLD is only a fallback for an older bridge.
  function roomExits() {
    if (S.exits && typeof S.exits === 'object') return S.exits;
    var rooms = GUE.WORLD && GUE.WORLD.rooms;
    var r = rooms && S.roomId && rooms[S.roomId];
    return (r && r.exits) || {};
  }
  function exitFor(exits, dir) {
    if (!exits) return undefined;
    var alt = { NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST' }[dir];
    var keys = [dir, alt, dir.toLowerCase(), alt && alt.toLowerCase()];
    for (var i = 0; i < keys.length; i++) if (keys[i] && keys[i] in exits) return exits[keys[i]];
    return undefined;
  }
  // 0 = no such exit (draw ghosted, not clickable)
  // 1 = exit exists but is currently blocked (dim, still clickable — you've earned the refusal)
  // 2 = go ahead
  function exitState(ex) {
    if (ex === undefined || ex === null || ex === '') return 0;
    if (ex === false) return 1;
    if (ex === true) return 2;
    if (typeof ex === 'string') return 2;                    // "ROOM-ID"
    if (typeof ex === 'object') return ex.type === 'msg' ? 1 : 2;   // GUE.WORLD shape
    return 2;
  }

  // --- verb grid
  var verbRects = [];
  function drawVerbs() {
    frame(VERBS.x, VERBS.y, VERBS.w, VERBS.h, COL.dim);
    verbRects = [];
    // Cells divide the pane rather than using a fixed size, so the same code
    // gives a desktop its compact grid and a phone its thumb-sized buttons.
    var pad = 2;
    var gw = VERBS.w - pad * 2, gh = VERBS.h - pad * 2;
    for (var i = 0; i < VERB_LIST.length; i++) {
      var col = i % 2, row = (i / 2) | 0;
      var cx = cell(VERBS.x + pad, gw, col, 2), cy = cell(VERBS.y + pad, gh, row, 4);
      var r = { x: cx.p, y: cy.p, w: cx.s, h: cy.s, verb: VERB_LIST[i] };
      var on = VERB_LIST[i] === selectedVerb;
      if (on) rect(r.x, r.y, r.w, r.h, COL.sel);
      textC(VERB_LIST[i], r.x + r.w / 2, r.y + (r.h - 8) / 2, on ? COL.selInk : COL.ink);
      verbRects.push(r);
    }
  }

  // --- text window
  function drawText() {
    frame(TEXT.x - 1, TEXT.y - 1, TEXT.w + 2, TEXT.h + 2, COL.dim);
    var lines = pages[page] || [];
    for (var i = 0; i < lines.length && i < ROWS; i++) {
      text(lines[i], TEXT.x + TPAD_X, TEXT.y + TPAD_Y + i * LH, COL.ink);
    }
    if (morePages() && (t >> 3) % 2) {
      text(glyphDown(), TEXT.x + TEXT.w - 10, TEXT.y + TEXT.h - 10, COL.gold);
    }
  }

  // --- inventory strip
  var invRects = [], invArrow = null;
  function drawInv() {
    frame(INV.x, INV.y, INV.w, INV.h, COL.dim);
    invRects = []; invArrow = null;
    var items = S.inventory || [];
    if (!items.length) { text('(EMPTY HANDED)', INV.x + TPAD_X + 2, INV.y + (INV.h - 8) / 2, COL.dark); return; }

    // A game with sprites gets icons. A game without them used to get a row of
    // 16-pixel boxes each holding one dim letter, which is not an inventory, it
    // is a row of identical squares. A player who had just picked up the object
    // that opens the first room could not tell which square it was.
    // Whether THIS GAME's things have pictures, not whether a sprite module was
    // loaded. The player bundles the engine's sprite set with every game, so
    // asking whether GUE.sprites exists answered yes for a game that has no art
    // of its own, and the strip stayed a row of one-letter boxes.
    var art = GUE.sprites && typeof GUE.sprites.draw === 'function' &&
      (typeof GUE.sprites.has !== 'function' ||
        items.some(function (id) { return GUE.sprites.has(id); }));
    // Icons are all one size; words are not. Sizing each slot to its own label
    // shows the whole word wherever it fits, instead of cutting CAMERA to five
    // characters because something else in the strip was long.
    var labels = {}, widths = {};
    for (var n = 0; n < items.length; n++) {
      labels[items[n]] = art ? '' : fitLabel(items[n], 9);
      widths[items[n]] = art ? 20 : Math.max(28, labels[items[n]].length * 8 + 10);
    }
    var room = INV.w - 16;
    var perPage = 0, used = 0;
    for (var m = invPage * 1; m < items.length; m++) {
      var wd = widths[items[m]];
      if (used + wd > room) break;
      used += wd; perPage++;
      if (art && perPage >= 11) break;
    }
    perPage = Math.max(1, perPage);
    if (items.length > perPage) invPage = Math.min(invPage, Math.ceil(items.length / perPage) - 1);
    else invPage = 0;
    var slice = items.slice(invPage * perPage, invPage * perPage + perPage);

    var cursor = INV.x + 5;
    for (var i = 0; i < slice.length; i++) {
      var id = slice[i];
      var slotW = widths[id];
      var x = cursor, y = (INV.y + (INV.h - 16) / 2) | 0;
      cursor += slotW;
      var rect = { x: x - 1, y: y - 1, w: slotW - 2, h: 18, obj: id };
      var drawn = false;
      if (art) {
        try { GUE.sprites.draw(ctx, id, x, y, t); drawn = true; } catch (e) { drawn = false; }
      }
      if (!drawn) {
        // Named, not initialled. Five characters is enough to tell a camera from
        // a phone, and pointing at it gives the whole name in the status bar.
        frame(rect.x, rect.y, rect.w, rect.h, COL.dim);
        text(labels[id], rect.x + 3, y + 4, COL.ink);
      }
      if (id === selectedItem) frame(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2, COL.gold);
      invRects.push(rect);
    }
    if (items.length > perPage) {
      invArrow = { x: INV.x + INV.w - 12, y: INV.y + 12, w: 10, h: 10 };
      text(glyphRight(), invArrow.x, invArrow.y, COL.gold);
    }
  }

  // ---------------------------------------------------------------- SPEAK: on-screen keyboard
  var KB = { x: 4, y: 104, w: 248, h: 132 };
  var kbRects = [];
  function openKeyboard(cb) {
    mode = 'keys'; typed = ''; keysCb = cb || null;
    pendingObj = pendingVerb = null; hint = '';
  }
  function closeKeyboard() { mode = 'play'; typed = ''; keysCb = null; }
  function submitTyped() {
    var s = typed.trim();
    var cb = keysCb;
    closeKeyboard();
    if (!s) return;
    if (cb) return cb(s);
    send(s, 'SPEAK');
  }

  function drawKeyboard() {
    rect(KB.x, KB.y, KB.w, KB.h, COL.bg);
    frame(KB.x, KB.y, KB.w, KB.h, COL.ink);
    kbRects = [];
    text('SAY:', KB.x + 4, KB.y + 5, COL.gold);
    var shown = typed.slice(-24);
    text(shown + (((t >> 3) % 2) ? '_' : ''), KB.x + 40, KB.y + 5, COL.ink);
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var x0 = KB.x + 5, y0 = KB.y + 20, cw = 34, ch = 18;
    for (var i = 0; i < 26; i++) {
      var r = { x: x0 + (i % 7) * cw, y: y0 + ((i / 7) | 0) * 20, w: cw - 2, h: ch, key: letters[i] };
      frame(r.x, r.y, r.w, r.h, COL.dim);
      textC(letters[i], r.x + r.w / 2, r.y + 5, COL.ink);
      kbRects.push(r);
    }
    var by = y0 + 4 * 20;
    var specials = [
      { key: ' ',    label: 'SPACE', w: 100 },
      { key: '\b',   label: 'DEL',   w: 60  },
      { key: '\n',   label: 'SAY',   w: 68  }   // not 'END' — players read that as "quit"
    ];
    var bx = x0;
    for (var s2 = 0; s2 < specials.length; s2++) {
      var sp = specials[s2];
      var rr = { x: bx, y: by, w: sp.w - 2, h: ch, key: sp.key };
      frame(rr.x, rr.y, rr.w, rr.h, sp.key === '\n' ? COL.gold : COL.dim);
      textC(sp.label, rr.x + rr.w / 2, rr.y + 5, sp.key === '\n' ? COL.gold : COL.ink);
      kbRects.push(rr);
      bx += sp.w;
    }
    // Quick row: the words you'd never guess to type. (verbmap owns the list.)
    var magic = (GUE.verbmap && GUE.verbmap.magicWords) || [];
    for (var m = 0; m < 3 && m < magic.length; m++) {
      var mr = { x: x0 + m * 78, y: by + 20, w: 76, h: 11, word: String(magic[m]).toUpperCase() };
      if (mr.y + mr.h > KB.y + KB.h - 1) break;
      frame(mr.x, mr.y, mr.w, mr.h, COL.dark);
      textC(mr.word.slice(0, 9), mr.x + mr.w / 2, mr.y + 2, COL.blue);
      kbRects.push(mr);
    }
  }

  function kbKey(k) {
    if (k === '\n') return submitTyped();
    if (k === '\b') { typed = typed.slice(0, -1); return; }
    if (typed.length < 40) typed += k;
  }

  // ---------------------------------------------------------------- save slots UI
  var SAVEUI = { x: 24, y: 46, w: 208, h: 152 };
  var saveRects = [], volRects = [];
  function drawSaves() {
    rect(SAVEUI.x, SAVEUI.y, SAVEUI.w, SAVEUI.h, COL.bg);
    frame(SAVEUI.x, SAVEUI.y, SAVEUI.w, SAVEUI.h, COL.ink);
    textC('MENU', SAVEUI.x + SAVEUI.w / 2, SAVEUI.y + 5, COL.gold);
    text('BATTERY SAVE', SAVEUI.x + 6, SAVEUI.y + 17, COL.dim);
    saveRects = [];
    for (var n = 0; n <= 3; n++) {
      var rec = slotCache[n];
      var y = SAVEUI.y + 30 + n * 16;
      var label = (n === 0 ? 'AUTO' : 'SLOT' + n) + ' ';
      var body = rec ? ((rec.room || '?').toUpperCase().slice(0, 9) + ' ' + pad(rec.score || 0, 3)) : '- EMPTY -';
      text(label, SAVEUI.x + 6, y, COL.dim);
      text(body, SAVEUI.x + 48, y, rec ? COL.ink : COL.dark);
      var sr = { x: SAVEUI.x + 150, y: y - 2, w: 24, h: 11, slot: n, act: 'save' };
      var lr = { x: SAVEUI.x + 176, y: y - 2, w: 24, h: 11, slot: n, act: 'load' };
      if (n > 0) { frame(sr.x, sr.y, sr.w, sr.h, COL.dim); textC('PUT', sr.x + 12, sr.y + 2, COL.ink); saveRects.push(sr); }
      if (rec)   { frame(lr.x, lr.y, lr.w, lr.h, COL.dim); textC('GET', lr.x + 12, lr.y + 2, COL.green); saveRects.push(lr); }
    }
    // Options live here because this is the only menu the game has, and a player
    // looking for a setting looks where the saves are. Everything below is laid
    // out against a running cursor so the panel can be any height.
    var oy = SAVEUI.y + 30 + 4 * 16 + 4;
    var L = SAVEUI.x + 8, R = SAVEUI.x + SAVEUI.w - 8;
    rect(SAVEUI.x + 6, oy - 6, SAVEUI.w - 12, 1, COL.dark);
    text('OPTIONS', L, oy - 1, COL.dim);

    oy += 13;
    text('POINTER HINTS', L, oy, COL.ink);
    var hw = 44;
    var hr = { x: R - hw, y: oy - 2, w: hw, h: 11, act: 'hints' };
    frame(hr.x, hr.y, hr.w, hr.h, hints ? COL.gold : COL.dim);
    textC(hints ? 'ON' : 'OFF', hr.x + hr.w / 2, hr.y + 2, hints ? COL.gold : COL.dark);
    saveRects.push(hr);
    oy += 11;
    text(hints ? 'NAMES WHAT YOU POINT AT' : 'FIND THINGS YOURSELF (H)', L, oy, COL.dark);

    // Volume in the game's own pixels — a chrome slider floating over the
    // cabinet never looked like part of the machine.
    oy += 16;
    text('SOUND', L, oy, COL.ink);
    volRects = [];
    var bw = 9, gap = 2, n = 8;
    var bx = R - (n * (bw + gap) - gap);
    var vol = audioVolume(), litTo = Math.round(vol * n);
    for (var v = 0; v < n; v++) {
      var vr = { x: bx + v * (bw + gap), y: oy - 2, w: bw, h: 11, vol: (v + 1) / n };
      if (!audioMuted() && v < litTo) rect(vr.x, vr.y, vr.w, vr.h, COL.gold);
      else frame(vr.x, vr.y, vr.w, vr.h, COL.dark);
      volRects.push(vr);
    }
    oy += 15;
    var mr = { x: L, y: oy, w: 58, h: 12, act: 'mute' };
    frame(mr.x, mr.y, mr.w, mr.h, audioMuted() ? COL.gold : COL.dim);
    textC(audioMuted() ? 'UNMUTE' : 'MUTE', mr.x + mr.w / 2, mr.y + 3, audioMuted() ? COL.gold : COL.ink);
    saveRects.push(mr);

    var cr = { x: SAVEUI.x + 70, y: SAVEUI.y + SAVEUI.h - 17, w: 68, h: 13, act: 'close' };
    frame(cr.x, cr.y, cr.w, cr.h, COL.ink);
    textC('CLOSE', cr.x + cr.w / 2, cr.y + 3, COL.ink);
    saveRects.push(cr);
  }

  // ---------------------------------------------------------------- input
  function bindInput() {
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', function () { hover = null; canvas.style.cursor = 'default'; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches.length) return;
      e.preventDefault();
      touching = true;                 // widens hit tests for the rest of this tap
      onDown({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, preventDefault: function () {} });
    }, { passive: false });
  }

  function firstGesture() {
    if (audioReady) return;
    audioReady = true;
    safe(function () { GUE.audio.init(); });
    safe(function () { GUE.audio.update(S); });
  }

  function toLogical(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }

  // --- pointing ------------------------------------------------------------
  // A picture full of things is only playable if the player can tell WHICH things.
  // Pointing names what is under the cursor and outlines it; nothing else in the
  // interface tells you the mailbox can be opened.
  function onMove(e) {
    if (mode !== 'play' || blocked) { hover = null; return; }
    var p = toLogical(e), cur = 'default';
    hover = null;
    // With hints off the scene keeps its secrets: no name, no outline, no cursor
    // change over the picture. The chrome (verbs, compass, inventory) is plainly
    // a control panel either way, so it always points.
    if (hints && hit(SCENE, p.x, p.y) && !S.dark) {
      var h = hotspotAt((p.x - SCENE.x) / SCENE_SCALE, (p.y - SCENE.y) / SCENE_SCALE);
      if (h) { hover = h; cur = 'pointer'; }
    } else if (overClickable(p.x, p.y)) {
      cur = 'pointer';
      // Naming what is in your hands, which matters most when the strip is a row
      // of lettered boxes because the game ships no sprites.
      if (hints) {
        for (var q = 0; q < invRects.length; q++) {
          if (hit(invRects[q], p.x, p.y)) { hover = invRects[q]; break; }
        }
      }
    }
    canvas.style.cursor = cur;   // the 30fps loop paints the change
  }
  // v2 of the key: hints briefly defaulted ON for touch devices, so a choice
  // stored under the old key may not be a choice at all — it may be that old
  // default echoed back. Retiring the key resets everyone to "off" cleanly.
  var HINTS_KEY = 'gue.hints.v2';
  function setHints(on) {
    hints = !!on;
    if (!hints) hover = null;
    try { localStorage.setItem(HINTS_KEY, hints ? '1' : '0'); } catch (e) {}
  }
  function loadHints() {
    // Off by default on every device. Finding what is clickable is the game, as
    // it was in Uninvited; a player who wants the modern affordance turns it on.
    //
    // Unless the game has no art. Then there is nothing to find: the scene is a
    // list of labels, the inventory is a row of lettered boxes, and withholding
    // names is not difficulty, it is just an unreadable screen. A player got stuck
    // in the first room of a thirty-room game holding the object that opens it,
    // unable to tell which box it was.
    var stored = null;
    try {
      stored = localStorage.getItem(HINTS_KEY);
      localStorage.removeItem('gue.hints');           // drop the stale key
    } catch (e) {}
    if (stored === null && !hasArt()) { hints = true; return; }
    hints = stored === '1';
  }

  /** Does this game draw anything of its own? */
  function hasArt() {
    // Scenes only. The sprite module ships with the player rather than with the
    // game, so its presence says nothing about whether this game was drawn.
    var sc = GUE.scenes;
    if (!sc) return false;
    for (var k in sc) if (Object.prototype.hasOwnProperty.call(sc, k)) return true;
    return false;
  }
  function overClickable(x, y) {
    var i;
    for (i = 0; i < verbRects.length; i++) if (hit(verbRects[i], x, y)) return true;
    for (i = 0; i < compassRects.length; i++) if (hit(compassRects[i], x, y)) return true;
    for (i = 0; i < invRects.length; i++) if (hit(invRects[i], x, y)) return true;
    if (invArrow && hit(invArrow, x, y)) return true;
    return hit(saveBtn, x, y);
  }
  // The same pick rule the click uses, so what lights up is what you get.
  function hotspotAt(lx, ly) {
    var sc = sceneFor(S.roomId);
    if (!sc || typeof sc.hotspots !== 'function') return null;
    var list = safe(function () { return sc.hotspots(S); }) || [];
    var objs = [], exits = [], i, h;
    for (i = 0; i < list.length; i++) {
      h = list[i];
      if (!h || lx < h.x || lx >= h.x + h.w || ly < h.y || ly >= h.y + h.h) continue;
      (exitDirOf(h) ? exits : objs).push(h);
    }
    // pickObj() answers with an id because that is what a click needs; pointing
    // needs the rect itself, so choose by the same smallest-wins rule here.
    var smallest = function (list) {
      var best = list[0], bestA = best.w * best.h;
      for (var k = 1; k < list.length; k++) {
        var a = list[k].w * list[k].h;
        if (a <= bestA) { best = list[k]; bestA = a; }
      }
      return best;
    };
    var armed = selectedVerb !== 'LOOK' || pendingObj || asked;
    if (armed && objs.length) return smallest(objs);
    if (exits.length && !asked) return exits[0];
    return objs.length ? smallest(objs) : null;
  }
  // What the player would call the thing, not what the source calls it.
  function hoverLabel(h) {
    if (!h) return '';
    var d = exitDirOf(h);
    if (d) return 'GO ' + String(d).toUpperCase();
    var n = GUE.verbmap && GUE.verbmap.noun ? safe(function () { return GUE.verbmap.noun(h.obj); }) : null;
    return String(n || h.obj || '').replace(/-/g, ' ').toUpperCase();
  }

  function onDown(e) {
    if (e.preventDefault) e.preventDefault();
    firstGesture();
    var p = toLogical(e), x = p.x, y = p.y;
    if (mode === 'chrome') return cardClick(x, y);
    if (mode === 'dead' || mode === 'boot') return;
    if (mode === 'keys') return kbClick(x, y);
    if (mode === 'saves') return savesClick(x, y);
    if (hit(saveBtn, x, y)) { openSaves('save'); return; }
    if (advance()) return;                                  // any click pages the text first
    // Parked on the permadeath prompt: nothing on the board does anything, so put the
    // choice back in front of the player rather than leaving them poking a dead UI.
    if (blocked) { reRaiseIfParked(); return; }
    if (hit(TEXT, x, y)) return;

    var i;
    for (i = 0; i < verbRects.length; i++) if (hit(verbRects[i], x, y)) {
      selectedVerb = verbRects[i].verb;
      pendingObj = pendingVerb = null; hint = ''; lastHitObj = null;   // new verb, new gesture
      if (selectedVerb === 'SPEAK') openKeyboard();
      return;
    }
    for (i = 0; i < compassRects.length; i++) if (hit(compassRects[i], x, y)) return go(compassRects[i].dir);
    if (invArrow && hit(invArrow, x, y)) { invPage++; return; }
    for (i = 0; i < invRects.length; i++) if (hit(invRects[i], x, y)) {
      selectedItem = invRects[i].obj;
      return objectClicked(invRects[i].obj);
    }
    if (hit(SCENE, x, y)) return sceneClick((x - SCENE.x) / SCENE_SCALE, (y - SCENE.y) / SCENE_SCALE);
  }

  function sceneClick(lx, ly) {
    if (S.dark) return;
    var sc = sceneFor(S.roomId);
    if (!sc || typeof sc.hotspots !== 'function') return;
    var list = safe(function () { return sc.hotspots(S); }) || [];
    var pad = touching ? TOUCH_SLOP / SCENE_SCALE : 0;
    var inside = function (h) {
      return h && lx >= h.x - pad && lx < h.x + h.w + pad && ly >= h.y - pad && ly < h.y + h.h + pad;
    };

    // Exits and real objects routinely overlap — Behind House stacks '__go_in' in the middle
    // of KITCHEN-WINDOW — so split them and let intent decide instead of pure z-order.
    var objs = [], exits = [];
    for (var i = 0; i < list.length; i++) {
      if (!inside(list[i])) continue;
      (exitDirOf(list[i]) ? exits : objs).push(list[i]);
    }
    if (!objs.length && !exits.length) {
      if (!touching) return;
      // A finger that misses everything still meant SOMETHING. Reach for the
      // nearest target within a thumb's width rather than swallowing the tap.
      var near = null, nd = TOUCH_SLOP * 2.4;
      for (var n = 0; n < list.length; n++) {
        var h2 = list[n]; if (!h2) continue;
        var dx = Math.max(h2.x - lx, 0, lx - (h2.x + h2.w));
        var dy = Math.max(h2.y - ly, 0, ly - (h2.y + h2.h));
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < nd) { nd = d; near = h2; }
      }
      if (!near) return;
      (exitDirOf(near) ? exits : objs).push(near);
    }

    // An armed verb is an explicit statement of intent about a THING: "open" the window,
    // don't walk through it. Exits are not things, so an object always wins while one is armed.
    var armed = selectedVerb !== 'LOOK' || pendingObj || asked;
    if (armed && objs.length) return objectClicked(pickObj(objs));
    // A bare click on a doorway walks it. Archways can stack two exits ('up' + 'out') on
    // one rect — take the first declared.
    if (exits.length && !asked) return go(exitDirOf(exits[0]));
    if (objs.length) return objectClicked(pickObj(objs));
  }
  // Smallest rect wins: room-filling scenery (WHITE-HOUSE, FOREST) is declared around the
  // props sitting on it, and the small rect is the thing the player aimed at. Later
  // declaration breaks ties, so props still beat same-size scenery.
  function pickObj(objs) {
    var best = objs[0], bestA = best.w * best.h;
    for (var i = 1; i < objs.length; i++) {
      var a = objs[i].w * objs[i].h;
      if (a <= bestA) { best = objs[i]; bestA = a; }
    }
    return best.obj || best.id;
  }

  function kbClick(x, y) {
    for (var i = 0; i < kbRects.length; i++) {
      if (!hit(kbRects[i], x, y)) continue;
      if (kbRects[i].word) { typed = kbRects[i].word; return; }   // fill, don't cast — let them see it
      return kbKey(kbRects[i].key);
    }
    if (!hit(KB, x, y)) closeKeyboard();
  }

  function savesClick(x, y) {
    for (var v = 0; v < volRects.length; v++) {
      if (hit(volRects[v], x, y)) { setAudioVolume(volRects[v].vol); return; }
    }
    for (var i = 0; i < saveRects.length; i++) {
      var r = saveRects[i];
      if (!hit(r, x, y)) continue;
      if (r.act === 'hints') { setHints(!hints); return; }
      if (r.act === 'mute')  { setAudioMuted(!audioMuted()); return; }
      if (r.act === 'close') { if (!reRaiseIfParked()) mode = 'play'; return; }
      if (r.act === 'save') { saveSlot(r.slot); refreshSlots(); return; }
      if (r.act === 'load') { if (loadSlot(r.slot)) mode = 'play'; else reRaiseIfParked(); return; }
    }
    if (!hit(SAVEUI, x, y) && !reRaiseIfParked()) mode = 'play';
  }

  // 'd' is up for grabs between WASD-east and the U/D vertical pair; the vertical pair wins
  // (a mis-stepped DOWN in the dark is the difference between a lamp and a grue), so east
  // lives on ArrowRight and 'e'. Diagonals are compass-pane clicks.
  var KEY_DIR = {
    ArrowUp: 'NORTH', ArrowDown: 'SOUTH', ArrowLeft: 'WEST', ArrowRight: 'EAST',
    w: 'NORTH', s: 'SOUTH', a: 'WEST', e: 'EAST',
    u: 'UP', d: 'DOWN', PageUp: 'UP', PageDown: 'DOWN'
  };

  function onKey(e) {
    firstGesture();
    if (mode === 'keys') {
      e.preventDefault();
      if (e.key === 'Escape') return closeKeyboard();
      if (e.key === 'Enter') return submitTyped();
      if (e.key === 'Backspace') return kbKey('\b');
      if (e.key.length === 1) return kbKey(e.key.toUpperCase());
      return;
    }
    if (mode === 'saves') { if (e.key === 'Escape' && !reRaiseIfParked()) mode = 'play'; return; }
    if (mode !== 'play') return;

    var k = e.key;
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.preventDefault(); advance(); return; }
    if (k === 't' || k === 'T' || k === '/') { e.preventDefault(); return openKeyboard(); }
    if (k === 'h' || k === 'H') { setHints(!hints); hint = 'HINTS ' + (hints ? 'ON' : 'OFF'); return; }
    if (k === 'Escape') { pendingObj = pendingVerb = null; hint = ''; asked = false; return; }
    if (k === 'i' || k === 'I') { e.preventDefault(); flush(); return send('inventory', 'LOOK'); }
    if (k === 'l' || k === 'L') { e.preventDefault(); flush(); return send('look', 'LOOK'); }

    var lower = k.length === 1 ? k.toLowerCase() : k;
    var dir = KEY_DIR[lower] || KEY_DIR[k];
    if (dir) {
      e.preventDefault();
      if (flush()) return;                                  // read the rest first, then move
      return go(dir);
    }
  }

  // Skip to the end of the pending prose; returns true if that consumed the keypress
  // (an end-of-game card must never be skipped past).
  function flush() {
    while (morePages()) page++;
    if (pendingEnd) { fireEnd(); return true; }
    return false;
  }

  // ---------------------------------------------------------------- exports (integration + tests)
  GUE.shell = {
    boot: boot,
    send: send,
    state: function () { return S; },
    mode: function () { return mode; },
    lastText: function () { return (pages[page] || []).join(' '); },
    zm: function () { return zm; },
    canvas: function () { return canvas; },
    setVerb: function (v) { if (VERB_LIST.indexOf(v) >= 0) { selectedVerb = v; lastHitObj = null; } },
    verbs: VERB_LIST,
    hoverInfo: function () { return hover ? { obj: hover.obj, label: hoverLabel(hover), mode: mode } : { obj: null, mode: mode }; },
    // live: the board is chosen at boot and can change on rotation, so this
    // must be read at access time, not captured when the module loads
    get layout() {
      return { STATUS: STATUS, SCENE: SCENE, COMPASS: COMPASS, VERBS: VERBS,
               TEXT: TEXT, INV: INV, W: W, H: H, portrait: PORTRAIT, sceneScale: SCENE_SCALE };
    },
    wrap: wrap,
    saveSlot: saveSlot,
    loadSlot: loadSlot,
    restart: fullRestart,
    speak: openKeyboard,
    blocked: function () { return blocked; },
    answerPrompt: answerPrompt
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
