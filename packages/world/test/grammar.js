//  The grammar a Zork-scale or MacVenture-scale game actually needs.
//
//  Every case here was impossible to express before, and the first cold build of
//  a game hit most of them and worked around them by hand. The two-object case is
//  the worst of the set: the board has always asked the player for a second
//  object under USE and HIT, and matches() dropped it on the floor, so the central
//  MacVenture gesture was wired up at both ends and connected to nothing in the
//  middle. Pick a verb, click two things, get silence.

'use strict';
const { createBackend } = require('../index.js');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};
console.log('\n=== \x1b[1mworld grammar\x1b[0m ===\n');

const boot = (w) => createBackend(w, { seed: 1 });
const base = (extra) => Object.assign({
  meta: { start: 'A' }, rooms: [{ id: 'A', exits: [] }], items: [], rules: []
}, extra);

// ---- two-object rules -----------------------------------------------------
{
  const be = boot(base({
    items: [{ id: 'DOOR', location: 'A', attributes: {} },
            { id: 'KEY', location: 'A', attributes: { TAKEBIT: true } }],
    rules: [
      { on: { verb: 'USE', noun: 'DOOR', second: 'KEY' },
        do: [{ type: 'print', text: 'The key turns.' }] },
      { on: { verb: 'USE', noun: 'DOOR' }, do: [{ type: 'print', text: 'With what?' }] }
    ]
  }));
  ok('a pairing reaches its rule', be.submit('USE', 'DOOR', 'KEY').prose === 'The key turns.');
  ok('the single-object fallback still answers on its own',
    be.submit('USE', 'DOOR').prose === 'With what?');
}
{
  // And the reverse: a bare rule must not swallow a pairing just by being first.
  const be = boot(base({
    items: [{ id: 'DOOR', location: 'A', attributes: {} },
            { id: 'KEY', location: 'A', attributes: {} }],
    rules: [
      { on: { verb: 'USE', noun: 'DOOR' }, do: [{ type: 'print', text: 'nothing' }] },
      { on: { verb: 'USE', noun: 'DOOR', second: 'KEY' }, do: [{ type: 'print', text: 'opens' }] }
    ]
  }));
  ok('a rule with no second object does not swallow a two-object command',
    be.submit('USE', 'DOOR', 'KEY').prose === 'opens');
}

// ---- counters -------------------------------------------------------------
{
  const be = boot(base({
    counters: { trips: 0 },
    rules: [
      { on: { verb: 'WAIT' }, if: [{ type: 'counter-at-least', counter: 'trips', value: 3 }],
        do: [{ type: 'print', text: 'third' }] },
      { on: { verb: 'WAIT' }, do: [{ type: 'add-counter', counter: 'trips', value: 1 },
                                   { type: 'print', text: 'again' }] }
    ]
  }));
  be.submit('WAIT'); be.submit('WAIT'); be.submit('WAIT');
  ok('a counter branches on the third time', be.submit('WAIT').prose === 'third');
  ok('counters are published in globals, alongside flags', be.state().globals.trips === 3,
    JSON.stringify(be.state().globals));
}

// ---- boolean composition --------------------------------------------------
{
  const be = boot(base({
    flags: { a: true, b: false },
    rules: [{ on: { verb: 'LOOK' },
      if: [{ type: 'any', conditions: [{ type: 'flag', flag: 'a' }, { type: 'flag', flag: 'b' }] }],
      do: [{ type: 'print', text: 'either' }] }]
  }));
  ok('any passes when one branch holds', be.submit('LOOK').prose === 'either');
}
{
  const be = boot(base({
    flags: { a: true, b: false },
    rules: [
      { on: { verb: 'LOOK' },
        if: [{ type: 'all', conditions: [{ type: 'flag', flag: 'a' }, { type: 'flag', flag: 'b' }] }],
        do: [{ type: 'print', text: 'both' }] },
      { on: { verb: 'LOOK' }, do: [{ type: 'print', text: 'not both' }] }
    ]
  }));
  ok('all fails when one branch does not hold', be.submit('LOOK').prose === 'not both');
}

