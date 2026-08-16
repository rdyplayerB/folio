//  The starfield.
//
//  Carried over from the printed poster, where it did more work than it looks
//  like it does. A field of evenly scattered identical dots reads as noise and
//  flattens the page; what gives depth is variation and clustering, so most stars
//  here are dim and small, a few are bright enough to earn a cross flare, and
//  roughly half sit in loose clumps rather than spread out evenly.
//
//  Painted to a canvas once and used as a repeating background. Deterministic
//  from a fixed seed, so the sky is the same on every visit and in every
//  screenshot, which matters when the screenshots are how the design gets
//  reviewed.

(function (root) {
  'use strict';

  // Same generator the engine uses, so the sky is reproducible across builds.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var TILE = 440;
  var SEED = 20260815;

  function paint(dpr) {
    var c = document.createElement('canvas');
    c.width = c.height = TILE * dpr;
    var x = c.getContext('2d');
    x.scale(dpr, dpr);

    var R = mulberry32(SEED);

    // Six loose centres. Stars gather around them the way real ones do, which is
    // the difference between a sky and a texture.
    var cl = [];
    for (var k = 0; k < 6; k++) cl.push([R() * TILE, R() * TILE]);

    for (var i = 0; i < 190; i++) {
      var px, py;
      if (R() < 0.55) {
        var c0 = cl[(R() * 6) | 0];
        // Three summed randoms approximate a normal distribution, so clumps fade
        // at the edges instead of ending in a hard circle.
        px = (c0[0] + (R() + R() + R() - 1.5) * 46) | 0;
        py = (c0[1] + (R() + R() + R() - 1.5) * 46) | 0;
      } else {
        px = (R() * TILE) | 0;
        py = (R() * TILE) | 0;
      }
      if (px < 0 || py < 0 || px > TILE - 1 || py > TILE - 1) continue;

      // A power curve keeps most stars faint and lets a handful stand out. A flat
      // distribution would make every star mid-bright, which reads as static.
      var a = 0.1 + Math.pow(R(), 1.9) * 0.9;
      var sz = (a > 0.72 && R() > 0.55) ? 2 : 1;

      var tn = R();
      var col = tn > 0.92 ? '190,208,255' : tn > 0.84 ? '255,238,196' : '255,255,255';
      x.fillStyle = 'rgba(' + col + ',' + a.toFixed(2) + ')';
      x.fillRect(px, py, sz, sz);

      // Only the brightest get a flare, so it stays an accent.
      if (a > 0.9 && sz === 2) {
        x.fillStyle = 'rgba(' + col + ',.28)';
        x.fillRect(px - 1, py, 4, 2);
        x.fillRect(px, py - 1, 2, 4);
      }
    }

    // Five proper sparkles with long arms. These are what the eye catches first.
    for (var j = 0; j < 5; j++) {
      var qx = ((R() * (TILE - 20)) | 0) + 8;
      var qy = ((R() * (TILE - 20)) | 0) + 8;
      x.fillStyle = 'rgba(255,255,255,.9)';
      x.fillRect(qx - 3, qy, 7, 1);
      x.fillRect(qx, qy - 3, 1, 7);
      x.fillStyle = 'rgba(255,255,255,.35)';
      x.fillRect(qx - 1, qy - 1, 3, 3);
      x.fillStyle = 'rgba(255,255,255,.15)';
      x.fillRect(qx - 5, qy, 11, 1);
      x.fillRect(qx, qy - 5, 1, 11);
    }

    return c.toDataURL();
  }

  function apply() {
    // Painting at device resolution keeps a one-pixel star one pixel on a retina
    // screen. Painting at 1x and letting the browser upscale turns every star
    // into a soft grey smudge, which is most of what "flat" looked like.
    var dpr = Math.min(3, Math.max(1, Math.round(root.devicePixelRatio || 1)));
    var url = paint(dpr);

    // Two layers on the body, and the difference between them is the point.
    //
    // The stars scroll with the document, so they behave like a backdrop the page
    // is printed on. The vignette is fixed to the viewport, so it behaves like
    // light falling on that backdrop rather than like part of it. Pinning both
    // made the sky read as marks on the glass; scrolling both lost the sense that
    // the middle of the screen is nearer than the corners.
    var s = document.createElement('style');
    s.textContent =
      'body{' +
      'background-image:radial-gradient(125% 85% at 50% 26%, rgba(0,0,0,0) 42%, rgba(0,0,0,.5) 100%),' +
      'url(' + url + ');' +
      'background-attachment:fixed,scroll;' +
      'background-repeat:no-repeat,repeat;' +
      'background-size:100% 100%,' + TILE + 'px ' + TILE + 'px;' +
      '}';
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})(typeof window !== 'undefined' ? window : globalThis);
