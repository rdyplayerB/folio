//  The map editor.
//
//  Built because of a bug that survived every automated check: an adaptation of a
//  film wired its scene cuts as compass exits, and twenty-nine of its thirty rooms
//  ended up joined to somewhere on another continent. Walking out of a Humvee on a
//  road in Afghanistan put the player on the floor of a casino in Las Vegas. The
//  world was sound, every tier passed, and it made no sense to anybody inside it.
//
//  That defect is invisible in JSON and impossible to miss in a picture. So:
//
//    THE DIRECTION COMES FROM THE POSITIONS. You do not choose NORTH; you put one
//    room above another and joining them is northward. A map drawn this way cannot
//    claim two places are adjacent while showing them apart, which is exactly the
//    lie the format used to permit.
//
//  The other half is that the real validator runs here — the same graph.js,
//  replay.js and design.js the command line runs, not a browser-shaped copy — so
//  the badge in the corner cannot drift from the verdict you get when you pack.

(function () {
  'use strict';

  var F = window.Folio;
  var cv = document.getElementById('map');
  var ctx = cv.getContext('2d');

  // ---------------------------------------------------------------- the world
  //  Two things are kept side by side: the world, which is what a .folio holds,
  //  and the layout, which is where the rooms sit on this canvas. Layout is
  //  editor state and rides along in meta.editorLayout so a map can be reopened
  //  looking the way it was left.
  var world = blank();
  var layout = {};
  var selected = null;

  function blank() {
    return {
      meta: { title: 'Untitled', start: null },
      flags: {}, rooms: [], items: [], rules: []
    };
  }

  var DIRS = ['NORTH', 'NE', 'EAST', 'SE', 'SOUTH', 'SW', 'WEST', 'NW'];
  var OPPOSITE = { NORTH: 'SOUTH', SOUTH: 'NORTH', EAST: 'WEST', WEST: 'EAST',
    NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW', UP: 'DOWN', DOWN: 'UP', IN: 'OUT', OUT: 'IN' };

  // Eight compass points, chosen by the angle between two rooms. This is the
  // whole idea: the geometry decides, so the map and the exits agree by
  // construction rather than by an author remembering to keep them in step.
  function directionBetween(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var ang = Math.atan2(-dy, dx) * 180 / Math.PI;      // 0 east, 90 north
    if (ang < 0) ang += 360;
    var i = Math.round(ang / 45) % 8;
    return ['EAST', 'NE', 'NORTH', 'NW', 'WEST', 'SW', 'SOUTH', 'SE'][i];
  }

  var ROOM_W = 118, ROOM_H = 54;

  function roomAt(x, y) {
    for (var i = world.rooms.length - 1; i >= 0; i--) {
      var r = world.rooms[i], p = layout[r.id];
      if (!p) continue;
      if (x >= p.x - ROOM_W / 2 && x <= p.x + ROOM_W / 2 &&
          y >= p.y - ROOM_H / 2 && y <= p.y + ROOM_H / 2) return r;
    }
    return null;
  }
  var byId = function (id) {
    for (var i = 0; i < world.rooms.length; i++) if (world.rooms[i].id === id) return world.rooms[i];
    return null;
  };

  // -------------------------------------------------------------- the palette
  //  The site's colours, so the tool and the games it makes look related.
  var C = {
    ink: '#06091a', panel: '#121a3a', line: '#3b4472',
    gold: '#f2a71b', pale: '#e9c874', paper: '#e8e4da',
    dim: '#70707c', green: '#92cc41', red: '#d8555a'
  };
  // Regions are coloured so that a crossing is a thing you see rather than a
  // thing you are told about.
  var REGION_COLOURS = ['#f2a71b', '#4fa3d1', '#92cc41', '#d8555a', '#b07cd6', '#e0a06a'];
  function regionColour(name) {
    if (!name) return C.line;
    var list = regionList();
    var i = list.indexOf(name);
    return i < 0 ? C.line : REGION_COLOURS[i % REGION_COLOURS.length];
  }
  function regionList() {
    var seen = [];
    for (var i = 0; i < world.rooms.length; i++) {
      var r = world.rooms[i].region;
      if (r && seen.indexOf(r) < 0) seen.push(r);
    }
    return seen.sort();
  }

  // ------------------------------------------------------------------ drawing
  function draw() {
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, cv.width, cv.height);

    ctx.strokeStyle = 'rgba(59,68,114,.35)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx < cv.width; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx + .5, 0); ctx.lineTo(gx + .5, cv.height); ctx.stroke();
    }
    for (var gy = 0; gy < cv.height; gy += 40) {
      ctx.beginPath(); ctx.moveTo(0, gy + .5); ctx.lineTo(cv.width, gy + .5); ctx.stroke();
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
        var ex = r.exits[j], b = layout[ex.to];
        if (!b) continue;

        // A line that crosses a region is drawn as what it is: a claim the world
        // does not support. This is the picture of the bug that started all this.
        var crossing = r.region && byId(ex.to) && byId(ex.to).region &&
          r.region !== byId(ex.to).region;

        ctx.strokeStyle = crossing ? C.red : 'rgba(232,228,218,.5)';
        ctx.lineWidth = crossing ? 3 : 2;
        if (crossing) ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // an arrowhead, so a one-way passage reads as one way
        var ang = Math.atan2(b.y - a.y, b.x - a.x);
        var tipX = b.x - Math.cos(ang) * (ROOM_W / 2 + 4);
        var tipY = b.y - Math.sin(ang) * (ROOM_H / 2 + 4);
        ctx.fillStyle = crossing ? C.red : 'rgba(232,228,218,.6)';
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(ang - .4) * 11, tipY - Math.sin(ang - .4) * 11);
        ctx.lineTo(tipX - Math.cos(ang + .4) * 11, tipY - Math.sin(ang + .4) * 11);
        ctx.fill();

        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.font = '600 11px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = C.ink;
        ctx.fillRect(mx - 16, my - 8, 32, 15);
        ctx.fillStyle = crossing ? C.red : C.dim;
        ctx.fillText(ex.dir, mx, my + 3);
      }
    }
  }

  function drawPendingLink() {
    var a = layout[dragLink.from];
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(dragLink.x, dragLink.y); ctx.stroke();
    ctx.setLineDash([]);
    var over = roomAt(dragLink.x, dragLink.y);
    if (over && over.id !== dragLink.from) {
      var d = directionBetween(a, layout[over.id]);
      ctx.font = '700 12px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.gold;
      ctx.fillText(d, (a.x + layout[over.id].x) / 2, (a.y + layout[over.id].y) / 2 - 10);
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
    ctx.fillRect(x + 3, y + ROOM_H, ROOM_W, 3);           // the stepped print shadow

    ctx.lineWidth = selected === r.id ? 3 : 2;
    ctx.strokeStyle = selected === r.id ? C.gold : accent;
    ctx.strokeRect(x + .5, y + .5, ROOM_W - 1, ROOM_H - 1);

    if (r.region) { ctx.fillStyle = accent; ctx.fillRect(x, y, ROOM_W, 3); }
    if (r.dark) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(x + 1, y + 4, ROOM_W - 2, ROOM_H - 5);
    }

    ctx.textAlign = 'center';
    ctx.font = '700 12px ui-monospace, Menlo, monospace';
    ctx.fillStyle = isStart ? C.gold : C.paper;
    ctx.fillText(clip(r.name || r.id, 15), p.x, p.y - 4);

    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = C.dim;
    var note = (isStart ? 'START  ' : '') + countHere(r.id) + ' items';
    ctx.fillText(clip(note, 20), p.x, p.y + 11);

    if (!r.prose) {
      ctx.fillStyle = C.gold;
      ctx.fillRect(x + ROOM_W - 9, y + ROOM_H - 9, 5, 5);   // no prose written yet
    }
  }

  function countHere(id) {
    var n = 0;
    for (var i = 0; i < world.items.length; i++) if (world.items[i].location === id) n++;
    return n;
  }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '.' : s; }

  // --------------------------------------------------------------- validating
  //  The real checks, on every edit. Cheap enough to run continuously, which is
  //  the point: a mistake is reported while you are still looking at the thing
  //  that caused it.
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
      for (var j = 0; j < g.findings.length; j++) {
        found.push({ level: g.findings[j].level, code: g.findings[j].code,
          msg: g.findings[j].msg, hint: g.findings[j].hint });
      }
      // The design audit is opinion rather than fault, and only worth showing
      // once the structure holds up.
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

    if (!found.length) {
      findingsEl.innerHTML = '<p class="pdim">Nothing to report. The world holds together.</p>';
      return;
    }
    findingsEl.innerHTML = found.slice(0, 14).map(function (f) {
      return '<div class="f ' + (f.level === 'error' ? 'err' : f.level === 'warning' ? 'warn' : '') +
        '"><code>' + esc(f.code || '') + '</code>' + esc(f.msg) + '</div>';
    }).join('');
  }

  // The layout is the editor's, not the game's, so nothing downstream ever sees
  // it. It travels in meta only so a map can be reopened as it was left.
  function stripLayout(w) {
    var copy = JSON.parse(JSON.stringify(w));
    if (copy.meta) delete copy.meta.editorLayout;
    return copy;
  }
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  // ------------------------------------------------------------- the inspector
  var inspector = document.getElementById('inspector');

  function showInspector() {
    var r = selected && byId(selected);
    if (!r) {
      inspector.innerHTML = '<p class="ptitle">Nothing selected</p>' +
        '<p class="pdim">Click a room to edit it.</p>';
      return;
    }
    var regions = regionList();
    var html = '<p class="ptitle">' + esc(r.id) + '</p>';
    html += field('Name', 'text', 'name', r.name || '');
    html += '<div class="field"><label>Description</label>' +
      '<textarea data-k="prose">' + esc(r.prose || '') + '</textarea></div>';
    html += '<div class="field"><label>Region</label>' +
      '<input type="text" data-k="region" list="regions" value="' + esc(r.region || '') + '">' +
      '<datalist id="regions">' +
      regions.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') +
      '</datalist></div>';
    html += '<div class="field"><label class="check">' +
      '<input type="checkbox" data-k="dark"' + (r.dark ? ' checked' : '') + '> Dark' +
      '</label></div>';
    html += '<div class="field"><label class="check">' +
      '<input type="checkbox" data-k="start"' + (world.meta.start === r.id ? ' checked' : '') +
      '> The game starts here</label></div>';

    if ((r.exits || []).length) {
      html += '<div class="exits"><p class="ptitle">Ways out</p>';
      for (var i = 0; i < r.exits.length; i++) {
        var ex = r.exits[i], to = byId(ex.to);
        var cross = r.region && to && to.region && r.region !== to.region;
        html += '<div class="exitrow' + (cross ? ' cross' : '') + '"><b>' + esc(ex.dir) + '</b>' +
          esc(to ? (to.name || to.id) : ex.to) +
          (cross ? ' <span title="crosses a region">⚠</span>' : '') +
          '<span class="x" data-del="' + i + '">remove</span></div>';
      }
      html += '</div>';
    }
    inspector.innerHTML = html;

    inspector.querySelectorAll('[data-k]').forEach(function (el) {
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function () {
        var k = el.getAttribute('data-k');
        var room = byId(selected);
        if (!room) return;
        if (k === 'start') { world.meta.start = el.checked ? room.id : null; }
        else if (k === 'dark') { if (el.checked) room.dark = true; else delete room.dark; }
        else if (el.value) { room[k] = el.value; }
        else { delete room[k]; }
        draw(); check();
      });
    });
    inspector.querySelectorAll('[data-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        var room = byId(selected);
        room.exits.splice(Number(el.getAttribute('data-del')), 1);
        showInspector(); draw(); check();
      });
    });
  }

  function field(label, type, key, value) {
    return '<div class="field"><label>' + label + '</label>' +
      '<input type="' + type + '" data-k="' + key + '" value="' + esc(value) + '"></div>';
  }

  // -------------------------------------------------------------- interaction
  var drag = null, dragLink = null, downAt = null;

  function toCanvas(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * cv.width / r.width,
             y: (e.clientY - r.top) * cv.height / r.height };
  }

  cv.addEventListener('mousedown', function (e) {
    var p = toCanvas(e);
    var r = roomAt(p.x, p.y);
    downAt = p;
    if (!r) return;
    selected = r.id;
    showInspector();
    // Shift starts a join; a plain drag moves the room.
    if (e.shiftKey) dragLink = { from: r.id, x: p.x, y: p.y };
    else drag = { id: r.id, dx: p.x - layout[r.id].x, dy: p.y - layout[r.id].y };
    draw();
  });

  cv.addEventListener('mousemove', function (e) {
    var p = toCanvas(e);
    if (drag) {
      layout[drag.id] = { x: p.x - drag.dx, y: p.y - drag.dy };
      draw();
    } else if (dragLink) {
      dragLink.x = p.x; dragLink.y = p.y;
      draw();
    }
    cv.style.cursor = roomAt(p.x, p.y) ? 'move' : 'crosshair';
  });

  window.addEventListener('mouseup', function (e) {
    var p = toCanvas(e);
    if (dragLink) {
      var target = roomAt(p.x, p.y);
      if (target && target.id !== dragLink.from) join(dragLink.from, target.id);
      dragLink = null;
      draw(); check(); showInspector();
      return;
    }
    if (drag) {
      // Moving a room can change what direction its exits are, so they are
      // recomputed from the new geometry. The picture stays the source of truth.
      relabel();
      drag = null; draw(); check(); showInspector();
      return;
    }
    // A click on empty canvas puts a room down there.
    if (downAt && Math.abs(downAt.x - p.x) < 4 && Math.abs(downAt.y - p.y) < 4 &&
        !roomAt(p.x, p.y) && p.x > 0 && p.y > 0 && p.x < cv.width && p.y < cv.height) {
      addRoom(p.x, p.y);
    }
    downAt = null;
  });

  function join(fromId, toId) {
    var a = layout[fromId], b = layout[toId];
    var dir = directionBetween(a, b);
    var from = byId(fromId), to = byId(toId);
    from.exits = from.exits || [];
    for (var i = 0; i < from.exits.length; i++) if (from.exits[i].to === toId) return;
    from.exits.push({ dir: dir, to: toId });
    // Two-way by default, because a passage you cannot come back through is a
    // deliberate thing and should be the deliberate choice.
    to.exits = to.exits || [];
    for (var j = 0; j < to.exits.length; j++) if (to.exits[j].to === fromId) return;
    to.exits.push({ dir: OPPOSITE[dir], to: fromId });
  }

  //  Directions follow the geometry, always. This is what makes the map honest:
  //  drag a room to the other side of another and the exits between them turn
  //  round to match, instead of quietly continuing to claim the old arrangement.
  function relabel() {
    for (var i = 0; i < world.rooms.length; i++) {
      var r = world.rooms[i], a = layout[r.id];
      if (!a) continue;
      for (var j = 0; j < (r.exits || []).length; j++) {
        var b = layout[r.exits[j].to];
        if (!b) continue;
        if (['UP', 'DOWN', 'IN', 'OUT'].indexOf(r.exits[j].dir) >= 0) continue;
        r.exits[j].dir = directionBetween(a, b);
      }
    }
  }

  function addRoom(x, y) {
    var n = world.rooms.length + 1;
    var id = 'ROOM-' + n;
    while (byId(id)) { n++; id = 'ROOM-' + n; }
    var r = { id: id, name: 'Room ' + n, prose: '', exits: [] };
    world.rooms.push(r);
    layout[id] = { x: x, y: y };
    if (!world.meta.start) world.meta.start = id;
    selected = id;
    draw(); check(); showInspector();
  }

  // ------------------------------------------------------------------ toolbar
  document.getElementById('addRoom').addEventListener('click', function () {
    addRoom(120 + (world.rooms.length % 8) * 130, 90 + Math.floor(world.rooms.length / 8) * 110);
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
    draw(); check(); showInspector();
  });

  document.getElementById('exportWorld').addEventListener('click', function () {
    var out = stripLayout(world);
    out.meta.editorLayout = layout;
    download(JSON.stringify(out, null, 2), 'world.json', 'application/json');
  });

  document.getElementById('openFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    file.arrayBuffer().then(function (buf) {
      return window.FolioZip
        ? window.FolioZip.readFolio(new Uint8Array(buf))
        : Promise.reject(new Error('no zip reader on this page'));
    }).then(function (files) {
      var w = JSON.parse(new TextDecoder().decode(files['logic/world.json']));
      adopt(w);
    }).catch(function (err) {
      findingsEl.innerHTML = '<div class="f err"><code>OPEN</code>' + esc(err.message) + '</div>';
    });
  });

  document.getElementById('sample').addEventListener('click', function () {
    fetch('/games/cellar-door.folio').then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) { return window.FolioZip.readFolio(new Uint8Array(buf)); })
      .then(function (files) {
        adopt(JSON.parse(new TextDecoder().decode(files['logic/world.json'])));
      })
      .catch(function () {
        // Offline, or the gallery is not there. A hand-made example still shows
        // the idea, and a tool that dies without a network is not much of a tool.
        adopt(example());
      });
  });

  function adopt(w) {
    world = w;
    world.items = world.items || [];
    world.rules = world.rules || [];
    layout = (w.meta && w.meta.editorLayout) || autoLayout(w);
    if (w.meta) delete w.meta.editorLayout;
    selected = null;
    draw(); check(); showInspector();
  }

  //  A map for a world that has never been laid out: place the start room and
  //  walk outward, putting each room in the direction its exit claims. A map that
  //  was written as JSON gets drawn the way it says it is, and anything impossible
  //  about it becomes visible immediately.
  function autoLayout(w) {
    var pos = {}, step = 150;
    var VEC = { NORTH: [0, -1], SOUTH: [0, 1], EAST: [1, 0], WEST: [-1, 0],
      NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
      UP: [1, -1], DOWN: [-1, 1], IN: [1, 0], OUT: [-1, 0] };
    var start = (w.meta && w.meta.start) || (w.rooms[0] && w.rooms[0].id);
    if (!start) return {};
    pos[start] = { x: cv.width / 2, y: cv.height / 2 };
    var queue = [start], guard = 0;
    while (queue.length && guard++ < 500) {
      var id = queue.shift();
      var room = null;
      for (var i = 0; i < w.rooms.length; i++) if (w.rooms[i].id === id) room = w.rooms[i];
      if (!room) continue;
      for (var j = 0; j < (room.exits || []).length; j++) {
        var ex = room.exits[j];
        if (pos[ex.to]) continue;
        var v = VEC[ex.dir] || [1, 0];
        var p = { x: pos[id].x + v[0] * step, y: pos[id].y + v[1] * step };
        while (occupied(pos, p)) { p.x += 36; p.y += 24; }
        pos[ex.to] = p;
        queue.push(ex.to);
      }
    }
    // Anything the walk never reached still has to be somewhere.
    var loose = 0;
    for (var k = 0; k < w.rooms.length; k++) {
      if (pos[w.rooms[k].id]) continue;
      pos[w.rooms[k].id] = { x: 90 + (loose % 7) * 140, y: cv.height - 70 - Math.floor(loose / 7) * 80 };
      loose++;
    }
    return fit(pos);
  }
  function occupied(pos, p) {
    for (var k in pos) {
      if (Math.abs(pos[k].x - p.x) < ROOM_W + 12 && Math.abs(pos[k].y - p.y) < ROOM_H + 12) return true;
    }
    return false;
  }
  // Bring the whole map inside the canvas, whatever shape the walk produced.
  function fit(pos) {
    var xs = [], ys = [];
    for (var k in pos) { xs.push(pos[k].x); ys.push(pos[k].y); }
    if (!xs.length) return pos;
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var pad = 80;
    var sx = (cv.width - pad * 2) / Math.max(1, maxX - minX);
    var sy = (cv.height - pad * 2) / Math.max(1, maxY - minY);
    var s = Math.min(1, sx, sy);
    for (var id in pos) {
      pos[id] = { x: pad + (pos[id].x - minX) * s, y: pad + (pos[id].y - minY) * s };
    }
    return pos;
  }

  function example() {
    return {
      meta: { title: 'A start', start: 'PORCH' },
      rooms: [
        { id: 'PORCH', name: 'The Porch', region: 'house',
          prose: 'Paint curls off the boards.', exits: [{ dir: 'NORTH', to: 'HALL' }] },
        { id: 'HALL', name: 'The Hall', region: 'house',
          prose: 'A narrow hall.', exits: [{ dir: 'SOUTH', to: 'PORCH' }] }
      ],
      items: [], rules: []
    };
  }

  function download(text, name, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------------------------------------------------------------- and go
  draw(); check(); showInspector();
  window.FolioEditor = {
    world: function () { return stripLayout(world); },
    layout: function () { return layout; },
    load: adopt,
    addRoom: addRoom,
    join: join,
    select: function (id) { selected = id; showInspector(); draw(); },
    badge: function () { return badge.textContent; }
  };
})();
