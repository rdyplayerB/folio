//  Scaffolding the art.
//
//  There was never an art pipeline. Zork's pictures are three hundred and ninety
//  seven kilobytes of hand-written drawing code, one function per room, produced
//  across many sessions by a person reading a room description and writing
//  JavaScript. That worked and it is not a process anybody else can follow, and
//  the consequence showed up the first time somebody built a thirty-room game:
//  no art, and therefore no hotspots, and therefore a game that could not be
//  played at all.
//
//  This is the first honest half of that pipeline. It cannot draw a room — that
//  is a decision about what the place looks like, and the engine has no opinion.
//  What it can do is everything around the drawing, which turns out to be most of
//  the work and all of the parts that go wrong:
//
//    · a stub per room, so nothing is silently missing
//    · hotspots already correct, derived from what the world says is in the room
//    · exits placed on the edge they point at, so the picture agrees with the map
//    · a backdrop guessed from the room's own prose, using the engine's kit
//
//  Hotspots are the part worth automating. They have to agree with three things
//  at once — the picture, the world's item ids, and the exits — and a mismatch is
//  invisible until a player clicks the wrong thing. Generating them from the world
//  means they cannot disagree with it.
//
//  What comes out is a working, ugly, playable game. Making it beautiful is the
//  author's job, and now it is the only part left.

'use strict';

//  Words a room might use about itself, and what to lay down when it does.
//  Deliberately small and obvious. A guess that is wrong is easy to replace; a
//  guess that is clever and wrong wastes somebody's afternoon.
//  sky() paints down to y=37 and grass(y) paints from y to the floor, so the two
//  have to meet or the picture has a black stripe across its middle. Every
//  outdoor backdrop below starts its ground at 37 for that reason.
const BACKDROPS = [
  { when: /\b(cave|cavern|tunnel|shaft|mine|underground|grotto)\b/i, name: 'cave',
    body: ['K.rect(ctx, 0, 0, W, H, K.PAL.STONE_DK);',
           'K.caveCeiling(ctx, W);',
           'K.rockWall(ctx, 0, 14, W, H - 36);',
           'K.cavefloor(ctx, H - 22, W);'] },
  { when: /\b(night|stars|moonlight|midnight)\b/i, name: 'night',
    body: ['K.nightSky(ctx);',
           'K.grass(ctx, 46, W);'] },
  { when: /\b(river|lake|sea|water|shore|beach|coast|ocean)\b/i, name: 'water',
    body: ['K.sky(ctx, t);',
           'K.water(ctx, 0, 37, W, H - 37, t);',
           'K.riverbank(ctx, 0, H - 20, W);'] },
  { when: /\b(hall|room|kitchen|cellar|attic|chamber|corridor|office|lab|shed)\b/i,
    name: 'interior',
    body: ['K.rect(ctx, 0, 0, W, H, K.PAL.BLACK);',
           'K.houseWall(ctx, 0, 0, W, H - 18);',
           'K.rect(ctx, 0, H - 18, W, 18, K.PAL.WOOD);',
           'K.dither(ctx, 0, H - 18, W, 4, K.PAL.WOOD, K.PAL.WOOD_DK);'] },
  { when: /\b(forest|wood|tree|clearing|path|road|field|garden|yard|hill|sky|cloud)\b/i,
    name: 'outdoors',
    body: ['K.sky(ctx, t);',
           'K.grass(ctx, 37, W);',
           '// tree(x, y, size): size is HEIGHT IN PIXELS, and y is the top, so a',
           '// tree standing on the horizon starts about its own height above it.',
           '// A negative size draws a pine.',
           'K.tree(ctx, 10, 22, 34);',
           'K.tree(ctx, W - 38, 30, 26);'] }
];

const FALLBACK = { name: 'plain',
  body: ['K.sky(ctx, t);', 'K.grass(ctx, 37, W);'] };

// Where an exit sits in the picture. A door out of the north side belongs at the
// top of the frame, or the picture and the compass are telling different stories.
const EXIT_RECTS = {
  NORTH: [56, 6, 32, 20], SOUTH: [56, 78, 32, 20],
  WEST: [2, 40, 18, 34], EAST: [124, 40, 18, 34],
  NW: [4, 8, 22, 18], NE: [118, 8, 22, 18],
  SW: [4, 78, 22, 18], SE: [118, 78, 22, 18],
  UP: [104, 6, 26, 18], DOWN: [104, 80, 26, 18],
  IN: [60, 44, 24, 26], OUT: [2, 6, 20, 18]
};

/** Room prose, including any variant, so the guess reads everything on offer. */
function proseOf(room) {
  let s = (room.name || '') + ' ' + (room.prose || '');
  for (const v of (room.variants || [])) s += ' ' + (v.prose || '');
  return s;
}

function backdropFor(room) {
  const text = proseOf(room);
  for (const b of BACKDROPS) if (b.when.test(text)) return b;
  return FALLBACK;
}

