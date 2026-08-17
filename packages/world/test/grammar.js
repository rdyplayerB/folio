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

console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
