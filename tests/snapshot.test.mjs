import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, cp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPackage, commitFixture } from '../src/snapshot/files.mjs';
import { validatePackage, contentHashes, safePath, LIMITS } from '../src/snapshot/validate.mjs';
import { parseJSON, utf8, hashJSON, hash, decode, jcs } from '../src/snapshot/json.mjs';
import { loadSnapshot, makeViewerDocument } from '../src/snapshot/viewer.mjs';
import { inspectHTML } from '../src/snapshot/html.mjs';
const catalog = JSON.parse(await readFile('examples/snapshots/catalog.json'));
const parents = new Map(catalog.entries.map(e => [e.ref.snapshotId, { scope: e.scope }]));
const root = new URL('../examples/snapshots/', import.meta.url).pathname;
async function fixture(key = 'launch') {
  const entry = catalog.entries.find(e => e.key === key);
  return { ...await readPackage(join(root, entry.ref.snapshotId)), entry };
}
const check = pkg => validatePackage(pkg.manifest, pkg.files, pkg.entry.ref, pkg.entry.scope, parents);
async function resign(pkg, mutate) {
  const m = parseJSON(pkg.manifest); await mutate(m, pkg.files);
  const query = parseJSON(pkg.files.get(m.resources.find(r => r.id === m.query.resourceId).path));
  const hashes = await contentHashes(m, query);
  m.query.fingerprint = hashes.query; m.data.contentHash = hashes.data; m.presentation.contentHash = hashes.presentation;
  const { integrity, ...definition } = m; m.integrity.manifestHash = await hashJSON(definition);
  pkg.manifest = utf8(JSON.stringify(m)); pkg.entry = { ...pkg.entry, ref: { ...pkg.entry.ref, manifestHash: m.integrity.manifestHash } };
  return pkg;
}
test('all stored fixtures pass the shared validator including empty and binary datasets', async () => {
  assert.equal(catalog.entries.length, 7);
  for (const entry of catalog.entries) await check(await fixture(entry.key));
  const mixed = await check(await fixture('mixed'));
  assert.deepEqual([...mixed.files.get('data/raw.bin')], [0, 1, 127, 128, 254, 255]);
});
test('JCS follows RFC numeric, Unicode key sorting and input rejection vectors', async () => {
  assert.equal(decode(jcs({ numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27] })), '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}');
  const sorted = JSON.parse(decode(jcs({ '\ufb33': 7, '😀': 6, '€': 5, 'ö': 4, '\u0080': 3, '1': 2, '\r': 1 })));
  assert.deepEqual(Object.values(sorted).filter(n => n !== 2), [1, 3, 4, 5, 6, 7]);
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":1e999}', '{"x":"\\ud800"}', '{/*bad*/"x":1}', '{"x":1,}']) assert.throws(() => parseJSON(input));
  assert.throws(() => jcs({ x: NaN }));
  assert.equal(await hash(utf8('abc')), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('trusted hash and project scope are mandatory, even for a self-consistent downloaded package', async () => {
  const pkg = await fixture();
  await assert.rejects(validatePackage(pkg.manifest, pkg.files, { ...pkg.entry.ref, manifestHash: 'sha256:' + '0'.repeat(64) }, pkg.entry.scope), /Trusted manifest/);
  await assert.rejects(validatePackage(pkg.manifest, pkg.files, pkg.entry.ref, { ...pkg.entry.scope, projectId: 'other' }), /scope/);
  await assert.rejects(validatePackage(pkg.manifest, pkg.files, undefined, pkg.entry.scope), /identity/);
});
test('tampered bytes, missing and extra files fail before execution', async () => {
  const pkg = await fixture(); pkg.files.get('data/board.json')[0] ^= 1;
  await assert.rejects(check(pkg), /hash/);
  for (const change of [p => p.files.delete('data/board.json'), p => p.files.set('hidden.js', utf8('bad'))]) {
    const p = await fixture(); change(p); await assert.rejects(check(p), /Unlisted or missing/);
  }
});
test('unsafe paths and case collisions are rejected', async () => {
  for (const path of ['../file', '/file', 'a//b', 'a/../b', 'a\\b', 'a/%2e%2e/b', 'a/./b', '']) assert.equal(safePath(path), false);
  for (const path of ['../board.json', 'DATA/BRIEF.MD']) {
    const p = await resign(await fixture(), m => { m.resources.find(r => r.id === 'data.board').path = path; });
    await assert.rejects(check(p), /path/);
  }
});
test('schema rejects unsupported versions, MIME mismatch, invalid dates and oversized metadata', async () => {
  for (const mutate of [m => m.schemaVersion = '2.0.0', m => m.presentation.runtime = 'native', m => m.createdAt = 'yesterday', m => m.resources[0].byteLength = 9007199254740992, m => m.ttl = 30]) {
    const p = await resign(await fixture(), mutate); await assert.rejects(check(p), /schema/);
  }
  const p = await resign(await fixture(), m => m.resources.find(r => r.id === 'view.index').mediaType = 'text/plain');
  await assert.rejects(check(p), /HTML entry/);
});
test('resource bindings, entry inclusion and complete reachability are enforced', async () => {
  for (const mutate of [m => m.presentation.bindings.board = 'missing', m => m.data.datasets[0].entryResourceId = 'view.index', m => m.presentation.resourceIds = ['view.state']]) {
    const p = await resign(await fixture(), mutate); await assert.rejects(check(p), /binding|entry/i);
  }
  const p = await resign(await fixture(), m => { m.resources[0].byteLength = LIMITS.fileBytes + 1; });
  await assert.rejects(check(p), /limit/);
});
test('data and presentation hashes separate initial state changes; parent scope is checked', async () => {
  const original = await check(await fixture()); const updated = await check(await fixture('filtered'));
  assert.equal(original.manifest.data.contentHash, updated.manifest.data.contentHash);
  assert.equal(original.manifest.query.fingerprint, updated.manifest.query.fingerprint);
  assert.notEqual(original.manifest.presentation.contentHash, updated.manifest.presentation.contentHash);
  const p = await fixture('filtered'); await assert.rejects(validatePackage(p.manifest, p.files, p.entry.ref, p.entry.scope, new Map()), /Parent/);
});
test('fixed source revision mismatch is rejected even after resigning', async () => {
  const p = await resign(await fixture(), async (m, files) => {
    const q = parseJSON(files.get('query.json')); q.observations[0].revision = 'wrong';
    const body = utf8(JSON.stringify(q)); files.set('query.json', body);
    const r = m.resources.find(r => r.id === m.query.resourceId); m.totalResourceBytes += body.length - r.byteLength; r.byteLength = body.length; r.sha256 = await hash(body);
  });
  await assert.rejects(check(p), /Source revision/);
});
test('P1 HTML profile rejects external dependencies and active markup', () => {
  for (const body of ['<script src="https://example.test/x.js"></script>', '<img src="x.png">', '<meta http-equiv="refresh" content="0;url=https://example.test">', '<div onclick="alert(1)"></div>', '<style>@import "https://example.test";</style>', '<iframe></iframe>', '<script type="module">import "x"</script>']) {
    assert.throws(() => inspectHTML('<!doctype html><html><head></head><body>' + body + '</body></html>'));
  }
});
test('fixture commits are idempotent but never overwrite an existing snapshot ID', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'xuyan-fixture-'));
  try {
    const p = await fixture(); const target = join(temp, p.entry.ref.snapshotId);
    await commitFixture(target, p.manifest, p.files, p.entry.ref, p.entry.scope);
    await commitFixture(target, p.manifest, p.files, p.entry.ref, p.entry.scope);
    const modified = await resign(await fixture(), m => m.createdAt = '2026-09-12T00:00:00Z');
    await assert.rejects(commitFixture(target, modified.manifest, modified.files, modified.entry.ref, modified.entry.scope), /Immutable/);
  } finally { await rm(temp, { recursive: true }); }
});
test('filesystem reader rejects symlinks and hidden files are caught as unlisted', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'xuyan-read-'));
  try {
    await cp(join(root, 'dummy-launch-v1'), temp, { recursive: true });
    await symlink(join(temp, 'query.json'), join(temp, 'alias.json'));
    await assert.rejects(readPackage(temp), /Symlink/);
    await rm(join(temp, 'alias.json')); await writeFile(join(temp, 'hidden.txt'), 'extra');
    const p = await fixture(); const read = await readPackage(temp);
    await assert.rejects(check({ ...read, entry: p.entry }), /Unlisted/);
  } finally { await rm(temp, { recursive: true }); }
});
test('loader verifies before fetching entry and propagates network/missing-file failures', async () => {
  const p = await fixture(); let calls = 0;
  const fetcher = async url => { calls++; const name = url.split('/').slice(3).join('/'); return new Response(name === 'manifest.json' ? p.manifest : p.files.get(name)); };
  await loadSnapshot(p.entry.ref, p.entry.scope, { fetcher }); assert.equal(calls, 6);
  calls = 0;
  await assert.rejects(loadSnapshot({ ...p.entry.ref, manifestHash: 'sha256:' + '0'.repeat(64) }, p.entry.scope, { fetcher })); assert.equal(calls, 1);
  await assert.rejects(loadSnapshot(p.entry.ref, p.entry.scope, { fetcher: async () => new Response('missing', { status: 404 }) }), /不可用/);
});
test('runtime has no ambient credentials, pins scripts and injects data safely', async () => {
  const doc = await makeViewerDocument(await check(await fixture('boundary')), 'test-channel');
  assert.match(doc, /connect-src 'none'/); assert.match(doc, /sha256-/); assert.match(doc, /Content-Security-Policy/);
  assert.ok(!doc.includes('<script>不会执行</script>'));
  assert.ok(!doc.includes('DEEPSEEK_API_KEY'));
});
