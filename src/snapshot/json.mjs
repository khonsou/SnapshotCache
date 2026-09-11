import canonicalize from 'canonicalize';
import { parseTree } from 'jsonc-parser';

export const utf8 = value => new TextEncoder().encode(value);
export const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export function assertJSON(value, depth = 0) {
  if (depth > 64) throw new Error('JSON nesting limit exceeded');
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new Error('Invalid Unicode');
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite JSON number');
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!key.isWellFormed()) throw new Error('Invalid Unicode key');
      assertJSON(child, depth + 1);
    }
  } else if (value !== null && typeof value !== 'boolean') throw new Error('Not JSON');
}

export function parseJSON(bytes) {
  const text = typeof bytes === 'string' ? bytes : decode(bytes);
  const errors = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) throw new Error('Invalid JSON');
  function check(node, depth = 0) {
    if (depth > 64) throw new Error('JSON nesting limit exceeded');
    if (node.type === 'object') {
      const keys = node.children.map(p => p.children[0].value);
      if (new Set(keys).size !== keys.length) throw new Error('Duplicate JSON key');
    }
    for (const child of node.children || []) check(child, depth + 1);
  }
  check(tree);
  const value = JSON.parse(text);
  assertJSON(value);
  return value;
}

export function jcs(value) { assertJSON(value); return utf8(canonicalize(value)); }
export async function hash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
export const hashJSON = value => hash(jcs(value));