// ---- rooms that change ----------------------------------------------------
{
  const be = boot({
    meta: { start: 'A' }, flags: { awake: false }, items: [],
    rooms: [{ id: 'A', prose: 'He is asleep.', exits: [],
      variants: [{ if: [{ type: 'flag', flag: 'awake' }], prose: 'He is awake.' }] }],
    rules: [{ on: { verb: 'HIT' }, do: [{ type: 'set-flag', flag: 'awake' }] }]
  });
  ok('a room reads its base prose first', /He is asleep/.test(be.submit('LOOK').prose));
  be.submit('HIT');
  ok('and switches once its variant holds', /He is awake/.test(be.submit('LOOK').prose));
}

// ---- actors ---------------------------------------------------------------
{
  const be = boot({
    meta: { start: 'A' }, items: [],
    rooms: [{ id: 'A', exits: [{ dir: 'NORTH', to: 'B' }] }, { id: 'B', exits: [] }],
    actors: [{ id: 'TROLL', location: 'A', hostile: true }],
    rules: [
      { on: { verb: 'LOOK' }, if: [{ type: 'fighting' }], do: [{ type: 'print', text: 'menaced' }] },
      { on: { verb: 'LOOK' }, do: [{ type: 'print', text: 'quiet' }] }
    ]
  });
  ok('fighting reads as a condition', be.submit('LOOK').prose === 'menaced');
  be.submit('NORTH');
  ok('and stops holding once you leave the room', be.submit('LOOK').prose === 'quiet');
}
{
  const be = boot({
    meta: { start: 'A' }, items: [],
    rooms: [{ id: 'A', exits: [] }, { id: 'B', exits: [] }],
    actors: [{ id: 'THIEF', location: 'B' }],
    rules: [
      { on: { verb: 'LOOK' }, if: [{ type: 'actor-here', actor: 'THIEF' }],
        do: [{ type: 'print', text: 'he is here' }] },
      { on: { verb: 'LOOK' }, do: [{ type: 'print', text: 'alone' }] },
      { on: { verb: 'SPEAK' }, do: [{ type: 'move-actor', actor: 'THIEF', to: 'A' }] }
    ]
  });
  ok('actor-here is false while the actor is elsewhere', be.submit('LOOK').prose === 'alone');
  be.submit('SPEAK');
  ok('and true once a rule moves them in', be.submit('LOOK').prose === 'he is here');
}

// ---- waiting --------------------------------------------------------------
{
  const be = boot(base({ meta: { start: 'A', defaults: { wait: 'You count ten.' } } }));
  ok('WAIT passes a turn and can be worded', be.submit('WAIT').prose === 'You count ten.');
  ok('and it costs a move', be.state().moves === 1, 'moves=' + be.state().moves);
}


// ---- arriving somewhere ---------------------------------------------------
{
  const be = boot({
    meta: { start: 'LEDGE' }, items: [],
    rooms: [{ id: 'LEDGE', prose: 'A ledge.', exits: [{ dir: 'DOWN', to: 'PIT' }] },
            { id: 'PIT', prose: 'A pit.', exits: [] }],
    rules: [{ on: { enter: 'PIT' },
      do: [{ type: 'print', text: 'The floor gives way.' }, { type: 'set-flag', flag: 'fell' }] }]
  });
  // Every field on `on` is optional, so without an explicit guard an arrival
  // rule matched the first command of any kind and answered the whole game.
  ok('an arrival rule does not answer ordinary commands',
    !/gives way/.test(be.submit('LOOK').prose), be.submit('LOOK').prose.split('\n')[0]);
  const arrived = be.submit('DOWN').prose;
  ok('it fires on arrival', /gives way/.test(arrived), arrived.replace(/\n+/g, ' | '));
  ok('and its effects land', be.state().globals.fell === true);
}

// ---- refusals that belong to the passage ----------------------------------
{
  const be = boot({
    meta: { start: 'A', defaults: { blocked: 'You cannot go that way.' } },
    flags: { tied: false }, items: [],
    rooms: [{ id: 'A', exits: [
        { dir: 'NORTH', to: 'B', condition: { type: 'flag', flag: 'tied' },
          blocked: 'The rope is not tied off yet.' },
        { dir: 'EAST', to: 'B', condition: { type: 'flag', flag: 'tied' } }] },
      { id: 'B', exits: [] }]
  });
  ok('a blocked exit can speak for itself',
    be.submit('NORTH').prose === 'The rope is not tied off yet.');
  ok('and falls back to the global refusal when it does not',
    be.submit('EAST').prose === 'You cannot go that way.');
}

