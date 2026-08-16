//  Drives the MCP server the way a client does: a real child process, real
//  newline-delimited JSON-RPC over stdio.
//
//  Calling handle() directly would test the tools and miss everything that
//  actually breaks an MCP server, which is the transport. The failure modes worth
//  catching are all in that layer: answering a notification, writing anything to
//  stdout that is not a protocol message, or disagreeing with the client about a
//  version string.
//
//  The last test plays a game to completion without ever reading its walkthrough,
//  which is the shape the blind solver will take.

'use strict';

const path = require('path');
const { spawn } = require('child_process');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};

const SERVER = path.join(__dirname, '..', 'server.js');
const WORLD = require(path.join(__dirname, '..', '..', '..',
  'conformance', 'cellar-door', 'logic', 'world.json'));

function client() {
  const proc = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  const stray = [];
  let n = 0;

  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); }
      catch (e) { stray.push(line); continue; }   // anything unparseable is contamination
      const w = waiting.get(msg.id);
      if (w) { waiting.delete(msg.id); w(msg); }
      else stray.push(line);
    }
  });

  return {
    proc, stray,
    rpc(method, params) {
      const id = ++n;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out: ' + method)), 8000);
        waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    notify(method, params) {
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    },
    close() { proc.stdin.end(); proc.kill(); }
  };
}

const body = (res) => JSON.parse(res.result.content[0].text);

