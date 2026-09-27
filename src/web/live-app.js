import { registerInlineSnapshotPackage } from './live-snapshots.mjs';
import { renderAgentMarkdown } from './markdown.js';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const projects = new Map();
const sessionSnapshots = new Map();
const sessionTraces = new Map();
const active = new Map();
let currentId = null;
let currentDetail = null;
let currentUser = null;
let managerFilter = 'active';
let editingId = null;
let contextId = null;
let serial = 0;
let sidebarOpen = false;
const list = $('#message-list');
const input = $('#message-input');
const projectDialog = $('#project-dialog');
const snapshotDialog = $('#snapshot-dialog');

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { showAuthGate('登录已失效，请重新登录。'); throw new Error('登录已失效，请重新登录。'); }
  if (!response.ok) throw new Error(data.error || '服务暂不可用，请稍后重试。');
  return data;
}

function showAuthGate(message, configured = true) {
  $('.shell').hidden = true;
  $('#auth-gate').hidden = false;
  $('#auth-message').textContent = message;
  $('#auth-login').setAttribute('aria-disabled', String(!configured));
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
}

function notify(message) {
  const node = $('#feedback');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { node.hidden = true; }, 3200);
}

function time(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function snapshotHtml(projectId, result) {
  if (!result?.snapshotRef || !result?.snapshotPackage || !result?.scope) return '';
  const ref = result.snapshotRef;
  return `<div class="snapshot-container" data-project="${escapeHtml(projectId)}"><div class="snapshot-header"><div><h2>${escapeHtml(result.title || '生成快照')}</h2><p class="snapshot-subtitle">${escapeHtml(time(new Date().toISOString()))} · 当次生成</p></div><button class="icon-button" data-expand aria-label="展开生成快照">${icon('expand')}</button></div><snapshot-viewer source="dynamic" snapshot-title="${escapeHtml(result.title || '生成快照')}" snapshot-id="${escapeHtml(ref.snapshotId)}" manifest-hash="${escapeHtml(ref.manifestHash)}" tenant-id="${escapeHtml(result.scope.tenantId)}" project-id="${escapeHtml(projectId)}"></snapshot-viewer><div class="snapshot-provenance"><span>动态生成 · 仅当前页面，刷新后快照不可回放</span><button class="text-button" data-reload-snapshot>重新加载</button></div></div>`;
}

function messageHtml(item) {
  const agent = item.role === 'assistant';
  const name = agent ? '序言' : (item.actorName || '公司员工');
  const initial = agent ? icon('spark') : escapeHtml(name.slice(0, 1));
  const body = agent ? renderAgentMarkdown(item.content) : `<p class="message-text">${escapeHtml(item.content)}</p>`;
  const snapshot = sessionSnapshots.get(item.id);
  const snapshotNote = agent && item.snapshotRef && !snapshot ? '<p class="panel-note">这条消息的快照包未做历史持久化，原始文字对话已保存。</p>' : '';
  const trace = sessionTraces.get(item.id) || '';
  return `<article class="message"><span class="avatar avatar-${agent ? 'agent' : 'me'}" aria-hidden="true">${initial}</span><div class="message-content"><div class="message-meta">${escapeHtml(name)}<small>${escapeHtml(time(item.createdAt))}</small></div><div class="agent-reply markdown-body">${body}</div>${snapshot ? snapshotHtml(currentId, snapshot) : snapshotNote}${trace}</div></article>`;
}

function renderConversation() {
  const messages = currentDetail?.messages || [];
  list.innerHTML = messages.length ? messages.map(messageHtml).join('') : '<div class="empty-conversation"><span class="empty-symbol">✦</span><h2>从一段对话开始</h2><p>@序言，聊聊项目的下一步。</p></div>';
  $('#project-title').textContent = currentDetail?.title || '项目对话';
  $('#members-button').hidden = !currentId;
  $('#members-button').textContent = '全体已登录员工';
  $('#members-button').disabled = true;
  $('#members-button').removeAttribute('aria-haspopup');
  $('#members-button').setAttribute('aria-label', '此项目由所有已登录员工共享');
  input.disabled = !currentId;
  syncInput();
}

function renderNavigation() {
  $('#project-list').innerHTML = [...projects.values()].filter(project => !project.archived).map(project =>
    `<button class="project ${project.id === currentId ? 'active' : ''}" data-project="${escapeHtml(project.id)}" ${project.id === currentId ? 'aria-current="page"' : ''}>${icon('folder')}<span>${escapeHtml(project.title)}</span></button>`
  ).join('') || '<p class="sidebar-empty">暂无进行中的项目</p>';
}

function renderManager() {
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === managerFilter)));
  $('#managed-projects').innerHTML = [...projects.values()].filter(project => project.archived === (managerFilter === 'archived')).map(project =>
    `<div class="managed-project"><span class="managed-icon">${icon('folder')}</span><div class="managed-name"><span>${escapeHtml(project.title)}</span>${project.id === currentId ? '<small>当前项目</small>' : ''}</div><div class="project-actions"><button class="text-button" data-context="${escapeHtml(project.id)}">上下文</button><button class="text-button" data-rename="${escapeHtml(project.id)}">重命名</button><button class="text-button" data-archive="${escapeHtml(project.id)}">${project.archived ? '恢复' : '归档'}</button><button class="text-button danger-action" data-delete="${escapeHtml(project.id)}">删除</button></div></div>`
  ).join('') || `<div class="manager-empty">${managerFilter === 'archived' ? '还没有归档的项目' : '暂无进行中的项目'}</div>`;
  $('#project-manager-feedback').textContent = '项目和对话由服务端保存，所有已登录员工共享。';
}

