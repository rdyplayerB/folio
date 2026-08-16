//  Minimal ZIP reader/writer for .folio containers.
//
//  Dependency-free on purpose. A .folio has to open in a browser with no build
//  step and no library download — the whole portability promise collapses if
//  playing a game requires npm. Node gets zlib; the browser reader uses
//  DecompressionStream, which is available everywhere the engine already runs.
//
//  Deliberately not a general ZIP implementation: no encryption, no zip64, no
//  multi-disk. A .folio is a small archive we produce ourselves, and refusing
//  exotic features is how the reader stays auditable.

'use strict';

const zlib = require('zlib');

const LOCAL_SIG = 0x04034b50;
const CDIR_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Build a .folio buffer from { path: Buffer|string } entries. */
function write(files) {
  const names = Object.keys(files).sort();   // sorted → byte-identical rebuilds
  const locals = [];
  const central = [];
  let offset = 0;

  for (const name of names) {
    const raw = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name], 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);

    // Store PNGs and other pre-compressed payloads; deflate the rest. Blorb, the
    // interactive-fiction container this format most resembles, refuses container
    // compression entirely on the grounds that real asset formats already compress.
    const store = /\.(png|jpg|jpeg|ogg|mp3|z3|z5|z8|zip)$/i.test(name);
    const body = store ? raw : zlib.deflateRawSync(raw, { level: 9 });
    const method = store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);            // mod time — fixed, for reproducibility
    local.writeUInt16LE(0x21, 12);         // mod date — fixed (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CDIR_SIG, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** Read a .folio buffer into { path: Buffer }. */
function read(buf) {
  // Find the end-of-central-directory record by scanning back from the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a .folio: no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CDIR_SIG) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name/extra lengths and they can differ from the
    // central directory's, so the data offset must be computed from the local one.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const body = buf.subarray(start, start + compSize);

    out[name] = method === 0 ? Buffer.from(body) : zlib.inflateRawSync(body);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

module.exports = { read, write };
