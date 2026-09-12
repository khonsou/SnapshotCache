import catalog from '../../examples/snapshots/catalog.json';
import { mountSnapshot } from '../snapshot/viewer.mjs';

export const snapshotCatalog = catalog;
const parents = new Map(catalog.entries.map(e => [e.ref.snapshotId, { scope: e.scope }]));
const inlinePackages = new Map();

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > 6000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid inline snapshot bytes');
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function registerInlineSnapshotPackage(entry) {
  const id = entry?.snapshotRef?.snapshotId;
  const pkg = entry?.snapshotPackage;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id || '') || !pkg || !Array.isArray(pkg.resources) || pkg.resources.length > 64) throw new Error('Invalid inline snapshot package');
  const resources = new Map();
  for (const resource of pkg.resources) {
    if (!resource || typeof resource.id !== 'string' || resources.has(resource.id)) throw new Error('Invalid inline snapshot package');
    resources.set(resource.id, decodeBase64(resource.bytes));
  }
  inlinePackages.set(id, { manifest: decodeBase64(pkg.manifest), resources });
}

function inlineFetcher(snapshotId) {
  return async url => {
    const pkg = inlinePackages.get(snapshotId);
    if (!pkg) return new Response(null, { status: 404 });
    const name = String(url).split('/').at(-1);
    const bytes = name === 'manifest' ? pkg.manifest : pkg.resources.get(decodeURIComponent(name));
    return bytes ? new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }) : new Response(null, { status: 404 });
  };
}
class SnapshotView extends HTMLElement {
  connectedCallback() {
    const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{display:block;min-height:240px}.snapshot-frame{display:block;border:0;width:100%;background:white}.snapshot-load-state{padding:24px;margin:0;font:14px/1.8 sans-serif;color:#737985}</style><div></div>';
    const host = root.querySelector('div');
    const entry = catalog.entries.find(e => e.ref.snapshotId === this.getAttribute('snapshot-id'));
    const dynamic = this.getAttribute('source') === 'dynamic';
    const projectId = this.getAttribute('project-id');
    const snapshotId = this.getAttribute('snapshot-id');
    const manifestHash = this.getAttribute('manifest-hash');
    const tenantId = this.getAttribute('tenant-id');
    if ((!dynamic && (!entry || entry.ref.manifestHash !== manifestHash || entry.scope.projectId !== projectId)) || (dynamic && (!tenantId || !projectId || !snapshotId || !manifestHash))) {
      host.textContent = '快照引用无效或不属于当前项目。'; this.dataset.loadState = 'unavailable'; return;
    }
    const ref = dynamic ? { snapshotId, manifestHash } : entry.ref;
    const scope = dynamic ? { tenantId, projectId } : entry.scope;
    const inline = dynamic && inlinePackages.has(snapshotId);
    const options = dynamic
      ? inline
        ? { base: `inline://${encodeURIComponent(snapshotId)}/`, resourceById: true, fetcher: inlineFetcher(snapshotId) }
        : { base: `/api/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/`, resourceById: true }
      : { parents };
    this.dispose?.();
    mountSnapshot(host, ref, scope, { ...options, title: dynamic ? this.getAttribute('snapshot-title') || '生成快照' : entry.title + ' · ' + entry.label, onDispose: dispose => { this.dispose = dispose; } });
  }
  disconnectedCallback() { this.dispose?.(); }
}
customElements.define('snapshot-viewer', SnapshotView);