async function refreshProjects(selectId = currentId) {
  const result = await api('/api/projects');
  projects.clear();
  result.projects.forEach(project => projects.set(project.id, project));
  renderNavigation();
  renderManager();
  const next = selectId && projects.has(selectId) && !projects.get(selectId).archived ? selectId : [...projects.values()].find(project => !project.archived)?.id || null;
  await openProject(next);
}

async function openProject(id) {
  if (active.has(currentId)) return;
  currentId = id;
  currentDetail = id ? (await api(`/api/projects/${encodeURIComponent(id)}`)).project : null;
  renderNavigation();
  renderConversation();
  if (!id) list.innerHTML = '<div class="empty-conversation"><h2>建立团队项目</h2><p>新建项目后，可以设置上下文并与序言对话。</p><button class="primary-button" data-manage-projects>管理项目</button></div>';
  $('#conversation').scrollTop = 0;
  closeSidebar();
}

function syncInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  $('.send-button').disabled = !currentId || !input.value.trim() || active.has(currentId);
}

function closeSidebar() {
  sidebarOpen = false;
  $('#sidebar').classList.remove('is-open');
  $('#sidebar').inert = true;
  $('#sidebar').setAttribute('aria-hidden', 'true');
  $('.shell').classList.add('sidebar-hidden');
  $('#sidebar-backdrop').hidden = true;
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  $('#sidebar').classList.toggle('is-open', sidebarOpen);
  $('#sidebar').inert = !sidebarOpen;
  $('#sidebar').setAttribute('aria-hidden', String(!sidebarOpen));
  $('.shell').classList.toggle('sidebar-hidden', !sidebarOpen);
  $('#sidebar-backdrop').hidden = !sidebarOpen || !matchMedia('(max-width: 760px)').matches;
  $('#menu-toggle').setAttribute('aria-expanded', String(sidebarOpen));
}

function progressLabel(event) {
  if (event.phase === 'accepted') return '请求已接收，正在启动 Agent';
  if (event.phase === 'runtime_ready') return 'Agent 已启动，正在处理';
  if (event.phase === 'validating_snapshot') return '正在校验快照';
  if (!event.phase?.startsWith('tool_')) return null;
  const action = { read: '读取', auth: '鉴权', change_set: '创建变更提案', commit: '提交变更' }[event.action] || '请求';
  const tool = event.tool === 'project_http_request' ? `数据源 ${event.source || ''} · ${action}` : event.tool === 'WebSearch' ? '联网搜索' : '提交快照';
  return event.phase === 'tool_started' ? `${event.step}. ${tool} · 执行中` : `${event.step}. ${tool} · ${event.outcome === 'failed' ? '失败' : '已返回'}${event.status ? ` · HTTP ${event.status}` : ''}`;
}

async function readStream(response, onProgress) {
  if (!response.body) throw new Error('服务器没有返回进度流。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > 16000000) throw new Error('回复内容过大，请重试。');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (frame.startsWith(':')) continue;
      const lines = frame.split('\n');
      const type = lines.find(line => line.startsWith('event: '))?.slice(7);
      const data = lines.find(line => line.startsWith('data: '))?.slice(6);
      if (!data) continue;
      const value = JSON.parse(data);
      if (type === 'progress') onProgress(value);
      if (type === 'result') result = value;
    }
  }
  if (!result) throw new Error('回复未完成，请重试。');
  return result;
}

