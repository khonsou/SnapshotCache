import { test, expect } from '@playwright/test';
import { buildQueryContext, buildSnapshotCandidate, parseSnapshotDraft } from '../../src/agent/draft.mjs';

async function loaded(page) {
  await page.goto('/');
  const frame = page.frameLocator('snapshot-viewer iframe').first();
  await expect(frame.getByRole('heading', { name: '秋季新品发布' })).toBeVisible();
  return frame;
}
test('loads a verified package, filters, changes tabs and reloads initial state', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const frame = await loaded(page);
  await expect(frame.locator('#count')).toHaveText('显示 4 / 4 项');
  await frame.getByRole('combobox', { name: /^状态/ }).selectOption('待执行');
  await expect(frame.locator('#count')).toHaveText('显示 2 / 4 项');
  await frame.getByRole('tab', { name: '状态分布' }).click();
  await expect(frame.getByRole('tabpanel', { name: '状态分布' })).toBeVisible();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(frame.locator('#count')).toHaveText('显示 4 / 4 项');
  await expect(frame.getByRole('tab', { name: '时间安排' })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});
test('opening another initial state creates a new message and preserves the old snapshot reference', async ({ page }) => {
  await loaded(page);
  await page.getByLabel('快照验证样例').selectOption('dummy-filtered-v1');
  await expect(page.locator('snapshot-viewer')).toHaveCount(2);
  await expect(page.locator('snapshot-viewer').first()).toHaveAttribute('snapshot-id', 'dummy-launch-v1');
  await expect(page.frameLocator('snapshot-viewer iframe').nth(1).locator('#count')).toHaveText('显示 2 / 4 项');
  await expect(page.frameLocator('snapshot-viewer iframe').first().locator('#count')).toHaveText('显示 4 / 4 项');
});
test('empty, boundary and mixed binary data render without HTML injection', async ({ page }) => {
  await loaded(page);
  await page.getByLabel('快照验证样例').selectOption('dummy-empty-v1');
  await expect(page.frameLocator('snapshot-viewer iframe').nth(1).getByText('当前快照没有事项。')).toBeVisible();
  await page.getByLabel('快照验证样例').selectOption('dummy-boundary-v1');
  const boundary = page.frameLocator('snapshot-viewer iframe').nth(2);
  await expect(boundary.getByText('未排期', { exact: true })).toBeVisible();
  await expect(boundary.getByText('边界文本 <script>不会执行</script>', { exact: false })).toBeVisible();
  await page.getByLabel('快照验证样例').selectOption('dummy-mixed-v1');
  const mixed = page.frameLocator('snapshot-viewer iframe').nth(3);
  await expect(mixed.getByRole('heading', { name: '混合资源报告' })).toBeVisible();
  await expect(mixed.locator('#bytes')).toHaveText('00 01 7f 80 fe ff');
  await expect(mixed.locator('#csv')).toContainText('9007199254740993');
});
test('expand, close, switch projects and refresh keep stable fixture identities', async ({ page }) => {
  await loaded(page);
  await page.getByRole('button', { name: '展开项目快照' }).click();
  await expect(page.locator('#snapshot-dialog')).toBeVisible();
  await expect(page.frameLocator('#snapshot-dialog iframe').getByRole('heading', { name: '秋季新品发布' })).toBeVisible();
  await page.locator('#close-dialog').click();
  await expect(page.locator('#snapshot-dialog iframe')).toHaveCount(0);
  await page.getByRole('button', { name: '显示侧边栏' }).click();
  await page.getByRole('button', { name: '品牌体验升级', exact: true }).click();
  await expect(page.frameLocator('snapshot-viewer iframe').getByRole('heading', { name: '品牌体验升级' })).toBeVisible();
  await page.getByRole('button', { name: '秋季新品发布', exact: true }).click();
  await expect(page.locator('snapshot-viewer')).toHaveAttribute('snapshot-id', 'dummy-launch-v1');
  await page.reload();
  await expect(page.frameLocator('snapshot-viewer iframe').locator('#count')).toHaveText('显示 4 / 4 项');
});
test('corrupt or missing resources fail closed and a retry can recover', async ({ page }) => {
  await page.route('**/snapshots/dummy-launch-v1/data/board.json', route => route.fulfill({ body: 'corrupt', contentType: 'application/octet-stream' }));
  await page.goto('/');
  await expect(page.getByText('快照无法加载：', { exact: false })).toBeVisible();
  await expect(page.locator('snapshot-viewer iframe')).toHaveCount(0);
  await page.unroute('**/snapshots/dummy-launch-v1/data/board.json');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.frameLocator('snapshot-viewer iframe').locator('#count')).toHaveText('显示 4 / 4 项');
});
test('opaque sandbox and parent CSP block ambient access, remote requests and self-navigation', async ({ page }) => {
  await loaded(page);
  const frame = page.frames().find(f => f.url().startsWith('blob:'));
  const urls = [];
  // Chromium reports a request event even when CSP blocks it before network interception.
  await page.route('**/*p1-probe*', route => { urls.push(route.request().url()); return route.abort(); });
  const result = await frame.evaluate(async () => {
    const out = {};
    try { void parent.document.body; out.parent = true; } catch { out.parent = false; }
    try { localStorage.setItem('p1-probe', 'secret'); out.storage = true; } catch { out.storage = false; }
    try { await fetch('https://example.invalid/p1-probe'); out.network = true; } catch { out.network = false; }
    const image = new Image(); image.src = 'https://example.invalid/p1-probe-image'; document.body.append(image);
    return out;
  });
  expect(result).toEqual({ parent: false, storage: false, network: false });
  await frame.evaluate(() => { location.href = 'https://example.invalid/p1-probe-navigation'; });
  await page.waitForTimeout(200);
  expect(urls).toEqual([]);
  await expect(page).toHaveURL('/');
  if (await page.locator('snapshot-viewer iframe').count()) expect(frame.url()).toMatch(/^blob:/);
  else await expect(page.getByText('快照运行失败或发生了不允许的导航，请重新加载。')).toBeVisible();
});
test('runtime script failure produces an unavailable state and retry restores the saved package', async ({ page }) => {
  await loaded(page);
  const frame = page.frames().find(f => f.url().startsWith('blob:'));
  await frame.evaluate(() => dispatchEvent(new ErrorEvent('error', { message: 'test renderer failed' })));
  await expect(page.getByText('快照运行失败或发生了不允许的导航，请重新加载。')).toBeVisible();
  await expect(page.locator('snapshot-viewer iframe')).toHaveCount(0);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.frameLocator('snapshot-viewer iframe').locator('#count')).toHaveText('显示 4 / 4 项');
});
test('mobile layout and keyboard tab switching remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const frame = await loaded(page);
  await frame.getByRole('tab', { name: '时间安排' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(frame.getByRole('tab', { name: '状态分布' })).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  const child = page.frames().find(f => f.url().startsWith('blob:'));
  expect(await child.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
test('existing text chat still replies and snapshot reload does not call the model', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/chat', route => { requests++; return route.fulfill({ json: { reply: '测试回复 <不执行HTML>', truncated: false } }); });
  await loaded(page);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  expect(requests).toBe(0);
  await page.locator('#message-input').fill('测试文本对话');
  await page.locator('#composer').evaluate(form => form.requestSubmit());
  await expect(page.getByText('测试回复 <不执行HTML>', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.frameLocator('snapshot-viewer iframe').locator('#count')).toHaveText('显示 4 / 4 项');
});

test('generated snapshot opens immediately and can be replayed from project history after refresh', async ({ page }) => {
  const createdAt = '2026-09-11T14:00:00.000Z';
  const scope = { tenantId: 'local', projectId: 'launch' };
  const draft = parseSnapshotDraft(JSON.stringify({
    mode: 'snapshot',
    reply: '已根据用户提供的测试数据生成报告。',
    title: '生成的测试报告',
    datasets: [{ id: 'main', mediaType: 'application/json', content: { title: '浏览器端动态快照' } }],
    presentation: { html: '<!doctype html><html><head><meta charset="utf-8"><title>动态快照</title><style>body{font:16px sans-serif}</style></head><body><h1 id="title"></h1><script>"use strict";document.getElementById("title").textContent=Snapshot.readJSON("main").title;</script></body></html>' },
  }));
  const query = await buildQueryContext({ scope, project: '秋季新品发布', context: '浏览器验收', text: '生成一个测试报告快照', createdAt, requestedMode: 'auto' });
  const candidate = await buildSnapshotCandidate({ draft, snapshotId: 'gen-browser-test', scope, createdAt, query, model: 'test-model' });
  const entry = { title: candidate.title, committedAt: createdAt, messageId: 'msg-browser-test', ref: candidate.ref, scope, sourceKind: 'user-provided' };
  let showHistory = false;

  await page.route('**/api/projects/launch/snapshots**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/projects/launch/snapshots') return route.fulfill({ json: { entries: showHistory ? [entry] : [] } });
    if (pathname.endsWith('/manifest')) return route.fulfill({ body: Buffer.from(candidate.bytes), contentType: 'application/octet-stream' });
    const resourceId = decodeURIComponent(pathname.split('/').at(-1));
    const resource = candidate.manifest.resources.find(item => item.id === resourceId);
    return resource ? route.fulfill({ body: Buffer.from(candidate.files.get(resource.path)), contentType: 'application/octet-stream' }) : route.fulfill({ status: 404 });
  });
  await page.route('**/api/chat', route => route.fulfill({ json: { reply: draft.reply, runId: 'run-browser-test', snapshotStatus: 'generated', snapshotRef: candidate.ref, scope, title: candidate.title, messageId: 'msg-browser-test', truncated: false } }));

  await loaded(page);
  await page.locator('#message-input').fill('生成一个测试报告快照');
  await page.locator('#composer').evaluate(form => form.requestSubmit());
  await expect(page.frameLocator('snapshot-viewer[source="dynamic"] iframe').getByRole('heading', { name: '浏览器端动态快照' })).toBeVisible();
  await expect(page.getByText('已生成快照')).toBeVisible();

  showHistory = true;
  await page.reload();
  await page.getByRole('button', { name: '生成的测试报告' }).click();
  await expect(page.frameLocator('snapshot-viewer[source="dynamic"] iframe').getByRole('heading', { name: '浏览器端动态快照' })).toBeVisible();
  await expect(page.getByText('已从本项目生成记录重新打开，引用和内容保持不变。')).toBeVisible();
});

test('configured real project hides dummy data and renders a stateless inline Timeline snapshot', async ({ page }) => {
  const createdAt = '2026-09-12T12:00:00.000Z';
  const scope = { tenantId: 'local', projectId: 'timeline-real' };
  const source = { sourceId: 'timeline.board-real', revision: '23', observedAt: createdAt, protocolVersion: '19.2', boardId: 'board-real' };
  const draft = parseSnapshotDraft(JSON.stringify({
    mode: 'snapshot', reply: '已基于 Timeline 真实数据生成快照。', title: 'Timeline 真实概览',
    datasets: [{ id: 'main', mediaType: 'application/json', content: { title: '真实 Timeline 数据' } }],
    presentation: { html: '<!doctype html><html><head><meta charset="utf-8"><title>真实快照</title><style>body{font:16px sans-serif}</style></head><body><h1 id="title"></h1><script>"use strict";document.getElementById("title").textContent=Snapshot.readJSON("main").title;</script></body></html>' },
    notes: ['Timeline 真实数据'],
  }));
  const query = await buildQueryContext({ scope, project: '真实 Timeline 项目', context: '服务端真实配置', text: '生成 Timeline 快照', createdAt, requestedMode: 'snapshot', source, policyVersion: 'configured-project-v1' });
  const candidate = await buildSnapshotCandidate({ draft, snapshotId: 'gen-inline-real', scope, createdAt, query, model: 'test-model', source });
  const encode = bytes => Buffer.from(bytes).toString('base64');
  const snapshotPackage = { manifest: encode(candidate.bytes), resources: candidate.manifest.resources.map(resource => ({ id: resource.id, bytes: encode(candidate.files.get(resource.path)) })) };
  let snapshotApiRequests = 0;

  await page.route('**/api/projects', route => route.fulfill({ json: { configured: true, projects: [{ key: 'timeline-real', title: '真实 Timeline 项目', context: '服务端真实配置', source: { type: 'timeline', boardId: 'board-real' } }] } }));
  await page.route('**/api/projects/**', route => { snapshotApiRequests++; return route.fulfill({ status: 404 }); });
  await page.route('**/api/chat', route => route.fulfill({ json: {
    reply: draft.reply, snapshotStatus: 'generated', snapshotPersistence: 'session', snapshotRef: candidate.ref,
    snapshotPackage, scope, sourceKind: 'timeline', source, title: candidate.title, messageId: 'msg-inline-real', truncated: false,
  } }));

  await page.goto('/');
  await expect(page.locator('#project-title')).toHaveText('真实 Timeline 项目');
  await expect(page.getByText('秋季新品发布')).toHaveCount(0);
  await expect(page.getByText('真实项目已由服务端加载。', { exact: false })).toBeVisible();
  await page.locator('#message-input').fill('生成 Timeline 快照');
  await page.locator('#composer').evaluate(form => form.requestSubmit());
  await expect(page.frameLocator('snapshot-viewer[source="dynamic"] iframe').getByRole('heading', { name: '真实 Timeline 数据' })).toBeVisible();
  await expect(page.getByText('仅当前页面，刷新后消失', { exact: false })).toBeVisible();
  expect(snapshotApiRequests).toBe(0);

  await page.reload();
  await expect(page.getByText('真实项目已由服务端加载。', { exact: false })).toBeVisible();
  await expect(page.locator('snapshot-viewer')).toHaveCount(0);
});
