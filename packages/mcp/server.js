#!/usr/bin/env node
/* eslint-disable no-console */
//
//  folio-mcp — the engine as tools an agent can call.
//
//  This does not make the format more portable. A .folio is JSON in a zip and a
//  model that has read the spec can already produce one; MCP is a client-server
//  protocol for a single session, not an interoperability standard. What it buys
//  is the loop: write a world, validate it, read the exact failure, fix it, and go
//  again without a human shuttling files between a chat window and a terminal.
//
//  The second thing it buys is the one worth having. folio_play_start and
//  folio_play_send let an agent PLAY a game it did not write, with the walkthrough
//  withheld. That is the blind solver, and it is the missing half of T4: today a
//  badge can say a path exists and cannot say a human would find it.
//
//  Two deliberate constraints:
//
//  PATH B ONLY for anything that runs. A world is data and cannot contain
//  executable code, so playing one from a stranger is safe. A Z-machine story is a
//  compiled program by definition, and an agent handing arbitrary binaries to a
//  tool that executes them is a different risk with a different answer. Calibration
//  is offered because it is a static read of the file and never runs it.
//
//  NO DEPENDENCIES, including the MCP SDK. The protocol over stdio is newline
//  delimited JSON-RPC 2.0 and implementing it is a couple of hundred lines. This
//  package's whole promise is that a game keeps working, and every dependency is a
//  thing that can stop being installable.
//
//  Run:  node packages/mcp/server.js
//  Or wire it into a client as the command for a stdio server.

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const world = require('../world/index.js');
const { validate } = require('../validator/index.js');
const { pack: packDir, load } = require('../format/pack.js');
const zip = require('../format/zip.js');
const crypto = require('crypto');
const { validateWorld, WORLD_SCHEMA } = require('../format/schema.js');
const brief = require('../format/brief.js');
const trace = require('../format/trace.js');

const ROOT = path.join(__dirname, '..', '..');
const SPEC = path.join(ROOT, 'site', 'llms.txt');

// stdout belongs to the protocol. Anything else said out loud corrupts the
// stream, so diagnostics go to stderr and nowhere else.
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

// Build a container from files already in memory. pack.js walks a directory,
// which an agent holding a world in its context does not have; the checksum and
// required-entry rules are the same, and load() verifies them either way.
function packFiles(files) {
  for (const req of ['manifest.json', 'walkthrough.folioscript']) {
    if (!files[req]) throw new Error('a .folio needs ' + req);
  }
  const sums = {};
  for (const name of Object.keys(files).sort()) {
    sums[name] = crypto.createHash('sha256').update(files[name]).digest('hex');
  }
  files['checksums.json'] = Buffer.from(JSON.stringify(sums, null, 2), 'utf8');
  return zip.write(files);
}

// ---------------------------------------------------------------- play sessions
// Held in memory and keyed by an opaque id. A session is a running world, which
// is plain data, so nothing here escapes the process.
const sessions = new Map();
let seq = 0;

function shortState(be) {
  const s = be.state();
  return {
    room: s.roomId, roomName: s.roomName,
    score: s.score, moves: s.moves, dark: s.dark,
    // What a player can see and act on, which is all a blind solver should get.
    objects: s.objects, inventory: s.inventory,
    exits: Object.keys(s.exits).filter(d => s.exits[d] !== false),
    blockedExits: Object.keys(s.exits).filter(d => s.exits[d] === false),
    ended: be.world.ended || null
  };
}

