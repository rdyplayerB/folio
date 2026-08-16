//  @folio/validator — the tiered check that decides what a .folio may claim.
//
//    T0 SCHEMA       manifest fields, types, zip layout, checksums
//    T1 INTEGRITY    every reference resolves; assets decode; capabilities are
//                    supported by the declared format version
//    T2 GRAPH        (later) puzzle-dependency analysis — no dead ends exist
//    T3 COMPLETABLE  (later) headless cold-start walkthrough replay
//    T4 DESIGN       (later) corpus-calibrated design audit + blind solver
//
//  T0/T1 ship here. The tiers above need the world interpreter and corpus profiler,
//  and are staged in the roadmap rather than stubbed, because a validator that
//  silently passes checks it cannot actually perform is worse than one that says
//  plainly what it has and has not verified.
//
//  Findings carry a code, and every code must have a matching docs anchor — the
//  cheapest way to keep "why won't my game certify" answerable is to make it
//  mechanically impossible to add an error without documenting it.

'use strict';

const SEMVER = /^\d+\.\d+\.\d+$/;
const RATINGS = ['all-ages', 'teen', 'mature'];
const LOGIC_TYPES = ['zmachine', 'world'];

// Capabilities this format version understands. A game declaring anything else is
// telling us it needs an engine we are not — better to refuse than to glitch.
const KNOWN_CAPABILITIES = [
  'darkness', 'timed-events', 'combat', 'containers', 'npc-dialogue',
  'multi-save', 'custom-verbs', 'sound', 'score'
];

/**
 * Run T0 and T1 against a loaded .folio.
 * @param {{manifest:object, walkthrough:string, files:object}} game
 * @returns {{ok:boolean, tier:string, findings:Array, summary:string}}
 */
function validate(game) {
  const f = [];
  const err = (code, msg, hint) => f.push({ level: 'error', code, msg, hint });
  const warn = (code, msg, hint) => f.push({ level: 'warning', code, msg, hint });

  // ------------------------------------------------------------------ T0
  const m = game.manifest || {};
  const required = {
    id: 'string', title: 'string', author: 'string',
    folioVersion: 'string', logicType: 'string',
    license: 'string', contentRating: 'string'
  };
  for (const [field, type] of Object.entries(required)) {
    if (m[field] === undefined) {
      err('E100', 'manifest is missing the mandatory field "' + field + '"',
        'Every .folio must declare it; see docs/reference/manifest.');
    } else if (typeof m[field] !== type) {
      err('E101', 'manifest field "' + field + '" must be a ' + type);
    }
  }
  if (m.folioVersion && !SEMVER.test(m.folioVersion)) {
    err('E102', 'folioVersion must be semver, got "' + m.folioVersion + '"');
  }
  if (m.logicType && !LOGIC_TYPES.includes(m.logicType)) {
    err('E103', 'unknown logicType "' + m.logicType + '"',
      'Expected one of: ' + LOGIC_TYPES.join(', '));
  }
  if (m.contentRating && !RATINGS.includes(m.contentRating)) {
    err('E104', 'unknown contentRating "' + m.contentRating + '"',
      'Expected one of: ' + RATINGS.join(', '));
  }
  if (m.license === 'unknown') {
    warn('W105', 'license is "unknown" — playable, but not hostable',
      'The gallery cannot serve a game whose rights are undeclared.');
  }
  if (!m.aiDisclosure) {
    warn('W106', 'no aiDisclosure block',
      'Disclose precisely what was generated and what a human reviewed. ' +
      'A claim that outruns the pipeline is the failure mode that costs trust.');
  }
  if (!game.walkthrough || !game.walkthrough.trim()) {
    err('E107', 'walkthrough.folioscript is empty',
      'The walkthrough is the proof of completability; a game without one cannot certify.');
  }

  // ------------------------------------------------------------------ T1
  const files = game.files || {};
  const has = (p) => Object.prototype.hasOwnProperty.call(files, p);

  if (m.logicType === 'zmachine') {
    const story = Object.keys(files).find(n => /^logic\/.+\.(z3|z5|z8)$/.test(n));
    if (!story) {
      err('E200', 'logicType is "zmachine" but no logic/*.z3|z5|z8 is present');
    } else {
      const bytes = files[story];
      // A Z-machine header declares its own version in byte 0. Checking it catches
      // the common mistake of shipping a v5 story while declaring a v3 engine.
      const ver = bytes[0];
      if (![3, 5, 8].includes(ver)) {
        err('E201', story + ' does not look like a Z-machine story (version byte ' + ver + ')');
      }
      const declared = story.match(/\.z(\d)$/);
      if (declared && Number(declared[1]) !== ver) {
        err('E202', story + ' is named .z' + declared[1] + ' but its header says v' + ver,
          'Rename the file to match, or ship the story you meant to ship.');
      }
    }
    if (!has('presentation/roommap.json')) {
      err('E203', 'zmachine games need presentation/roommap.json',
        'It binds the story\'s internal object numbers to stable ids. It is game ' +
        'data and ships in the .folio, not with the engine.');
    } else {
      let rm = null;
      try { rm = JSON.parse(files['presentation/roommap.json'].toString('utf8')); }
      catch (e) { err('E204', 'presentation/roommap.json is not valid JSON: ' + e.message); }
      if (rm) {
        for (const key of ['ROOMMAP', 'OBJMAP', 'ATTR']) {
          if (!rm[key]) err('E205', 'roommap.json is missing "' + key + '"');
        }
      }
    }
  }

  if (m.logicType === 'world' && !has('logic/world.json')) {
    err('E210', 'logicType is "world" but logic/world.json is absent');
  }

  for (const cap of (m.capabilities || [])) {
    if (!KNOWN_CAPABILITIES.includes(cap)) {
      err('E220', 'unknown capability "' + cap + '"',
        'This game needs an engine feature this format version does not define. ' +
        'Known: ' + KNOWN_CAPABILITIES.join(', '));
    }
  }

  // Assets must decode. A PNG that is not a PNG fails at play time, in front of a
  // player, which is the worst possible moment to discover it.
  const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
  for (const name of Object.keys(files)) {
    if (/\.png$/i.test(name) && !files[name].subarray(0, 4).equals(PNG)) {
      err('E230', name + ' has a .png extension but is not a PNG');
    }
  }

  const errors = f.filter(x => x.level === 'error');
  const tier = errors.length ? 'invalid' : 'valid';
  return {
    ok: errors.length === 0,
    tier,
    findings: f,
    summary: errors.length
      ? errors.length + ' error' + (errors.length > 1 ? 's' : '')
      : 'T0+T1 passed' + (f.length ? ' with ' + f.length + ' warning' + (f.length > 1 ? 's' : '') : '')
  };
}

module.exports = { validate, KNOWN_CAPABILITIES };