async function send(text, idempotencyKey = crypto.randomUUID()) {
  text = text.trim();
  if (!text || !currentId || active.has(currentId)) return;
  if (text.length > 6000) { input.setCustomValidity('消息最多 6,000 个字符。'); input.reportValidity(); return; }
  const projectId = currentId;
  const controller = new AbortController();
  active.set(projectId, controller);
  input.value = '';
  syncInput();
  list.querySelector('.empty-conversation')?.remove();
  const loadingId = `pending-${++serial}`;
  list.insertAdjacentHTML('beforeend', `<article class="message"><span class="avatar avatar-me">${escapeHtml((currentUser?.name || '我').slice(0, 1))}</span><div class="message-content"><div class="message-meta">${escapeHtml(currentUser?.name || '我')}</div><p class="message-text">${escapeHtml(text)}</p></div></article><article class="message" id="${loadingId}"><span class="avatar avatar-agent">${icon('spark')}</span><div class="message-content"><div class="message-meta">序言</div><div class="typing"><i></i><i></i><i></i></div><details class="agent-trace"><summary><span data-trace-count>执行记录 · 0 步</span><span class="agent-trace-viewport"><span class="agent-progress" data-progress>正在连接 Agent</span></span></summary><ol data-steps></ol></details></div></article>`);
  $('#conversation').scrollTop = $('#conversation').scrollHeight;
  const timeout = setTimeout(() => controller.abort(), 175000);
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }, signal: controller.signal, body: JSON.stringify({ projectId, message: text, responseMode: 'auto', idempotencyKey }) });
    const steps = [];
    const onProgress = event => {
      const label = progressLabel(event);
      if (!label) return;
      const root = document.getElementById(loadingId);
      if (!root) return;
      root.querySelector('[data-progress]').textContent = label;
      if (event.phase === 'tool_started') steps.push(label);
      if (event.phase === 'tool_finished') steps[event.step - 1] = label;
      root.querySelector('[data-steps]').innerHTML = steps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
      root.querySelector('[data-trace-count]').textContent = `执行记录 · ${steps.length} 步`;
    };
    const outcome = response.headers.get('content-type')?.includes('text/event-stream') ? await readStream(response, onProgress) : { status: response.status, body: await response.json() };
    if (outcome.status === 401) { showAuthGate('登录已失效，请重新登录。'); throw new Error('登录已失效，请重新登录。'); }
    if (outcome.status < 200 || outcome.status >= 300) throw new Error(outcome.body?.error || '回复失败，请重试。');
    const result = outcome.body;
    if (result.snapshotPackage && result.conversationMessageId) {
      registerInlineSnapshotPackage(result);
      sessionSnapshots.set(result.conversationMessageId, result);
    }
    if (result.conversationMessageId && steps.length) sessionTraces.set(result.conversationMessageId, `<details class="agent-trace"><summary>本轮执行记录 · ${steps.length} 步</summary><ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol></details>`);
    if (currentId === projectId) { currentDetail = (await api(`/api/projects/${encodeURIComponent(projectId)}`)).project; renderConversation(); $('#conversation').scrollTop = $('#conversation').scrollHeight; }
  } catch (error) {
    if (currentId === projectId) {
      list.querySelector(`#${loadingId}`)?.remove();
      list.insertAdjacentHTML('beforeend', `<p class="panel-note">${escapeHtml(controller.signal.aborted ? '回复超时，请核对项目对话和数据源后再试。' : error.message)} <button class="text-button" data-retry-message="${escapeHtml(text)}" data-retry-key="${escapeHtml(idempotencyKey)}">重试</button></p>`);
    }
  } finally { clearTimeout(timeout); active.delete(projectId); syncInput(); }
}

function openManager() {
  managerFilter = 'active';
  $('#project-manager-view').hidden = false;
  $('#project-context-view').hidden = true;
  $('#project-form').hidden = true;
  renderManager();
  projectDialog.showModal();
}

function openContext(id) {
  contextId = id;
  api(`/api/projects/${encodeURIComponent(id)}`).then(({ project }) => {
    $('#context-project-name').textContent = project.title;
    $('#context-content').value = project.context;
    $('#context-error').hidden = true;
    $('#project-manager-view').hidden = true;
    $('#project-context-view').hidden = false;
  }).catch(error => notify(error.message));
}