// --------------------------------------------------------------------- tools
const TOOLS = [
  {
    name: 'folio_spec',
    description:
      'The complete Folio authoring spec in one document: the closed vocabularies, ' +
      'a worked example, and the failures worth expecting. Read this first if you ' +
      'have not written a Folio world before.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => text(fs.readFileSync(SPEC, 'utf8'))
  },
  {
    name: 'folio_schema',
    description:
      'The JSON Schema for world.json. Use it to constrain generation so only ' +
      'valid structures are emitted. The validator checks against this same file.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => json(WORLD_SCHEMA)
  },
  {
    name: 'folio_validate',
    description:
      'Check a world. Runs shape (schema), integrity, dependency-graph analysis ' +
      '(proves no dead ends), cold-start walkthrough replay (proves it can be ' +
      'finished), and a design audit. Supply the walkthrough to get past T2. ' +
      'This is the tool to call after every edit.',
    inputSchema: {
      type: 'object',
      required: ['world'],
      additionalProperties: false,
      properties: {
        world: { type: 'object', description: 'A world.json object.' },
        walkthrough: {
          type: 'string',
          description: 'Newline-separated commands. Without one, replay and design ' +
            'checks cannot run and the result says so.'
        },
        brief: {
          type: 'object',
          description: 'Optional authoring dials. Supplying them grades the design ' +
            'audit against your stated intent instead of generic defaults.'
        }
      }
    },
    handler: (args) => {
      const shape = validateWorld(args.world);
      const files = {
        'logic/world.json': Buffer.from(JSON.stringify(args.world), 'utf8')
      };
      if (args.brief) files['brief.json'] = Buffer.from(JSON.stringify(args.brief), 'utf8');
      // A synthetic manifest, so an agent iterating on logic is not made to
      // invent packaging metadata before it can check its work.
      const game = {
        manifest: {
          id: 'draft', title: (args.world.meta && args.world.meta.title) || 'Draft',
          author: 'mcp', folioVersion: '0.1.0', logicType: 'world',
          license: 'MIT', contentRating: 'all-ages'
        },
        walkthrough: args.walkthrough || '',
        files
      };
      const r = validate(game);
      let findings = r.findings;
      let ran = r.ran;
      let tier = r.tier;
      let ok = r.ok;

      // A missing walkthrough must not cost an agent its structural feedback.
      //
      // Packaging treats an empty walkthrough as fatal, which is right for a game
      // being published and wrong here: half the reason to call this tool is to
      // check a world that is still being drafted. Left alone, the only thing
      // coming back would be "walkthrough.folioscript is empty", which says
      // nothing about the world and stops the graph analysis from ever running.
      // So when no walkthrough was offered, that particular complaint is dropped
      // and the dead-end analysis is run directly instead.
      if (!args.walkthrough) {
        findings = findings.filter(f => f.code !== 'E107');
        // The tier chain stops at the first error, so with E107 dropped the shape
        // and graph checks have to be run here rather than read off the result.
        if (!shape.ok) {
          findings = findings.concat(shape.errors.slice(0, 12).map(e => ({
            level: 'error', code: 'E212',
            msg: 'world.json ' + e.path + ' ' + e.msg,
            hint: 'Checked against the published schema.'
          })));
        } else {
          const g = require('../validator/graph.js').analyse(args.world);
          findings = findings.concat(g.findings);
          ran = ran.concat(['T2']);
        }
        ok = findings.every(f => f.level !== 'error');
        tier = ok ? 'valid' : 'invalid';
      }

      return json({
        ok,
        tier,
        ranTiers: ran,
        notChecked: ['T0', 'T1', 'T2', 'T3', 'T4'].filter(t => !ran.includes(t)),
        schemaOk: shape.ok,
        stats: r.stats,
        findings: findings.map(f => ({
          level: f.level, code: f.code, message: f.msg, hint: f.hint
        })),
        note: !args.walkthrough
          ? 'No walkthrough supplied, so completability was not proved. Send one to ' +
            'reach "playable".'
          : tier === 'playable'
            ? '"playable" means a path exists, not that a human could find it.'
            : undefined
      });
    }
  },
  {
    name: 'folio_play_start',
    description:
      'Boot a world and return the opening text. Use with folio_play_send to play ' +
      'it. To test whether a game is findable rather than merely completable, play ' +
      'it without reading its walkthrough.',
    inputSchema: {
      type: 'object',
      required: ['world'],
      additionalProperties: false,
      properties: {
        world: { type: 'object' },
        seed: { type: 'integer', description: 'Defaults to 1234, so runs repeat.' }
      }
    },
    handler: (args) => {
      const shape = validateWorld(args.world);
      if (!shape.ok) {
        return json({ error: 'the world does not match the schema',
          problems: shape.errors.slice(0, 6) }, true);
      }
      const be = world.createBackend(args.world,
        { seed: args.seed === undefined ? 1234 : args.seed });
      const id = 'play-' + (++seq);
      sessions.set(id, be);
      return json({ session: id, prose: be.banner, state: shortState(be),
        verbs: ['LOOK', 'TAKE', 'DROP', 'OPEN', 'CLOSE', 'USE', 'HIT', 'SPEAK'],
        note: 'Only the twelve directions, LOOK, TAKE, DROP, OPEN and INVENTORY have ' +
              'built-in behaviour. Everything else is whatever the world defines.' });
    }
  },
  {
    name: 'folio_play_send',
    description: 'Send one command to a running game and get the response and new state.',
    inputSchema: {
      type: 'object',
      required: ['session', 'command'],
      additionalProperties: false,
      properties: {
        session: { type: 'string' },
        command: { type: 'string', description: 'For example "take lamp" or "north".' }
      }
    },
    handler: (args) => {
      const be = sessions.get(args.session);
      if (!be) return json({ error: 'no such session. Call folio_play_start first.' }, true);
      const parts = String(args.command).trim().split(/\s+/);
      const verb = parts.shift() || '';
      const noun = parts.length ? parts.join(' ').toUpperCase() : null;
      const r = be.submit(verb, noun);
      return json({ prose: r.prose, state: shortState(be) });
    }
  },
  {
    name: 'folio_play_end',
    description: 'Discard a running game session.',
    inputSchema: {
      type: 'object', required: ['session'], additionalProperties: false,
      properties: { session: { type: 'string' } }
    },
    handler: (args) => json({ closed: sessions.delete(args.session) })
  },
  {
    name: 'folio_pack',
    description:
      'Assemble a finished game into a .folio file and return it base64 encoded. ' +
      'This is the last step: the result is a single self-contained file that runs ' +
      'in a browser with no server. Validates on the way through and reports what ' +
      'the game may claim.',
    inputSchema: {
      type: 'object',
      required: ['world', 'walkthrough', 'manifest'],
      additionalProperties: false,
      properties: {
        world: { type: 'object' },
        walkthrough: { type: 'string', description: 'Newline-separated commands that reach the ending.' },
        manifest: {
          type: 'object',
          required: ['id', 'title', 'author', 'license', 'contentRating'],
          description: 'folioVersion and logicType are filled in for you.',
          properties: {
            id: { type: 'string' }, title: { type: 'string' }, author: { type: 'string' },
            license: { type: 'string', description: 'An SPDX id, or "unknown" (playable, not hostable).' },
            contentRating: { type: 'string', enum: ['all-ages', 'teen', 'mature'] },
            capabilities: { type: 'array', items: { type: 'string' } },
            aiDisclosure: { type: 'object', description: 'What was generated, what a human reviewed.' }
          }
        },
        brief: { type: 'object', description: 'Ship it and the design audit grades against your intent.' },
        presentation: {
          type: 'object',
          description: 'Optional presentation files, as {"scenes.js": "...source..."}. ' +
            'They land under presentation/ in the container.',
          additionalProperties: { type: 'string' }
        }
      }
    },
    handler: (args) => {
      const m = Object.assign({ folioVersion: '0.1.0', logicType: 'world' }, args.manifest);
      const files = {
        'manifest.json': Buffer.from(JSON.stringify(m, null, 2), 'utf8'),
        'walkthrough.folioscript': Buffer.from(args.walkthrough, 'utf8'),
        'logic/world.json': Buffer.from(JSON.stringify(args.world, null, 2), 'utf8')
      };
      if (args.brief) files['brief.json'] = Buffer.from(JSON.stringify(args.brief), 'utf8');
      for (const [name, src] of Object.entries(args.presentation || {})) {
        // Keep it inside presentation/ whether or not the caller said so, and
        // refuse anything trying to climb out of the container.
        const clean = String(name).replace(/^presentation\//, '');
        if (/(^\/|\.\.)/.test(clean)) throw new Error('bad presentation path: ' + name);
        files['presentation/' + clean] = Buffer.from(String(src), 'utf8');
      }

      const buf = packFiles(files);
      const game = load(buf);
      const r = validate(game);
      return json({
        filename: m.id + '.folio',
        bytes: buf.length,
        base64: buf.toString('base64'),
        tier: r.tier,
        ok: r.ok,
        ranTiers: r.ran,
        stats: r.stats,
        findings: r.findings.map(f => ({ level: f.level, code: f.code, message: f.msg })),
        note: r.ok
          ? 'Write the base64 to a file as ' + m.id + '.folio. It runs in a browser ' +
            'with no server and keeps working offline.'
          : 'Packed, but it will not be hosted while it has errors.'
      });
    }
  },
  {
    name: 'folio_next',
    description:
      'What to do next. Reads whatever exists so far and returns the ordered list ' +
      'of remaining work with the reason for each. Call it any time you are unsure ' +
      'where you are, including at the very start with nothing.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        world: { type: 'object', description: 'Omit if you have not started one.' },
        walkthrough: { type: 'string' },
        manifest: { type: 'object' },
        brief: { type: 'object' },
        presentation: {
          type: 'object', additionalProperties: { type: 'string' },
          description: 'Same shape as folio_pack takes.'
        },
        goal: {
          type: 'string', enum: ['create', 'port'],
          description: 'Porting an existing Z-machine game is a different, shorter path.'
        }
      }
    },
    handler: (args) => nextSteps(args)
  },
  {
    name: 'folio_brief',
    description:
      'Resolve authoring dials into concrete targets and thresholds. The same ' +
      'resolved object is both what to build toward and what the design audit ' +
      'grades against, so a difficulty setting cannot become decorative.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        length: { type: 'string', enum: ['short', 'standard', 'epic'] },
        difficulty: { type: 'string', enum: ['gentle', 'standard', 'cruel'] },
        deadliness: { type: 'string', enum: ['none', 'fair', 'classic'] },
        sprawl: { type: 'string', enum: ['linear', 'balanced', 'open'] },
        density: { type: 'string', enum: ['sparse', 'balanced', 'packed'] },
        source: {
          type: 'object',
          description: 'What the source material actually contains, used to scale ' +
            'the game to it rather than to a default.',
          properties: {
            locations: { type: 'integer' },
            objects: { type: 'integer' }
          }
        }
      }
    },
    handler: (args) => {
      const r = brief.resolve(args || {});
      return json({ summary: r.describe(), targets: r.targets,
        thresholds: r.thresholds, notes: r.notes });
    }
  },
  {
    name: 'folio_calibrate',
    description:
      'Derive a Path A room map from a Z-machine v3 story file. Reads the binary ' +
      'statically and never executes it. Everything structural comes out exact; ' +
      'most attribute flags are returned as a census for a human to confirm.',
    inputSchema: {
      type: 'object',
      required: ['storyBase64'],
      additionalProperties: false,
      properties: {
        storyBase64: { type: 'string', description: 'The .z3 file, base64 encoded.' }
      }
    },
    handler: (args) => {
      const { calibrate } = require('../zmachine/calibrate.js');
      const r = calibrate(Buffer.from(args.storyBase64, 'base64'));
      return json({
        roommap: r.roommap,
        rooms: r.report.rooms,
        objects: r.report.objects,
        directionsConfident: r.report.directions.reciprocity,
        flagsNeedingConfirmation: r.report.missingFlags,
        census: r.report.census,
        note: 'Fill the remaining flags into ATTR by reading the census: the bit ' +
              'whose sample names match the meaning is the right one.'
      });
    }
  }
];

