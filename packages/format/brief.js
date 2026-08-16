//  The authoring brief — the dials a creator actually turns.
//
//  Without these you get whatever the compiler felt like producing. With them you
//  get intent, and intent is what makes a tool feel like an instrument rather than
//  a slot machine.
//
//  The important design decision is that the dials are NOT raw knobs. Nobody knows
//  what "chain depth 6" means, and asking is a bad question anyway: difficulty is
//  not one quantity. It is chain depth, clue explicitness, how far a key sits from
//  its lock, and how long the game dares to go without paying out — and those move
//  together in ways a creator should not have to hand-tune.
//
//  So a creator states an intent ("cruel", "epic") and the brief resolves it into
//  concrete targets, anchored on the measured Zork I profile as "standard".
//
//  The second decision matters more: THE SAME RESOLVED BRIEF IS BOTH THE
//  GENERATION TARGET AND THE VALIDATION THRESHOLD. The compiler builds toward it;
//  T4 judges against it. One source of truth, so a game cannot be generated to one
//  standard and graded against another — which is exactly how a "difficulty
//  setting" quietly becomes decorative in tools that keep the two apart.

'use strict';

// Zork I, measured (conformance/corpus/zork-1.json). "Standard" is not a guess.
const ZORK = {
  rooms: 82,
  loopsPerRoom: 0.67,
  takeRate: 43,
  movesPerScoreEvent: 11.5,
  longestDrySpell: 69,
  chainDepth: 9
};

const LENGTH = {
  short:    { rooms: 12, label: 'an hour or so' },
  standard: { rooms: 35, label: 'an evening' },
  epic:     { rooms: 82, label: 'a Zork-scale undertaking' }
};

// Difficulty is four dials moving together. Gentle is not "fewer puzzles" — it is
// shallower chains, clues placed near their locks, and rewards that arrive often
// enough to keep faith. Cruel earns its patience budget.
const DIFFICULTY = {
  gentle:   { chainDepth: 3, gateDistance: 1, drySpell: 20, cluePolicy: 'explicit',
              label: 'forgiving — clues near their locks, frequent rewards' },
  standard: { chainDepth: 5, gateDistance: 3, drySpell: 45, cluePolicy: 'stated',
              label: 'fair — the classic rhythm' },
  cruel:    { chainDepth: 9, gateDistance: 6, drySpell: 69, cluePolicy: 'implied',
              label: 'Zork-hard — long chains, distant keys, real dry spells' }
};

const DEADLINESS = {
  none:    { deaths: 0, warned: true,  label: 'nothing can kill you' },
  fair:    { deaths: 3, warned: true,  label: 'you can die, but you are always warned first' },
  classic: { deaths: 8, warned: false, label: 'the grue is out there and it does not announce itself' }
};

// Sprawl controls map interconnection. Linear is a corridor and reads as generated
// geography; open is Zork, where nearly every room sits on a circuit.
const SPRAWL = {
  linear:   { loopsPerRoom: 0.05, label: 'a path through' },
  balanced: { loopsPerRoom: 0.35, label: 'some circling back' },
  open:     { loopsPerRoom: 0.67, label: 'a place you learn to navigate' }
};

// Density is the scenery ratio, and more is not better. Zork keeps 57% of what a
// player sees as pure scenery; that is what makes the useful objects feel chosen.
const DENSITY = {
  sparse:   { takeRate: 25, label: 'mostly scenery, a few things that matter' },
  balanced: { takeRate: 43, label: "Zork's ratio — over half the world is texture" },
  packed:   { takeRate: 70, label: 'most things are useful' }
};

/**
 * Resolve a creator's intent into concrete targets.
 *
 * @param {object} brief
 * @param {string|{rooms:number}} [brief.length]      short | standard | epic
 * @param {string} [brief.difficulty]                 gentle | standard | cruel
 * @param {string} [brief.deadliness]                 none | fair | classic
 * @param {string} [brief.sprawl]                     linear | balanced | open
 * @param {string} [brief.density]                    sparse | balanced | packed
 * @param {object} [brief.source]                     what the Story Bible counted
 * @param {number} [brief.source.locations]           named places in the source
 * @param {number} [brief.source.objects]             significant objects
 */