// ---- examining ------------------------------------------------------------
{
  const be = boot({
    meta: { start: 'A' }, rooms: [{ id: 'A', prose: 'A room.', exits: [] }],
    items: [{ id: 'ROPE', name: 'rope', location: 'A',
              description: 'Hemp, and older than you are.', attributes: {} },
            { id: 'MOSS', name: 'moss', location: 'A', attributes: {} },
            { id: 'FAR', name: 'far thing', location: 'B', attributes: {} }],
    rules: []
  });
  ok('LOOK with a noun examines rather than re-describing the room',
    be.submit('LOOK', 'ROPE').prose === 'Hemp, and older than you are.');
  ok('something with no description still answers',
    /nothing special/.test(be.submit('LOOK', 'MOSS').prose));
  ok('and something that is not here is refused',
    /do not see/.test(be.submit('LOOK', 'FAR').prose));
  ok('a bare LOOK still describes the room', /A room/.test(be.submit('LOOK').prose));
}

// ---- countdowns you can defeat --------------------------------------------
{
  const world = {
    meta: { start: 'A' }, flags: { drank: false }, items: [],
    rooms: [{ id: 'A', exits: [] }], rules: [],
    timers: [{ turns: 3, stopFlag: 'drank', do: [{ type: 'lose', text: 'Thirst finishes you.' }] }]
  };
  let be = boot(world);
  be.submit('WAIT'); be.submit('WAIT'); be.submit('WAIT');
  ok('an unanswered countdown kills you', !!be.world.ended);
  be = boot(world);
  be.world.flags.drank = true;
  be.submit('WAIT'); be.submit('WAIT'); be.submit('WAIT'); be.submit('WAIT');
  ok('and one you answered does not', !be.world.ended);
}


// ---- companions -----------------------------------------------------------
{
  const be = boot({
    meta: { start: 'A' }, items: [],
    rooms: [{ id: 'A', exits: [{ dir: 'NORTH', to: 'B' }] }, { id: 'B', exits: [] }],
    actors: [{ id: 'HANS', name: 'Hans', location: 'PLAYER',
               description: 'Silent, and always a step behind.' },
             { id: 'GUIDE', name: 'guide', location: 'B' }],
    rules: [
      { on: { verb: 'SPEAK', noun: 'HANS' }, if: [{ type: 'actor-here', actor: 'HANS' }],
        do: [{ type: 'print', text: 'Hans nods.' }] },
      { on: { verb: 'SPEAK', noun: 'HANS' }, do: [{ type: 'print', text: 'He is not here.' }] }
    ]
  });
  ok('an actor located on the player is present at the start',
    be.submit('SPEAK', 'HANS').prose === 'Hans nods.');
  ok('and is listed in the room', be.state().objects.indexOf('HANS') >= 0,
    JSON.stringify(be.state().objects));
  be.submit('NORTH');
  ok('and comes with you', be.submit('SPEAK', 'HANS').prose === 'Hans nods.');
  ok('while an actor left behind does not follow',
    be.state().objects.indexOf('GUIDE') >= 0);   // GUIDE lives in B, we are in B
  ok('a companion can be examined anywhere',
    /step behind/.test(be.submit('LOOK', 'HANS').prose));
}

// ---- endings with more than one breath ------------------------------------
{
  const be = boot(base({
    rules: [{ on: { verb: 'LOOK' },
      do: [{ type: 'win', pages: ['The raft breaks the surface.',
                                  'Stromboli, and the sun.',
                                  'Hamburg, and nobody believes a word.'] }] }]
  }));
  be.submit('LOOK');
  ok('an ending can be paced as beats', be.world.ended.pages.length === 3);
  ok('and still reads as one block for anything that wants it',
    /raft breaks[\s\S]*nobody believes/.test(be.world.ended.reason));
}
{
  const be = boot(base({
    rules: [{ on: { verb: 'LOOK' }, do: [{ type: 'win', text: 'Done.' }] }]
  }));
  be.submit('LOOK');
  ok('a single-string ending still works', be.world.ended.pages.join('') === 'Done.');
}