// ------------------------------------------------------------------ staging
//
//  The step-by-step, expressed as checks on the work rather than as a menu.
//
//  A wizard would be the obvious shape and the wrong one. The agent calling these
//  tools is already the conversational layer and is better at asking what someone
//  wants than any script we could ship. What it lacks is a sense of whether the
//  thing is sound yet, and a wizard breaks the moment somebody arrives holding a
//  half-finished world, or does the steps out of order, or comes back a week
//  later. Reading the artifact survives all three.
//
//  The order below is not arbitrary. Structure comes before prose because that is
//  what stops a long source compiling into six rooms and a walk: bad structure is
//  thrown away while it still costs nothing, rather than after forty room
//  descriptions are written. The walkthrough belongs with structure rather than at
//  the end, because once the puzzle graph exists the solution path is already
//  known, and it is the proof the whole certification rests on.

const CREATE_START = [
  { do: 'folio_spec', why: 'Read the format once. It is short and it is the whole thing.' },
  { do: 'folio_brief', why: 'Set intent first. The dials become the targets everything else is graded against, and shipping the brief means the design audit judges you against what you asked for rather than against Zork.' },
  { do: 'Draft structure with no prose', why: 'Rooms, exits, items and rules as bare ids. Write the walkthrough at the same time, because the solution path is known once the graph is. Leave every description empty for now.' },
  { do: 'folio_validate', why: 'Prove the shape holds and nothing is a dead end while it is still cheap to rearrange.' },
  { do: 'Write the prose', why: 'Descriptions, names, and the failure branches. The unguarded fallback rules are where a world stops feeling like a form.' },
  { do: 'folio_pack', why: 'Assemble the file.' }
];

