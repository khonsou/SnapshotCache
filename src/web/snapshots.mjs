import catalog from '../../examples/snapshots/catalog.json';
import { mountSnapshot } from '../snapshot/viewer.mjs';

export const snapshotCatalog = catalog;
const parents = new Map(catalog.entries.map(e => [e.ref.snapshotId, { scope: e.scope }]));
class SnapshotView extends HTMLElement {
  connectedCallback() {
    const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{display:block;min-height:240px}.snapshot-frame{display:block;border:0;width:100%;background:white}.snapshot-load-state{padding:24px;margin:0;font:14px/1.8 sans-serif;color:#737985}</style><div></div>';
    const host = root.querySelector('div');
    const entry = catalog.entries.find(e => e.ref.snapshotId === this.getAttribute('snapshot-id'));
    if (!entry || entry.ref.manifestHash !== this.getAttribute('manifest-hash') || entry.scope.projectId !== this.getAttribute('project-id')) {
      host.textContent = '快照引用无效或不属于当前项目。'; this.dataset.loadState = 'unavailable'; return;
    }
    this.dispose?.();
    mountSnapshot(host, entry.ref, entry.scope, { parents, title: entry.title + ' · ' + entry.label, onDispose: dispose => { this.dispose = dispose; } });
  }
  disconnectedCallback() { this.dispose?.(); }
}
customElements.define('snapshot-viewer', SnapshotView);
