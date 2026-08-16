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
