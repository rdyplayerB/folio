//  Browser-side .folio reader.
//
//  A .folio must open in a page with no build step and no library download — the
//  portability promise collapses the moment playing a game requires npm. So this
//  reads the container using only what a browser already has: DataView for the
//  headers and DecompressionStream for the payloads.
//
//  Deliberately read-only. Packing is an authoring operation and belongs in the
//  CLI; a player that could also write archives is a larger attack surface for no
//  benefit to the person playing.

(function (root) {
  'use strict';

  const CDIR_SIG = 0x02014b50;
  const EOCD_SIG = 0x06054b50;

  /**
   * @param {ArrayBuffer|Uint8Array} input
   * @returns {Promise<Object<string, Uint8Array>>}
   */
  async function readFolio(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Scan back for the end-of-central-directory record. The comment field can be
    // up to 64KB, so the scan is bounded rather than unbounded.
    let eocd = -1;
    const floor = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a .folio: no end-of-central-directory record');

    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const out = {};

    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== CDIR_SIG) throw new Error('corrupt central directory');
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOff = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

      // The local header repeats the name and extra lengths, and they may differ
      // from the central directory's, so the data offset must come from the local
      // header or entries silently decode as garbage.
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const body = bytes.subarray(start, start + compSize);

      out[name] = method === 0 ? body : await inflateRaw(body);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('this browser cannot decompress .folio entries (no DecompressionStream)');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const text = (u8) => new TextDecoder().decode(u8);
  const json = (u8) => JSON.parse(text(u8));

  root.FolioZip = { readFolio, text, json };
})(typeof window !== 'undefined' ? window : globalThis);