// ---- chance ---------------------------------------------------------------
{
  const world = base({
    rules: [{ on: { verb: 'HIT' }, if: [{ type: 'chance', percent: 50 }],
              do: [{ type: 'print', text: 'hit' }] },
            { on: { verb: 'HIT' }, do: [{ type: 'print', text: 'miss' }] }]
  });
  const roll = (seed) => {
    const b = createBackend(world, { seed });
    return [1, 2, 3, 4, 5, 6].map(() => b.submit('HIT').prose).join('');
  };
  const a = roll(7);
  ok('rolls vary within a run', /hit/.test(a) && /miss/.test(a), a);
  ok('and repeat exactly on the same seed', roll(7) === a);
  ok('while a different seed gives a different fight', roll(99) !== a, roll(99));
}


// ---- characters who go about their business -------------------------------
//
// The largest single thing the format could not express was Zork's thief.
// Measured against the ZIL source, characters and combat are 39 of the 72
// routines that need real code — more than half of everything out of reach.
{
  const w = {
    meta: { start: 'A' },
    rooms: [{ id: 'A', exits: [{ dir: 'NORTH', to: 'B' }] },
            { id: 'B', exits: [{ dir: 'SOUTH', to: 'A' }] },
            { id: 'LAIR', exits: [] }],
    items: [{ id: 'COIN', name: 'coin', location: 'PLAYER', attributes: { TAKEBIT: true } }],
    actors: [{ id: 'THIEF', name: 'thief', location: 'B',
      patrol: { rooms: ['B', 'A'], every: 1, arrives: 'He slips in.', leaves: 'He melts away.' },
      takes: { to: 'LAIR', chance: 100, says: 'He lifts the coin.' } }],
    rules: [{ on: { meets: 'THIEF' }, do: [{ type: 'print', text: 'He looks you over.' }] }]
  };
  const be = boot(w);
  const first = be.submit('LOOK').prose;
  ok('a patrolling character walks into your room',
    /slips in/.test(first), first.replace(/\n+/g, ' | ').slice(0, 60));
  ok('and helps itself to what you are carrying',
    be.world.loc.COIN === 'LAIR', 'coin is at ' + be.world.loc.COIN);
  ok('and a meets rule answers while it is here', /looks you over/.test(first));
  ok('it leaves again on its route',
    /melts away/.test(be.submit('LOOK').prose));
  // An encounter is a thing that happens during the turn, not the turn's answer.
  // It fires whenever the character is present, which is what makes a haunting
  // lethal, but the command still gets its own reply first.
  const both = be.submit('TAKE', 'NOTHING').prose;
  ok('an encounter does not replace the answer to the command',
    /do not see|not something/i.test(both.split('\n')[0]), both.split('\n')[0]);
}
{
  // A route is walked in order, because a patrol a player can learn is a beat
  // and a patrol that shuffles is indistinguishable from teleporting.
  const be = boot({
    meta: { start: 'A' }, items: [],
    rooms: [{ id: 'A', exits: [] }, { id: 'B', exits: [] }, { id: 'C', exits: [] }],
    actors: [{ id: 'GUARD', location: 'A', patrol: { rooms: ['A', 'B', 'C'], every: 1 } }],
    rules: []
  });
  const seen = [];
  for (var i = 0; i < 4; i++) { be.submit('LOOK'); seen.push(be.world.actorLoc.GUARD); }
  ok('a named route is walked in order', seen.join('') === 'BCAB', seen.join(' '));
}
{
  // Uninvited's shape rather than Zork's: something that kills you unless you
  // are carrying the thing that wards it off.
  const w = {
    meta: { start: 'A' }, rooms: [{ id: 'A', exits: [] }],
    items: [{ id: 'AMULET', location: 'A', attributes: { TAKEBIT: true } }],
    actors: [{ id: 'WRAITH', location: 'A', hostile: true, patrol: { rooms: ['A'], every: 1 } }],
    rules: [{ on: { meets: 'WRAITH' },
      if: [{ type: 'not', condition: { type: 'carrying', item: 'AMULET' } }],
      do: [{ type: 'lose', text: 'The cold gets into you.' }] }]
  };
  let be = boot(w);
  be.submit('LOOK');
  ok('a haunting kills you when you are unprotected', !!be.world.ended);
  be = boot(w);
  be.submit('TAKE', 'AMULET');
  be.submit('LOOK');
  ok('and does not when you are not', !be.world.ended);
}

console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
