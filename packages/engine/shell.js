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
