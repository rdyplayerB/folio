//  The library wall: fetches games.json and renders the shelf.
//
//  Kept out of the page because the same wall appears on the home page and will
//  appear on browse and tag pages, and three copies of this logic would drift.

(function () {
  'use strict';

  var grid = document.getElementById('grid');
  if (!grid) return;

  var filtersEl = document.getElementById('filters');
  var progEl = document.getElementById('prog');
  var PLAY = '/play/?game=';

  // Completions live in the browser first and merge into an account only if one is
  // ever created. Ticking a box must never require signing up — friction at the
  // moment of delight is where platforms lose people. The honest consequence is
  // that anonymous ticks cannot feed ranking, which makes the signal harder to
  // farm rather than easier.
  var KEY = 'folio.finished';
  var finished = new Set(read());
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify([].slice.call(finished))); } catch (e) {}
  }

  var games = [], active = 'All';

  fetch('/games.json')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (list) { games = list; init(); })
    .catch(function () {
      grid.innerHTML = '<p class="empty">The library could not be loaded. ' +
        'Try again in a moment.</p>';
    });

  function init() {
    set('fGames', games.length);
    set('fMakers', new Set(games.map(function (g) { return g.author; })).size);
    feature();
    buildFilters();
    render();
  }

  function set(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

  function feature() {
    var g = games.filter(function (x) { return x.featured; })[0] || games[0];
    if (!g) return;
    var img = document.getElementById('featImg');
    if (img) { img.src = g.shot; img.alt = g.title + ' — opening screen'; }
    set('featName', g.title);
    set('featBy', (g.series || g.genre || 'Adventure') + ' · by ' + g.author);
    var href = PLAY + encodeURIComponent(g.id);
    ['featShot', 'featPlay'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.href = href;
    });
  }

  function buildFilters() {
    if (!filtersEl) return;
    var genres = ['All'].concat(
      Array.from(new Set(games.map(function (g) { return g.genre || 'Adventure'; }))).sort());
    genres.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.setAttribute('aria-pressed', name === active ? 'true' : 'false');
      b.addEventListener('click', function () {
        active = name;
        [].forEach.call(filtersEl.children, function (el) {
          el.setAttribute('aria-pressed', el.textContent === active ? 'true' : 'false');
        });
        render();
      });
      filtersEl.appendChild(b);
    });
  }

  function render() {
    var list = active === 'All' ? games
      : games.filter(function (g) { return (g.genre || 'Adventure') === active; });
    grid.innerHTML = '';
    if (!list.length) {
      grid.innerHTML = '<p class="empty">Nothing here yet — the first one could be yours.</p>';
    }
    list.forEach(function (g) { grid.appendChild(cart(g)); });
    progress();
  }

  function cart(g) {
    var el = document.createElement('article');
    el.className = 'cart';
    var href = PLAY + encodeURIComponent(g.id);

    var a = document.createElement('a');
    a.className = 'screen';
    a.href = href;
    a.setAttribute('aria-label', 'Play ' + g.title);
    var img = document.createElement('img');
    img.src = g.shot;
    img.alt = '';
    img.loading = 'lazy';
    a.appendChild(img);

    var meta = document.createElement('div');
    meta.className = 'meta';

    var tick = document.createElement('button');
    tick.className = 'tick';
    tick.type = 'button';
    tick.setAttribute('aria-pressed', finished.has(g.id) ? 'true' : 'false');
    tick.setAttribute('aria-label', 'Mark ' + g.title + ' as finished');
    tick.addEventListener('click', function () {
      if (finished.has(g.id)) finished.delete(g.id); else finished.add(g.id);
      tick.setAttribute('aria-pressed', finished.has(g.id) ? 'true' : 'false');
      persist();
      progress();
    });

    var txt = document.createElement('div');
    txt.style.minWidth = '0';
    var name = document.createElement('a');
    name.className = 'name';
    name.href = href;
    name.textContent = g.title;
    var sub = document.createElement('div');
    sub.className = 'sub';
    sub.appendChild(document.createTextNode(g.genre || 'Adventure'));
    if (g.tier === 'certified' || g.tier === 'playable') {
      sub.appendChild(document.createTextNode(' · '));
      var t = document.createElement('span');
      if (g.tier === 'certified') t.className = 'cert';
      t.textContent = g.tier === 'certified' ? 'Certified' : 'Playable';
      sub.appendChild(t);
    }
    sub.appendChild(document.createElement('br'));
    sub.appendChild(document.createTextNode('by ' + g.author));
    txt.appendChild(name);
    txt.appendChild(sub);

    meta.appendChild(tick);
    meta.appendChild(txt);
    el.appendChild(a);
    el.appendChild(meta);
    return el;
  }

  function progress() {
    if (progEl) progEl.textContent = 'You have finished ' + finished.size + ' of ' + games.length;
  }
})();
