window.GUE = window.GUE || {};
/* art/sprites.js — pixel sprites for every takeable object, the load-bearing
 * scenery, and the three monsters. Object IDs are the exact keys from
 * data/zork1_world.json. Small items are 16x16 so they double as inventory
 * icons; boats/rugs/monsters are larger.
 *
 *   GUE.sprites.draw(ctx, objId, x, y, t) -> true if drawn
 *   GUE.sprites.has(objId)                -> bool
 *   GUE.sprites.size(objId)               -> {w,h}
 */
(function () {
  'use strict';

  var GUE = window.GUE;
  var K = GUE.kit, PAL = K.PAL;

  /* One shared char->color map. Every grid below speaks this alphabet. */
  var P = {
    k: PAL.BLACK,      // outline / shadow
    d: PAL[0x2D],      // dark grey
    g: PAL[0x00],      // grey
    G: PAL[0x10],      // light grey / silver / steel
    w: PAL[0x30],      // white
    y: PAL[0x28],      // gold
    Y: PAL[0x37],      // pale gold / bone / parchment
    o: PAL[0x27],      // orange
    r: PAL[0x16],      // red
    R: PAL[0x05],      // crimson
    n: PAL[0x08],      // dark brown
    N: PAL[0x18],      // brown
    u: PAL[0x17],      // light wood
    e: PAL[0x1A],      // green
    E: PAL[0x0A],      // dark green
    l: PAL[0x29],      // light green
    b: PAL[0x11],      // blue
    B: PAL[0x02],      // dark blue
    c: PAL[0x2C],      // cyan
    s: PAL[0x21],      // sky
    S: PAL[0x31],      // pale sky
    p: PAL[0x23],      // violet
    q: PAL[0x03],      // dark violet
    m: PAL[0x14],      // magenta
    i: PAL[0x35],      // pink
    t: PAL[0x1C]       // teal
  };

  /* palMap variant: P plus/overriding a few chars */
  function ext(over) {
    var o = {}, kk;
    for (kk in P) if (Object.prototype.hasOwnProperty.call(P, kk)) o[kk] = P[kk];
    for (kk in over) if (Object.prototype.hasOwnProperty.call(over, kk)) o[kk] = over[kk];
    return o;
  }

  var S = {};   // objId -> {g, p} | function(ctx,x,y,t)

  /* register a grid sprite; rows are right-padded so a miscount can't crop */
  function G(id, grid, pmap) {
    var w = 0, i;
    for (i = 0; i < grid.length; i++) if (grid[i].length > w) w = grid[i].length;
    for (i = 0; i < grid.length; i++) {
      while (grid[i].length < w) grid[i] += '.';
    }
    S[id] = { g: grid, p: pmap || P, w: w, h: grid.length };
    return S[id];
  }
  function F(id, w, h, fn) { S[id] = { fn: fn, w: w, h: h }; }
  function alias(id, src, pmap) {
    var s = S[src];
    S[id] = pmap ? { g: s.g, p: pmap, w: s.w, h: s.h } : s;
  }

  /* ==================================================================
   * shared sub-generators — family resemblance without repetition
   * ================================================================ */

  /* faceted gem. cut 0 = brilliant (point down), 1 = emerald (table cut) */
  var GEM_BRILLIANT = [
    '................',
    '.....kkkkkk.....',
    '....k111111k....',
    '...k11111111k...',
    '..k1111111111k..',
    '..k1122222211k..',
    '..k1222222221k..',
    '...k22233222k...',
    '...k22333322k...',
    '....k333333k....',
    '....k333333k....',
    '.....k3333k.....',
    '......k33k......',
    '.......kk.......',
    '................',
    '................'
  ];
  var GEM_EMERALD = [
    '................',
    '................',
    '...kkkkkkkkkk...',
    '..k1111111111k..',
    '.k112222222211k.',
    '.k122333333221k.',
    '.k123333333321k.',
    '.k123333333321k.',
    '.k123333333321k.',
    '.k122333333221k.',
    '.k112222222211k.',
    '..k1111111111k..',
    '...kkkkkkkkkk...',
    '................',
    '................',
    '................'
  ];
  function gem(id, hi, mid, lo, cut) {
    var g = (cut ? GEM_EMERALD : GEM_BRILLIANT).slice();
    G(id, g, ext({ 1: hi, 2: mid, 3: lo }));
  }

  /* stoppered glass vessel; body/liquid colors swappable */
  function bottleShape(neck) {
    return [
      '......kkkk......',
      '......k11k......',
      '......k11k......',
      neck ? '.....kk11kk.....' : '......k11k......',
      '.....k1111k.....',
      '....k111111k....',
      '...k11111111k...',
      '...k11222211k...',
      '...k12222221k...',
      '...k12222221k...',
      '...k12222221k...',
      '...k12222221k...',
      '...k11222211k...',
      '...k11111111k...',
      '....kkkkkkkk....',
      '................'
    ];
  }

  /* flat rectangular page/leaflet with ruled lines */
  function pageGrid(fold) {
    return [
      '................',
      '..kkkkkkkkkkkk..',
      '..k1111111111k..',
      '..k12222222 1k..'.replace(' ', '2'),
      '..k1122222211k..',
      '..k1222222221k..',
      '..k1233333321k..',
      '..k1222222221k..',
      '..k1233333321k..',
      '..k1222222221k..',
      '..k1233332221k..',
      '..k1222222221k..',
      fold ? '..k1kkkkkkkk1k..' : '..k1222222221k..',
      '..k1111111111k..',
      '..kkkkkkkkkkkk..',
      '................'
    ];
  }

  /* long tool: shaft from (0,15) up to (11,4) with a head block on top */
  function toolShaft(grid) { return grid; }

  /* ==================================================================
   * TREASURES
   * ================================================================ */

  G('EGG', [
    '................',
    '......kkkk......',
    '....kkyyyykk....',
    '...kyyyyyyyyk...',
    '..kwwyyyyyyyyk..',
    '..kwyyyybyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kyyRyyyyyeyk..',
    '..kyyyyyyyyyyk..',
    '..kyyyyybyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kynyyyyyynyk..',
    '...kynnyynnyk...',
    '...kknnnnnnkk...',
    '....kkkkkkkk....',
    '................'
  ]);

  G('BROKEN-EGG', [
    '................',
    '..k..kkkk....k..',
    '..kkyyyykk..k...',
    '.kyyyyyyyyk.....',
    'kwyyyybyyyyk....',
    '.kyykyyykyyk....',
    '..kykkkkkykk....',
    '..kkkGGGkkk.....',
    '..kyGGGGGyk.....',
    '..kyyGGGyyk.....',
    '..kynyyyynk.....',
    '...kknnnnkk.....',
    '....kkkkkk......',
    '................',
    '................',
    '................'
  ]);

  G('CANARY', [
    '................',
    '.......kkk......',
    '......kyyyk.....',
    '.....kykwyyk....',
    '....koykkyyk....',
    '.....kyyyyyk....',
    '....kyyGGyyyk...',
    '...kyyGGGGyyyk..',
    '..kyyyGGGGyyyyk.',
    '..kyyyyGGyyyyyk.',
    '..kyyyyyyyyyyk..',
    '...kyyyyyyyk....',
    '....kkyyykk.....',
    '.....koyok......',
    '.....kk.kk......',
    '................'
  ]);

  G('BROKEN-CANARY', [
    '................',
    '.......kkk......',
    '......kyyyk..G..',
    '.....kykkyyk.G..',
    '....koykkyykGk..',
    '.....kyyyyyGk...',
    '....kyyGGkGk....',
    '...kyyGkkGGk....',
    '..kyyykGGkyyk...',
    '..kyyyyGkyyyk...',
    '..kyykyyyyyk....',
    '...kyykyyyk.....',
    '....kkyykk......',
    '.....koyk.......',
    '.....kk.k.......',
    '................'
  ]);

  G('BAUBLE', [
    '................',
    '.......kk.......',
    '......kGGk......',
    '......kGGk......',
    '....kkkyykkk....',
    '...kyyyyyyyyk...',
    '..kyywwyyyyyyk..',
    '..kywwyyyyoyyk..',
    '..kyyyyyyyoyyk..',
    '..kyyyoyyyyyyk..',
    '..kyyyoyyyyoyk..',
    '..kyyyyyyyyyyk..',
    '...kyyyyyyyyk...',
    '....kkyyyykk....',
    '......kkkk......',
    '................'
  ]);

  G('PAINTING', [
    '.kkkkkkkkkkkkkk.',
    '.kyyyyyyyyyyyyk.',
    '.kykkkkkkkkkkyk.',
    '.kykSSSSSSSSkyk.',
    '.kykSSSwwSSSkyk.',
    '.kykSSwwwwSSkyk.',
    '.kykSEEEEEESkyk.',
    '.kykEEnnnnEEkyk.',
    '.kykEnnwwnnEkyk.',
    '.kyknnnwwnnnkyk.',
    '.kyknnnnnnnnkyk.',
    '.kykkkkkkkkkkyk.',
    '.kyyyyyyyyyyyyk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................'
  ]);

  G('COFFIN', [
    '................',
    '....kkkkkkkk....',
    '...kyyyyyyyyk...',
    '..kyywwyyyyyyk..',
    '..kywwyyyyyyyk..',
    '.kyyyyyyyyyyyyk.',
    '.kyyykkkkkkyyyk.',
    '.kyykYYYYYYkyyk.',
    '.kyykYkkkkYkyyk.',
    '.kyykYYYYYYkyyk.',
    '.kyyykkkkkkyyyk.',
    '.kyyyyyyyyyyyyk.',
    '..kyyyyyyyyyyk..',
    '..kkyyyyyyyykk..',
    '...kkkkkkkkkk...',
    '................'
  ]);

  G('SCEPTRE', [
    '............kkk.',
    '...........kyyyk',
    '..........kymmyk',
    '..........kyyyyk',
    '.........kkyyykk',
    '........kyyykk..',
    '.......kyyyk....',
    '......kyyyk.....',
    '.....kyyyk......',
    '....kyyyk.......',
    '...kyyyk........',
    '..kyyyk.........',
    '..kyyk..........',
    '.kyyk...........',
    '.kykk...........',
    '.kk.............'
  ]);

  G('TRUNK', [
    '................',
    '..kkkkkkkkkkkk..',
    '..kNNNNNNNNNNk..',
    '.kNuuuuuuuuuuNk.',
    '.kNbkmkckrkpkNk.',
    '.kNkbkmkckrkkNk.',
    '.kNyyyyyyyyyyNk.',
    'kkNNNNNNNNNNNNkk',
    'kNuuuuuuuuuuuuNk',
    'kNuNyyNNNNyyNuNk',
    'kNuNNNNNNNNNNuNk',
    'kNuuuuuuuuuuuuNk',
    'kNNNNNNNNNNNNNNk',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................'
  ]);

  G('TRIDENT', [
    '..k...kk...k....',
    '.kSk.kSSk.kSk...',
    '.kSk.kSSk.kSk...',
    '.kSk.kSSk.kSk...',
    '.kSkkkSSkkkSk...',
    '.kSSSSSSSSSSk...',
    '.kSSSSSSSSSSk...',
    '..kkkkSSkkkk....',
    '.....kSSk.......',
    '.....kSSk.......',
    '.....kGGk.......',
    '.....kSSk.......',
    '.....kSSk.......',
    '.....kGGk.......',
    '.....kSSk.......',
    '.....kkkk.......'
  ]);

  G('JADE', [
    '................',
    '.....kkkk.......',
    '....keeeek......',
    '....kelleek.....',
    '....keeeeek.....',
    '...kkkeeekkk....',
    '..kelEeeeElek...',
    '..keelEEEEleek..',
    '..kEeeEEEEeeEk..',
    '...kkeEEEEekk...',
    '....kEEEEEEk....',
    '....kEEkkEEk....',
    '....kEEkkEEk....',
    '...kkEkkkkEkk...',
    '...kEEk..kEEk...',
    '...kkkk..kkkk...'
  ]);

  gem('DIAMOND', PAL[0x30], PAL[0x31], PAL[0x21], 0);
  gem('EMERALD', PAL[0x2A], PAL[0x1A], PAL[0x0A], 1);
  gem('SAPPHIRE', PAL[0x21], PAL[0x11], PAL[0x02], 0);

  G('BRACELET', [
    '................',
    '....kkkkkkkk....',
    '...kyyyyyyyyk...',
    '..kyykkkkkkyyk..',
    '..kykbbkkbbkyk..',
    '.kyykbBkkBbkyyk.',
    '.kyk..kk..kkyyk.',
    '.kyk......kkyyk.',
    '.kyk......kkyyk.',
    '.kyykbBkkBbkyyk.',
    '..kykbbkkbbkyk..',
    '..kyykkkkkkyyk..',
    '...kyyyyyyyyk...',
    '....kkkkkkkk....',
    '................',
    '................'
  ]);

  G('CHALICE', [
    '................',
    '..kkkkkkkkkkkk..',
    '..kGwwGGGGGGGk..',
    '..kGwGGGGGGGGk..',
    '...kGGGGGGGGk...',
    '...kGGyyyyGGk...',
    '....kGGGGGGk....',
    '.....kGGGGk.....',
    '......kGGk......',
    '......kGGk......',
    '......kGGk......',
    '.....kkGGkk.....',
    '....kGGGGGGk....',
    '...kGGGGGGGGk...',
    '...kkkkkkkkkk...',
    '................'
  ]);

  G('POT-OF-GOLD', [
    '................',
    '................',
    '....yy...yy.....',
    '...kyyk.kyyk....',
    '..kyyyykyyyyk...',
    '.kkyyyyyyyyykk..',
    'kkkkkkkkkkkkkkk.',
    'kddddddddddddkk.',
    'kdggggggggggdk..',
    'kdgddddddddgdk..',
    '.kdgggggggggdk..',
    '.kddddddddddk...',
    '..kddddddddk....',
    '...kkkkkkkk.....',
    '................',
    '................'
  ]);

  G('BAR', [
    '................',
    '................',
    '................',
    '.....kkkkkkkkk..',
    '....kwGGGGGGGkk.',
    '...kwGGGGGGGGGGk',
    '..kGGGGGGGGGGGGk',
    '..kGGdddddddGGGk',
    '..kGGdGGGGGdGGGk',
    '..kGGdddddddGGdk',
    '..kGGGGGGGGGGddk',
    '..kdddddddddddk.',
    '...kkkkkkkkkkk..',
    '................',
    '................',
    '................'
  ]);

  G('SKULL', [
    '................',
    '.....kkkkkk.....',
    '...kkSSSSSSkk...',
    '..kSSSSSSSSSSk..',
    '..kSSwSSSSwSSk..',
    '..kSkkSSSSkkSk..',
    '..kSkBkSSkBkSk..',
    '..kSkkkSSkkkSk..',
    '..kSSSSkkSSSSk..',
    '...kSSSSSSSSk...',
    '...kSkSkSkSkk...',
    '....kSSSSSSk....',
    '....kkkkkkkk....',
    '................',
    '................',
    '................'
  ]);

  G('SCARAB', [
    '................',
    '......kkkk......',
    '.....kcccck.....',
    '....kckkkkck....',
    '...kcccccccck...',
    '..kctcccccctck..',
    '.kcctcccccctcck.',
    'kccctckkkkctccck',
    'kctttcccccctttck',
    'kcttcccyyccctcck',
    '.kctcccyycccck..',
    '..kcttcccctck...',
    '...kkctttckk....',
    '.....kkkkk......',
    '................',
    '................'
  ]);

  /* Drawstring sack: gathered neck, tie, round belly, coins glinting at the
   * mouth. The old all-gold teardrop read as a flame. */
  G('BAG-OF-COINS', [
    '................',
    '.....kkkkkk.....',
    '....kyYwYyk.....',
    '....kknNNkk.....',
    '.....knNnk......',
    '....kknNNkk.....',
    '...knNNNNNnk....',
    '..knNNNNNNNnk...',
    '.knNYNNNNNNNnk..',
    '.knNYNNNNNNNnk..',
    'knNNNNNNNNNNNnk.',
    'knNNNNNNNNNNNnk.',
    'knnNNNNNNNNNnnk.',
    '.knnNNNNNNNnnk..',
    '..kknnNNNnnkk...',
    '....kkkkkkk.....'
  ]);

  G('COAL', [
    '................',
    '................',
    '................',
    '.......kk.......',
    '......kddk......',
    '....kkdgdkk.....',
    '...kdddgddkk....',
    '..kkdgdddgddk...',
    '.kdddddgdddddk..',
    'kddgdddddgdddkk.',
    'kdddddgddddddgdk',
    'kdgdddddgdddddk.',
    '.kkkkkkkkkkkkk..',
    '................',
    '................',
    '................'
  ]);

  G('GUNK', [
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '....kkGGGGkk....',
    '...kGGwGGGGGk...',
    '..kGGGGGGdGGk...',
    '..kGdGGGGGGGGk..',
    '..kGGGGdGGGdGk..',
    '...kGGGGGGGGk...',
    '....kkkGGGkk....',
    '.......kkk......',
    '................',
    '................',
    '................'
  ]);

  /* ==================================================================
   * LIGHT + TOOLS
   * ================================================================ */

  G('LAMP', [
    '.......kk.......',
    '......k..k......',
    '.....kkkkkk.....',
    '.....kyYYyk.....',
    '....kkkkkkkk....',
    '....kyYYYYyk....',
    '....kywwwwyk....',
    '....kywwwwyk....',
    '....kywwwwyk....',
    '....kywwwwyk....',
    '....kyYYYYyk....',
    '....kkkkkkkk....',
    '.....kyYYyk.....',
    '.....kkkkkk.....',
    '................',
    '................'
  ]);
  alias('BROKEN-LAMP', 'LAMP', ext({ y: PAL[0x00], Y: PAL[0x2D], w: PAL[0x10] }));
  alias('BURNED-OUT-LANTERN', 'LAMP', ext({ y: PAL[0x18], Y: PAL[0x08], w: PAL[0x2D] }));

  G('TORCH', [
    '.......r........',
    '......rrr.......',
    '.....rroyr......',
    '....rroyyor.....',
    '....royywyor....',
    '....royyywor....',
    '.....rooyor.....',
    '......rror......',
    '......kkkk......',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '......kkkk......'
  ]);

  G('CANDLES', [
    '...r......r.....',
    '..roy....roy....',
    '..royk...royk...',
    '...rk.....rk....',
    '..kkkk..kkkk....',
    '..kwwk..kwwk....',
    '..kwwk..kwwk....',
    '..kwwk..kwwk....',
    '..kwwkkkkwwk....',
    '..kwwkwwkwwk....',
    '..kwwkwwkwwk....',
    '..kwYkwYkwYk....',
    '..kwYkwYkwYk....',
    '..kkkkkkkkkk....',
    '................',
    '................'
  ]);

  G('MATCH', [
    '................',
    '................',
    '..kkkkkkkkkkk...',
    '..kNNNNNNNNNk...',
    '..kNuuuuuuuNk...',
    '..kNuRRRRRuNk...',
    '..kNuRwwRRuNk...',
    '..kNuRRRRRuNk...',
    '..kNuuuuuuuNk...',
    '..kNkkkkkkkNk...',
    '..kNwwwwwwwNk...',
    '..kNrkrkrkrNk...',
    '..kNNNNNNNNNk...',
    '..kkkkkkkkkkk...',
    '................',
    '................'
  ]);

  G('SWORD', [
    '.............kk.',
    '............kSGk',
    '...........kSGk.',
    '..........kSGk..',
    '.........kSGk...',
    '........kSGk....',
    '.......kSGk.....',
    '......kSGk......',
    '.....kSGk.......',
    '....kkSkk.......',
    '...kyykykk......',
    '..kyykkkyyk.....',
    '..kkk.kkkkk.....',
    '..kNk...........',
    '..kNk...........',
    '..kkk...........'
  ]);

  G('KNIFE', [
    '..............k.',
    '.............kGk',
    '............kGGk',
    '...........kGGk.',
    '..........kGGk..',
    '.........kGwk...',
    '........kGGk....',
    '.......kGGk.....',
    '......kGwk......',
    '.....kkGkk......',
    '....kkkkk.......',
    '...kNuuNk.......',
    '..kNuuNk........',
    '..kNuNk.........',
    '..kkkk..........',
    '................'
  ]);
  alias('RUSTY-KNIFE', 'KNIFE', ext({ G: PAL[0x18], w: PAL[0x17], N: PAL[0x07], u: PAL[0x08] }));

  G('STILETTO', [
    '.........kk.....',
    '........kGk.....',
    '........kGk.....',
    '.......kGGk.....',
    '.......kGk......',
    '......kGGk......',
    '......kGk.......',
    '.....kGGk.......',
    '.....kGk........',
    '....kkGkk.......',
    '...kkkkkkk......',
    '....kdddk.......',
    '....kdRdk.......',
    '....kdddk.......',
    '....kkdkk.......',
    '.....kkk........'
  ]);

  G('AXE', [
    '................',
    '....kkkkkk......',
    '...kGGGGGGk.....',
    '..kGGwwGGRGk....',
    '.kGGwwGGGRRGk...',
    '.kGGGGGGGRRGk...',
    '.kGGGGGGkkNkk...',
    '..kGGGGkkNNk....',
    '...kkkkkNNk.....',
    '.......kNNk.....',
    '.......kNNk.....',
    '......kNNk......',
    '......kNNk......',
    '.....kNNk.......',
    '.....kNNk.......',
    '.....kkkk.......'
  ]);

  G('ROPE', [
    '................',
    '...kkkkkkkkk....',
    '..kYYYYYYYYYk...',
    '.kYnYnYnYnYnYk..',
    '.kYYYYYYYYYYYk..',
    '.kkkkkkkkkkkkk..',
    '.kYnYnYnYnYnYk..',
    '.kYYYYYYYYYYYk..',
    '.kkkkkkkkkkkkk..',
    '.kYnYnYnYnYnYk..',
    '..kYYYYYYYYYk...',
    '...kkkkkkkkk....',
    '......kYk.......',
    '......kYk.......',
    '......kkk.......',
    '................'
  ]);

  G('SHOVEL', [
    '.......kk.......',
    '......kNNk......',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '.....kkNukk.....',
    '....kGGGGGGk....',
    '...kGGwGGGGGk...',
    '..kGGGGGGGGGGk..',
    '..kGGGGGGGGGGk..',
    '..kGdGGGGGGdGk..',
    '...kGGGGGGGGk...',
    '....kkGGGGkk....',
    '......kkkk......'
  ]);

  G('WRENCH', [
    '................',
    '....kkk.kkk.....',
    '...kGGGkGGGk....',
    '...kGGGkGGGk....',
    '...kGGkkkGGk....',
    '....kGGGGGk.....',
    '.....kGGGk......',
    '.....kGwGk......',
    '.....kGGGk......',
    '.....kGGGk......',
    '.....kGwGk......',
    '....kkGGGkk.....',
    '...kGGkkkGGk....',
    '...kGGGkGGGk....',
    '...kkkk.kkkk....',
    '................'
  ]);

  G('SCREWDRIVER', [
    '................',
    '.....kkkk.......',
    '....kRRRRk......',
    '....kRrrRk......',
    '....kRrrRk......',
    '....kRrrRk......',
    '....kRrrRk......',
    '....kRRRRk......',
    '.....kGGk.......',
    '.....kGwk.......',
    '.....kGwk.......',
    '.....kGwk.......',
    '.....kGwk.......',
    '.....kGGk.......',
    '.....kkkk.......',
    '................'
  ]);

  G('PUMP', [
    '.......kk.......',
    '......kNNk......',
    '.....kkNNkk.....',
    '....kNNNNNNk....',
    '.....kkGGkk.....',
    '.......GG.......',
    '....kkkGGkkk....',
    '...kGGGGGGGGk...',
    '..kGGwGGGGGGk...',
    '..kGwGGGGGGGGk..',
    '..kGGGGGGGGGGk..',
    '..kGGGGGGGGGGk..',
    '..kGdGGGGGGdGk..',
    '..kkGGGGGGGGkk..',
    '...kkkkkkkkkk...',
    '.......kk...kk..'
  ]);

  G('KEYS', [
    '................',
    '....kkkk........',
    '...kGGGGk.......',
    '..kGGkkGGk......',
    '..kGkwwkGk......',
    '..kGGkkGGk......',
    '...kGGGGk.......',
    '....kGGk........',
    '.....kGGk.......',
    '......kGGk......',
    '.......kGGk.....',
    '........kGGkkk..',
    '.........kGGGGk.',
    '.........kGkkGk.',
    '.........kkk.kk.',
    '................'
  ]);

  G('BOLT', [
    '................',
    '................',
    '.....kkkkk......',
    '....kGGGGGk.....',
    '...kGGwwGGGk....',
    '..kGGwwGGGGGk...',
    '..kGGGGGGGGGk...',
    '..kGGGGGGGGGk...',
    '...kGGGGGGGk....',
    '....kkkGGkkk....',
    '.....kGGGGk.....',
    '.....kGdGdk.....',
    '.....kGGGGk.....',
    '.....kkkkkk.....',
    '................',
    '................'
  ]);

  G('TIMBERS', [
    '................',
    '................',
    '..kkk...........',
    '.kNuNkkk........',
    '.kNuuuuNkkk.....',
    '.kNuuuuuuuNkkk..',
    '.kkNuuuuuuuuuNk.',
    '..kkNNuuuuuuNk..',
    '....kkkNNNNkk...',
    '..kkk...........',
    '.kNuNkkkkk......',
    '.kNuuuuuuNkk....',
    '.kkNuuuuuuuNk...',
    '..kkNNNNNNNkk...',
    '....kkkkkkk.....',
    '................'
  ]);

  /* ================================================================
   * CONTAINERS / READABLES / FOOD
   * ============================================================== */

  G('BOOK', [
    '................',
    '..kkkkkkkkkkkk..',
    '..kddddddddddk..',
    '..kdkkkkkkkkdk..',
    '..kdkYYYYYYkdk..',
    '..kdkYkkkkYkdk..',
    '..kdkYkyykYkdk..',
    '..kdkYkyykYkdk..',
    '..kdkYkkkkYkdk..',
    '..kdkYYYYYYkdk..',
    '..kdkkkkkkkkdk..',
    '..kddddddddddk..',
    '..kdwwwwwwwwdk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................'
  ]);
  alias('GUIDE', 'BOOK', ext({ d: PAL[0x1A], Y: PAL[0x37], y: PAL[0x0A] }));
  alias('OWNERS-MANUAL', 'BOOK', ext({ d: PAL[0x11], Y: PAL[0x31], y: PAL[0x02] }));

  G('ADVERTISEMENT', pageGrid(0), ext({ 1: PAL[0x30], 2: PAL[0x37], 3: PAL[0x00] }));
  G('MAP', pageGrid(1), ext({ 1: PAL[0x37], 2: PAL[0x36], 3: PAL[0x07] }));
  G('BOAT-LABEL', pageGrid(0), ext({ 1: PAL[0x37], 2: PAL[0x38], 3: PAL[0x08] }));
  G('PRAYER', pageGrid(0), ext({ 1: PAL[0x10], 2: PAL[0x30], 3: PAL[0x00] }));

  G('SANDWICH-BAG', [
    '................',
    '...kkkkkkkkkk...',
    '...kNNNNNNNNk...',
    '...kNuuuuuuNk...',
    '..kkNuuuuuuNkk..',
    '..kNNuuuuuuNNk..',
    '..kNuuuuuuuuNk..',
    '..kNuuNuuNuuNk..',
    '..kNuuuuuuuuNk..',
    '..kNuuuuuuuuNk..',
    '..kNuNuuuuNuNk..',
    '..kNuuuuuuuuNk..',
    '..kNNuuuuuuNNk..',
    '..kkNNNNNNNNkk..',
    '....kkkkkkkk....',
    '................'
  ]);

  G('LARGE-BAG', [
    '................',
    '....kkk..kkk....',
    '...kdddkkdddk...',
    '..kdddddddddk...',
    '.kkddddddddddkk.',
    '.kdddddddddddddk',
    'kddddkkkkkddddgk',
    'kdddkgggggkdddgk',
    'kddkggyyyggkddgk',
    'kddkgyyyyygkddgk',
    'kdddkgggggkdddgk',
    'kddddkkkkkddddgk',
    '.kdddddddddddgk.',
    '.kkdddddddddgkk.',
    '...kkkkkkkkkk...',
    '................'
  ]);

  G('BOTTLE', bottleShape(1), ext({ 1: PAL[0x31], 2: PAL[0x11] }));
  G('TUBE', [
    '................',
    '................',
    '.....kkkk.......',
    '....kGGGGk......',
    '....kGwwGk......',
    '...kkGGGGkk.....',
    '..kGGGGGGGGk....',
    '..kGwGGGGGGk....',
    '..kGwGGGGGGk....',
    '..kGGGGGGGGk....',
    '..kGGGGGGGGk....',
    '..kGGGGGGGGk....',
    '..kkGGGGGGkk....',
    '...kkkkkkkk.....',
    '.....kkkk.......',
    '................'
  ]);

  G('WATER', [
    '................',
    '.......kk.......',
    '......kbbk......',
    '......kbbk......',
    '.....kbSbbk.....',
    '.....kbSbbk.....',
    '....kbSbbbbk....',
    '....kbSbbbbk....',
    '...kbSbbbbbbk...',
    '...kbbbbbbbbk...',
    '..kbbbbbbbbbbk..',
    '..kbbbbbbbbbbk..',
    '..kBbbbbbbbBBk..',
    '...kBBbbbbBBk...',
    '....kkBBBBkk....',
    '......kkkk......'
  ]);

  G('GARLIC', [
    '................',
    '.......ll.......',
    '......lkl.......',
    '......kek.......',
    '.....kkkkk......',
    '....kwwYYwk.....',
    '...kwwYwYYwk....',
    '..kwYwYwYwYwk...',
    '..kwYwYwYwYwk...',
    '..kwYwYwYwYwk...',
    '..kwYYwYwYYwk...',
    '..kwwYYwYYwwk...',
    '...kwwYYYYwk....',
    '....kkwwwkk.....',
    '......kkk.......',
    '................'
  ]);

  G('LUNCH', [
    '................',
    '................',
    '..kkkkkkkkkkk...',
    '.kYYYYYYYYYYYk..',
    '.kYYuYYYYuYYYk..',
    '.kkkkkkkkkkkkk..',
    '.kEEeEEeEEeEEk..',
    '.krrrrrrrrrrrk..',
    '.kYYYYYYYYYYYk..',
    '.kwwwwwwwwwwwk..',
    '.kkkkkkkkkkkkk..',
    '.kYuYYYYYuYYYk..',
    '.kYYYYYYYYYYYk..',
    '..kkkkkkkkkkk...',
    '................',
    '................'
  ]);

  G('LEAVES', [
    '................',
    '................',
    '................',
    '.....kk...kk....',
    '....kolk.koyk...',
    '...koookkooolk..',
    '..kolookoooook..',
    '.kooookkkoooook.',
    'kolookoyokoooolk',
    'koooooooooooookk',
    'kyokooookooookok',
    'kooooooooooooook',
    '.kkookoookookkk.',
    '..kkkkkkkkkkk...',
    '................',
    '................'
  ]);

  G('NEST', [
    '................',
    '................',
    '................',
    '....kkkkkkkk....',
    '...kNuNuNuNuk...',
    '..kNuNuNuNuNuk..',
    '.kNuNkkkkkkNuNk.',
    '.kuNkSSkSSkuNuk.',
    'kNuNkSSkSSkNuNuk',
    'kuNuNkkkkkNuNuNk',
    'kNuNuNuNuNuNuNuk',
    '.kuNuNuNuNuNuNk.',
    '..kNuNuNuNuNuk..',
    '...kkkkkkkkkk...',
    '................',
    '................'
  ]);

  G('BELL', [
    '................',
    '.......kk.......',
    '......kNNk......',
    '.....kkyykk.....',
    '....kyyyyyyk....',
    '...kyywyyyyyk...',
    '...kywyyyyyyk...',
    '..kyyyyyyyyyyk..',
    '..kyyyyyyyyyyk..',
    '.kyyyyyyyyyyyyk.',
    '.kyyyyyyyyyyyyk.',
    'kkyyyyyyyyyyyykk',
    'kkkkkkkkkkkkkkkk',
    '......kyyk......',
    '......kkkk......',
    '................'
  ]);
  alias('HOT-BELL', 'BELL', ext({ y: PAL[0x16], w: PAL[0x28], N: PAL[0x00] }));

  G('BUOY', [
    '................',
    '.......kk.......',
    '......kGGk......',
    '.....kkGGkk.....',
    '....kRRRRRRk....',
    '...kRrrRRRRRk...',
    '..kRrRRRRRRRRk..',
    '..kRRRRRRRRRRk..',
    '.kRRRRwwwwRRRRk.',
    '.kRRRRwwwwRRRRk.',
    '..kRRRRRRRRRRk..',
    '..kRRRRRRRRRRk..',
    '...kRRRRRRRRk...',
    '....kkRRRRkk....',
    '......kkkk......',
    '................'
  ]);

  G('INFLATABLE-BOAT', [
    '................',
    '................',
    '................',
    '................',
    '.....kkkkk......',
    '...kkdddddkk....',
    '..kdddYdddddk...',
    '.kdddddddYdddk..',
    'kddYdddddddddkk.',
    'kdddddYdddddddk.',
    'kdddddddddYdddk.',
    '.kkddddddddddk..',
    '..kkkkkkkkkkk...',
    '................',
    '................',
    '................'
  ]);

  G('INFLATED-BOAT', [
    '........................',
    '........................',
    '.....kkkkkkkkkkkkkk.....',
    '...kkddddddddddddddkk...',
    '..kdddddddddddddddddk...',
    '.kddwwddddddddddddddkk..',
    'kddwwddkkkkkkkkkkdddddk.',
    'kdddddkYYYYYYYYYkdddddk.',
    'kddddkYYNNNNNYYYYkddddk.',
    'kddddkYYYYYYYYYYYkddddk.',
    'kdddddkkkkkkkkkkkdddddk.',
    'kdddddddddddddddddddddk.',
    '.kddddddddddddddddddddk.',
    '.kkddddddddddddddddddkk.',
    '..kkkkkkkkkkkkkkkkkkkk..',
    '........................'
  ]);
  G('PUNCTURED-BOAT', [
    '........................',
    '........................',
    '........................',
    '........................',
    '.....kkkkkkkkk..........',
    '...kkdddddddddkkk.......',
    '..kddddkkddddddddkk.....',
    '.kdddkk..kkddddddddk....',
    'kdddk......kdddddddddk..',
    'kddk........kddddddddkk.',
    'kdddkk....kkddddddddddk.',
    '.kddddkkkkddddddddddddk.',
    '..kkddddddddddddddddkk..',
    '....kkkkkkkkkkkkkkkk....',
    '........................',
    '........................'
  ]);

  G('BONES', [
    '................',
    '................',
    '...kkkk.........',
    '..kSSSSk........',
    '..kSkkSk...kk...',
    '..kSSSSk..kSSk..',
    '...kkkk..kSSk...',
    '..kkkkkkkSSk....',
    '.kSSSSSSSSk.....',
    'kSkSkSkSkSSk....',
    'kSkSkSkSkkSk....',
    '.kSSSSSSSk.kkk..',
    '..kkkkkkk.kSSk..',
    '.kSk..kSk.kkk...',
    '.kSk..kSk.......',
    '.kkk..kkk.......'
  ]);

  G('BUBBLE', [
    '................',
    '................',
    '......kkkk......',
    '....kkllllkk....',
    '...klwleeeelk...',
    '..klwleeeeeelk..',
    '..kleeeeeeeelk..',
    '.kleeeeeeeeeelk.',
    '.kleeeeeeeeeelk.',
    '..kleeeeeeeelk..',
    '..klEeeeeeeElk..',
    '...klEEeeEElk...',
    '....kklEElkk....',
    '......kkkk......',
    '................',
    '................'
  ]);

  G('PUTTY', [
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '....kkiiiikk....',
    '...kiiwiiiiik...',
    '..kiiiiiiiiiik..',
    '.kiiiiiiiiiiiik.',
    '.kiiiiiiiiiiiik.',
    '..kiiiiiiiiiik..',
    '...kkiiiiiikk...',
    '.....kkkkkk.....',
    '................',
    '................',
    '................'
  ]);

  /* ================================================================
   * SCENERY (clickable, drawn by scenes)
   * ============================================================== */

  G('MAILBOX', [
    '................',
    '....kkkkkkkk....',
    '...kGGGGGGGGk...',
    '..kGwwwwwwwwGk..',
    '..kGwkkkkkkwGk..',
    '..kGwkRRRRkwGk..',
    '..kGwkRRRRkwGk..',
    '..kGwkkkkkkwGk..',
    '..kGwwwwwwwwGk..',
    '..kkGGGGGGGGkk..',
    '....kkkNNkkk....',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '......kNuk......',
    '.....kkNukk.....'
  ]);

  G('RUG', [
    '................................',
    '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '.kRRRRRRRRRRRRRRRRRRRRRRRRRRRRk.',
    '.kRyyyyyyyyyyyyyyyyyyyyyyyyyyRk.',
    '.kRykkkkkkkkkkkkkkkkkkkkkkkkyRk.',
    '.kRykqqqqmqqqqqqqqqqmqqqqqqqykk.',
    '.kRykqmqqqqmqqqqmqqqqqqmqqqqyRk.',
    '.kRykqqqqqqqqmqqqqqqmqqqqqqqyRk.',
    '.kRykqqmqqqqqqqqqqqqqqqqmqqqyRk.',
    '.kRykkkkkkkkkkkkkkkkkkkkkkkkyRk.',
    '.kRyyyyyyyyyyyyyyyyyyyyyyyyyyRk.',
    '.kRRRRRRRRRRRRRRRRRRRRRRRRRRRRk.',
    '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '................................'
  ]);

  G('TRAP-DOOR', [
    '........................',
    '..kkkkkkkkkkkkkkkkkkkk..',
    '.kNNNNNNNNNNNNNNNNNNNNk.',
    '.kNuuuuuuuuuuuuuuuuuuNk.',
    '.kNuNuNuNuNuNuNuNuNuuNk.',
    '.kNuuuuuuuuuuuuuuuuuuNk.',
    '.kNuuuuukkkkkkuuuuuuuNk.',
    '.kNuuuukGGGGGGkuuuuuuNk.',
    '.kNuuuukGkkkkGkuuuuuuNk.',
    '.kNuuuukGGGGGGkuuuuuuNk.',
    '.kNuuuuukkkkkkuuuuuuuNk.',
    '.kNuNuNuNuNuNuNuNuNuuNk.',
    '.kNuuuuuuuuuuuuuuuuuuNk.',
    '.kNNNNNNNNNNNNNNNNNNNNk.',
    '..kkkkkkkkkkkkkkkkkkkk..',
    '........................'
  ]);

  G('TROPHY-CASE', [
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kNNNNNNNNNNNNNNNNNNNNNNk',
    'kNuuuuuuuuuuuuuuuuuuuuNk',
    'kNukkkkkkkkkkkkkkkkkkuNk',
    'kNukSSSSSSSkSSSSSSSSSkuk',
    'kNukSSSSSSSkSSSSSSSSSkuk',
    'kNukSSSSSSSkSSSSSSSSSkuk',
    'kNukkkkkkkkkkkkkkkkkkkuk',
    'kNuNNNNNNNNNNNNNNNNNNuNk',
    'kNukkkkkkkkkkkkkkkkkkuNk',
    'kNukSSSSSSSkSSSSSSSSSkuk',
    'kNukSSSSSSSkSSSSSSSSSkuk',
    'kNukSSSSSSSkSSSSSSSSSkuk',
    'kNukkkkkkkkkkkkkkkkkkkuk',
    'kNuuuuuuuuuuuuuuuuuuuuNk',
    'kNNNNNNNNNNNNNNNNNNNNNNk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    '.kk................kk...'
  ]);

  G('KITCHEN-WINDOW', [
    'kkkkkkkkkkkkkkkkkk',
    'kwwwwwwwwwwwwwwwwk',
    'kwkkkkkkkkkkkkkkwk',
    'kwkSSSSSSkSSSSSkwk',
    'kwkSSwwSSkSSSSSkwk',
    'kwkSSwSSSkSSSSSkwk',
    'kwkSSSSSSkSSSSSkwk',
    'kwkkkkkkkkkkkkkkwk',
    'kwwwwwwwwwwwwwwwwk',
    'kwkkkkkkkkkkkkkkwk',
    'kwkSSSSSSkSSSSSkwk',
    'kwkSSSSSSkSSSSSkwk',
    'kwkSSSSSSkSSSSSkwk',
    'kwkSSSSSSkSSSSSkwk',
    'kwkkkkkkkkkkkkkkwk',
    'kwwwwwwwwwwwwwwwwk',
    'kkkkkkkkkkkkkkkkkk',
    '..................'
  ]);
  alias('BOARDED-WINDOW', 'KITCHEN-WINDOW', ext({ S: PAL[0x08], w: PAL[0x18] }));

  G('GRATE', [
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    'kgggggggggggggggggggggg k'.replace(' ', 'g'),
    'kgkkkkkkkkkkkkkkkkkkkkgk',
    'kgkGkGkGkGkGkGkGkGkGkkgk',
    'kgkGkGkGkGkGkGkGkGkGkkgk',
    'kgkkkkkkkkkkkkkkkkkkkkgk',
    'kgkGkGkGkGkGkGkGkGkGkkgk',
    'kgkGkGkGkGkGkGkGkGkGkkgk',
    'kgkkkkkkkkkkkkkkkkkkkkgk',
    'kgkGkGkGkGkGkGkGkGkGkkgk',
    'kgkGkGkGkGkGkGkGkGkGkkgk',
    'kgkkkkkkkkkkkkkkkkkkkkgk',
    'kgggggggggggggggggggggkk',
    '.kkkkkkkkkkkkkkkkkkkkk..',
    '........................'
  ]);

  G('ALTAR', [
    '................................',
    '................................',
    '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '..kGGGGGGGGGGGGGGGGGGGGGGGGGGk..',
    '..kwwGGGGGGGGGGGGGGGGGGGGGGGdk..',
    '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '....kGGGGGGGGGGGGGGGGGGGGGGk....',
    '....kGdGGGGGGGGGGGGGGGGGGdGk....',
    '....kGGGGGGkkkkkkGGGGGGGGGGk....',
    '....kGGGGGkGGGGGGkGGGGGGGGGk....',
    '....kGGGGGkGGGGGGkGGGGGGGGGk....',
    '....kGGGGGGkkkkkkGGGGGGGGGGk....',
    '....kGdGGGGGGGGGGGGGGGGGGdGk....',
    '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '..kGGGGGGGGGGGGGGGGGGGGGGGGGGk..',
    '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..'
  ]);

  G('PEDESTAL', [
    '........................',
    '...kkkkkkkkkkkkkkkkkk...',
    '...kwwGGGGGGGGGGGGGdk...',
    '...kkkkkkkkkkkkkkkkkk...',
    '......kGGGGGGGGGGk......',
    '......kGwGGGGGGdGk......',
    '......kGwGGGGGGdGk......',
    '......kGwGGGGGGdGk......',
    '......kGwGGGGGGdGk......',
    '......kGwGGGGGGdGk......',
    '......kGwGGGGGGdGk......',
    '....kkkkkkkkkkkkkkkk....',
    '....kwGGGGGGGGGGGGdk....',
    '...kkGGGGGGGGGGGGGGdk...',
    '...kkkkkkkkkkkkkkkkkk...',
    '........................'
  ]);

  G('MACHINE', [
    '................................',
    '..kkkkkkkkkkkkkkkkkkkkkkkkkk....',
    '..kGGGGGGGGGGGGGGGGGGGGGGGGk....',
    '..kGwwGGGGGGGGGGGGGGGGGGGGdk....',
    '..kGwGkkkkkkkkkkkkkkkkkkGGdk....',
    '..kGGkddddddddddddddddddkGdk....',
    '..kGGkdGGGGGGGGGGGGGGGGdkGdk....',
    '..kGGkdGkkkkkkkkkkkkkkGdkGdk....',
    '..kGGkdGkddddddddddddkGdkGdk....',
    '..kGGkdGkddddddddddddkGdkGdk....',
    '..kGGkdGkkkkkkkkkkkkkkGdkGdk....',
    '..kGGkdGGGGGGGGGGGGGGGGdkGdk....',
    '..kGGkddddddddddddddddddkGdk....',
    '..kGGkkkkkkkkkkkkkkkkkkkkGdk....',
    '..kGGGGGGGGGGGGGGGGGGGGGGGdk....',
    '..kGGrGGGGGGGGGGGGGGGGGGyGdk....',
    '..kddddddddddddddddddddddddk....',
    '..kkkkkkkkkkkkkkkkkkkkkkkkkk....'
  ]);

  G('CONTROL-PANEL', [
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '.kdddddddddddddddddddddk',
    '.kdGGGGGGGGGGGGGGGGGGGdk',
    '.kdGkkkkkkkkkkkkkkkkkGdk',
    '.kdGkyyyyyyyyyyyyyyykGdk',
    '.kdGkkkkkkkkkkkkkkkkkGdk',
    '.kdGGGGGGGGGGGGGGGGGGGdk',
    '.kdGkykkkykkkbkkkrkkkGdk',
    '.kdGkyyykyyykbbbkrrrkGdk',
    '.kdGkykkkykkkbkkkrkkkGdk',
    '.kdGGGGGGGGGGGGGGGGGGGdk',
    '.kdddddddddddddddddddddk',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '........................',
    '........................'
  ]);

  G('TOOL-CHEST', [
    '........................',
    '........................',
    '..kkkkkkkkkkkkkkkkkkkk..',
    '..kdddddddddddddddddddk.',
    '..kdGGGGGGGGGGGGGGGGGdk.',
    '..kdGkkkkkkkkkkkkkkkkdk.',
    '..kdGkddddddkddddddkkdk.',
    '..kdGkdGGGGdkdGGGGdkkdk.',
    '..kdGkddddddkddddddkkdk.',
    '..kdGkkkkkkkkkkkkkkkkdk.',
    '..kdGkddddddkddddddkkdk.',
    '..kdGkdGGGGdkdGGGGdkkdk.',
    '..kdGkddddddkddddddkkdk.',
    '..kdGGGGGGGGGGGGGGGGGdk.',
    '..kdddddddddddddddddddk.',
    '..kkkkkkkkkkkkkkkkkkkk..'
  ]);

  G('LOWERED-BASKET', [
    '................',
    '.......kk.......',
    '.......kk.......',
    '.......kk.......',
    '.kkkkkkkkkkkkkk.',
    '.kNuNuNuNuNuNuk.',
    '.kuNuNuNuNuNuNk.',
    '.kNuNuNuNuNuNuk.',
    '.kuNuNuNuNuNuNk.',
    '.kNuNuNuNuNuNuk.',
    '..kuNuNuNuNuNk..',
    '..kNuNuNuNuNuk..',
    '...kuNuNuNuNk...',
    '...kkkkkkkkkk...',
    '................',
    '................'
  ]);
  alias('RAISED-BASKET', 'LOWERED-BASKET');

  G('MIRROR-1', [
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '.kyyyyyyyyyyyyyyyyyyyyk.',
    '.kykkkkkkkkkkkkkkkkkkyk.',
    '.kykSSSSSSSSSSSSSSSSkyk.',
    '.kykSwwSSSSSSSSSSSSSkyk.',
    '.kykSwSSSSSSSSSSSSSSkyk.',
    '.kykSSSSSSSSSSSSSSSSkyk.',
    '.kykSSSSSSSSSSSSSSSSkyk.',
    '.kykSSSSSSSSSSSSSbSSkyk.',
    '.kykSSSSSSSSSSSSbbSSkyk.',
    '.kykSSSSSSSSSSSSSSSSkyk.',
    '.kykkkkkkkkkkkkkkkkkkyk.',
    '.kyyyyyyyyyyyyyyyyyyyyk.',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '........................'
  ]);
  alias('MIRROR-2', 'MIRROR-1');

  G('LADDER', [
    '................',
    '.kNk......kNk...',
    '.kNk......kNk...',
    '.kNkkkkkkkkNk...',
    '.kNuuuuuuuuNk...',
    '.kNkkkkkkkkNk...',
    '.kNk......kNk...',
    '.kNkkkkkkkkNk...',
    '.kNuuuuuuuuNk...',
    '.kNkkkkkkkkNk...',
    '.kNk......kNk...',
    '.kNkkkkkkkkNk...',
    '.kNuuuuuuuuNk...',
    '.kNkkkkkkkkNk...',
    '.kNk......kNk...',
    '.kkk......kkk...'
  ]);

  G('SONGBIRD', [
    '................',
    '................',
    '.....kkk........',
    '....kbbbk.......',
    '...kbkwbbk......',
    '...kokkbbbk.....',
    '....kbbbbbbk....',
    '...kbbbbSbbbk...',
    '..kbbbSSSSbbbk..',
    '..kbbbbSSbbbbbk.',
    '...kbbbbbbbbbk..',
    '....kkbbbbbkk...',
    '......kkbkk.....',
    '.......kok......',
    '.......k.k......',
    '................'
  ]);

  G('BODIES', [
    '................................',
    '................................',
    '................................',
    '.........kkkk...................',
    '........kSSSSk........kkkk......',
    '........kSkkSk.......kSSSSk.....',
    '.....kkkkSSSSkkkk...kSkkSSk.....',
    '...kkYYYYYYYYYYYkkkkkSSSSkkk....',
    '..kYYYYnnYYYYnnYYYYYkkYYYYYkk...',
    '.kYYnnYYYYnnYYYYnnYYYYnnYYYYYk..',
    'kYnnYYYYnnYYYYnnYYYYnnYYYYnnYYk.',
    'kYYYYnnYYYYnnYYYYnnYYYYnnYYYYYk.',
    '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '................................',
    '................................',
    '................................'
  ]);

  G('GHOSTS', [
    '........................',
    '....kkkk......kkkk......',
    '...kSSSSk....kSSSSk.....',
    '..kSSSSSSk..kSSSSSSk....',
    '..kSkSSkSk..kSkSSkSk....',
    '..kSSSSSSk..kSSSSSSk....',
    '..kSSkkSSk..kSSkkSSk....',
    '..kSSSSSSk..kSSSSSSk....',
    '.kSSSSSSSSkkSSSSSSSSk...',
    '.kSSSSSSSSkkSSSSSSSSk...',
    '.kSSSSSSSSkkSSSSSSSSk...',
    '.kSkSkSkSkkSkSkSkSkSk...',
    '..k.k.k.k...k.k.k.k.....',
    '........................',
    '........................',
    '........................'
  ]);

  G('TEETH', [
    '................',
    '................',
    '....kkkkkkkk....',
    '...kwwwwwwwwk...',
    '..kwwwwwwwwwwk..',
    '..kwkwkwkwkwwk..',
    '..kwkwkwkwkwwk..',
    '..kkkkkkkkkkkk..',
    '..kwkwkwkwkwwk..',
    '..kwkwkwkwkwwk..',
    '..kwwwwwwwwwwk..',
    '...kwwwwwwwwk...',
    '....kkkkkkkk....',
    '................',
    '................',
    '................'
  ]);

  /* dam control buttons — same housing, four colors */
  var BUTTON = [
    '..kkkkkkkk..',
    '.kddddddddk.',
    'kd11111111dk',
    'kd12222221dk',
    'kd12222221dk',
    'kd12222221dk',
    'kd11111111dk',
    '.kddddddddk.',
    '..kkkkkkkk..'
  ];
  G('YELLOW-BUTTON', BUTTON.slice(), ext({ 1: PAL[0x28], 2: PAL[0x38] }));
  G('BROWN-BUTTON', BUTTON.slice(), ext({ 1: PAL[0x08], 2: PAL[0x18] }));
  G('RED-BUTTON', BUTTON.slice(), ext({ 1: PAL[0x05], 2: PAL[0x16] }));
  G('BLUE-BUTTON', BUTTON.slice(), ext({ 1: PAL[0x02], 2: PAL[0x11] }));

  G('MACHINE-SWITCH', [
    '................',
    '.......kk.......',
    '......kGGk......',
    '......kGwk......',
    '......kGGk......',
    '.....kkGGkk.....',
    '....kdddddddk...',
    '...kdGGGGGGGdk..',
    '...kdGkkkkGGdk..',
    '...kdGGGGGGGdk..',
    '...kddddddddd k'.replace(' ', 'd'),
    '....kkkkkkkkk...',
    '................',
    '................',
    '................',
    '................'
  ]);

  G('KITCHEN-TABLE', [
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    'kNuuuuuuuuuuuuuuuuuuuuNk',
    'kNuNuNuNuNuNuNuNuNuNuuNk',
    'kNNNNNNNNNNNNNNNNNNNNNNk',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '..kNk..............kNk..',
    '..kNk..............kNk..',
    '..kNk..............kNk..',
    '..kNk..............kNk..',
    '..kNk..............kNk..',
    '..kNk..............kNk..',
    '..kkk..............kkk..',
    '........................'
  ]);
  alias('ATTIC-TABLE', 'KITCHEN-TABLE', ext({ N: PAL[0x07], u: PAL[0x08] }));

  G('RAILING', [
    '........................',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kNuuuuuuuuuuuuuuuuuuuuNk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    '..kNk...kNk...kNk...kNk.',
    '..kuk...kuk...kuk...kuk.',
    '..kNk...kNk...kNk...kNk.',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kNuuuuuuuuuuuuuuuuuuuuNk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    '..kNk...kNk...kNk...kNk.',
    '..kuk...kuk...kuk...kuk.',
    '..kNk...kNk...kNk...kNk.',
    '..kkk...kkk...kkk...kkk.'
  ]);

  /* the wooden door with the gothic lettering, seen head-on */
  G('WOODEN-DOOR', [
    'kkkkkkkkkkkkkkkkkkkk',
    'kNNNNNNNNNNNNNNNNNNk',
    'kNuuNuuNuuNuuNuuNuNk',
    'kNuuNuuNuuNuuNuuNuNk',
    'kNkkkkkkkkkkkkkkkkNk',
    'kNkYYYYYYYYYYYYYYkNk',
    'kNkYkYkkYkkYkkYkYkNk',
    'kNkYkYkYkYkYkYkYYkNk',
    'kNkYkkkkYkkYkkYkYkNk',
    'kNkYYYYYYYYYYYYYYkNk',
    'kNkkkkkkkkkkkkkkkkNk',
    'kNuuNuuNuuNuuNuuNuNk',
    'kNuuNuuNuuNuuNuuNuNk',
    'kNuuNuuNuuNuuNuuyuNk',
    'kNuuNuuNuuNuuNuuNuNk',
    'kNNNNNNNNNNNNNNNNNNk',
    'kkkkkkkkkkkkkkkkkkkk',
    '....................'
  ]);
  alias('FRONT-DOOR', 'WOODEN-DOOR', ext({ Y: PAL[0x18], N: PAL[0x30], u: PAL[0x10] }));
  G('BARROW-DOOR', [
    '....kkkkkkkkkkkk....',
    '..kkGGGGGGGGGGGGkk..',
    '.kGGGGGGGGGGGGGGGGk.',
    'kGGwwGGGGGGGGGGGGGGk',
    'kGwGGGGGGGGGGGGGGGdk',
    'kGGGGGGkkkkkkGGGGGdk',
    'kGGGGGkGGGGGGkGGGGdk',
    'kGGGGGkGdddddkGGGGdk',
    'kGGGGGkGdddddkGGGGdk',
    'kGGGGGkGGGGGGkGGGGdk',
    'kGGGGGGkkkkkkGGGGGdk',
    'kGGGGGGGGGGGGGGGGGdk',
    'kGdGGGGGGGGGGGGGGddk',
    'kGddddddddddddddddkk',
    'kkkkkkkkkkkkkkkkkkk.',
    '....................'
  ]);

  G('LEAK', [
    '................',
    'kkkkkkkkkkkkkkkk',
    'kGGGGGGGGGGGGGGk',
    'kGGkkkkkkGGGGGGk',
    'kGkbbbbbbkGGGGGk',
    'kGkbbbbbbkGGGGGk',
    'kGGkkbbkkGGGGGGk',
    'kGGGGkbkGGGGGGGk',
    'kGGGGGbGGGGGGGGk',
    'kGGGGGbGGGGGGGGk',
    'kGGGGkbkGGGGGGGk',
    'kGGGGkbkGGGGGGGk',
    'kGGGGGbGGGGGGGGk',
    'kGGGGGSGGGGGGGGk',
    'kkkkkkkkkkkkkkkk',
    '................'
  ]);

  G('CRACK', [
    '................',
    '.......k........',
    '......kk........',
    '.....kk.........',
    '.....k..........',
    '....kk..........',
    '....k...........',
    '...kk...........',
    '...k............',
    '..kk............',
    '..k.............',
    '.kk.............',
    '.k..............',
    'kk..............',
    'k...............',
    '................'
  ]);

  G('ENGRAVINGS', [
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '.kgggggggggggggggggggggk',
    '.kgGkGkkGkGkkGkGkkGkGggk',
    '.kggkGkGkkGkGkkGkGkGkggk',
    '.kgGkkGkGkkGkGkkGkGkkggk',
    '.kggggggggggggggggggggkk',
    '.kgGkkGkGkkGkGkkGkGkkggk',
    '.kggkGkGkkGkGkkGkGkGkggk',
    '.kgGkGkkGkGkkGkGkkGkGggk',
    '.kgggggggggggggggggggggk',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '........................',
    '........................'
  ]);

  G('SAND', [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......YYYY......',
    '...YYYYYYYYYY...',
    '.YYYYYyYYYyYYYY.',
    'YYYyYYYYYYYYYyYY',
    'YYYYYYYyYYYYYYYY',
    'YyYYYYYYYYYyYYYY',
    'YYYYYyYYYYYYYYyY',
    'YYYYYYYYYyYYYYYY',
    '................',
    '................'
  ]);

  G('SLIDE', [
    '........................',
    'kkkkkkkkk...............',
    'kdddddddkk..............',
    'kdkkkkkddkk.............',
    'kdk...kkddkk............',
    'kdk....kkddkk...........',
    '.kk.....kkddkk..........',
    '.........kkddkk.........',
    '..........kkddkk........',
    '...........kkddkk.......',
    '............kkddkk......',
    '.............kkddkk.....',
    '..............kkddkk....',
    '...............kkddkk...',
    '................kkddkk..',
    '.................kkkkk..'
  ]);

  G('CHIMNEY', [
    '................',
    '..kkkkkkkkkkkk..',
    '..kRRRRRRRRRRk..',
    '..kRkRRkRRkRRk..',
    '..kRRRRRRRRRRk..',
    '..kkkkkkkkkkkk..',
    '...kRRkRRkRRk...',
    '...kRRRRRRRRk...',
    '...kkkkkkkkkk...',
    '...kRkRRkRRRk...',
    '...kRRRRRRRRk...',
    '...kkkkkkkkkk...',
    '...kRRkRRkRRk...',
    '...kRRRRRRRRk...',
    '...kkkkkkkkkk...',
    '................'
  ]);

  /* ================================================================
   * CREATURES — split top/bottom so idle frames can breathe
   * ============================================================== */

  var TROLL_TOP = [
    '..........kkkkkkkkkkkk..........',
    '.........kEEEEEEEEEEEEk.........',
    '........kEeekkkeeeekkkeEk........',
    '........kEeeeeeeeeeeeeEk........',
    '........kEeewkweewkweeEk........',
    '........kEeeeeeeeeeeeeEk........',
    '........kEeeeeeeeeeeeeEk........',
    '........kEeeeeeEEeeeeeEk........',
    '........kEeeekkkkkkkeeEk........',
    '........kEeeeYkkkkkYeeEk........',
    '........kEeeeekkkkkeeeEk........',
    '.........kEEeeeeeeeeEEk.........',
    '..........kkEEEEEEEEkk..........',
    '.............kkeekk.............',
    '.....kkkk...kkeeeekk............',
    '....kGGGGkkkEeeeeeeEkkk.........',
    '...kRwwGGGkEeeeeeeeeeEkk........',
    '...kRRGGGGkEeeeeeeeeeeEkkkk.....',
    '....kkkkkGkEeeEEEEEEeeeEeeEk....',
    '.......kkNkEeEEeeeeEEeeeEeeEk...',
    '......kNNkkEeEeeeeeeEEeeeEeEk...',
    '.....kNNk.kEeEeeeeeeeEEeeeeEk...',
    '.....kNk..kEEeeeeeeeeeEkkkkkk...',
    '..........kkEEEEEEEEEEkk........'
  ];
  var TROLL_BOT = [
    '..........kEeeeeeeeeeEk.........',
    '..........kEeeeeeeeeeEk.........',
    '..........kEeeEkkEeeeEk.........',
    '.........kEeeeEkkEeeeeEk........',
    '.........kEeeeEkkEeeeeEk........',
    '.........kEeeEkkkkEeeeEk........',
    '.........kEeeEk..kEeeeEk........',
    '.........kEeeEk..kEeeeEk........',
    '.........kEeeEk..kEeeeEk........',
    '........kEeeeEk..kEeeeeEk.......',
    '........kEeeeEk..kEeeeeEk.......',
    '.......kkEeeeEkkkkEeeeeEkk......',
    '.......kEEeeeEkkkkEeeeeEEk......',
    '.......kEeeeeeEkkEeeeeeeEk......',
    '.......kkkkkkkkkkkkkkkkkkk......',
    '................................'
  ];

  var THIEF_TOP = [
    '.......kkkkkkk..........',
    '.....kkdddddddkk........',
    '....kddddddddddddk......',
    '...kdddYYYYYYYdddk......',
    '...kddYYYkYkYYYddk......',
    '...kddYYYkYkYYYddk......',
    '...kddYYYYYYYYYddk......',
    '...kdddYYkkkYYdddk......',
    '....kddYYYYYYYddk.......',
    '....kdddddddddddk.......',
    '...kddddddddddddddk.....',
    '..kdddddddddddddddddk...',
    '..kddddkddddddkdddddk...',
    '.kddddkdddddddkddddddk..',
    '.kdddkddddddddddkddddk..',
    '.kddkdddddddddddddkddkkk',
    '.kdkddddddddddddddddkkGk',
    '.kkddddddddddddddddkkGk.',
    '..kdddddddddddddddkkGk..',
    '..kddddddddddddddkkGk...',
    '..kdddddddddddddkkGk....',
    '..kdddddddddddddkkk.....',
    '..kdddddddddddddddk.....',
    '..kdddddddddddddddk.....',
    '...kdddddddddddddk......',
    '...kkkddddddddkkkk......'
  ];
  var THIEF_BOT = [
    '.....kdddddddddk........',
    '.....kdddkkdddddk.......',
    '.....kdddkkdddddk.......',
    '.....kdddk.kddddk.......',
    '.....kdddk.kddddk.......',
    '.....kdddk.kddddk.......',
    '.....kdddk.kddddk.......',
    '....kkdddk.kdddkk.......',
    '....kkkkkk.kkkkkk.......',
    '....kGGGGk.kGGGGk.......',
    '....kkkkkk.kkkkkk.......',
    '........................'
  ];

  var CYCLOPS_TOP = [
    '..............kkkkkkkkkkkk..............',
    '............kkYYYYYYYYYYYYkk............',
    '..........kkYYYYYYYYYYYYYYYYkk..........',
    '.........kYYYYYYYYYYYYYYYYYYYYk.........',
    '........kYYYYYYYYYYYYYYYYYYYYYYk........',
    '........kYYYYnnnnnnnnnnnnnnYYYYk........',
    '........kYYYYYYYkkkkkkkkYYYYYYYk........',
    '........kYYYYYYYkwwwwwwkYYYYYYYk........',
    '........kYYYYYYYkwwkkwwkYYYYYYYk........',
    '........kYYYYYYYkwkkkkwkYYYYYYYk........',
    '........kYYYYYYYkwkkkkwkYYYYYYYk........',
    '........kYYYYYYYkwwkkwwkYYYYYYYk........',
    '........kYYYYYYYkwwwwwwkYYYYYYYk........',
    '........kYYYYYYYkkkkkkkkYYYYYYYk........',
    '........kYYYYYYYYYYYYYYYYYYYYYYk........',
    '........kYYYYYYYYYYYYYYYYYYYYYYk........',
    '........kYYYYYYYYnnnnnnYYYYYYYYk........',
    '.........kYYYYYnnkkkkkknnYYYYYk.........',
    '.........kYYYYnwkwkwkwkwnYYYYYk.........',
    '..........kYYYnkkkkkkkkknYYYYk..........',
    '...........kkYYYYYYYYYYYYYYkk...........',
    '.............kkYYYYYYYYYYkk.............',
    '...............kkYYYYYYkk...............',
    '............kkkkkYYYYYYkkkkk............',
    '.......kkkkkYYYYYYYYYYYYYYYYkkkk........',
    '.....kkYYYYYYYYYYYYYYYYYYYYYYYYYYkk.....',
    '...kkYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYkk...',
    '..kYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYk..',
    '..kYYnYYYYYYYYYYYYYYYYYYYYYYYYYYYYnYYk..',
    '..kYnnYYYYYYYYYYYYYYYYYYYYYYYYYYYYnnYk..'
  ];
  var CYCLOPS_BOT = [
    '..kYnYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYnYk..',
    '..kYnYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYnYk..',
    '...kYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYk...',
    '....kkYYYYYYYYYYYYYYYYYYYYYYYYYYYYkk....',
    '......kYYYYYYYYYkkkkYYYYYYYYYYYYYk......',
    '......kYYYYYYYYkkkkkkYYYYYYYYYYYYk......',
    '......kYYYYYYYk......kYYYYYYYYYYYk......',
    '......kYYYYYYYk......kYYYYYYYYYYYk......',
    '.....kYYYYYYYYk......kYYYYYYYYYYYYk.....',
    '.....kYYYYYYYYk......kYYYYYYYYYYYYk.....',
    '.....kYYYYYYYYk......kYYYYYYYYYYYYk.....',
    '....kkYYYYYYYYk......kYYYYYYYYYYYYkk....',
    '....kYYnnYYYYYk......kYYYYYnnYYYYYYk....',
    '....kYnnnnYYYYk......kYYYYnnnnYYYYYk....',
    '....kkkkkkkkkkk......kkkkkkkkkkkkkkk....',
    '........................................',
    '........................................',
    '........................................'
  ];

  var BAT_F = [[
    '................',
    'kk............kk',
    'kdkk........kkdk',
    'kddkk..kk..kkddk',
    'kdddkkdddkkdddkk',
    '.kddddkkkkddddk.',
    '..kdddkrrkdddk..',
    '...kkdkrrkdkk...',
    '.....kdkkdk.....',
    '......kkkk......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................'
  ], [
    '................',
    '................',
    '.......kk.......',
    '.....kkddkk.....',
    '...kkddddddkk...',
    'kkkddddddddddkkk',
    'kddddkkrrkkddddk',
    'kdddkkkrrkkkdddk',
    'kkdk..kkkk..kdkk',
    '.k......kk.....k',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................'
  ]];

  var EYES = [
    '.rrrr..........rrrr.',
    'ryyyyr........ryyyyr',
    'ryykyr........rykyyr',
    '.rrrr..........rrrr.'
  ];

  /* Troll: 32x40. Bobs on the ticker; the axe is baked into the grid with his
   * arm, so there is no second procedural axe (there used to be, and the two
   * overlapped). Skin is muddy olive, not the bright $1A green that made him
   * read as a cheerful cartoon frog. */
  var TRL = ext({ e: PAL[0x0A], E: PAL[0x08], R: PAL[0x05] });
  F('TROLL', 32, 40, function (ctx, x, y, t) {
    var bob = (((t | 0) >> 4) & 1);
    K.sprite(ctx, TROLL_TOP, x, y + bob, TRL);
    K.sprite(ctx, TROLL_BOT, x, y + 24, TRL);
    /* fresh blood runs off the blade */
    K.px(ctx, x + 4, y + 20 + bob, PAL[0x05]);
    K.px(ctx, x + 4, y + 21 + bob, PAL[0x16]);
  });

  /* The large bag. "holding a large bag" is his defining line and the visual
   * promise that he is carrying your loot — he is not the thief without it. */
  var THIEF_BAG = [
    '...kkkk...',
    '..kkNNkk..',
    '.kNNNNNNk.',
    'kNNNNNNNNk',
    'kNNnnnnNNk',
    'kNNnnnnNNk',
    'kNNNNNNNNk',
    '.kNNNNNNk.',
    '..kNNNNk..',
    '...kkkk...'
  ];

  /* Thief: 24x40, cloaked, stiletto glinting, loot slung at his hip.
   * Frame 1 shifts his weight. */
  F('THIEF', 24, 40, function (ctx, x, y, t) {
    var f = (((t | 0) >> 4) & 1);
    K.sprite(ctx, THIEF_TOP, x + f, y, P);
    K.sprite(ctx, THIEF_BOT, x, y + 26, P);
    /* strap over the shoulder, down to the bag */
    K.rect(ctx, x + 8 - f, y + 14, 1, 4, P.k);
    K.rect(ctx, x + 7 - f, y + 18, 1, 4, P.k);
    K.sprite(ctx, THIEF_BAG, x + 1, y + 21, P);
    /* stiletto flick */
    var sx = x + 19 + f, sy = y + 12 - f * 2;
    K.rect(ctx, sx, sy, 1, 7, P.k);
    K.rect(ctx, sx + 1, sy + 1, 1, 6, P.G);
    K.px(ctx, sx + 1, sy, P.w);
  });

  /* Cyclops: 40x48, one enormous eye that narrows every few seconds.
   * Skin is olive-brown, NOT the pale tan the grid chars suggest: a white
   * sclera on $37 tan is the same luminance, so the eye — the whole point of
   * the creature — disappeared at scene size. $18 skin makes it read. */
  var CYC = ext({ Y: PAL[0x18], n: PAL[0x08] });
  F('CYCLOPS', 40, 48, function (ctx, x, y, t) {
    t = t | 0;
    K.sprite(ctx, CYCLOPS_TOP, x, y, CYC);
    K.sprite(ctx, CYCLOPS_BOT, x, y + 30, CYC);
    if ((t % 120) < 10) {                       // heavy lid drops over the eye
      K.rect(ctx, x + 16, y + 6, 8, 8, CYC.Y);
      K.rect(ctx, x + 16, y + 9, 8, 1, P.k);
    } else if (((t >> 4) & 1)) {                // pupil slides to track you
      K.rect(ctx, x + 17, y + 7, 6, 6, P.w);
      K.rect(ctx, x + 20, y + 8, 3, 4, P.k);
      K.px(ctx, x + 21, y + 9, P.r);
    }
  });

  F('BAT', 16, 16, function (ctx, x, y, t) {
    K.sprite(ctx, BAT_F[((t | 0) >> 2) & 1], x, y, P);
  });

  F('GRUE-EYES', 20, 4, function (ctx, x, y, t) {
    if (((t | 0) % 150) < 8) return;
    K.sprite(ctx, EYES, x, y, P);
  });
  alias('grueEyes', 'GRUE-EYES');

  /* ================================================================
   * public API
   * ============================================================== */

  GUE.sprites = {
    has: function (objId) { return !!S[objId]; },

    draw: function (ctx, objId, x, y, t) {
      var s = S[objId];
      if (!s) return false;
      if (s.fn) s.fn(ctx, x | 0, y | 0, t | 0);
      else K.sprite(ctx, s.g, x, y, s.p);
      return true;
    },

    /* {w,h} in pixels — scenes use this to centre/anchor a sprite */
    size: function (objId) {
      var s = S[objId];
      return s ? { w: s.w, h: s.h } : { w: 16, h: 16 };
    },

    list: function () { return Object.keys(S); },

    /* raw table, for the static coverage test */
    _table: S
  };
})();
