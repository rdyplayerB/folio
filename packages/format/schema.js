//  A small JSON Schema checker, and the world schema it exists to run.
//
//  Why not a library: this package has no dependencies and that is a feature, not
//  an aesthetic. A .folio has to be readable in a browser with no build step, and
//  every dependency is a thing that can rot out from under an archive format whose
//  whole promise is that games keep working. So this implements the subset of
//  JSON Schema that world.schema.json actually uses and nothing else.
//
//  Supported: type, required, properties, additionalProperties, items, enum,
//  const, oneOf, $ref into $defs, minimum, minItems, minLength.
//
//  The one piece of cleverness is oneOf. The condition and effect vocabularies are
//  discriminated unions on `type`, and a naive oneOf failure reports "matched none
//  of 14 branches", which tells an author nothing. When the branches discriminate
//  on a const, this picks the branch the instance was clearly aiming at and reports
//  that branch's real error instead.

'use strict';

const fs = require('fs');
const path = require('path');

const WORLD_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'world.schema.json'), 'utf8')
);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(want, got, value) {
  if (want === 'number') return got === 'number' || got === 'integer';
  if (want === 'integer') return got === 'integer';
  return want === got;
}

/**
 * Check a value against a schema.
 * @returns {Array<{path:string, msg:string}>} empty when valid
 */
function check(value, schema, root, where) {
  root = root || schema;
  where = where || '';
  const errs = [];
  const at = (p, msg) => errs.push({ path: p || '(root)', msg });

  if (schema.$ref) {
    const target = resolve(schema.$ref, root);
    if (!target) { at(where, 'unresolvable $ref ' + schema.$ref); return errs; }
    // A $ref sitting beside other keywords: apply both, which is what the 2020-12
    // draft says and what this schema relies on for descriptions.
    errs.push(...check(value, target, root, where));
    const rest = Object.assign({}, schema);
    delete rest.$ref;
    if (Object.keys(rest).length) errs.push(...check(value, rest, root, where));
    return errs;
  }

  const got = typeOf(value);

  if (schema.const !== undefined && value !== schema.const) {
    at(where, 'must be ' + JSON.stringify(schema.const));
    return errs;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    at(where, 'must be one of ' + schema.enum.join(', ') + ', got ' + JSON.stringify(value));
    return errs;
  }
  if (schema.type && !typeMatches(schema.type, got, value)) {
    at(where, 'must be ' + schema.type + ', got ' + got);
    return errs;                     // wrong type: further checks would be noise
  }

  if (got === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      at(where, 'must not be empty');
    }
  }

  if (got === 'integer' || got === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      at(where, 'must be at least ' + schema.minimum);
    }
  }

  if (got === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      at(where, 'must have at least ' + schema.minItems + ' item' + (schema.minItems > 1 ? 's' : ''));
    }
    if (schema.items) {
      value.forEach((v, i) => errs.push(...check(v, schema.items, root, where + '[' + i + ']')));
    }
  }

  if (got === 'object') {
    for (const key of (schema.required || [])) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        at(where, 'is missing "' + key + '"');
      }
    }
    const props = schema.properties || {};
    for (const key of Object.keys(value)) {
      const sub = where ? where + '.' + key : key;
      if (props[key]) {
        errs.push(...check(value[key], props[key], root, sub));
      } else if (schema.additionalProperties === false) {
        at(sub, 'is not a known field');
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errs.push(...check(value[key], schema.additionalProperties, root, sub));
      }
    }
  }

  if (schema.oneOf) {
    const branch = discriminate(value, schema.oneOf);
    if (branch) {
      // The author clearly meant this one, so report why it did not fit rather
      // than that fourteen alternatives all failed.
      errs.push(...check(value, branch, root, where));
    } else {
      const matched = schema.oneOf.filter(s => check(value, s, root, where).length === 0);
      if (matched.length !== 1) {
        const kinds = schema.oneOf
          .map(s => s.properties && s.properties.type && s.properties.type.const)
          .filter(Boolean);
        at(where, kinds.length
          ? 'has an unknown "type". Known: ' + kinds.join(', ')
          : 'does not match any allowed shape');
      }
    }
  }

  return errs;
}

// If every branch pins a literal `type`, and the instance names one of them, that
// is the branch the author meant.
function discriminate(value, branches) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.type !== 'string') return null;
  const all = branches.every(b => b.properties && b.properties.type && b.properties.type.const !== undefined);
  if (!all) return null;
  return branches.find(b => b.properties.type.const === value.type) || null;
}

function resolve(ref, root) {
  if (ref.charAt(0) !== '#') return null;
  let node = root;
  for (const seg of ref.split('/').slice(1)) {
    if (!node) return null;
    node = node[decodeURIComponent(seg.replace(/~1/g, '/').replace(/~0/g, '~'))];
  }
  return node || null;
}

/**
 * Validate a world definition against the published schema.
 * @param {object|string|Uint8Array} world
 * @returns {{ok:boolean, errors:Array<{path:string,msg:string}>}}
 */
function validateWorld(world) {
  let def = world;
  if (typeof def === 'string') def = JSON.parse(def);
  else if (def && typeof def.byteLength === 'number') {
    def = JSON.parse(Buffer.from(def).toString('utf8'));
  }
  const errors = check(def, WORLD_SCHEMA, WORLD_SCHEMA, '');
  return { ok: errors.length === 0, errors };
}

/** The vocabularies, pulled out of the schema so callers never hardcode them. */
function vocabulary() {
  const names = (def) => def.oneOf
    .map(b => b.properties && b.properties.type && b.properties.type.const)
    .filter(Boolean);
  return {
    conditions: names(WORLD_SCHEMA.$defs.condition),
    effects: names(WORLD_SCHEMA.$defs.effect),
    directions: WORLD_SCHEMA.$defs.direction.enum,
    attributes: Object.keys(WORLD_SCHEMA.$defs.attributes.properties),
    defaults: Object.keys(WORLD_SCHEMA.$defs.defaults.properties)
  };
}

module.exports = { validateWorld, vocabulary, check, WORLD_SCHEMA };
