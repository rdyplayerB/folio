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
const { validateWorld, WORLD_SCHEMA } = require('../format/schema.js');
const brief = require('../format/brief.js');

const ROOT = path.join(__dirname, '..', '..');
const SPEC = path.join(ROOT, 'site', 'llms.txt');

// stdout belongs to the protocol. Anything else said out loud corrupts the
// stream, so diagnostics go to stderr and nowhere else.
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

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
      return tool.handler((params && params.arguments) || {});
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