(async () => {
  console.log('\n=== \x1b[1mMCP server over stdio\x1b[0m ===\n');
  const c = client();

  const init = await c.rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {}, clientInfo: { name: 'test', version: '1' }
  });
  ok('initialize answers', !!init.result, JSON.stringify(init.error || '').slice(0, 60));
  ok('it agrees with the client about the protocol version',
    init.result.protocolVersion === '2025-06-18', init.result.protocolVersion);
  ok('it declares the tools capability', !!(init.result.capabilities || {}).tools);

  // A notification has no id. Answering one is a protocol violation that some
  // clients treat as fatal.
  c.notify('notifications/initialized', {});
  await new Promise(r => setTimeout(r, 120));
  ok('a notification draws no reply', c.stray.length === 0, c.stray.join(' | ').slice(0, 80));

  const list = await c.rpc('tools/list', {});
  const names = list.result.tools.map(t => t.name);
  ok('tools/list returns every tool', names.length === 8, names.join(', '));
  ok('every tool declares an input schema',
    list.result.tools.every(t => t.inputSchema && t.inputSchema.type === 'object'));

  const spec = await c.rpc('tools/call', { name: 'folio_spec', arguments: {} });
  ok('the spec comes back whole',
    /Folio Game Engine/.test(spec.result.content[0].text) &&
    spec.result.content[0].text.length > 5000,
    spec.result.content[0].text.length + ' bytes');

  // ---- validation, the loop this exists for -----------------------------
  const good = await c.rpc('tools/call', {
    name: 'folio_validate',
    arguments: {
      world: WORLD,
      walkthrough: 'north\ntake key\ntake lantern\nsouth\nunlock cellar-door\n' +
        'light lantern\ndown\ntake locket'
    }
  });
  const g = body(good);
  ok('a working world validates', g.ok === true, 'tier=' + g.tier);
  ok('it reports the tiers it actually ran', g.ranTiers.length === 5, g.ranTiers.join('+'));
  ok('it reports that the walkthrough won', g.stats && g.stats.won === true,
    g.stats ? g.stats.moves + ' moves' : 'no stats');

  const broken = JSON.parse(JSON.stringify(WORLD));
  broken.rooms[0].exits[0].to = 'NOWHERE-AT-ALL';
  const bad = body(await c.rpc('tools/call', {
    name: 'folio_validate', arguments: { world: broken }
  }));
  ok('a broken exit is caught and named, with no walkthrough supplied',
    !bad.ok && bad.findings.some(f => f.code === 'E301'),
    (bad.findings.find(f => f.level === 'error') || {}).message);
  ok('drafting without a walkthrough still runs the dead-end analysis',
    bad.ranTiers.includes('T2') && !bad.findings.some(f => f.code === 'E107'),
    'ran ' + bad.ranTiers.join('+'));

  const typo = JSON.parse(JSON.stringify(WORLD));
  typo.rooms[0].descriptoin = 'oops';
  const t = body(await c.rpc('tools/call', {
    name: 'folio_validate', arguments: { world: typo }
  }));
  ok('a typo is reported with its exact path',
    !t.ok && t.findings.some(f => /descriptoin/.test(f.message)),
    (t.findings.find(f => f.level === 'error') || {}).message);

  // ---- playing blind ------------------------------------------------------
  // The walkthrough is never read here. This is the shape a blind solver takes.
  const start = body(await c.rpc('tools/call', {
    name: 'folio_play_start', arguments: { world: WORLD }
  }));
  ok('a game boots and returns its opening text',
    !!start.session && /Cellar Door/.test(start.prose), start.state.room);
  ok('the opening state names the exits it offers',
    Array.isArray(start.state.exits) && start.state.exits.includes('NORTH'),
    start.state.exits.join(','));

  const say = async (cmd) => body(await c.rpc('tools/call', {
    name: 'folio_play_send', arguments: { session: start.session, command: cmd }
  }));

  await say('north');
  const afterTake = await say('take key');
  ok('a command changes the world', /Taken|key/i.test(afterTake.prose),
    afterTake.prose.slice(0, 40));

  await say('take lantern');
  await say('south');
  await say('unlock cellar-door');
  await say('light lantern');
  await say('down');
  const won = await say('take locket');
  ok('a game can be played to a win through the protocol',
    !!(won.state.ended && won.state.ended.win),
    'score ' + won.state.score + ' in ' + won.state.moves + ' moves');

  // A blocked exit has to be visible but distinguishable, or a solver cannot tell
  // "there is nothing there" from "there is something you cannot do yet".
  const s2 = body(await c.rpc('tools/call', {
    name: 'folio_play_start', arguments: { world: WORLD }
  }));
  ok('a locked way shows as blocked rather than absent',
    s2.state.blockedExits.includes('DOWN'),
    'open=' + s2.state.exits.join(',') + ' blocked=' + s2.state.blockedExits.join(','));
  await c.rpc('tools/call', { name: 'folio_play_end', arguments: { session: s2.session } });

  // ---- the rest -----------------------------------------------------------
  const br = body(await c.rpc('tools/call', {
    name: 'folio_brief', arguments: { length: 'short', difficulty: 'gentle' }
  }));
  ok('the dials resolve to concrete targets', br.targets.rooms === 12,
    br.targets.rooms + ' rooms, depth ' + br.targets.chainDepth);

  const sch = await c.rpc('tools/call', { name: 'folio_schema', arguments: {} });
  ok('the schema is served', JSON.parse(sch.result.content[0].text).$id.includes('world-0.1.0'));

  // ---- failure handling ---------------------------------------------------
  const nope = await c.rpc('tools/call', { name: 'folio_nonexistent', arguments: {} });
  ok('an unknown tool is a JSON-RPC error, not a crash', !!nope.error, nope.error && nope.error.message);

  const noSession = body(await c.rpc('tools/call', {
    name: 'folio_play_send', arguments: { session: 'gone', command: 'look' }
  }));
  ok('a dead session is reported as a failed call', /no such session/.test(noSession.error));

  const junk = body(await c.rpc('tools/call', {
    name: 'folio_play_start', arguments: { world: { meta: {} } }
  }));
  ok('an unusable world is refused with reasons', /schema/.test(junk.error || ''),
    (junk.problems && junk.problems[0] ? junk.problems[0].msg : ''));

  ok('nothing but protocol messages was ever written to stdout',
    c.stray.length === 0, c.stray.join(' | ').slice(0, 80));

  c.close();
  console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
    '\x1b[32m' + pass + ' passed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\x1b[31m' + e.stack + '\x1b[0m'); process.exit(1); });
