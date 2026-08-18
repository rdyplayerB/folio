//  The map editor.
//
//  Built because of a bug that survived every automated check: an adaptation of a
//  film wired its scene cuts as compass exits, and twenty-nine of its thirty rooms
//  ended up joined to somewhere on another continent. Walking out of a Humvee on a
//  road in Afghanistan put the player on the floor of a casino in Las Vegas. The
//  world was sound, every tier passed, and it made no sense to anybody inside it.
//
//  That defect is unreadable in JSON and unmissable in a picture, which is the
//  whole argument for a canvas. Two ideas carry it:
//
//    THE DIRECTION COMES FROM THE POSITIONS. You do not choose NORTH; you put one
//    room above another and joining them is northward. Drag it elsewhere and the
//    exits turn round to match. A map drawn this way cannot claim two places are
//    adjacent while showing them apart.
//
//    YOU DO NOT AUTHOR RULES, YOU PLACE PUZZLES. A rule shown as raw fields is
//    JSON with boxes round it, which is worse than JSON. But almost every rule in
//    a real game is one of about six shapes, and those shapes are already written
//    down. Say "a locked door, this door, that key" and the editor writes the
//    flag, the exit condition, the guarded rule and the failure branch, in the
//    order that keeps them all reachable.
//
//  And the real validator runs here — the same graph.js, replay.js and design.js
//  the command line runs, not a browser-shaped copy — so the badge in the corner
//  cannot drift from the verdict you get when you pack the game.

