import { validateEnvelope, validatePackage, LIMITS } from './validate.mjs';
import { decode, parseJSON } from './json.mjs';
import { inspectHTML, prependRuntime } from './html.mjs';

async function readLimited(response, max) {
  if (!response.ok || !response.body) throw new Error('快照资源不可用');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error('快照资源超过大小限制');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function loadSnapshot(ref, scope, { fetcher = fetch, signal, parents } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(ref.snapshotId)) throw new Error('无效快照引用');
  const base = `/snapshots/${ref.snapshotId}/`;
  const options = { cache: 'no-store', credentials: 'same-origin', signal, redirect: 'error' };
  const manifestBytes = await readLimited(await fetcher(base + 'manifest.json', options), LIMITS.manifestBytes);
  const m = await validateEnvelope(manifestBytes, ref, scope);
  const files = new Map();
  // Sequential bounded reads avoid multiplying memory limits or leaving work after a failure.
  for (const resource of m.resources) files.set(resource.path, await readLimited(await fetcher(base + resource.path, options), resource.byteLength));
  return validatePackage(manifestBytes, files, ref, scope, parents);
}

const quoteScript = object => JSON.stringify(object).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
async function scriptHash(code) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  return `'sha256-${btoa(String.fromCharCode(...digest))}'`;
}

export async function makeViewerDocument(pkg, channel, nonce = '') {
  const { manifest: m, files } = pkg;
  const get = id => m.resources.find(r => r.id === id);
  const data = Object.create(null);
  for (const [binding, datasetId] of Object.entries(m.presentation.bindings)) {
    const dataset = m.data.datasets.find(d => d.id === datasetId);
    const resources = Object.create(null);
    for (const id of dataset.resourceIds) {
      const r = get(id), bytes = files.get(r.path);
      resources[id] = { mediaType: r.mediaType, bytes: Array.from(bytes) };
    }
    data[binding] = { entryResourceId: dataset.entryResourceId, resources };
  }
  const initialState = m.presentation.initialStateResourceId ? parseJSON(files.get(get(m.presentation.initialStateResourceId).path)) : null;
  const bootstrap = `(() => { 'use strict';
const bindings = ${quoteScript(data)};
const channel = ${quoteScript(channel)};
let failed = false;
const reportError = () => { failed = true; parent.postMessage({ type: 'snapshot:error', channel, snapshotId: Snapshot.id }, '*'); };
addEventListener('error', reportError);
addEventListener('unhandledrejection', reportError);
const get = (binding, id) => { const d = bindings[binding]; if (!d) throw Error('Unknown binding'); const r = d.resources[id || d.entryResourceId]; if (!r) throw Error('Unknown resource'); return r; };
Object.defineProperty(window, 'Snapshot', { value: Object.freeze({
  id: ${quoteScript(m.snapshotId)}, initialState: ${quoteScript(initialState)},
  readBytes: (binding, id) => Uint8Array.from(get(binding, id).bytes),
  readText: (binding, id) => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(get(binding, id).bytes)),
  readJSON: (binding, id) => JSON.parse(new TextDecoder().decode(Uint8Array.from(get(binding, id).bytes)))
}) });
addEventListener('DOMContentLoaded', () => {
  const notify = () => { if (!failed) parent.postMessage({ type: 'snapshot:ready', channel, snapshotId: Snapshot.id, height: document.body.scrollHeight + 12 }, '*'); };
  notify(); new ResizeObserver(notify).observe(document.body);
});
})();`;
  const inspected = inspectHTML(pkg.html);
  const hashes = await Promise.all([bootstrap, ...inspected.scripts].map(scriptHash));
  const csp = `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return prependRuntime(inspected, csp, bootstrap, nonce);
}

export async function mountSnapshot(host, ref, scope, options = {}) {
  const controller = new AbortController();
  let url, frame, timer, listener;
  let disposed = false;
  const status = document.createElement('p');
  status.className = 'snapshot-load-state'; status.setAttribute('role', 'status'); status.textContent = '正在校验快照…';
  host.dataset.loadState = 'loading';
  host.replaceChildren(status);
  const dispose = () => {
    disposed = true; controller.abort(); clearTimeout(timer);
    if (listener) window.removeEventListener('message', listener);
    if (url) URL.revokeObjectURL(url);
    frame?.remove();
  };
  const failRuntime = () => {
    if (disposed) return;
    dispose(); host.dataset.loadState = 'unavailable';
    status.textContent = '快照运行失败或发生了不允许的导航，请重新加载。';
    host.replaceChildren(status);
  };
  options.onDispose?.(dispose);
  try {
    const pkg = await loadSnapshot(ref, scope, { ...options, signal: controller.signal });
    const channel = crypto.randomUUID();
    const nonce = document.querySelector('meta[name="snapshot-script-nonce"]')?.content;
    if (!nonce) throw new Error('Snapshot host CSP nonce missing');
    const html = await makeViewerDocument(pkg, channel, nonce);
    if (disposed) return;
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.title = options.title || '快照内容'; frame.className = 'snapshot-frame';
    frame.style.height = '440px';
    let loads = 0;
    frame.addEventListener('load', () => { if (++loads > 1) failRuntime(); });
    listener = event => {
      const value = event.data;
      if (event.source !== frame.contentWindow || event.origin !== 'null' || !value || value.channel !== channel || value.snapshotId !== ref.snapshotId) return;
      if (value.type === 'snapshot:error') { failRuntime(); return; }
      if (value.type !== 'snapshot:ready') return;
      if (!Number.isFinite(value.height)) return;
      clearTimeout(timer); status.remove();
      frame.style.height = Math.min(1000, Math.max(200, value.height)) + 'px';
      host.dataset.loadState = 'verified';
    };
    window.addEventListener('message', listener);
    url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    frame.src = url; host.append(frame);
    timer = setTimeout(() => { if (!disposed && host.dataset.loadState !== 'verified') failRuntime(); }, 10000);
  } catch (error) {
    if (disposed) return;
    host.dataset.loadState = 'unavailable';
    status.textContent = '快照无法加载：文件不可用、内容校验失败或版本不兼容。';
    options.onError?.(error);
  }
  return dispose;
}
