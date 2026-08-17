//  T3 — proof of completability by cold-start walkthrough replay.
//
//  The single claim Folio makes that no other platform in this space currently
//  makes, and the rules below are what the claim rests on:
//
//    COLD START.  The run begins at the game's own start state. No teleporting the
//                 player, no granting items, no setting flags.
//    NO PRIVILEGED VERBS.  Only commands a player could type.
//    DETERMINISTIC.  Same seed, same run, every time.
//
//  Inform 7 has shipped a TEST ME facility for twenty years and it is the closest
//  prior art. It also shows exactly where the idea leaks: its scripts accept
//  stipulations that teleport state ("in the Kitchen holding the jam") and a
//  PURLOIN verb that conjures any object. A green run there proves a vignette
//  works from a fabricated state — not that the game is finishable. Folio refuses
//  those affordances on purpose; without that refusal the badge means nothing.
//
//  What this proves and does not prove, stated plainly because the distinction is
//  the whole integrity of the certification: it proves a path exists. It does not
//  prove a human could find it. That is T4's blind solver, and the badge reads
//  "verified completable", never "verified fair".

'use strict';

const world = require('../world/index.js');

/**
 * Replay a walkthrough against a Path B world from a cold start.
 * @returns {{ok, findings, transcript, stats}}
 */
function replay(worldDef, walkthrough, opts) {
  opts = opts || {};
  const findings = [];
  const err = (code, msg, hint) => findings.push({ level: 'error', code, msg, hint });

  const cmds = String(walkthrough || '')
    .split('\n')
    .map(l => l.split('#')[0].trim())
    .filter(Boolean);

  if (!cmds.length) {
    err('E400', 'the walkthrough contains no commands');
    return { ok: false, findings, transcript: [], stats: {} };
  }

  let be;
  try {
    be = world.createBackend(worldDef, { seed: opts.seed === undefined ? 1234 : opts.seed });
  } catch (e) {
    err('E401', 'the game would not start: ' + e.message);
    return { ok: false, findings, transcript: [], stats: {} };
  }

  const transcript = [];
  const visited = new Set([be.state().roomId]);
  let firedRules = 0;

  for (let i = 0; i < cmds.length; i++) {
    const line = cmds[i];
    const [verb, ...rest] = line.split(/\s+/);

    // `expect:` lines are assertions, not commands — they let an author pin the
    // run's shape so a walkthrough that still completes by accident is caught.
    if (verb.toLowerCase() === 'expect:') {
      const [what, ...want] = rest;
      const s = be.state();
      const got = what === 'score' ? String(s.score)
        : what === 'room' ? s.roomId
        : what === 'moves' ? String(s.moves) : undefined;
      if (got === undefined) {
        err('E402', 'line ' + (i + 1) + ': unknown assertion "' + what + '"',
          'Supported: expect: score N | expect: room ID | expect: moves N');
      } else if (got.toUpperCase() !== want.join(' ').toUpperCase()) {
        err('E403', 'line ' + (i + 1) + ': expected ' + what + ' ' + want.join(' ') +
          ', got ' + got);
      }
      continue;
    }

    const before = be.state();
    let r;
    try {
      const noun = rest.length ? String(rest.shift()).toUpperCase() : null;
      const second = rest.length ? rest.join(' ').toUpperCase() : null;
      r = be.submit(verb, noun, second);
    } catch (e) {
      err('E404', 'line ' + (i + 1) + ' ("' + line + '") threw: ' + e.message);
      break;
    }
    const after = be.state();
    if (after.roomId !== before.roomId) visited.add(after.roomId);
    if (after.score !== before.score) firedRules++;
    transcript.push({ cmd: line, prose: r.prose, room: after.roomId, score: after.score });

    if (be.world.ended) break;
  }

  const end = be.world.ended;
  if (!end) {
    const s = be.state();
    err('E410', 'the walkthrough ran to the end without winning',
      'Stopped in ' + s.roomId + ' at ' + s.score + ' points after ' + s.moves +
      ' moves. The last command was "' + (transcript[transcript.length - 1] || {}).cmd + '".');
  } else if (!end.win) {
    err('E411', 'the walkthrough ends in a loss, not a win', end.reason);
  }

  const s = be.state();
  const totalRooms = (worldDef.rooms || []).length;
  return {
    ok: findings.filter(f => f.level === 'error').length === 0,
    findings,
    transcript,
    stats: {
      commands: cmds.length,
      moves: s.moves,
      score: s.score,
      won: !!(end && end.win),
      roomsVisited: visited.size,
      roomCoverage: totalRooms ? Math.round((visited.size / totalRooms) * 100) : 0
    }
  };
}

module.exports = { replay };
