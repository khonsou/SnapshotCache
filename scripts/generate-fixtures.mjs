import { readFile, writeFile } from 'node:fs/promises';
import { packSnapshot } from '../src/snapshot/pack.mjs';
import { commitFixture } from '../src/snapshot/files.mjs';
import { hashJSON } from '../src/snapshot/json.mjs';

const html = await readFile(new URL('../examples/source/timeline.html', import.meta.url), 'utf8');
const members = [{ id: 'lin', name: '林安（模拟）' }, { id: 'qiao', name: '乔一（模拟）' }, { id: 'lu', name: '陆遥（模拟）' }];
const definitions = [
  { key: 'launch', projectId: 'launch', title: '秋季新品发布', names: ['主视觉与物料定稿', '首轮内容上线', '产品详情页验收', '新品正式发布'], variant: 'normal' },
  { key: 'brand', projectId: 'brand', title: '品牌体验升级', names: ['品牌基础规范确认', '官网视觉适配', '移动端体验走查', '品牌规范交付'], variant: 'normal' },
  { key: 'research', projectId: 'research', title: '用户研究室', names: ['访谈提纲确认', '深度用户访谈', '整理研究发现', '研究结论分享'], variant: 'normal' },
  { key: 'empty', projectId: 'launch', title: '秋季新品发布 · 空数据样例', variant: 'empty' },
  { key: 'boundary', projectId: 'launch', title: '秋季新品发布 · 边界样例', variant: 'boundary' },
  { key: 'filtered', projectId: 'launch', title: '秋季新品发布', names: ['主视觉与物料定稿', '首轮内容上线', '产品详情页验收', '新品正式发布'], variant: 'filtered', parent: 'launch' },
];
const catalog = { schemaVersion: '1', entries: [], defaults: {}, variants: {} };
const parents = new Map();
for (const definition of definitions) {
  const scope = { tenantId: 'fixture-workspace', projectId: definition.projectId };
  const snapshotId = 'dummy-' + definition.key + '-v1';
  const items = (definition.names || []).map((title, index) => ({ id: 'task-' + (index + 1), title, date: ['2026-09-08', '2026-09-10', '2026-09-12', '2026-09-15'][index], ownerId: members[index % 3].id, status: ['已发布', '待发布', '待执行', '待执行'][index], dependsOn: index ? ['task-' + index] : [] }));
  if (definition.variant === 'boundary') items.push(
    { id: 'edge-1', title: '没有排期与负责人的事项', date: null, ownerId: null, status: '待执行', dependsOn: [] },
    { id: 'edge-2', title: '边界文本 <script>不会执行</script> & 中文、emoji 🌱：' + '很长的事项说明，'.repeat(12), date: '2026-12-31', ownerId: 'lin', status: '待发布', dependsOn: ['edge-1'] },
  );
  const board = { title: definition.title, description: 'Timeline 风格模拟看板 · 验证快照与表现层', observedAt: '2026-09-11 10:00（Asia/Shanghai）', simulated: true, members, items };
  const query = { identity: { intent: { name: 'fixture.project-overview', version: '1' }, parameters: { project: definition.projectId, variant: definition.variant === 'filtered' ? 'normal' : definition.variant }, contextHash: null, authorization: { scopeHash: await hashJSON(scope), policyVersion: 'fixture-1' }, locale: 'zh-CN', timezone: 'Asia/Shanghai', sourceSelections: [{ sourceId: 'local-dummy', revision: '1' }], presentationRequest: { view: 'project-overview' } }, observations: [{ sourceId: 'local-dummy', revision: '1', observedAt: '2026-09-11T02:00:00Z' }], originalText: '查看本项目当前安排（模拟输入）' };
  const initialState = { tab: 'timeline', status: definition.variant === 'filtered' ? '待执行' : '', owner: '', search: '' };
  const parentSnapshotId = definition.parent ? 'dummy-' + definition.parent + '-v1' : undefined;
  const pkg = await packSnapshot({ snapshotId, scope, parentSnapshotId, createdAt: '2026-09-11T02:00:00Z', query, extensions: { 'com.xuyan.fixture': { simulated: true } },
    datasets: [{ id: 'board', entryResourceId: 'data.board', resourceIds: ['data.board'] }, { id: 'brief', entryResourceId: 'data.brief', resourceIds: ['data.brief'] }],
    presentation: { runtime: 'web', runtimeVersion: '1', entryResourceId: 'view.index', resourceIds: ['view.index', 'view.state'], bindings: { board: 'board', brief: 'brief' }, initialStateResourceId: 'view.state' },
    resources: [
      { id: 'query.context', path: 'query.json', mediaType: 'application/json', body: JSON.stringify(query, null, 2) + '\n' },
      { id: 'data.board', path: 'data/board.json', mediaType: 'application/json', body: JSON.stringify(board, null, 2) + '\n' },
      { id: 'data.brief', path: 'data/brief.md', mediaType: 'text/markdown', body: '# 项目说明\n\n这是用于 P1 验收的模拟数据，不来自真实 Timeline 看板。\n\n时间安排、状态筛选和负责人筛选仅改变当前浏览状态。数据和页面资源随包冻结，历史引用保持不变。\n' },
      { id: 'view.index', path: 'presentation/index.html', mediaType: 'text/html', body: html },
      { id: 'view.state', path: 'presentation/state.json', mediaType: 'application/json', body: JSON.stringify(initialState) + '\n' },
    ] });
  const ref = { snapshotId, manifestHash: pkg.manifest.integrity.manifestHash };
  await commitFixture(new URL('../examples/snapshots/' + snapshotId, import.meta.url).pathname, pkg.bytes, pkg.files, ref, scope, parents);
  const entry = { key: definition.key, title: definition.title, label: { normal: '正常数据', empty: '空数据', boundary: '边界数据', filtered: '保存的筛选状态' }[definition.variant], scope, ref };
  catalog.entries.push(entry); parents.set(snapshotId, { scope });
  if (definition.key === definition.projectId) catalog.defaults[definition.projectId] = snapshotId;
  if (definition.projectId === 'launch') catalog.variants[definition.key] = snapshotId;
}
const scope = { tenantId: 'fixture-workspace', projectId: 'launch' };
const query = { identity: { intent: { name: 'fixture.mixed-report', version: '1' }, parameters: {}, contextHash: null, authorization: { scopeHash: await hashJSON(scope), policyVersion: 'fixture-1' }, locale: 'zh-CN', timezone: 'Asia/Shanghai', sourceSelections: [], presentationRequest: {} }, observations: [] };
const mixed = await packSnapshot({ snapshotId: 'dummy-mixed-v1', scope, createdAt: '2026-09-11T02:00:00Z', query, extensions: { 'com.xuyan.fixture': { simulated: true } },
  datasets: [{ id: 'measurements', entryResourceId: 'data.csv', resourceIds: ['data.csv'] }, { id: 'binary', entryResourceId: 'data.binary', resourceIds: ['data.binary'] }, { id: 'brief', entryResourceId: 'data.brief', resourceIds: ['data.brief'] }],
  presentation: { runtime: 'web', runtimeVersion: '1', entryResourceId: 'view.index', resourceIds: ['view.index'], bindings: { measurements: 'measurements', binary: 'binary', brief: 'brief' } },
  resources: [
    { id: 'query.context', path: 'query.json', mediaType: 'application/json', body: JSON.stringify(query) + '\n' },
    { id: 'data.csv', path: 'data/measurements.csv', mediaType: 'text/csv', body: 'sample,value\nA,0\nB,-2.5\nC,9007199254740993\n' },
    { id: 'data.binary', path: 'data/raw.bin', mediaType: 'application/octet-stream', body: Uint8Array.from([0, 1, 127, 128, 254, 255]) },
    { id: 'data.brief', path: 'data/brief.md', mediaType: 'text/markdown', body: 'CSV 与原始二进制字节保持原样。大整数作为原始文本保存，协议不强制转换为 JSON 数值。\n' },
    { id: 'view.index', path: 'presentation/report.html', mediaType: 'text/html', body: await readFile(new URL('../examples/source/mixed.html', import.meta.url), 'utf8') },
  ] });
const mixedRef = { snapshotId: mixed.manifest.snapshotId, manifestHash: mixed.manifest.integrity.manifestHash };
await commitFixture(new URL('../examples/snapshots/dummy-mixed-v1', import.meta.url).pathname, mixed.bytes, mixed.files, mixedRef, scope);
catalog.entries.push({ key: 'mixed', title: '混合资源报告', label: 'CSV 与二进制', scope, ref: mixedRef });
catalog.variants.mixed = mixedRef.snapshotId;
await writeFile(new URL('../examples/snapshots/catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
console.log('Seven immutable fixture packages verified; catalog written.');
