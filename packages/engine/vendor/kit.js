window.GUE = window.GUE || {};
/* art/kit.js — NES palette + pixel drawing primitives + shared scene props.
 * Scene window is 144x104; every prop here is sized for that box.
 * STYLE LAW: black outlines, dithered shading, no gradients, horizon ~y=36
 * outdoors, floor line ~y=80 indoors/caves.
 */
(function () {
  'use strict';

  var GUE = window.GUE;
  var SCENE_W = 144, SCENE_H = 104;

  /* ---------------------------------------------------------------- palette
   * Canonical 64-entry Ricoh 2C02 table. Indices are the real NES $00..$3F.
   * Named conveniences are aliases onto those same strings — use the names.
   */
  var PAL = {
    0x00: '#7C7C7C', 0x01: '#0000FC', 0x02: '#0000BC', 0x03: '#4428BC',
    0x04: '#940084', 0x05: '#A80020', 0x06: '#A81000', 0x07: '#881400',
    0x08: '#503000', 0x09: '#007800', 0x0A: '#006800', 0x0B: '#005800',
    0x0C: '#004058', 0x0D: '#000000', 0x0E: '#000000', 0x0F: '#000000',

    0x10: '#BCBCBC', 0x11: '#0078F8', 0x12: '#0058F8', 0x13: '#6844FC',
    0x14: '#D800CC', 0x15: '#E40058', 0x16: '#F83800', 0x17: '#E45C10',
    0x18: '#AC7C00', 0x19: '#00B800', 0x1A: '#00A800', 0x1B: '#00A844',
    0x1C: '#008888', 0x1D: '#000000', 0x1E: '#000000', 0x1F: '#000000',

    0x20: '#F8F8F8', 0x21: '#3CBCFC', 0x22: '#6888FC', 0x23: '#9878F8',
    0x24: '#F878F8', 0x25: '#F85898', 0x26: '#F87858', 0x27: '#FCA044',
    0x28: '#F8B800', 0x29: '#B8F818', 0x2A: '#58D854', 0x2B: '#58F898',
    0x2C: '#00E8D8', 0x2D: '#787878', 0x2E: '#000000', 0x2F: '#000000',

    0x30: '#FCFCFC', 0x31: '#A4E4FC', 0x32: '#B8B8F8', 0x33: '#D8B8F8',
    0x34: '#F8B8F8', 0x35: '#F8A4C0', 0x36: '#F0D0B0', 0x37: '#FCE0A8',
    0x38: '#F8D878', 0x39: '#D8F878', 0x3A: '#B8F8B8', 0x3B: '#B8F8D8',
    0x3C: '#00FCFC', 0x3D: '#F8D8F8', 0x3E: '#000000', 0x3F: '#000000'
  };

  /* named conveniences (contract-locked names first) */
  PAL.BLACK     = PAL[0x0F];  // $0F
  PAL.WHITE     = PAL[0x30];  // $30
  PAL.SKY       = PAL[0x21];  // $21 pale NES sky
  PAL.GRASS     = PAL[0x2A];  // $2A
  PAL.TREE      = PAL[0x1A];  // $1A foliage mid
  PAL.DIRT      = PAL[0x18];  // $18
  PAL.BROWN     = PAL[0x08];  // $08 dark wood
  PAL.STONE     = PAL[0x10];  // $10
  PAL.STONE_DK  = PAL[0x00];  // $00
  PAL.WATER     = PAL[0x11];  // $11
  PAL.WATER_DK  = PAL[0x02];  // $02
  PAL.TORCH     = PAL[0x27];  // $27 flame orange
  PAL.FIRE      = PAL[0x16];  // $16 flame red
  PAL.CRIMSON   = PAL[0x05];  // $05
  PAL.GOLD      = PAL[0x28];  // $28
  PAL.GREY      = PAL[0x2D];  // $2D
  PAL.TAN       = PAL[0x37];  // $37
  PAL.PURPLE    = PAL[0x23];  // $23
  PAL.GREEN_DK  = PAL[0x0A];  // $0A

  /* extra conveniences (additive — never remove the above) */
  PAL.SKY_LT    = PAL[0x31];
  PAL.GRASS_DK  = PAL[0x1A];
  PAL.GRASS_LT  = PAL[0x29];
  PAL.WOOD      = PAL[0x17];  // light wood / plank highlight
  PAL.WOOD_DK   = PAL[0x07];
  PAL.WATER_LT  = PAL[0x21];
  PAL.PURPLE_DK = PAL[0x03];
  PAL.MAGENTA   = PAL[0x14];
  PAL.PINK      = PAL[0x35];
  PAL.CYAN      = PAL[0x2C];
  PAL.TEAL      = PAL[0x1C];
  PAL.SILVER    = PAL[0x10];
  PAL.BONE      = PAL[0x37];
  PAL.RED       = PAL[0x16];
  PAL.BLUE      = PAL[0x11];
  PAL.OLIVE     = PAL[0x18];

  /* --------------------------------------------------------- primitives */

  function px(ctx, x, y, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x | 0, y | 0, 1, 1);
  }

  function rect(ctx, x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = c;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  function frame(ctx, x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    x |= 0; y |= 0; w |= 0; h |= 0;
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  function hline(ctx, x, y, w, c) { rect(ctx, x, y, w, 1, c); }
  function vline(ctx, x, y, h, c) { rect(ctx, x, y, 1, h, c); }

  /* 50% checkerboard. c1 is the base, c2 the speckle. */
  function dither(ctx, x, y, w, h, c1, c2) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    if (w <= 0 || h <= 0) return;
    if (c1) rect(ctx, x, y, w, h, c1);
    ctx.fillStyle = c2;
    for (var r = 0; r < h; r++) {
      for (var c = (r & 1); c < w; c += 2) ctx.fillRect(x + c, y + r, 1, 1);
    }
  }

  /* 25% speckle — lighter shading than a full checker. */
  function dither25(ctx, x, y, w, h, c1, c2) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    if (w <= 0 || h <= 0) return;
    if (c1) rect(ctx, x, y, w, h, c1);
    ctx.fillStyle = c2;
    for (var r = 0; r < h; r++) {
      for (var c = (r & 1) * 2; c < w; c += 4) ctx.fillRect(x + c, y + r, 1, 1);
    }
  }

  /* grid: array of equal-length strings; each char is a palMap key.
   * '.' and ' ' are transparent. Scale 1: one char = one pixel. */
  function sprite(ctx, grid, x, y, palMap) {
    if (!grid || !grid.length) return;
    var map = palMap || {}, byCol = {}, r, row, n, c0, end, ch, col, a, i;
    x |= 0; y |= 0;
    for (r = 0; r < grid.length; r++) {
      row = grid[r]; n = row.length; c0 = 0;
      while (c0 < n) {
        ch = row.charAt(c0);
        end = c0 + 1;
        while (end < n && row.charAt(end) === ch) end++;
        if (ch !== '.' && ch !== ' ') {
          col = map[ch];
          if (col) (byCol[col] || (byCol[col] = [])).push(c0, r, end - c0);
        }
        c0 = end;
      }
    }
    for (col in byCol) {
      if (!Object.prototype.hasOwnProperty.call(byCol, col)) continue;
      a = byCol[col];
      ctx.fillStyle = col;
      for (i = 0; i < a.length; i += 3) ctx.fillRect(x + a[i], y + a[i + 1], a[i + 2], 1);
    }
  }

  /* filled circle, integer raster (no antialiasing anywhere in this kit) */
  function disc(ctx, cx, cy, r, c) {
    ctx.fillStyle = c;
    for (var dy = -r; dy <= r; dy++) {
      var span = Math.floor(Math.sqrt(r * r - dy * dy));
      if (span < 0) continue;
      ctx.fillRect((cx - span) | 0, (cy + dy) | 0, span * 2 + 1, 1);
    }
  }

  /* upward-pointing triangle with apex at (cx, y), base halfw at y+rows-1 */
  function tri(ctx, cx, y, halfw, rows, c) {
    ctx.fillStyle = c;
    for (var i = 0; i < rows; i++) {
      var hw = Math.round(halfw * (i + 1) / rows);
      ctx.fillRect((cx - hw) | 0, (y + i) | 0, hw * 2 + 1, 1);
    }
  }

  /* deterministic hash -> [0,1). Same room always looks the same. */
  function hash(a, b) {
    var n = (((a | 0) * 374761393) + ((b | 0) * 668265263)) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  /* scattered single pixels — grit, pebbles, stars, sand */
  function noise(ctx, x, y, w, h, c, density, seed) {
    ctx.fillStyle = c;
    seed = seed | 0;
    for (var r = 0; r < h; r++) {
      for (var cc = 0; cc < w; cc++) {
        if (hash(x + cc + seed * 71, y + r - seed * 31) < density) {
          ctx.fillRect(x + cc, y + r, 1, 1);
        }
      }
    }
  }

  /* jagged 1px crack walking downward from (x,y) */
  function crack(ctx, x, y, len, c, seed) {
    ctx.fillStyle = c;
    var cx = x;
    for (var i = 0; i < len; i++) {
      ctx.fillRect(cx | 0, (y + i) | 0, 1, 1);
      var h = hash(cx + seed * 17, y + i + seed * 5);
      if (h < 0.3) cx -= 1; else if (h > 0.72) cx += 1;
      if (h > 0.94) ctx.fillRect((cx + 1) | 0, (y + i) | 0, 1, 1);
    }
  }

  /* ------------------------------------------------------------ backdrops */

  function cloud(ctx, x, y, big) {
    var M = { w: PAL.WHITE, S: PAL.SKY_LT };
    var g = big ? [
      '.....wwwwww.....',
      '...wwwwwwwwww...',
      '.wwwwwwwwwwwwww.',
      'wwwwwwwwwwwwwwww',
      '.SSSSSSSSSSSSSS.'
    ] : [
      '...wwwww..',
      '.wwwwwwwww',
      '.SSSSSSSS.'
    ];
    sprite(ctx, g, x, y, M);
  }

  /* Fills y 0..36 with sky + a couple of clouds. Static (t accepted, unused
   * for motion — NES skies don't scroll and determinism keeps tests sane). */
  function sky(ctx, t) {
    rect(ctx, 0, 0, SCENE_W, 26, PAL.SKY);
    dither(ctx, 0, 26, SCENE_W, 4, PAL.SKY, PAL.SKY_LT);
    rect(ctx, 0, 30, SCENE_W, 7, PAL.SKY_LT);
    cloud(ctx, 12, 6, 1);
    cloud(ctx, 96, 15, 0);
  }

  /* Night/cave sky: near-black with a stone lip. */
  function nightSky(ctx) {
    rect(ctx, 0, 0, SCENE_W, 37, PAL.BLACK);
    dither25(ctx, 0, 0, SCENE_W, 20, null, PAL[0x02]);
  }

  /* Ground band from y down to the bottom of the scene window. */
  function grass(ctx, y, w) {
    w = w || SCENE_W;
    var h = SCENE_H - y;
    if (h <= 0) return;
    rect(ctx, 0, y, w, h, PAL.GRASS);
    dither(ctx, 0, y, w, 3, PAL.GRASS, PAL.GRASS_DK);          // horizon haze
    dither25(ctx, 0, y + h - 14, w, 14, null, PAL.GRASS_LT);   // near-ground light
    for (var x = 1; x < w - 2; x += 5) {
      var j = hash(x, y);
      var ty = y + 4 + Math.floor(j * (h - 6));
      if (ty > SCENE_H - 2) continue;
      px(ctx, x + (j > 0.5 ? 1 : 0), ty, PAL.GREEN_DK);
      px(ctx, x + 1, ty - 1, PAL.GREEN_DK);
      px(ctx, x + 2, ty, PAL.GREEN_DK);
      if (j > 0.66) px(ctx, x + 1, ty - 2, PAL.GRASS_LT);
    }
  }

  /* Cave/room floor band from y down to the bottom. */
  function cavefloor(ctx, y, w) {
    w = w || SCENE_W;
    var h = SCENE_H - y;
    if (h <= 0) return;
    rect(ctx, 0, y, w, h, PAL.STONE_DK);
    hline(ctx, 0, y, w, PAL.BLACK);
    dither(ctx, 0, y + 1, w, 4, PAL.STONE_DK, PAL.BLACK);      // recede into dark
    dither25(ctx, 0, y + h - 12, w, 12, null, PAL.STONE);      // near floor catches light
    for (var i = 0; i < 26; i++) {
      var px0 = Math.floor(hash(i * 13, y) * (w - 4)) + 2;
      var py0 = y + 5 + Math.floor(hash(i * 7, y + 3) * (h - 7));
      if (py0 >= SCENE_H - 1) continue;
      px(ctx, px0, py0, PAL.STONE);
      px(ctx, px0 + 1, py0, PAL.GREY);
      px(ctx, px0, py0 + 1, PAL.BLACK);
    }
  }

  /* Rock ceiling with stalactites across the top of the scene. */
  function caveCeiling(ctx, w) {
    w = w || SCENE_W;
    dither(ctx, 0, 0, w, 9, PAL.STONE_DK, PAL.GREY);
    hline(ctx, 0, 9, w, PAL.BLACK);
    for (var x = 3; x < w - 4; x += 9) {
      var len = 3 + Math.floor(hash(x, 99) * 9);
      var hw = 2 + (hash(x, 7) > 0.6 ? 1 : 0);
      for (var i = 0; i < len; i++) {
        var t = 1 - i / len;
        var half = Math.max(0, Math.round(hw * t));
        rect(ctx, x - half, 10 + i, half * 2 + 1, 1, PAL.STONE_DK);
        px(ctx, x - half - 1, 10 + i, PAL.BLACK);
        px(ctx, x + half + 1, 10 + i, PAL.BLACK);
        if (i < len - 2) px(ctx, x - half, 10 + i, PAL.STONE);
      }
      px(ctx, x, 10 + len, PAL.BLACK);
    }
  }

  /* ---------------------------------------------------------------- props */

  /* Cave wall texture: dithered greys + crack lines + shadow blotches. */
  function rockWall(ctx, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    dither(ctx, x, y, w, h, PAL.STONE_DK, PAL.STONE);
    hline(ctx, x, y, w, PAL.STONE);                    // lit top lip
    hline(ctx, x, y + h - 1, w, PAL.BLACK);
    var i, bx, by, bw, bh;
    for (i = 0; i < 5; i++) {                          // shadow blotches
      bx = x + Math.floor(hash(x + i * 31, y) * Math.max(1, w - 10));
      by = y + Math.floor(hash(y + i * 17, x) * Math.max(1, h - 8));
      bw = 4 + Math.floor(hash(i, x + y) * 8);
      bh = 3 + Math.floor(hash(i + 9, x - y) * 5);
      dither(ctx, bx, by, Math.min(bw, x + w - bx), Math.min(bh, y + h - by),
             null, PAL.BLACK);
    }
    for (i = 0; i < 3; i++) {                          // cracks
      bx = x + 3 + Math.floor(hash(x + i * 53, y + 11) * Math.max(1, w - 6));
      by = y + 1 + Math.floor(hash(y + i * 29, x + 5) * Math.max(1, h / 2));
      crack(ctx, bx, by, Math.min(h - (by - y) - 1, 5 + Math.floor(hash(i, 3) * 12)),
            PAL.BLACK, i + 1);
    }
  }

  /* White clapboard siding. */
  function houseWall(ctx, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    rect(ctx, x, y, w, h, PAL.WHITE);
    for (var r = 3; r < h - 1; r += 4) {
      hline(ctx, x + 1, y + r, w - 2, PAL.GREY);
      hline(ctx, x + 1, y + r + 1, w - 2, PAL.STONE);
    }
    dither25(ctx, x + w - 6, y + 1, 5, h - 2, null, PAL.STONE);  // right shading
    frame(ctx, x, y, w, h, PAL.BLACK);
  }

  /* 18x18 window. open=true -> dark opening; boarded=true -> nailed planks. */
  function windowProp(ctx, x, y, open, boarded) {
    rect(ctx, x, y, 18, 18, PAL.WHITE);
    frame(ctx, x, y, 18, 18, PAL.BLACK);
    var glass = open ? PAL.BLACK : PAL.SKY_LT;
    rect(ctx, x + 2, y + 2, 14, 14, glass);
    if (!open) {
      dither25(ctx, x + 2, y + 2, 14, 6, null, PAL.WHITE);   // pane glint
      rect(ctx, x + 8, y + 2, 1, 14, PAL.WHITE);
      rect(ctx, x + 2, y + 8, 14, 1, PAL.WHITE);
    } else {
      dither(ctx, x + 2, y + 12, 14, 4, null, PAL.STONE_DK);
    }
    frame(ctx, x + 1, y + 1, 16, 16, PAL.GREY);
    if (boarded) {
      var b, i;
      for (i = 0; i < 2; i++) {
        b = y + 3 + i * 8;
        rect(ctx, x - 1, b, 20, 4, PAL.DIRT);
        hline(ctx, x - 1, b, 20, PAL.BLACK);
        hline(ctx, x - 1, b + 3, 20, PAL.BROWN);
        px(ctx, x + 2, b + 1, PAL.GREY);
        px(ctx, x + 15, b + 1, PAL.GREY);
      }
    }
  }

  /* size>0 round deciduous, size<0 pointy pine. |size| = pixel height.
   * (x,y) is the top-left of the bounding box. */
  function tree(ctx, x, y, size) {
    var pine = size < 0, h = Math.abs(size) || 40;
    var w = Math.max(9, Math.round(h * (pine ? 0.62 : 0.78)));
    var cx = x + (w >> 1);
    var tw = Math.max(3, Math.round(h / 9));
    var trunkTop = y + Math.round(h * (pine ? 0.82 : 0.56));

    /* trunk */
    rect(ctx, cx - ((tw + 2) >> 1), trunkTop, tw + 2, h - (trunkTop - y), PAL.BLACK);
    rect(ctx, cx - (tw >> 1), trunkTop, tw, h - (trunkTop - y) - 1, PAL.DIRT);
    vline(ctx, cx + ((tw - 1) >> 1), trunkTop, h - (trunkTop - y) - 1, PAL.BROWN);
    if (!pine) {                                   // roots flare
      px(ctx, cx - (tw >> 1) - 1, y + h - 2, PAL.BROWN);
      px(ctx, cx + (tw >> 1) + 1, y + h - 2, PAL.BROWN);
    }

    if (pine) {
      /* three overlapping tiers, each rasterised row-by-row so the black
       * outline stays exactly 1px on both slopes */
      var tiers = 3, canopyH = trunkTop - y;
      var rows = Math.max(4, Math.round(canopyH * 0.46));
      for (var i = 0; i < tiers; i++) {
        var ty = Math.round(y + i * (canopyH - rows) / (tiers - 1));
        var half = Math.round((w / 2) * (0.52 + 0.24 * i));
        for (var r = 0; r < rows; r++) {
          var hw = Math.round(half * (r + 1) / rows);
          rect(ctx, cx - hw - 1, ty + r, hw * 2 + 3, 1, PAL.BLACK);
          if (r === 0) continue;
          rect(ctx, cx - hw, ty + r, hw * 2 + 1, 1, PAL.GREEN_DK);
          rect(ctx, cx - hw, ty + r, hw + 1, 1, PAL.TREE);       // lit left face
          if ((r & 1) === 0 && hw > 2) px(ctx, cx - hw + 1, ty + r, PAL.GRASS_LT);
        }
        hline(ctx, cx - half - 1, ty + rows, half * 2 + 3, PAL.BLACK);
      }
    } else {
      var r0 = Math.round(h * 0.32);
      var ccy = y + r0 + 1;
      disc(ctx, cx, ccy, r0 + 1, PAL.BLACK);      // outline
      disc(ctx, cx, ccy, r0, PAL.TREE);
      /* dithered shade on the lower-right, highlight on the upper-left */
      ctx.fillStyle = PAL.GREEN_DK;
      for (var dy = -r0; dy <= r0; dy++) {
        var span = Math.floor(Math.sqrt(r0 * r0 - dy * dy)) - 1;
        for (var dx = -span; dx <= span; dx++) {
          if (((dx + dy) & 1) === 0 && dx + dy > r0 * 0.55) {
            ctx.fillRect(cx + dx, ccy + dy, 1, 1);
          }
        }
      }
      ctx.fillStyle = PAL.GRASS_LT;
      for (var hy = -r0 + 1; hy < 0; hy++) {
        var hspan = Math.floor(Math.sqrt(r0 * r0 - hy * hy)) - 1;
        for (var hx = -hspan; hx <= 0; hx++) {
          if (((hx + hy) & 1) === 0 && hx + hy < -r0 * 0.62) {
            ctx.fillRect(cx + hx, ccy + hy, 1, 1);
          }
        }
      }
      /* a couple of dark leaf notches so the silhouette isn't a plain ball */
      px(ctx, cx - r0 + 1, ccy - 1, PAL.BLACK);
      px(ctx, cx + r0 - 1, ccy + 1, PAL.BLACK);
      px(ctx, cx, ccy - r0 + 1, PAL.BLACK);
    }
  }

  /* 2-frame shimmering water. t = frame ticker. */
  function water(ctx, x, y, w, h, t) {
    if (w <= 0 || h <= 0) return;
    var ph = ((t || 0) >> 3) & 1;
    rect(ctx, x, y, w, h, PAL.WATER);
    dither(ctx, x, y, w, Math.min(h, 4), null, PAL.WATER_DK);        // far edge
    dither25(ctx, x, y + h - Math.min(h, 6), w, Math.min(h, 6), null, PAL.WATER_DK);
    for (var r = 1; r < h; r += 4) {
      var off = ((r >> 1) + ph * 3) % 8;
      for (var c = off; c < w; c += 8) {
        rect(ctx, x + c, y + r, 3, 1, PAL.WATER_LT);
        px(ctx, x + c + 3, y + r, PAL.SKY_LT);
      }
    }
    hline(ctx, x, y, w, PAL.WATER_DK);
  }

  var TORCH_BASE = [
    '....kk....',
    '...kNNk...',
    '...kNuk...',
    '...kNNk...',
    '..kkNNkk..',
    '..kGGGGk..',
    '..kGkkGk..',
    '..kGGGGk..',
    '...kkkk...',
    '....kk....'
  ];
  var TORCH_FLAME = [[
    '....r.....',
    '...rr.....',
    '..rroy....',
    '..royyo...',
    '..royyo...',
    '...roor...'
  ], [
    '.....r....',
    '....rr....',
    '...royy...',
    '..rroyyo..',
    '..royyoo..',
    '...rooo...'
  ]];
  var TORCH_MAP = {
    k: PAL.BLACK, N: PAL.BROWN, u: PAL.DIRT, G: PAL.GREY,
    r: PAL.FIRE, o: PAL.TORCH, y: PAL.GOLD
  };

  /* Wall torch, 10x16, 2-frame flame + a warm glow halo. */
  function torch(ctx, x, y, t) {
    var f = (((t || 0) >> 3) & 1);
    dither25(ctx, x - 5, y - 3, 20, 18, null, PAL[0x08]);   // faint glow on the wall
    sprite(ctx, TORCH_FLAME[f], x, y, TORCH_MAP);
    sprite(ctx, TORCH_BASE, x, y + 6, TORCH_MAP);
  }

  /* Wooden door, 20x32 at (x,y). */
  function door(ctx, x, y, open) {
    if (open) {
      rect(ctx, x, y, 20, 32, PAL.BLACK);
      frame(ctx, x, y, 20, 32, PAL.BROWN);
      dither(ctx, x + 2, y + 22, 16, 9, null, PAL[0x08]);
      /* door swung inward on the left */
      rect(ctx, x + 1, y + 1, 5, 30, PAL.BROWN);
      rect(ctx, x + 2, y + 2, 3, 28, PAL.DIRT);
      vline(ctx, x + 5, y + 2, 28, PAL.BLACK);
      return;
    }
    rect(ctx, x, y, 20, 32, PAL.BLACK);
    rect(ctx, x + 1, y + 1, 18, 30, PAL.DIRT);
    for (var i = 0; i < 4; i++) {
      vline(ctx, x + 2 + i * 4, y + 1, 30, PAL.BROWN);
      vline(ctx, x + 3 + i * 4, y + 1, 30, PAL.WOOD);
    }
    rect(ctx, x + 1, y + 4, 18, 2, PAL.BROWN);   // cross braces
    rect(ctx, x + 1, y + 25, 18, 2, PAL.BROWN);
    disc(ctx, x + 15, y + 17, 2, PAL.BLACK);
    disc(ctx, x + 15, y + 17, 1, PAL.GOLD);
    frame(ctx, x, y, 20, 32, PAL.BLACK);
  }

  /* Steps receding away and down; 44x28 at (x,y). Bottom is black. */
  function stairsDown(ctx, x, y) {
    rect(ctx, x, y, 44, 28, PAL.BLACK);
    for (var i = 5; i >= 0; i--) {
      var sy = y + i * 4;
      var inset = (5 - i) * 3;
      var w = 44 - inset * 2;
      var shade = i > 3 ? PAL.STONE : (i > 1 ? PAL.STONE_DK : PAL.GREY);
      rect(ctx, x + inset, sy, w, 4, shade);
      hline(ctx, x + inset, sy, w, PAL.BLACK);
      hline(ctx, x + inset, sy + 3, w, PAL.BLACK);
      dither25(ctx, x + inset + 1, sy + 1, w - 2, 2, null, PAL.BLACK);
    }
    rect(ctx, x + 15, y + 24, 14, 4, PAL.BLACK);
    frame(ctx, x, y, 44, 28, PAL.BLACK);
  }

  /* Steps climbing away and up; 44x28 at (x,y). Light at the top. */
  function stairsUp(ctx, x, y) {
    rect(ctx, x, y, 44, 28, PAL.BLACK);
    for (var i = 0; i < 6; i++) {
      var sy = y + 24 - i * 4;
      var inset = i * 3;
      var w = 44 - inset * 2;
      var shade = i > 3 ? PAL.STONE : (i > 1 ? PAL.GREY : PAL.STONE_DK);
      rect(ctx, x + inset, sy, w, 4, shade);
      hline(ctx, x + inset, sy, w, PAL.STONE);
      hline(ctx, x + inset, sy + 3, w, PAL.BLACK);
    }
    dither(ctx, x + 15, y, 14, 4, PAL.STONE, PAL.WHITE);   // daylight at the top
  }

  /* Dark opening. dir: 'N'/'U'/'D' = arch facing the viewer (28x30),
   * 'E'/'W' = gap at that side wall (16x32). */
  function passage(ctx, x, y, dir) {
    dir = (dir || 'N').toString().toUpperCase().charAt(0);
    if (dir === 'E' || dir === 'W') {
      var flip = (dir === 'W');
      rect(ctx, x, y, 16, 32, PAL.BLACK);
      for (var r = 0; r < 32; r++) {
        var bite = Math.round(3 * Math.sin(r / 5)) + 3;
        var lx = flip ? x + 16 - bite : x;
        rect(ctx, lx, y + r, bite, 1, PAL.STONE_DK);
        px(ctx, flip ? lx : lx + bite - 1, y + r, PAL.BLACK);
      }
      dither25(ctx, flip ? x : x + 10, y, 6, 32, null, PAL.GREY);
      return;
    }
    /* arch: black outline ring, stone jamb, then the dark hole */
    var w = 28, h = 30, cx = x + (w >> 1), ay = y + 13;
    disc(ctx, cx, ay, 13, PAL.BLACK);
    rect(ctx, x, ay, w, h - 13, PAL.BLACK);
    disc(ctx, cx, ay, 12, PAL.STONE_DK);
    rect(ctx, x + 1, ay, w - 2, h - 13, PAL.STONE_DK);
    dither(ctx, x + 1, ay, 4, h - 13, null, PAL.GREY);         // jamb texture
    dither(ctx, x + w - 5, ay, 4, h - 13, null, PAL.GREY);
    disc(ctx, cx, ay + 1, 9, PAL.BLACK);
    rect(ctx, x + 5, ay + 1, w - 10, h - 14, PAL.BLACK);
    dither25(ctx, x + 5, ay + 1, w - 10, 6, null, PAL.STONE_DK);  // lit lintel
    hline(ctx, x, y + h - 1, w, PAL.BLACK);
  }

  /* Bottomless-looking pit. */
  function chasm(ctx, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    rect(ctx, x, y, w, h, PAL.BLACK);
    for (var c = 0; c < w; c++) {
      var d = 1 + Math.floor(hash(x + c, y) * 3);
      rect(ctx, x + c, y, 1, d, PAL.STONE_DK);
      px(ctx, x + c, y + d, PAL.BLACK);
      var d2 = 1 + Math.floor(hash(x + c, y + h) * 3);
      rect(ctx, x + c, y + h - d2, 1, d2, PAL.GREY);
    }
    dither(ctx, x, y + 2, w, 4, null, PAL.STONE_DK);
    dither25(ctx, x, y + h - 8, w, 6, null, PAL.STONE_DK);
  }

  /* Muddy/sandy shore strip — put it between grass and water. */
  function riverbank(ctx, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    rect(ctx, x, y, w, h, PAL.DIRT);
    dither(ctx, x, y, w, Math.max(1, h >> 1), null, PAL.TAN);
    dither25(ctx, x, y + h - Math.max(1, h >> 1), w, Math.max(1, h >> 1), null, PAL.BROWN);
    noise(ctx, x, y, w, h, PAL.BROWN, 0.06, 3);
    noise(ctx, x, y, w, h, PAL.WHITE, 0.03, 8);
    hline(ctx, x, y, w, PAL.BROWN);
  }

  /* Shell paints this over dark rooms: pitch black + a pair of grue eyes. */
  function darkOverlay(ctx, t) {
    t = t | 0;
    rect(ctx, 0, 0, SCENE_W, SCENE_H, PAL.BLACK);
    var cyc = t % 150;
    if (cyc < 8) return;                       // blink
    var drift = (Math.floor(t / 24) % 3) - 1;  // eyes shift a little, watching
    var ex = 56 + drift, ey = 48;
    var eye = [
      '.rrrr.',
      'ryyyyr',
      'ryykyr',
      '.rrrr.'
    ];
    var M = { r: PAL.CRIMSON, y: PAL.GOLD, k: PAL.BLACK };
    sprite(ctx, eye, ex, ey, M);
    sprite(ctx, eye, ex + 20, ey, M);
    if (cyc > 120) {                           // slow menacing glow
      dither25(ctx, ex - 4, ey - 3, 36, 10, null, PAL[0x06]);
    }
  }

  GUE.kit = {
    SCENE_W: SCENE_W,
    SCENE_H: SCENE_H,
    PAL: PAL,

    /* primitives */
    px: px, rect: rect, frame: frame, hline: hline, vline: vline,
    dither: dither, dither25: dither25, sprite: sprite,
    disc: disc, tri: tri, hash: hash, noise: noise, crack: crack,

    /* backdrops */
    sky: sky, nightSky: nightSky, cloud: cloud,
    grass: grass, cavefloor: cavefloor, caveCeiling: caveCeiling,

    /* props */
    tree: tree, rockWall: rockWall, water: water, torch: torch,
    door: door, stairsDown: stairsDown, stairsUp: stairsUp, passage: passage,
    houseWall: houseWall, window: windowProp, chasm: chasm, riverbank: riverbank,

    /* shell */
    darkOverlay: darkOverlay
  };
})();