(function () {
  'use strict';

  var F = window.Folio;
  var K = window.GUE && window.GUE.kit;
  var cv = document.getElementById('map');
  var ctx = cv.getContext('2d');
  var VW = 1200, VH = 760;              // logical size; the canvas follows the box

  // ---------------------------------------------------------------- the world
  //  The world is what a .folio holds. The layout is where rooms sit on this
  //  canvas, which is the editor's business and travels in meta.editorLayout so a
  //  map reopens the way it was left.
  var world = blank();
  var layout = {};
  var selected = null;      // a room id
  var pickedItem = null;    // an item id, for editing its description
  var walkthrough = '';     // found by the solver, not written by hand

  function blank() {
    return { meta: { title: 'Untitled', start: null }, flags: {},
      rooms: [], items: [], rules: [] };
  }

  var OPPOSITE = { NORTH: 'SOUTH', SOUTH: 'NORTH', EAST: 'WEST', WEST: 'EAST',
    NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW', UP: 'DOWN', DOWN: 'UP', IN: 'OUT', OUT: 'IN' };

  // Eight compass points from the angle between two rooms. The geometry decides,
  // so the map and the exits agree by construction rather than by an author
  // remembering to keep them in step.
  function directionBetween(a, b) {
    var ang = Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI;
    if (ang < 0) ang += 360;
    return ['EAST', 'NE', 'NORTH', 'NW', 'WEST', 'SW', 'SOUTH', 'SE'][Math.round(ang / 45) % 8];
  }

  var ROOM_W = 118, ROOM_H = 54;

  function byId(id) {
    for (var i = 0; i < world.rooms.length; i++) if (world.rooms[i].id === id) return world.rooms[i];
    return null;
  }
  function itemById(id) {
    for (var i = 0; i < world.items.length; i++) if (world.items[i].id === id) return world.items[i];
    return null;
  }
  function itemsIn(roomId) {
    return world.items.filter(function (i) { return i.location === roomId; });
  }
  function roomAt(x, y) {
    for (var i = world.rooms.length - 1; i >= 0; i--) {
      var r = world.rooms[i], p = layout[r.id];
      if (!p) continue;
      if (x >= p.x - ROOM_W / 2 && x <= p.x + ROOM_W / 2 &&
          y >= p.y - ROOM_H / 2 && y <= p.y + ROOM_H / 2) return r;
    }
    return null;
  }

  // -------------------------------------------------------------- the palette
  var C = { ink: '#06091a', panel: '#121a3a', line: '#3b4472', gold: '#f2a71b',
    paper: '#e8e4da', dim: '#70707c', red: '#d8555a' };
  var REGION_COLOURS = ['#f2a71b', '#4fa3d1', '#92cc41', '#d8555a', '#b07cd6', '#e0a06a'];
  function regionList() {
    var seen = [];
    for (var i = 0; i < world.rooms.length; i++) {
      var r = world.rooms[i].region;
      if (r && seen.indexOf(r) < 0) seen.push(r);
    }
    return seen.sort();
  }
  function regionColour(name) {
    if (!name) return C.line;
    var i = regionList().indexOf(name);
    return i < 0 ? C.line : REGION_COLOURS[i % REGION_COLOURS.length];
  }

  // --------------------------------------------------------------- the canvas
  //  Sized to its box rather than to a constant, and redrawn at device
  //  resolution so the type stays sharp on a retina screen.
  function resize() {
    var box = cv.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    VW = Math.max(320, Math.round(box.width));
    VH = Math.max(280, Math.round(box.height));
    cv.width = VW * dpr;
    cv.height = VH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener('resize', resize);

  function draw() {
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, VW, VH);
    ctx.strokeStyle = 'rgba(59,68,114,.35)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx < VW; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx + .5, 0); ctx.lineTo(gx + .5, VH); ctx.stroke();
    }
    for (var gy = 0; gy < VH; gy += 40) {
      ctx.beginPath(); ctx.moveTo(0, gy + .5); ctx.lineTo(VW, gy + .5); ctx.stroke();
    }
    drawExits();
    if (dragLink) drawPendingLink();
    for (var i = 0; i < world.rooms.length; i++) drawRoom(world.rooms[i]);
  }

  function drawExits() {
    for (var i = 0; i < world.rooms.length; i++) {
      var r = world.rooms[i], a = layout[r.id];
      if (!a) continue;
      for (var j = 0; j < (r.exits || []).length; j++) {
        var ex = r.exits[j], b = layout[ex.to], to = byId(ex.to);
        if (!b) continue;
        // A line crossing a region is drawn as what it is: a claim the world does
        // not support. This is the picture of the bug that started all of it.
        var crossing = r.region && to && to.region && r.region !== to.region;
        var locked = !!ex.condition;

        ctx.strokeStyle = crossing ? C.red : locked ? C.gold : 'rgba(232,228,218,.5)';
        ctx.lineWidth = crossing ? 3 : 2;
        if (crossing) ctx.setLineDash([7, 5]);
        else if (locked) ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);

        var ang = Math.atan2(b.y - a.y, b.x - a.x);
        var tx = b.x - Math.cos(ang) * (ROOM_W / 2 + 4);
        var ty = b.y - Math.sin(ang) * (ROOM_H / 2 + 4);
        ctx.fillStyle = crossing ? C.red : locked ? C.gold : 'rgba(232,228,218,.6)';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - Math.cos(ang - .4) * 11, ty - Math.sin(ang - .4) * 11);
        ctx.lineTo(tx - Math.cos(ang + .4) * 11, ty - Math.sin(ang + .4) * 11);
        ctx.fill();

        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.font = '600 11px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = C.ink;
        ctx.fillRect(mx - 20, my - 8, 40, 15);
        ctx.fillStyle = crossing ? C.red : locked ? C.gold : C.dim;
        ctx.fillText(ex.dir + (locked ? '*' : ''), mx, my + 3);
      }
    }
  }

  function drawPendingLink() {
    var a = layout[dragLink.from];
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(dragLink.x, dragLink.y); ctx.stroke();
    ctx.setLineDash([]);
    var over = roomAt(dragLink.x, dragLink.y);
    if (over && over.id !== dragLink.from) {
      ctx.font = '700 12px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.gold;
      ctx.fillText(directionBetween(a, layout[over.id]),
        (a.x + layout[over.id].x) / 2, (a.y + layout[over.id].y) / 2 - 10);
    }
  }

  function drawRoom(r) {
    var p = layout[r.id];
    if (!p) return;
    var x = p.x - ROOM_W / 2, y = p.y - ROOM_H / 2;
    var isStart = world.meta.start === r.id;
    var accent = regionColour(r.region);

    ctx.fillStyle = C.panel;
    ctx.fillRect(x, y, ROOM_W, ROOM_H);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(x + 3, y + ROOM_H, ROOM_W, 3);
    ctx.lineWidth = selected === r.id ? 3 : 2;
    ctx.strokeStyle = selected === r.id ? C.gold : accent;
    ctx.strokeRect(x + .5, y + .5, ROOM_W - 1, ROOM_H - 1);
    if (r.region) { ctx.fillStyle = accent; ctx.fillRect(x, y, ROOM_W, 3); }
    if (r.dark) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x + 1, y + 4, ROOM_W - 2, ROOM_H - 5); }

    ctx.textAlign = 'center';
    ctx.font = '700 12px ui-monospace, Menlo, monospace';
    ctx.fillStyle = isStart ? C.gold : C.paper;
    ctx.fillText(clip(r.name || r.id, 15), p.x, p.y - 4);

    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = C.dim;
    var n = itemsIn(r.id).length;
    ctx.fillText(clip((isStart ? 'START  ' : '') + (n ? n + ' here' : ''), 20), p.x, p.y + 11);

    if (!r.prose) { ctx.fillStyle = C.gold; ctx.fillRect(x + ROOM_W - 9, y + ROOM_H - 9, 5, 5); }
  }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '.' : s; }

  // --------------------------------------------------------------- validating
  var badge = document.getElementById('badge');
  var findingsEl = document.getElementById('findings');

  function check() {
    if (!world.rooms.length) {
      badge.className = 'badge'; badge.textContent = 'empty';
      findingsEl.innerHTML = '<p class="pdim">Put a room down to begin.</p>';
      return;
    }
    var found = [];
    var shape = F.schema.validateWorld(stripLayout(world));
    if (!shape.ok) {
      for (var i = 0; i < shape.errors.length && i < 6; i++) {
        found.push({ level: 'error', code: 'E212',
          msg: shape.errors[i].path + ' ' + shape.errors[i].msg });
      }
    } else {
      var g = F.graph.analyse(stripLayout(world));
      for (var j = 0; j < g.findings.length; j++) found.push(g.findings[j]);
      if (!g.findings.some(function (f) { return f.level === 'error'; })) {
        var d = F.design.audit(stripLayout(world));
        for (var k = 0; k < d.findings.length; k++) {
          found.push({ level: 'note', code: d.findings[k].code, msg: d.findings[k].msg });
        }
      }
    }
    var errs = found.filter(function (f) { return f.level === 'error'; }).length;
    var warns = found.filter(function (f) { return f.level === 'warning'; }).length;
    badge.className = 'badge ' + (errs ? 'bad' : warns ? 'warn' : 'ok');
    badge.textContent = errs ? errs + (errs > 1 ? ' errors' : ' error')
      : warns ? warns + (warns > 1 ? ' warnings' : ' warning') : 'holds up';

    findingsEl.innerHTML = found.length
      ? found.slice(0, 12).map(function (f) {
          return '<div class="f ' + (f.level === 'error' ? 'err' : f.level === 'warning' ? 'warn' : '') +
            '"><code>' + esc(f.code || '') + '</code>' + esc(f.msg || f.message || '') + '</div>';
        }).join('')
      : '<p class="pdim">Nothing to report. The world holds together.</p>';
  }

  function stripLayout(w) {
    var c = JSON.parse(JSON.stringify(w));
    if (c.meta) { delete c.meta.editorLayout; delete c.meta.editorWalkthrough; }
    return c;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function slug(s, fallback) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback;
  }
  function freshId(base) {
    var id = base, n = 2;
    while (itemById(id) || byId(id)) { id = base + '-' + n; n++; }
    return id;
  }

  // ------------------------------------------------------------ the backdrops
  //  Drawn by the engine's own kit, from the same definitions `folio scenes`
  //  writes into a game. Picking one here and running the scaffold later cannot
  //  disagree, because there is one list.
  var BACKDROPS = (F.scenes && F.scenes.BACKDROPS) || [];
  var FALLBACK_NAME = 'plain';

  function backdropNames() {
    var names = BACKDROPS.map(function (b) { return b.name; });
    names.push(FALLBACK_NAME);
    return names;
  }
  function backdropBody(name) {
    for (var i = 0; i < BACKDROPS.length; i++) if (BACKDROPS[i].name === name) return BACKDROPS[i].body;
    return ['K.sky(ctx, t);', 'K.grass(ctx, 37, W);'];
  }
  // The bodies are source, because that is what gets written into a game's
  // scenes.js. Running them here means the preview is the thing itself rather
  // than an impression of it.
  var drawCache = {};
  function backdropDrawer(name) {
    if (!drawCache[name]) {
      try {
        drawCache[name] = new Function('ctx', 'K', 'W', 'H', 't',
          backdropBody(name).join('\n'));
      } catch (e) { drawCache[name] = function () {}; }
    }
    return drawCache[name];
  }

  function paintPreview(canvas, room) {
    if (!K) return;
    var c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    try { backdropDrawer(room.backdrop || guessBackdrop(room))(c, K, 144, 104, 0); }
    catch (e) { /* a broken backdrop should not take the panel down */ }
    // The things in the room, boxed exactly where the scaffold will put them.
    var things = itemsIn(room.id);
    var rects = (F.scenes && F.scenes.objectRects) ? F.scenes.objectRects(things) : [];
    for (var i = 0; i < rects.length; i++) {
      c.fillStyle = '#000';
      c.fillRect(rects[i].x, rects[i].y, rects[i].w, rects[i].h);
      c.strokeStyle = '#F8F8F8'; c.lineWidth = 1;
      c.strokeRect(rects[i].x + .5, rects[i].y + .5, rects[i].w - 1, rects[i].h - 1);
    }
    if (room.dark) { c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(0, 0, 144, 104); }
  }
  function guessBackdrop(room) {
    if (!F.scenes || !F.scenes.backdropFor) return FALLBACK_NAME;
    return F.scenes.backdropFor(room).name;
  }

  // ------------------------------------------------------------- the inspector
  var inspector = document.getElementById('inspector');

  function showInspector() {
    var r = selected && byId(selected);
    if (!r) {
      inspector.innerHTML = '<p class="ptitle">Nothing selected</p>' +
        '<p class="pdim">Click the canvas to put a room down, or click a room to edit it.</p>';
      return;
    }
    var html = '';

    // ---- the room -------------------------------------------------------
    html += '<div class="pane"><p class="ptitle">' + esc(r.id) + '</p>';
    html += fieldText('Name', 'name', r.name || '');
    html += '<div class="field"><label>Description</label><textarea data-k="prose">' +
      esc(r.prose || '') + '</textarea></div>';
    html += '<div class="field"><label>Region</label><input type="text" data-k="region" ' +
      'list="regions" value="' + esc(r.region || '') + '"><datalist id="regions">' +
      regionList().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') +
      '</datalist></div>';
    html += '<div class="field"><label class="check"><input type="checkbox" data-k="dark"' +
      (r.dark ? ' checked' : '') + '> Dark</label></div>';
    html += '<div class="field"><label class="check"><input type="checkbox" data-k="start"' +
      (world.meta.start === r.id ? ' checked' : '') + '> The game starts here</label></div>';
    if ((r.exits || []).length) {
      html += '<p class="ptitle" style="margin-top:14px">Ways out</p>';
      for (var i = 0; i < r.exits.length; i++) {
        var ex = r.exits[i], to = byId(ex.to);
        var cross = r.region && to && to.region && r.region !== to.region;
        html += '<div class="row"><b style="color:' + (cross ? C.red : C.gold) + '">' +
          esc(ex.dir) + '</b>' + esc(to ? (to.name || to.id) : ex.to) +
          (ex.condition ? ' <span class="tag on">locked</span>' : '') +
          (cross ? ' <span class="tag" style="border-color:' + C.red + ';color:' + C.red +
            '">crosses</span>' : '') +
          '<span class="x" data-delexit="' + i + '">remove</span></div>';
      }
    }
    html += '</div>';

    // ---- the picture ----------------------------------------------------
    html += '<div class="pane"><p class="ptitle">The picture</p>';
    html += '<canvas class="preview" id="prev" width="144" height="104"></canvas>';
    html += '<div class="field"><label>Backdrop</label><select data-k="backdrop">' +
      backdropNames().map(function (n) {
        var on = (r.backdrop || guessBackdrop(r)) === n;
        return '<option value="' + n + '"' + (on ? ' selected' : '') + '>' + n +
          (!r.backdrop && n === guessBackdrop(r) ? ' (guessed from the words)' : '') + '</option>';
      }).join('') + '</select></div>';
    html += '<p class="pdim">The boxes are where the things in this room will sit. ' +
      'Export the game and <b>folio scenes</b> writes this out as code you can draw over.</p>';
    html += '</div>';

    // ---- what is in it --------------------------------------------------
    var here = itemsIn(r.id);
    html += '<div class="pane"><p class="ptitle">What is in here</p>';
    if (!here.length) html += '<p class="pdim">Nothing yet.</p>';
    for (var j = 0; j < here.length; j++) {
      var it = here[j];
      html += '<div class="row">' +
        '<input class="rename" data-item="' + esc(it.id) + '" value="' + esc(it.name || it.id) + '">' +
        '<span class="tag' + (it.attributes && it.attributes.TAKEBIT ? ' on' : '') +
        '" data-take="' + esc(it.id) + '" title="Can the player pick it up?">take</span>' +
        '<span class="x" data-delitem="' + esc(it.id) + '">×</span></div>';
    }
    html += '<div class="minirow"><button class="mini" data-add="item">+ Something here</button>' +
      '<button class="mini" data-add="fixture">+ Scenery</button></div>';
    // What LOOK says about the thing the author last touched. Kept to one at a
    // time because a textarea per object turns a short list into a wall.
    var pi = pickedItem && itemById(pickedItem);
    if (pi && pi.location === r.id) {
      html += '<div class="field" style="margin-top:12px"><label>Looking at ' +
        esc(pi.name || pi.id) + '</label><textarea data-desc="' + esc(pi.id) + '">' +
        esc(pi.description || '') + '</textarea></div>';
    }
    html += '</div>';

    // ---- who is in it ---------------------------------------------------
    var who = (world.actors || []).filter(function (a) { return a.location === r.id; });
    html += '<div class="pane"><p class="ptitle">Who is here</p>';
    if (!who.length) html += '<p class="pdim">Nobody.</p>';
    for (var q = 0; q < who.length; q++) {
      var a = who[q];
      html += '<div class="row">' +
        '<input class="rename" data-actor="' + esc(a.id) + '" value="' + esc(a.name || a.id) + '">' +
        '<span class="tag' + (a.patrol ? ' on' : '') + '" data-walk="' + esc(a.id) +
        '" title="Does it move about?">walks</span>' +
        '<span class="tag' + (a.takes ? ' on' : '') + '" data-rob="' + esc(a.id) +
        '" title="Does it take your things?">robs</span>' +
        '<span class="x" data-delactor="' + esc(a.id) + '">×</span></div>';
      if (a.patrol && a.patrol.rooms) {
        html += '<div class="row" style="border:0;padding-top:2px"><span class="pdim" ' +
          'style="font-size:11px">route: ' +
          esc(a.patrol.rooms.map(function (id) {
            var rr = byId(id); return rr ? (rr.name || id) : id;
          }).join(' → ')) + '</span></div>';
      }
    }
    html += '<div class="minirow"><button class="mini" data-add="actor">+ Somebody</button>' +
      '<button class="mini" data-pz="haunt">Kills you unless…</button></div>';
    html += '</div>';

    // ---- puzzles --------------------------------------------------------
    //  Patterns, not fields. Each writes several pieces at once, in the order
    //  that keeps them reachable, which is the part that is easy to get wrong by
    //  hand and impossible to get wrong from a template.
    html += '<div class="pane"><p class="ptitle">Puzzles here</p>';
    var mine = rulesFor(r.id);
    if (!mine.length) html += '<p class="pdim">Nothing happens in this room yet.</p>';
    for (var m = 0; m < mine.length; m++) {
      html += '<div class="row"><b style="color:' + C.gold + '">' + esc(mine[m].label) + '</b>' +
        esc(mine[m].detail) + '<span class="x" data-delrule="' + mine[m].index + '">×</span></div>';
    }
    html += '<div class="minirow">' +
      '<button class="mini" data-pz="lock">Locked way</button>' +
      '<button class="mini" data-pz="reward">Worth points</button>' +
      '<button class="mini" data-pz="win">The ending</button>' +
      '<button class="mini" data-pz="hazard">Something fatal</button>' +
      '</div></div>';

    inspector.innerHTML = html;
    var prev = document.getElementById('prev');
    if (prev) paintPreview(prev, r);
    wire(r);
  }

  function fieldText(label, key, value) {
    return '<div class="field"><label>' + label + '</label>' +
      '<input type="text" data-k="' + key + '" value="' + esc(value) + '"></div>';
  }

  /** The rules that belong to this room, described rather than dumped. */
  function rulesFor(roomId) {
    var out = [];
    var here = itemsIn(roomId).map(function (i) { return i.id; });
    for (var i = 0; i < world.rules.length; i++) {
      var on = world.rules[i].on || {};
      var mine = on.room === roomId || on.enter === roomId ||
        (on.noun && here.indexOf(on.noun) >= 0);
      if (!mine) continue;
      var effects = (world.rules[i].do || []).map(function (e) { return e.type; });
      out.push({
        index: i,
        label: on.enter ? 'ON ENTRY' : ((on.verb || 'ANY') + (on.noun ? ' ' + on.noun : '')),
        detail: effects.indexOf('win') >= 0 ? 'wins the game'
          : effects.indexOf('lose') >= 0 ? 'kills the player'
          : effects.indexOf('set-flag') >= 0 ? 'opens something'
          : effects.indexOf('score') >= 0 ? 'scores' : 'says something'
      });
    }
    return out;
  }

  function wire(r) {
    inspector.querySelectorAll('[data-k]').forEach(function (el) {
      var ev = el.type === 'checkbox' ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
      el.addEventListener(ev, function () {
        var k = el.getAttribute('data-k'), room = byId(selected);
        if (!room) return;
        if (k === 'start') world.meta.start = el.checked ? room.id : null;
        else if (k === 'dark') { if (el.checked) room.dark = true; else delete room.dark; }
        else if (el.value) room[k] = el.value;
        else delete room[k];
        if (k === 'backdrop' || k === 'dark') {
          var pv = document.getElementById('prev');
          if (pv) paintPreview(pv, room);
        }
        draw(); check();
      });
    });
    inspector.querySelectorAll('[data-delexit]').forEach(function (el) {
      el.addEventListener('click', function () {
        byId(selected).exits.splice(Number(el.getAttribute('data-delexit')), 1);
        redraw();
      });
    });
    inspector.querySelectorAll('[data-add]').forEach(function (el) {
      el.addEventListener('click', function () {
        var kind = el.getAttribute('data-add');
        if (kind === 'actor') addActor(selected);
        else addItem(selected, kind === 'item');
      });
    });
    inspector.querySelectorAll('.rename').forEach(function (el) {
      var isActor = el.hasAttribute('data-actor');
      el.addEventListener('change', function () {
        var thing = isActor ? actorById(el.getAttribute('data-actor'))
          : itemById(el.getAttribute('data-item'));
        if (thing) { thing.name = el.value; redraw(); }
      });
      if (!isActor) {
        el.addEventListener('focus', function () {
          pickedItem = el.getAttribute('data-item'); showInspector();
        });
      }
    });
    inspector.querySelectorAll('[data-desc]').forEach(function (el) {
      el.addEventListener('input', function () {
        var it = itemById(el.getAttribute('data-desc'));
        if (!it) return;
        if (el.value) it.description = el.value; else delete it.description;
        check();
      });
    });
    inspector.querySelectorAll('[data-walk]').forEach(function (el) {
      el.addEventListener('click', function () { toggleWalk(el.getAttribute('data-walk')); });
    });
    inspector.querySelectorAll('[data-rob]').forEach(function (el) {
      el.addEventListener('click', function () { toggleRob(el.getAttribute('data-rob')); });
    });
    inspector.querySelectorAll('[data-delactor]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-delactor');
        world.actors = (world.actors || []).filter(function (a) { return a.id !== id; });
        world.rules = world.rules.filter(function (ru) { return (ru.on || {}).meets !== id; });
        redraw();
      });
    });
    inspector.querySelectorAll('[data-take]').forEach(function (el) {
      el.addEventListener('click', function () {
        var it = itemById(el.getAttribute('data-take'));
        it.attributes = it.attributes || {};
        if (it.attributes.TAKEBIT) delete it.attributes.TAKEBIT; else it.attributes.TAKEBIT = true;
        redraw();
      });
    });
    inspector.querySelectorAll('[data-delitem]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-delitem');
        world.items = world.items.filter(function (i) { return i.id !== id; });
        world.rules = world.rules.filter(function (ru) {
          var on = ru.on || {};
          return on.noun !== id && on.second !== id;
        });
        redraw();
      });
    });
    inspector.querySelectorAll('[data-delrule]').forEach(function (el) {
      el.addEventListener('click', function () {
        world.rules.splice(Number(el.getAttribute('data-delrule')), 1);
        redraw();
      });
    });
    inspector.querySelectorAll('[data-pz]').forEach(function (el) {
      el.addEventListener('click', function () { puzzle(el.getAttribute('data-pz'), r.id); });
    });
  }

  function redraw() { draw(); check(); showInspector(); }

  function actorById(id) {
    for (var i = 0; i < (world.actors || []).length; i++) {
      if (world.actors[i].id === id) return world.actors[i];
    }
    return null;
  }

  function addActor(roomId) {
    world.actors = world.actors || [];
    var id = freshId('SOMEBODY');
    world.actors.push({ id: id, name: 'somebody', location: roomId, attributes: {} });
    redraw();
  }

  //  A patrol is a route walked in order, so the default is this room and its
  //  neighbours: a character who paces the ground around where you found them
  //  reads as a person, and one who teleports across the map reads as a bug.
  function toggleWalk(id) {
    var a = actorById(id);
    if (!a) return;
    if (a.patrol) { delete a.patrol; return redraw(); }
    var home = byId(a.location);
    var route = [a.location];
    for (var i = 0; i < ((home && home.exits) || []).length && route.length < 4; i++) {
      if (route.indexOf(home.exits[i].to) < 0) route.push(home.exits[i].to);
    }
    a.patrol = { rooms: route, every: 2, chance: 70,
      arrives: 'The ' + (a.name || 'figure') + ' comes in.',
      leaves: 'The ' + (a.name || 'figure') + ' goes.' };
    redraw();
  }

  //  Loot goes to the room the character started in, which is the difference
  //  between a thief and a dead end: somewhere the player can follow. Sending it
  //  nowhere is what W513 reports, so the editor does not do it by default.
  function toggleRob(id) {
    var a = actorById(id);
    if (!a) return;
    if (a.takes) { delete a.takes; return redraw(); }
    a.takes = { to: a.location, chance: 40,
      says: 'The ' + (a.name || 'figure') + ' takes something of yours and is gone with it.' };
    redraw();
  }

  function addItem(roomId, takeable) {
    var n = itemsIn(roomId).length + 1;
    var id = freshId(slug('thing ' + n, 'THING'));
    var it = { id: id, name: takeable ? 'a thing' : 'some scenery', location: roomId,
      attributes: takeable ? { TAKEBIT: true } : {} };
    world.items.push(it);
    redraw();
  }

  // ------------------------------------------------------------- the patterns
  //  Each of these writes every piece of a puzzle at once. A locked way is not
  //  one rule: it is a flag, a condition on the exit, the rule that satisfies it,
  //  and the rule that answers when you try without the key. Hand-written, the
  //  last of those is the one people leave out, and the first two are the ones
  //  people put in the wrong order.
  //  Takes an id, never a room object. An earlier signature took the room, and a
  //  caller holding a copy of the world could add the rules and the key while the
  //  lock on the exit went to the clone and vanished. Looking the room up here
  //  means there is only ever one of it.
  function puzzle(kind, roomOrId) {
    var room = typeof roomOrId === 'string' ? byId(roomOrId)
      : byId(roomOrId && roomOrId.id);
    if (!room) return;
    if (kind === 'lock') return lockedWay(room);
    if (kind === 'reward') return reward(room);
    if (kind === 'win') return ending(room);
    if (kind === 'hazard') return hazard(room);
    if (kind === 'haunt') return haunting(room);
  }

  //  The Uninvited shape: something that kills you unless you are carrying the
  //  thing that wards it off. One rule, but it needs the character to exist and
  //  to be somewhere the player will meet it, which is the part that is easy to
  //  get half-right by hand.
  function haunting(room) {
    var here = (world.actors || []).filter(function (a) { return a.location === room.id; })
      .map(function (a) { return { label: a.name || a.id, value: a.id }; });
    here.push({ label: '— make something new to haunt this room —', value: '__new' });
    var who = pick('What haunts this room?', here);
    if (!who) return;
    if (who === '__new') {
      who = freshId('WRAITH');
      world.actors = world.actors || [];
      world.actors.push({ id: who, name: 'a cold shape', location: room.id, hostile: true,
        patrol: { rooms: [room.id], every: 1,
          arrives: 'Something is here that was not here before.' } });
    }
    var wards = world.items.filter(function (i) { return i.attributes && i.attributes.TAKEBIT; })
      .map(function (i) {
        var w = byId(i.location);
        return { label: (i.name || i.id) + (w ? '  (in ' + (w.name || w.id) + ')' : ''), value: i.id };
      });
    wards.unshift({ label: 'nothing — it always kills', value: '__always' });
    var ward = pick('What keeps it off?', wards);
    if (!ward) return;

    var rule = { on: { meets: who },
      do: [{ type: 'lose', pages: ['It reaches you.', 'And that is all.'] }] };
    if (ward !== '__always') {
      rule.if = [{ type: 'not', condition: { type: 'carrying', item: ward } }];
    }
    world.rules.unshift(rule);
    redraw();
  }

  function pick(label, options) {
    if (!options.length) { alert(label + ': nothing to choose from yet.'); return null; }
    var list = options.map(function (o, i) { return '  ' + (i + 1) + '. ' + o.label; }).join('\n');
    var n = window.prompt(label + '\n' + list, '1');
    if (n === null) return null;
    var i = parseInt(n, 10) - 1;
    return options[i] ? options[i].value : null;
  }

  function lockedWay(room) {
    var exits = (room.exits || []).filter(function (e) { return !e.condition; })
      .map(function (e, i) {
        var to = byId(e.to);
        return { label: e.dir + ' to ' + (to ? (to.name || to.id) : e.to), value: e };
      });
    var ex = pick('Which way is locked?', exits);
    if (!ex) return;

    //  Never offer a key that sits behind the door it opens. The editor did, once,
    //  and the world it produced was circular: the way to the crypt needed the
    //  thing in the crypt. The validator caught it immediately, which is the
    //  system working, but a tool that offers you the wrong answer and then tells
    //  you off for taking it is not much of a tool.
    var keys = world.items.filter(function (i) {
      if (!(i.attributes && i.attributes.TAKEBIT)) return false;
      return i.location !== ex.to;
    }).map(function (i) {
      var where = byId(i.location);
      return { label: (i.name || i.id) + (where ? '  (in ' + (where.name || where.id) + ')' : ''),
        value: i.id };
    });
    keys.push({ label: '— make a new key, here —', value: '__new' });
    var keyId = pick('What opens it?', keys);
    if (!keyId) return;
    if (keyId === '__new') {
      keyId = freshId('KEY');
      world.items.push({ id: keyId, name: 'a key', location: room.id,
        attributes: { TAKEBIT: true } });
    }

    // The door has to be a thing you can point at, or there is nothing to use
    // the key on.
    var doorId = freshId(slug(ex.dir + ' door', 'DOOR'));
    world.items.push({ id: doorId, name: 'the ' + ex.dir.toLowerCase() + ' door',
      location: room.id, attributes: {} });

    var flag = 'open' + doorId.replace(/-/g, '');
    world.flags = world.flags || {};
    world.flags[flag] = false;
    ex.condition = { type: 'flag', flag: flag };
    ex.blocked = 'It will not open.';

    // Specific first, general second. The other order is W511, and it is the
    // commonest way a written scene never plays.
    world.rules.unshift({
      on: { verb: 'USE', noun: doorId, second: keyId },
      if: [{ type: 'carrying', item: keyId }],
      do: [{ type: 'print', text: 'It opens.' },
           { type: 'set-flag', flag: flag, value: true }]
    });
    world.rules.splice(1, 0, {
      on: { verb: 'USE', noun: doorId },
      do: [{ type: 'print', text: 'It is locked, and you have nothing to turn.' }]
    });
    redraw();
  }

  function reward(room) {
    var here = itemsIn(room.id).map(function (i) { return { label: i.name || i.id, value: i.id }; });
    var id = pick('What is worth points?', here);
    if (!id) return;
    var it = itemById(id);
    it.attributes = it.attributes || {}; it.attributes.TAKEBIT = true;
    world.rules.unshift({
      on: { verb: 'TAKE', noun: id },
      if: [{ type: 'in-room', item: id }],
      do: [{ type: 'take', item: id },
           { type: 'print', text: 'Yours now.' },
           { type: 'score', value: 10 }]
    });
    redraw();
  }

  function ending(room) {
    var here = itemsIn(room.id).map(function (i) { return { label: i.name || i.id, value: i.id }; });
    here.push({ label: '— make a new thing to finish on —', value: '__new' });
    var id = pick('What ends the game?', here);
    if (!id) return;
    if (id === '__new') {
      id = freshId('PRIZE');
      world.items.push({ id: id, name: 'the prize', location: room.id,
        attributes: { TAKEBIT: true } });
    }
    world.rules.unshift({
      on: { verb: 'TAKE', noun: id },
      if: [{ type: 'in-room', item: id }],
      do: [{ type: 'take', item: id },
           { type: 'score', value: 20 },
           { type: 'print', text: 'You have it.' },
           { type: 'win', pages: ['You have it.', 'And that is the end of it.'] }]
    });
    redraw();
  }

  function hazard(room) {
    var guards = world.items.filter(function (i) { return i.attributes && i.attributes.TAKEBIT; })
      .map(function (i) { return { label: 'unless carrying ' + (i.name || i.id), value: i.id }; });
    guards.unshift({ label: 'always, on entering', value: '__always' });
    var guard = pick('What kills the player here?', guards);
    if (!guard) return;
    var rule = { on: { enter: room.id },
      do: [{ type: 'lose', pages: ['It goes badly.', 'You do not get up.'] }] };
    if (guard !== '__always') {
      rule.if = [{ type: 'not', condition: { type: 'carrying', item: guard } }];
    }
    world.rules.unshift(rule);
    redraw();
  }

  // -------------------------------------------------------------- interaction
  var drag = null, dragLink = null, downAt = null;

  function toCanvas(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * VW / r.width, y: (e.clientY - r.top) * VH / r.height };
  }

  cv.addEventListener('mousedown', function (e) {
    var p = toCanvas(e), r = roomAt(p.x, p.y);
    downAt = p;
    if (!r) return;
    selected = r.id;
    showInspector();
    if (e.shiftKey) dragLink = { from: r.id, x: p.x, y: p.y };
    else drag = { id: r.id, dx: p.x - layout[r.id].x, dy: p.y - layout[r.id].y };
    draw();
  });

  cv.addEventListener('mousemove', function (e) {
    var p = toCanvas(e);
    if (drag) { layout[drag.id] = { x: p.x - drag.dx, y: p.y - drag.dy }; draw(); }
    else if (dragLink) { dragLink.x = p.x; dragLink.y = p.y; draw(); }
    cv.style.cursor = roomAt(p.x, p.y) ? 'move' : 'crosshair';
  });

  window.addEventListener('mouseup', function (e) {
    var p = toCanvas(e);
    if (dragLink) {
      var t = roomAt(p.x, p.y);
      if (t && t.id !== dragLink.from) join(dragLink.from, t.id);
      dragLink = null; redraw(); return;
    }
    if (drag) { relabel(); drag = null; redraw(); return; }
    if (downAt && Math.abs(downAt.x - p.x) < 4 && Math.abs(downAt.y - p.y) < 4 &&
        !roomAt(p.x, p.y) && p.x > 0 && p.y > 0 && p.x < VW && p.y < VH) addRoom(p.x, p.y);
    downAt = null;
  });

  function join(fromId, toId) {
    var dir = directionBetween(layout[fromId], layout[toId]);
    var from = byId(fromId), to = byId(toId);
    from.exits = from.exits || [];
    for (var i = 0; i < from.exits.length; i++) if (from.exits[i].to === toId) return;
    from.exits.push({ dir: dir, to: toId });
    to.exits = to.exits || [];
    for (var j = 0; j < to.exits.length; j++) if (to.exits[j].to === fromId) return;
    to.exits.push({ dir: OPPOSITE[dir], to: fromId });
  }

  //  Directions follow the geometry, always. Drag a room past another and the
  //  exits between them turn round, instead of quietly going on claiming the old
  //  arrangement. UP, DOWN, IN and OUT are left alone: those are not compass
  //  claims and an author who chose one meant it.
  function relabel() {
    for (var i = 0; i < world.rooms.length; i++) {
      var r = world.rooms[i], a = layout[r.id];
      if (!a) continue;
      for (var j = 0; j < (r.exits || []).length; j++) {
        var b = layout[r.exits[j].to];
        if (!b || ['UP', 'DOWN', 'IN', 'OUT'].indexOf(r.exits[j].dir) >= 0) continue;
        r.exits[j].dir = directionBetween(a, b);
      }
    }
  }

  function addRoom(x, y) {
    var n = world.rooms.length + 1, id = 'ROOM-' + n;
    while (byId(id)) { n++; id = 'ROOM-' + n; }
    world.rooms.push({ id: id, name: 'Room ' + n, prose: '', exits: [] });
    layout[id] = { x: x, y: y };
    if (!world.meta.start) world.meta.start = id;
    selected = id;
    redraw();
  }

  // ------------------------------------------------------------------ toolbar
  document.getElementById('addRoom').addEventListener('click', function () {
    addRoom(140 + (world.rooms.length % 8) * 130, 100 + Math.floor(world.rooms.length / 8) * 110);
  });
  document.getElementById('delRoom').addEventListener('click', function () {
    if (!selected) return;
    var gone = selected;
    world.rooms = world.rooms.filter(function (r) { return r.id !== gone; });
    world.items = world.items.filter(function (i) { return i.location !== gone; });
    for (var i = 0; i < world.rooms.length; i++) {
      world.rooms[i].exits = (world.rooms[i].exits || [])
        .filter(function (e) { return e.to !== gone; });
    }
    delete layout[gone];
    if (world.meta.start === gone) world.meta.start = world.rooms.length ? world.rooms[0].id : null;
    selected = null;
    redraw();
  });
  //  The walkthrough is found, not written.
  //
  //  A game cannot reach "playable" without one, and writing it by hand in a
  //  visual editor would be typing commands into a box, which is the thing this
  //  is meant to replace. The blind solver already plays a game with the
  //  walkthrough withheld, so if it can win, the route it took IS a walkthrough —
  //  and one that provably starts cold, which is what T3 requires.
  document.getElementById('findWalk').addEventListener('click', function () {
    var btn = this;
    btn.textContent = 'Looking...';
    btn.disabled = true;
    setTimeout(function () {
      var out;
      try { out = F.solve.solve(stripLayout(world), { maxMs: 8000 }); }
      catch (e) { out = { solvedBlind: false, error: e.message }; }
      btn.disabled = false;
      btn.textContent = 'Find the walkthrough';
      if (out.solvedBlind) {
        walkthrough = out.path.map(function (p) { return p.command.toLowerCase(); }).join('\n');
        findingsEl.innerHTML =
          '<div class="f"><code>FOUND</code>A route in ' + out.solutionMoves +
          ' moves, without being told how. ' + out.forcedFraction +
          '% of the steps had exactly one thing that worked' +
          (out.forcedFraction >= 60 ? ', which is a corridor.' : '.') + '</div>' +
          '<div class="f"><code>ROUTE</code>' + esc(walkthrough.replace(/\n/g, ' → ')) + '</div>';
      } else {
        findingsEl.innerHTML = '<div class="f warn"><code>NOT FOUND</code>' +
          'No route to an ending inside eight seconds. Either the game cannot be ' +
          'finished, or it is big enough to need the command line: ' +
          '<b>folio solve</b> takes a bigger budget.</div>';
      }
    }, 30);
  });

  //  A real game out, not a fragment. Everything a .folio needs, packed here so
  //  the thing you made is a thing you can play and give away.
  document.getElementById('exportFolio').addEventListener('click', function () {
    var w = stripLayout(world);
    if (!walkthrough) {
      findingsEl.innerHTML = '<div class="f warn"><code>NO WALKTHROUGH</code>' +
        'A .folio carries the proof it can be finished. Press <b>Find the ' +
        'walkthrough</b> first.</div>';
      return;
    }
    var id = slug(w.meta.title || 'my-game', 'my-game').toLowerCase();
    var files = {
      'manifest.json': JSON.stringify({
        id: id,
        title: w.meta.title || 'Untitled',
        author: w.meta.author || 'Unknown',
        folioVersion: '0.1.0',
        logicType: 'world',
        license: 'unknown',
        contentRating: 'all-ages',
        aiDisclosure: { prose: 'unknown', art: 'none', note: 'Made in the Folio map editor.' }
      }, null, 2),
      'walkthrough.folioscript': '# Found by the blind solver, so it starts cold.\n' + walkthrough + '\n',
      'logic/world.json': JSON.stringify(w, null, 2),
      'presentation/scenes.js': F.scenes.scaffold(w).source
    };
    // checksums.json is what makes a .folio refuse to load if it has been
    // tampered with, so it is written here rather than left to the CLI.
    var enc = new TextEncoder();
    var sums = {};
    var names = Object.keys(files).sort();
    Promise.all(names.map(function (n) {
      return crypto.subtle.digest('SHA-256', enc.encode(files[n]))
        .then(function (buf) {
          sums[n] = [...new Uint8Array(buf)]
            .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        });
    })).then(function () {
      files['checksums.json'] = JSON.stringify(sums, null, 2);
      var bytes = zipWrite(files);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      a.download = id + '.folio';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      findingsEl.innerHTML = '<div class="f"><code>PACKED</code>' + esc(id) +
        '.folio, ' + Math.round(bytes.length / 1024) + 'KB. Drop it on the player, ' +
        'or run <b>folio validate</b> on it.</div>';
    });
  });

  document.getElementById('exportWorld').addEventListener('click', function () {
    var out = stripLayout(world);
    out.meta.editorLayout = layout;
    if (walkthrough) out.meta.editorWalkthrough = walkthrough;
    download(JSON.stringify(out, null, 2), 'world.json', 'application/json');
  });
  document.getElementById('openFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    file.arrayBuffer()
      .then(function (b) { return window.FolioZip.readFolio(new Uint8Array(b)); })
      .then(function (files) { adopt(JSON.parse(new TextDecoder().decode(files['logic/world.json']))); })
      .catch(function (err) {
        findingsEl.innerHTML = '<div class="f err"><code>OPEN</code>' + esc(err.message) + '</div>';
      });
  });
  document.getElementById('sample').addEventListener('click', function () {
    fetch('/games/cellar-door.folio').then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return window.FolioZip.readFolio(new Uint8Array(b)); })
      .then(function (files) { adopt(JSON.parse(new TextDecoder().decode(files['logic/world.json']))); })
      .catch(function () { adopt(example()); });
  });

  function adopt(w) {
    world = w;
    world.items = world.items || [];
    world.rules = world.rules || [];
    world.flags = world.flags || {};
    layout = (w.meta && w.meta.editorLayout) || autoLayout(w);
    walkthrough = (w.meta && w.meta.editorWalkthrough) || '';
    if (w.meta) { delete w.meta.editorLayout; delete w.meta.editorWalkthrough; }
    selected = null;
    redraw();
  }

  //  A world that has never been laid out gets a map by walking outward from the
  //  start room, putting each room where its exit claims it is. A game written
  //  entirely as JSON can then be understood at a glance, and anything impossible
  //  about it is visible immediately.
  function autoLayout(w) {
    var pos = {}, step = 150;
    var VEC = { NORTH: [0, -1], SOUTH: [0, 1], EAST: [1, 0], WEST: [-1, 0],
      NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
      UP: [1, -1], DOWN: [-1, 1], IN: [1, 0], OUT: [-1, 0] };
    var start = (w.meta && w.meta.start) || (w.rooms[0] && w.rooms[0].id);
    if (!start) return {};
    pos[start] = { x: VW / 2, y: VH / 2 };
    var queue = [start], guard = 0;
    while (queue.length && guard++ < 600) {
      var id = queue.shift(), room = null;
      for (var i = 0; i < w.rooms.length; i++) if (w.rooms[i].id === id) room = w.rooms[i];
      if (!room) continue;
      for (var j = 0; j < (room.exits || []).length; j++) {
        var ex = room.exits[j];
        if (pos[ex.to]) continue;
        var v = VEC[ex.dir] || [1, 0];
        var p = { x: pos[id].x + v[0] * step, y: pos[id].y + v[1] * step };
        var spin = 0;
        while (occupied(pos, p) && spin++ < 40) { p.x += 34; p.y += 26; }
        pos[ex.to] = p;
        queue.push(ex.to);
      }
    }
    var loose = 0;
    for (var k = 0; k < w.rooms.length; k++) {
      if (pos[w.rooms[k].id]) continue;
      pos[w.rooms[k].id] = { x: 100 + (loose % 7) * 145, y: VH - 70 - Math.floor(loose / 7) * 80 };
      loose++;
    }
    return fit(pos);
  }
  function occupied(pos, p) {
    for (var k in pos) {
      if (Math.abs(pos[k].x - p.x) < ROOM_W + 14 && Math.abs(pos[k].y - p.y) < ROOM_H + 16) return true;
    }
    return false;
  }
  function fit(pos) {
    var xs = [], ys = [];
    for (var k in pos) { xs.push(pos[k].x); ys.push(pos[k].y); }
    if (!xs.length) return pos;
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var pad = 78;
    var s = Math.min(1, (VW - pad * 2) / Math.max(1, maxX - minX),
      (VH - pad * 2) / Math.max(1, maxY - minY));
    for (var id in pos) {
      pos[id] = { x: pad + (pos[id].x - minX) * s, y: pad + (pos[id].y - minY) * s };
    }
    return pos;
  }

  function example() {
    return { meta: { title: 'A start', start: 'PORCH' }, flags: {},
      rooms: [
        { id: 'PORCH', name: 'The Porch', region: 'house',
          prose: 'Paint curls off the boards.', exits: [{ dir: 'NORTH', to: 'HALL' }] },
        { id: 'HALL', name: 'The Hall', region: 'house',
          prose: 'A narrow hall.', exits: [{ dir: 'SOUTH', to: 'PORCH' }] }
      ], items: [], rules: [] };
  }

  //  A .folio is a zip, and the node writer deflates with zlib, which a page does
  //  not have. Everything here is stored instead of deflated: a stored zip is a
  //  perfectly ordinary zip, the reader already handles it, and a world file is a
  //  few kilobytes of JSON that nobody needs compressed.
  var CRC = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return function (bytes) {
      var c = -1;
      for (var i = 0; i < bytes.length; i++) c = (c >>> 8) ^ t[(c ^ bytes[i]) & 0xFF];
      return (c ^ -1) >>> 0;
    };
  })();

  function zipWrite(files) {
    var enc = new TextEncoder();
    var names = Object.keys(files).sort();     // sorted, so rebuilds are identical
    var chunks = [], central = [], offset = 0;
    for (var i = 0; i < names.length; i++) {
      var nameBytes = enc.encode(names[i]);
      var body = enc.encode(files[names[i]]);
      var crc = CRC(body);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(8, 0, true);             // stored
      local.setUint16(12, 0x21, true);         // fixed date, for reproducibility
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, body.length, true);
      local.setUint16(26, nameBytes.length, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, body);

      var cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(14, 0x21, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, body.length, true);
      cen.setUint32(24, body.length, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);
      offset += 30 + nameBytes.length + body.length;
    }
    var centralSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, names.length, true);
    end.setUint16(10, names.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    var all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    var total = all.reduce(function (n, c) { return n + c.length; }, 0);
    var out = new Uint8Array(total), at = 0;
    for (var j = 0; j < all.length; j++) { out.set(all[j], at); at += all[j].length; }
    return out;
  }

  function download(text, name, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------------------------------------------------------------- and go
  resize();
  check();
  showInspector();

  window.FolioEditor = {
    world: function () { return stripLayout(world); },
    layout: function () { return layout; },
    load: adopt, addRoom: addRoom, join: join,
    addItem: addItem, puzzle: puzzle,
    select: function (id) { selected = id; showInspector(); draw(); },
    badge: function () { return badge.textContent; }
  };
})();
