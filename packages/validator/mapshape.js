//  One definition of what a loop is.
//
//  There were two, and they disagreed about the same file. The design audit
//  halved the count of directed exits, which is only correct if every passage is
//  reciprocal; the corpus profiler did not halve at all. An author building a
//  Verne adaptation was told the map was "a tree, 0 loops per room" while the
//  project's own profile command reported 4 loops on the same world, and spent
//  more time decoding that than on anything else in the build.
//
//  A one-way passage is still a connection. The fall into the blind gallery, the
//  wreck, the blast and the eruption are all real links between rooms, and each
//  was counted as half an edge and quietly penalised. The author ended up adding
//  six reciprocal connections purely to satisfy the formula, inventing fiction to
//  appease a bug.
//
//  So: a connection is an unordered pair of rooms with at least one passage
//  between them, in either direction, and loops are connections minus rooms plus
//  one. Both tools call this now, and a test asserts they agree.

'use strict';

/** Unordered key for a link between two rooms. */
const link = (a, b) => (a < b ? a + ' ' + b : b + ' ' + a);

/**
 * Distinct connections implied by a set of directed passages.
 * @param {Array<Array<string>>} passages  [from, to] pairs
 */
function connections(passages) {
  const out = new Set();
  for (const p of passages) {
    const from = p[0], to = p[1];
    if (!from || !to || from === to) continue;   // a self-loop is not a circuit
    out.add(link(from, to));
  }
  return out;
}

/** Cyclomatic complexity of the room graph. A corridor is 0; a circuit is 1. */
function loops(connectionCount, roomCount) {
  if (!roomCount) return 0;
  return Math.max(0, connectionCount - roomCount + 1);
}

/** Read the passages straight out of a declared world. */
function passagesOf(world) {
  const out = [];
  for (const room of (world.rooms || [])) {
    for (const ex of (room.exits || [])) out.push([room.id, ex.to]);
  }
  return out;
}

module.exports = { connections, loops, passagesOf, link };