/**
 * Where the things in a room sit in its picture.
 *
 * Laid out on a shelf across the middle, which is wrong for almost every room and
 * right in the only way that matters at this stage: every object is somewhere, and
 * somewhere is clickable. Moving a rectangle is a minute's work. Discovering three
 * months later that an object was never clickable is not.
 */
function objectRects(items) {
  const out = [];
  const perRow = 4, w = 26, h = 24, gapX = 8, gapY = 6;
  const startX = Math.max(4, (144 - (perRow * w + (perRow - 1) * gapX)) / 2) | 0;
  for (let i = 0; i < items.length; i++) {
    const col = i % perRow, row = (i / perRow) | 0;
    out.push({
      id: items[i].id,
      name: items[i].name || items[i].id,
      x: startX + col * (w + gapX),
      y: 34 + row * (h + gapY),
      w, h
    });
  }
  return out;
}

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

/**
 * Generate a starter scenes.js for a world.
 * @param {object} def   a world.json
 * @returns {string}     JavaScript, ready to drop in presentation/
 */
function scaffold(def) {
  const rooms = def.rooms || [];
  const items = def.items || [];
  const actors = def.actors || [];

  const out = [];
  out.push('//  Scene art, scaffolded by `folio scenes`.');
  out.push('//');
  out.push('//  Every room has a picture and every picture is clickable, which is where');
  out.push('//  the engine can get you on its own. What it cannot do is decide what a');
  out.push('//  place looks like, so the draw bodies below are a starting backdrop and');
  out.push('//  a shelf of boxes. Replace them.');
  out.push('//');
  out.push('//  The hotspots are already right: they come from the world itself, so they');
  out.push('//  cannot disagree with it. Move the rectangles to match whatever you draw,');
  out.push('//  and keep the ids.');
  out.push('//');
  out.push('//  The canvas is 144x104 and never scales: draw in those coordinates and the');
  out.push('//  engine handles every screen. GUE.kit carries the primitives — sky, grass,');
  out.push('//  rockWall, houseWall, cavefloor, tree, water, door, stairsDown, torch,');
  out.push('//  dither, noise, and the palette in K.PAL (SKY, GRASS, STONE, WOOD,');
  out.push('//  WATER, TORCH, BONE, GOLD, and the rest — all upper case).');
  out.push('');
  out.push('(function (root) {');
  out.push("  'use strict';");
  out.push('  var GUE = root.GUE = root.GUE || {};');
  out.push('  var K = GUE.kit;');
  out.push('  var W = 144, H = 104;');
  out.push('  GUE.scenes = GUE.scenes || {};');
  out.push('');

  let drawn = 0;
  for (const room of rooms) {
    const here = items.filter(i => i.location === room.id);
    const who = actors.filter(a => a.location === room.id);
    const things = here.concat(who);
    const rects = objectRects(things);
    const back = backdropFor(room);

    out.push('  // ' + (room.name || room.id) +
      (room.dark ? '   (dark: the engine draws the dark, this only runs when lit)' : ''));
    out.push('  GUE.scenes[' + q(room.id) + '] = {');
    out.push('    draw: function (ctx, S, t) {');
    out.push('      // backdrop guessed from the room\'s own words: ' + back.name);
    for (const line of back.body) out.push('      ' + line);
    if (rects.length) {
      out.push('');
      out.push('      // a box per thing, standing in until you draw them');
      for (const r of rects) {
        out.push('      K.rect(ctx, ' + r.x + ', ' + r.y + ', ' + r.w + ', ' + r.h +
          ', K.PAL.BLACK);');
        out.push('      K.frame(ctx, ' + r.x + ', ' + r.y + ', ' + r.w + ', ' + r.h +
          ', K.PAL.WHITE);   // ' + r.name);
      }
    }
    out.push('    },');
    out.push('    hotspots: function (S) {');
    out.push('      return [');
    for (const r of rects) {
      out.push('        { x: ' + r.x + ', y: ' + r.y + ', w: ' + r.w + ', h: ' + r.h +
        ', obj: ' + q(r.id) + ' },');
    }
    for (const ex of (room.exits || [])) {
      const box = EXIT_RECTS[ex.dir];
      if (!box) continue;
      out.push('        { x: ' + box[0] + ', y: ' + box[1] + ', w: ' + box[2] + ', h: ' + box[3] +
        ', dir: ' + q(ex.dir) + ' },   // to ' + ex.to);
    }
    out.push('      ];');
    out.push('    }');
    out.push('  };');
    out.push('');
    drawn++;
  }

  out.push('})(typeof window !== \'undefined\' ? window : globalThis);');
  return { source: out.join('\n') + '\n', rooms: drawn };
}

module.exports = { scaffold, backdropFor, objectRects, BACKDROPS, FALLBACK, EXIT_RECTS };