$('#project-list').addEventListener('click', event => { const button = event.target.closest('[data-project]'); if (button) openProject(button.dataset.project).catch(error => notify(error.message)); });
$('#menu-toggle').addEventListener('click', toggleSidebar);
$('#sidebar-close').addEventListener('click', closeSidebar);
$('#sidebar-backdrop').addEventListener('click', closeSidebar);
$('#manage-projects').addEventListener('click', openManager);
$('#close-projects').addEventListener('click', () => projectDialog.close());
$('#close-context').addEventListener('click', () => projectDialog.close());
$('#cancel-context').addEventListener('click', () => { $('#project-manager-view').hidden = false; $('#project-context-view').hidden = true; });
$('#add-project').addEventListener('click', () => { editingId = null; $('#project-form').hidden = false; $('#project-name').value = ''; $('#project-name-label').textContent = '新建项目'; $('#project-name').focus(); });
$('#cancel-project-edit').addEventListener('click', () => { $('#project-form').hidden = true; });
$('#project-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (editingId) await api(`/api/projects/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: JSON.stringify({ title: $('#project-name').value }) });
    else {
      const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify({ title: $('#project-name').value }) });
      currentId = project.id;
    }
    $('#project-form').hidden = true;
    await refreshProjects(currentId);
    if (!editingId) projectDialog.close();
    notify(editingId ? '项目名称已保存。' : '项目已创建。');
  } catch (error) { $('#project-error').textContent = error.message; $('#project-error').hidden = false; }
});
projectDialog.addEventListener('click', async event => {
  const filter = event.target.closest('[data-filter]');
  if (filter) { managerFilter = filter.dataset.filter; renderManager(); return; }
  const context = event.target.closest('[data-context]');
  if (context) { openContext(context.dataset.context); return; }
  const rename = event.target.closest('[data-rename]');
  if (rename) { editingId = rename.dataset.rename; $('#project-form').hidden = false; $('#project-name').value = projects.get(editingId)?.title || ''; $('#project-name-label').textContent = '重命名项目'; $('#project-name').focus(); return; }
  const archive = event.target.closest('[data-archive]');
  if (archive) {
    try { const project = projects.get(archive.dataset.archive); await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: JSON.stringify({ archived: !project.archived }) }); await refreshProjects(currentId); notify(project.archived ? '项目已恢复。' : '项目已归档。'); }
    catch (error) { notify(error.message); }
    return;
  }
  const remove = event.target.closest('[data-delete]');
  if (remove) {
    const project = projects.get(remove.dataset.delete);
    if (!confirm(`删除“${project.title}”？此操作会删除全体员工共享的上下文和对话。`)) return;
    try { await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' }); sessionSnapshots.clear(); sessionTraces.clear(); if (currentId === project.id) currentId = null; await refreshProjects(currentId); notify('项目及其共享对话已删除。'); }
    catch (error) { notify(error.message); }
  }
});
$('#context-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api(`/api/projects/${encodeURIComponent(contextId)}`, { method: 'PATCH', body: JSON.stringify({ context: $('#context-content').value }) }); await refreshProjects(currentId); $('#project-manager-view').hidden = false; $('#project-context-view').hidden = true; notify('项目上下文已保存。'); }
  catch (error) { $('#context-error').textContent = error.message; $('#context-error').hidden = false; }
});
$('#composer').addEventListener('submit', event => { event.preventDefault(); send(input.value); });
input.addEventListener('input', () => { input.setCustomValidity(''); syncInput(); });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(input.value); } });
$('#new-chat').addEventListener('click', async () => {
  if (!currentId || !confirm('开启新对话会清空本项目所有员工共享的当前对话，是否继续？')) return;
  try { await api(`/api/projects/${encodeURIComponent(currentId)}/conversation`, { method: 'DELETE' }); sessionSnapshots.clear(); sessionTraces.clear(); currentDetail = (await api(`/api/projects/${encodeURIComponent(currentId)}`)).project; renderConversation(); notify('已开启新的共享对话。'); }
  catch (error) { notify(error.message); }
});
$('#auth-logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.assign('/'); });
document.addEventListener('click', event => {
  if (event.target.closest('[data-manage-projects]')) openManager();
  const retry = event.target.closest('[data-retry-message]');
  if (retry) { retry.closest('.panel-note')?.remove(); send(retry.dataset.retryMessage, retry.dataset.retryKey); }
  const expand = event.target.closest('[data-expand]');
  if (expand) { $('#dialog-content').replaceChildren(expand.closest('.snapshot-container').cloneNode(true)); snapshotDialog.showModal(); }
  const reload = event.target.closest('[data-reload-snapshot]');
  if (reload) { const viewer = reload.closest('.snapshot-container').querySelector('snapshot-viewer'); viewer.replaceWith(viewer.cloneNode(false)); }
});
$('#close-dialog').addEventListener('click', () => snapshotDialog.close());
snapshotDialog.addEventListener('close', () => $('#dialog-content').replaceChildren());

async function bootstrap() {
  const url = new URL(location.href);
  const authError = url.searchParams.get('auth_error');
  if (authError) { url.searchParams.delete('auth_error'); history.replaceState(null, '', url.pathname + url.search); }
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.authenticated) { showAuthGate(authError ? '登录校验失败，请重新尝试。' : result.configured === false ? 'DAO OAuth 尚未配置，请联系管理员。' : '请使用公司账号登录后继续。', result.configured !== false); return; }
    currentUser = result.user;
    $('#auth-user').textContent = currentUser?.name || '公司用户';
    $('#auth-gate').hidden = true;
    $('.shell').hidden = false;
    closeSidebar();
    await refreshProjects();
  } catch { showAuthGate('暂时无法加载项目，请稍后刷新。', false); }
}
bootstrap();