const PORT_START = [
  { do: 'folio_spec', why: 'The container and manifest are the same on both paths.' },
  { do: 'folio_calibrate', why: 'Derive the room map from the story file. Everything structural comes out exact; a handful of attribute flags come back as a census for you to confirm by reading the object names.' },
  { do: 'Write a verb map', why: 'A Z-machine parser has idioms, so a click has to be turned into a line its parser accepts. Path B does not need this; Path A does.' },
  { do: 'Write a walkthrough', why: 'Nothing mechanical can prove a port completable yet, so this one is a human promise. Write it anyway.' },
  { do: 'Pack it', why: 'Path A packing is a CLI job today: folio pack <dir> <out.folio>.' }
];

function nextSteps(args) {
  args = args || {};
  const steps = [];
  const done = [];
  const push = (doThis, why, detail) => steps.push(detail ? { do: doThis, why, detail } : { do: doThis, why });

  if (args.goal === 'port') {
    return json({ path: 'port',
      note: 'Porting is a binding problem rather than a design one: the game already ' +
            'has its map, its puzzles and its prose. You are supplying the parts that ' +
            'let the engine draw it.',
      steps: PORT_START });
  }

  if (!args.world || !Object.keys(args.world).length) {
    return json({ path: 'create', stage: 'nothing yet',
      note: 'Nothing to read yet, so this is the whole route.',
      steps: CREATE_START });
  }

  // --- shape ---------------------------------------------------------------
  const shape = validateWorld(args.world);
  if (!shape.ok) {
    return json({ path: 'create', stage: 'the world does not parse as a world',
      problems: shape.errors.slice(0, 10),
      steps: [{ do: 'Fix the schema errors above', why: 'Nothing further can be checked until the shape is right. Each one names its exact path.' },
              { do: 'folio_schema', why: 'Constrain generation against it and these stop happening.' }] });
  }
  done.push('the world matches the schema');

  const rooms = args.world.rooms || [];
  const items = args.world.items || [];
  const rules = args.world.rules || [];

  // --- structure -----------------------------------------------------------
  const g = require('../validator/graph.js').analyse(args.world);
  const gErrors = g.findings.filter(f => f.level === 'error');
  if (gErrors.length) {
    return json({ path: 'create', stage: 'the structure has holes',
      have: { rooms: rooms.length, items: items.length, rules: rules.length },
      problems: gErrors.map(f => ({ code: f.code, message: f.msg, hint: f.hint })),
      steps: [{ do: 'Fix the reachability errors above', why: 'Do this before writing any prose. Rearranging a graph is cheap; rewriting forty descriptions after rearranging it is not.' }] });
  }
  done.push('every room is reachable and the ending can be reached');

  // --- the walkthrough -----------------------------------------------------
  if (!args.walkthrough || !args.walkthrough.trim()) {
    push('Write walkthrough.folioscript', 'One command per line, from a cold start, ending in the win. It is the proof of completability and nothing can certify without it. You already know the path: the graph just proved it exists.');
  } else {
    const r = require('../validator/replay.js').replay(args.world, args.walkthrough);
    if (!r.ok) {
      return json({ path: 'create', stage: 'the walkthrough does not finish the game',
        problems: r.findings.map(f => ({ code: f.code, message: f.msg, hint: f.hint })),
        steps: [{ do: 'Fix the walkthrough, or the world it walks through', why: 'A path exists, since the graph found one. This particular sequence is not it.' }] });
    }
    done.push('the walkthrough reaches the ending in ' + r.stats.moves + ' moves');
  }

  // --- prose ---------------------------------------------------------------
  const bareRooms = rooms.filter(r => !r.prose || !r.prose.trim()).map(r => r.id);
  if (bareRooms.length) {
    push('Write room descriptions', 'Structure is sound, so prose is now safe to write: it will not be thrown away.',
      bareRooms.length + ' room' + (bareRooms.length > 1 ? 's' : '') + ' with no prose: ' + bareRooms.slice(0, 8).join(', '));
  }
  const unnamed = items.filter(i => !i.name).map(i => i.id);
  if (unnamed.length) {
    push('Name the items', 'The id is what the rules match on; the name is what a player is shown.',
      unnamed.slice(0, 8).join(', '));
  }

  // --- the four dead buttons ----------------------------------------------
  const usedVerbs = new Set(rules.map(r => ((r.on || {}).verb || '').toUpperCase()));
  const dead = ['CLOSE', 'USE', 'HIT', 'SPEAK'].filter(v => !usedVerbs.has(v));
  if (dead.length) {
    push('Give the idle verbs something to do', 'The board shows eight verbs and only four of them have built-in behaviour. Without rules these answer meta.defaults.unknown, which reads to a player as a broken button.',
      'no rules for ' + dead.join(', '));
  }
  if (!((args.world.meta || {}).defaults || {}).unknown) {
    push('Set meta.defaults.unknown', 'It is the line a player hears every time they try something you did not anticipate, which makes it the single most-heard sentence in most games.');
  }

  // --- art -----------------------------------------------------------------
  const sceneSrc = Object.values(args.presentation || {}).join('\n');
  const drawn = new Set([...sceneSrc.matchAll(/scenes\s*\[\s*['"]([^'"]+)['"]\s*\]/g)].map(m => m[1]));
  const undrawn = rooms.filter(r => !drawn.has(r.id)).map(r => r.id);
  if (undrawn.length) {
    push('Scene art', 'Rooms with no scene render as a placeholder. The rest of the board is drawn for you; only the picture is yours.',
      undrawn.length + ' of ' + rooms.length + ' rooms undrawn');
  }

  // --- packaging -----------------------------------------------------------
  const need = ['id', 'title', 'author', 'license', 'contentRating']
    .filter(k => !(args.manifest || {})[k]);
  if (need.length) push('Fill in the manifest', 'Packaging metadata, needed once at the end.', 'missing ' + need.join(', '));
  if (!args.brief) push('Consider shipping brief.json', 'Without it the design audit grades you against generic defaults. With it, a deliberately short or linear game is judged against what you asked for.');

  // --- design opinions -----------------------------------------------------
  let design = [];
  if (args.walkthrough) {
    const d = require('../validator/design.js')
      .audit(args.world, args.brief ? { thresholds: brief.resolve(args.brief).thresholds } : {});
    design = d.findings.map(f => ({ code: f.code, message: f.msg, hint: f.hint }));
  }

  if (!steps.length) {
    push('folio_pack', 'Everything checks out. Assemble the file.');
  }

  return json({
    path: 'create',
    stage: steps.length && steps[0].do === 'folio_pack' ? 'ready to pack' : 'in progress',
    done,
    have: { rooms: rooms.length, items: items.length, rules: rules.length,
            actors: (args.world.actors || []).length, timers: (args.world.timers || []).length },
    steps,
    designNotes: design.length ? design : undefined,
    note: design.length
      ? 'The design notes are advice, not faults. A shallow game is still a game; it ' +
        'simply cannot claim to be a finished one.'
      : undefined
  });
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const json = (o, isError) => ({
  content: [{ type: 'text', text: JSON.stringify(o, null, 2) }],
  isError: !!isError
});

// --------------------------------------------------------------- the protocol
const PROTOCOL_FALLBACK = '2024-11-05';

function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    // Echo the client's protocol version when it names one. Clients are stricter
    // about this than the spec reads, and disagreeing over a version string is a
    // silly way for a working server to look broken.
    const asked = params && typeof params.protocolVersion === 'string'
      ? params.protocolVersion : PROTOCOL_FALLBACK;
    return {
      protocolVersion: asked,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'folio', version: '0.1.0' }
    };
  }

  if (method === 'ping') return {};

  if (method === 'tools/list') {
    return { tools: TOOLS.map(t => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema
    })) };
  }

  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === (params && params.name));
    if (!tool) throw rpcError(-32602, 'unknown tool: ' + (params && params.name));
    try {
      const a = (params && params.arguments) || {};
      return trace.around('tool', tool.name, a, () => tool.handler(a));
    } catch (e) {
      // A tool that throws is reported as a failed call rather than as a broken
      // server, so the agent can read the message and try something else.
      return json({ error: e.message }, true);
    }
  }

  throw rpcError(-32601, 'unknown method: ' + method);
}

function rpcError(code, message) {
  const e = new Error(message);
  e.rpc = { code, message };
  return e;
}

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function main() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const raw = line.trim();
    if (!raw) return;
    let msg;
    try { msg = JSON.parse(raw); }
    catch (e) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    // Notifications carry no id and must not be answered at all.
    if (msg.id === undefined || msg.id === null) return;
    try {
      send({ jsonrpc: '2.0', id: msg.id, result: handle(msg) });
    } catch (e) {
      send({ jsonrpc: '2.0', id: msg.id,
        error: e.rpc || { code: -32603, message: e.message } });
    }
  });
  rl.on('close', () => process.exit(0));
  log('folio mcp: ready, ' + TOOLS.length + ' tools');
}

if (require.main === module) main();
module.exports = { TOOLS, handle };