function resolve(brief) {
  brief = brief || {};
  const notes = [];

  // ---- length: an explicit dial, or inferred from what the source actually holds
  let rooms;
  if (brief.length && typeof brief.length === 'object' && brief.length.rooms) {
    rooms = brief.length.rooms;
    notes.push('length set explicitly to ' + rooms + ' rooms');
  } else if (brief.length && LENGTH[brief.length]) {
    rooms = LENGTH[brief.length].rooms;
    notes.push('length "' + brief.length + '" — ' + LENGTH[brief.length].label);
  } else if (brief.source && brief.source.locations) {
    // The answer to "how do we stop a thousand-page novel compiling to six rooms".
    // Scale follows the source unless a creator overrides it, so a long book is
    // judged against the world it actually contains.
    rooms = clamp(brief.source.locations, 8, 200);
    notes.push('length inferred from the source: ' + brief.source.locations +
      ' named locations found, targeting ' + rooms + ' rooms');
  } else {
    rooms = LENGTH.standard.rooms;
    notes.push('length defaulted to standard (' + rooms + ' rooms)');
  }

  const diff = DIFFICULTY[brief.difficulty] || DIFFICULTY.standard;
  const dead = DEADLINESS[brief.deadliness] || DEADLINESS.fair;
  const spr = SPRAWL[brief.sprawl] || SPRAWL.balanced;
  const den = DENSITY[brief.density] || DENSITY.balanced;

  // Chain depth cannot exceed what the map can carry. A 12-room world cannot host
  // a 9-step chain without every room being a gate, which is a corridor wearing a
  // puzzle costume — so a small "cruel" game is honestly reported as capped.
  const maxSupportable = Math.max(2, Math.floor(rooms / 3));
  const chainDepth = Math.min(diff.chainDepth, maxSupportable);
  if (chainDepth < diff.chainDepth) {
    notes.push('chain depth capped at ' + chainDepth + ' (a ' + rooms +
      '-room world cannot carry ' + diff.chainDepth + ' without becoming a corridor of gates)');
  }

  const targets = {
    rooms,
    chainDepth,
    gateDistance: Math.min(diff.gateDistance, Math.max(1, Math.floor(rooms / 6))),
    longestDrySpell: diff.drySpell,
    cluePolicy: diff.cluePolicy,
    deaths: dead.deaths,
    deathsWarned: dead.warned,
    loopsPerRoom: spr.loopsPerRoom,
    takeRate: den.takeRate,
    items: Math.round(rooms * 1.07),          // Zork: 88 objects across 82 rooms
    scoreEvents: Math.max(3, Math.round(rooms / 1.9))  // Zork: 43 events, 82 rooms
  };

  return {
    targets,
    notes,
    // T4 reads this directly. Floors sit below target so a game that lands near
    // its brief is not nagged for missing it by one — the dial is an aim, not a
    // tripwire.
    thresholds: {
      minRooms: Math.round(targets.rooms * 0.6),
      minDepth: Math.max(2, Math.round(targets.chainDepth * 0.6)),
      minLoopsPerRoom: targets.loopsPerRoom * 0.5,
      minParticipation: Math.max(15, Math.round(targets.takeRate * 0.6)),
      maxParticipation: Math.min(95, Math.round(targets.takeRate * 1.8)),
      minRoomUtility: 60,
      // A dial must silence the warning it authorises, or the creator is nagged
      // for doing exactly what they asked for — the fastest way to teach someone
      // to ignore the whole report.
      expectDeaths: targets.deaths > 0
    },
    describe: () => describe(brief, targets)
  };
}

function describe(brief, t) {
  const lines = [];
  lines.push('A ' + t.rooms + '-room game with puzzle chains up to ' + t.chainDepth + ' steps deep.');
  lines.push((DIFFICULTY[brief.difficulty] || DIFFICULTY.standard).label + '.');
  lines.push((DEADLINESS[brief.deadliness] || DEADLINESS.fair).label + '.');
  lines.push('Map: ' + (SPRAWL[brief.sprawl] || SPRAWL.balanced).label + '.');
  lines.push('World: ' + (DENSITY[brief.density] || DENSITY.balanced).label + '.');
  lines.push('Expect a reward roughly every ' +
    Math.round((t.rooms * 6) / t.scoreEvents) + ' moves, with dry spells up to ' +
    t.longestDrySpell + '.');
  return lines.join('\n');
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

module.exports = { resolve, ZORK, LENGTH, DIFFICULTY, DEADLINESS, SPRAWL, DENSITY };
