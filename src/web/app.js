import { snapshotCatalog } from './snapshots.mjs';
'use strict';
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const projects = {
  launch: {title:'秋季新品发布',subtitle:'9 月 1 日 — 9 月 10 日',summary:'预约已达阶段目标的 89%，小红书贡献最多。接下来重点关注 9 月 12 日的详情页验收。',metrics:[['累计预约','2,846','人','较上周增长 24.8%'],['阶段目标达成','89','%','目标 3,200 人'],['已完成事项','18','/ 24','本周完成 6 项']],channels:[['小红书',46],['微信公众号',28],['自然访问',18],['其他渠道',8]],tasks:[['09.08','主视觉与物料定稿','乔一 · 品牌设计','已完成'],['09.10','首轮内容上线','陆遥 · 市场团队','进行中'],['09.12','产品详情页验收','林安 · 产品团队','待开始'],['09.15','新品正式发布','全体成员','待开始']],bars:[20,29,25,37,42,35,54,62,70,82,91,100]},
  brand: {title:'品牌体验升级',subtitle:'9 月第 2 周',summary:'品牌规范的核心部分已完成，官网和包装正在同步推进。接下来优先统一移动端的视觉细节。',metrics:[['已更新触点','12','个','覆盖 4 个业务场景'],['规范完成度','75','%','目标本月完成'],['已完成事项','9','/ 12','本周完成 3 项']],channels:[['官网',40],['产品界面',30],['品牌物料',20],['线下触点',10]],tasks:[['09.08','品牌基础规范确认','乔一 · 品牌设计','已完成'],['09.10','官网视觉适配','乔一 · 品牌设计','进行中'],['09.13','移动端体验走查','林安 · 产品团队','待开始'],['09.18','品牌规范交付','全体成员','待开始']],bars:[15,22,30,28,40,45,49,65,61,72,83,90]},
  research: {title:'用户研究室',subtitle:'9 月 1 日 — 9 月 10 日',summary:'已完成 18 场访谈。大家最关心的是信息是否清晰、协作能否顺畅，这两点会是下一轮体验验证的重点。',metrics:[['已访谈用户','18','人','覆盖 3 类用户'],['访谈完成度','90','%','计划 20 场访谈'],['关键发现','6','项','3 项已进入验证']],channels:[['新用户',35],['活跃用户',40],['流失用户',20],['其他',5]],tasks:[['09.07','访谈提纲确认','林安 · 用户研究','已完成'],['09.10','深度用户访谈','林安 · 用户研究','进行中'],['09.12','整理研究发现','陆遥 · 产品团队','待开始'],['09.16','研究结论分享','全体成员','待开始']],bars:[10,15,30,25,40,50,45,60,72,80,88,95]}
};
const directory = new ProjectDirectory(projects);
const membership = new ProjectMembers(workspacePeople, 'me');
for (const id of Object.keys(projects)) {
  membership.add(id, 'me', ['lu', 'qiao']);
  membership.setRole(id, 'me', 'lu', 'admin');
}
directory.saveContext('launch', '目标：9 月 15 日发布秋季新品，阶段预约目标为 3,200 人。\n重点关注内容上线、详情页验收和渠道表现。\n回答时说明数据来源与时间。');
directory.saveContext('brand', '目标：统一官网、产品界面和品牌物料的体验。\n优先推进移动端视觉细节和品牌规范交付。');
directory.saveContext('research', '目标：完成 20 场访谈，形成可验证的用户研究结论。\n区分用户原话、观察与推测，为结论保留来源。');
const chatTurns = {};
const activeRequests = new Map();
const retries = new Map();
let currentProject = 'launch';
let serial = 0;
const histories = {};
const pending = new Set();
const list = document.querySelector('#message-list');
const conversation = document.querySelector('#conversation');
const input = document.querySelector('#message-input');
const dialog = document.querySelector('#snapshot-dialog');
function message(author, body, time='10:32', source='hit') {
  const people = {lu:['陆遥','lu','陆'],qiao:['乔一','qiao','乔'],me:['林安','me','林'],agent:['序言','agent',icon('spark')]};
  const [name,cls,avatar] = people[author];
  return `<article class="message"><span class="avatar avatar-${cls}" aria-hidden="true">${avatar}</span><div class="message-content"><div class="message-meta">${name}${author==='agent'&&body.includes('snapshot-container')?`<span class="reply-source ${source==='hit'?'is-hit':''}" title="初始示例快照">${icon(source==='hit'?'check':'spark')}示例快照</span>`:''}</div>${body}</div></article>`;
}
function snapshot(project, snapshotId = snapshotCatalog.defaults[project]) {
  const entry = snapshotCatalog.entries.find(e => e.ref.snapshotId === snapshotId && e.scope.projectId === project);
  if (!entry) return '<p class="message-text">快照不可用。</p>';
  return `<div class="snapshot-container" data-project="${project}" data-snapshot-id="${entry.ref.snapshotId}"><div class="snapshot-header"><div><h2>项目快照</h2><p class="snapshot-subtitle">${escapeHtml(entry.label)} · 2026 年 9 月 11 日</p></div><button class="icon-button" data-expand aria-label="展开项目快照">${icon('expand')}</button></div><snapshot-viewer snapshot-id="${entry.ref.snapshotId}" manifest-hash="${entry.ref.manifestHash}" project-id="${project}"></snapshot-viewer><div class="snapshot-provenance"><span>模拟数据 · 完整快照包</span><button class="text-button" data-reload-snapshot>重新加载</button></div></div>`;
}
function fixturePicker(project) {
  if (project !== 'launch') return '';
  return `<div class="fixture-picker"><label>验证样例 <select data-fixture-picker aria-label="快照验证样例"><option value="">选择后在新消息中打开</option>${snapshotCatalog.entries.filter(e => e.scope.projectId === project).map(e => `<option value="${e.ref.snapshotId}">${escapeHtml(e.label)}</option>`).join('')}</select></label><span>样例使用固定模拟数据</span></div>`;
}
function initialMessages(project) {
  const data = projects[project];
  if(data.isNew) return emptyConversation();
  if(project==='launch') return `<div class="day-divider">9 月 10 日</div>${message('lu','<p class="message-text">早上好，距离新品发布还有 5 天。我们一起对一下进展？</p>','10:30')}${message('qiao','<p class="message-text">视觉物料已经全部定稿，首轮内容今天可以上线。</p>','10:31')}${message('me','<p class="message-text"><span class="mention">@序言</span> 帮我们看看目前的整体进展。</p>')}${message('agent',`<p class="message-text">以下是已冻结的模拟项目安排，可查看、筛选或展开。</p>${snapshot(project)}${fixturePicker(project)}`)}`;
  return `<div class="day-divider">9 月 10 日</div>${message('lu',`<p class="message-text">我们对一下「${escapeHtml(data.title)}」的最新进展吧。</p>`,'10:30')}${message('me','<p class="message-text"><span class="mention">@序言</span> 整理一下目前的情况。</p>','10:31')}${message('agent',`<p class="message-text">以下是已冻结的模拟项目安排，可查看、筛选或展开。</p>${snapshot(project)}${fixturePicker(project)}`)}`;
}
function renderNavigation() {
  document.querySelector('#project-list').innerHTML = directory.list().map(({id,title}) => `<button class="project ${id===currentProject?'active':''}" data-project="${id}" ${id===currentProject?'aria-current="page"':''}>${icon('folder')}<span>${escapeHtml(title)}</span></button>`).join('') || '<p class="sidebar-empty">暂无进行中的项目</p>';
}
function emptyConversation() {
  return '<div class="empty-conversation"><span class="empty-symbol">'+icon('spark')+'</span><h2>从一段对话开始</h2><p>@序言，聊聊项目的下一步。</p></div>';
}
function renderProject(project) {
  if(currentProject) histories[currentProject] = list.innerHTML;
  currentProject = project;
  list.innerHTML = project ? (histories[project] ?? initialMessages(project)) : '<div class="empty-conversation"><h2>留一点空间给新想法</h2><p>新建一个项目，或恢复已归档的项目。</p><button class="primary-button" data-manage-projects>管理项目</button></div>';
  document.querySelector('#project-title').textContent = project ? projects[project].title : '项目对话';
  syncMembersHeader();
  renderNavigation();
  input.value='';input.disabled=!project;syncInput();closeSidebar();conversation.scrollTop=0;
}
function scrollDown() {requestAnimationFrame(()=>conversation.scrollTo({top:conversation.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));}
function syncInput() {input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,130)}px`;document.querySelector('.send-button').disabled=!currentProject||!input.value.trim()||activeRequests.has(currentProject);}
function replaceReply(project, token, body) {
  const holder=document.createElement('div');
  holder.innerHTML=currentProject===project?list.innerHTML:histories[project];
  holder.querySelector(`#${token}`)?.replaceWith(document.createRange().createContextualFragment(body));
  histories[project]=holder.innerHTML;
  if(currentProject===project){list.innerHTML=histories[project];scrollDown();}
}
async function send(text, retryToken=null) {
  text=text.trim();if(!text||!currentProject||activeRequests.has(currentProject))return;
  if(text.length>6000){input.setCustomValidity('消息最多 6,000 个字符。');input.reportValidity();return;}
  input.setCustomValidity('');
  const project=currentProject;
  // A newer request replaces older retry controls so conversations keep their order.
  for(const [id, retry] of retries) if(retry.project===project) {
    list.querySelector(`[data-retry="${id}"]`)?.remove();retries.delete(id);
  }
  const now=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  list.querySelector('.empty-conversation')?.remove();
  if(!retryToken) list.insertAdjacentHTML('beforeend',message('me',`<p class="message-text">${escapeHtml(text)}</p>`,now));
  input.value='';
  const token=`reply-${++serial}`;
  const loading=`<div id="${token}" role="status" aria-label="序言正在整理回复">${message('agent','<div class="typing"><i></i><i></i><i></i></div>',now)}</div>`;
  if(retryToken) list.querySelector(`#${retryToken}`)?.remove();
  list.insertAdjacentHTML('beforeend',loading);
  const controller=new AbortController();activeRequests.set(project,controller);
  pending.add(token);histories[project]=list.innerHTML;syncInput();scrollDown();
  const turns=[...(chatTurns[project]||[]).slice(-18),{role:'user',content:text}];
  const timeout=setTimeout(()=>controller.abort(),55000);
  try {
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({project:projects[project].title,context:directory.getContext(project),messages:turns})});
    const result=await response.json().catch(()=>({error:'服务暂不可用，请通过服务端网址打开页面后重试。'}));
    if(!response.ok||typeof result.reply!=='string')throw new Error(result.error||'回复失败，请重试。');
    if(!pending.has(token))return;
    chatTurns[project]=[...turns,{role:'assistant',content:result.reply.slice(0,6000)}].slice(-18);
    const note=result.truncated?'<p class="panel-note">回复达到本次长度上限，可以发送“继续”。</p>':'';
    replaceReply(project,token,message('agent',`<p class="message-text agent-reply">${escapeHtml(result.reply)}</p>${note}`,now));
  } catch(error) {
    if(!pending.has(token))return;
    const errorText=controller.signal.aborted?'回复超时，请稍后重试。':error instanceof TypeError?'无法连接服务，请稍后重试。':error.message;
    retries.set(token,{project,text});
    replaceReply(project,token,`<div id="${token}" role="status">${message('agent',`<p class="message-text">${escapeHtml(errorText)}</p><button class="text-button" data-retry="${token}">重试</button>`,now)}</div>`);
  } finally {
    clearTimeout(timeout);pending.delete(token);
    if(activeRequests.get(project)===controller)activeRequests.delete(project);
    syncInput();
  }
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-retry]');
  const retry=button&&retries.get(button.dataset.retry);
  if(retry&&retry.project===currentProject)send(retry.text,button.dataset.retry);
});
document.querySelector('#composer').addEventListener('submit',event=>{event.preventDefault();send(input.value);});
input.addEventListener('input',()=>{input.setCustomValidity('');syncInput();});
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();send(input.value);}});
document.querySelector('#project-list').addEventListener('click',event=>{const button=event.target.closest('[data-project]');if(button)renderProject(button.dataset.project);});
document.addEventListener('click',event=>{
  if(event.target.closest('[data-manage-projects]'))openProjects();
  const expand=event.target.closest('[data-expand]');
  if(expand){const clone=expand.closest('.snapshot-container').cloneNode(true);const suffix=`-dialog-${++serial}`;clone.querySelectorAll('[id]').forEach(el=>el.id+=suffix);clone.querySelectorAll('[aria-controls]').forEach(el=>el.setAttribute('aria-controls',el.getAttribute('aria-controls')+suffix));clone.querySelectorAll('[aria-labelledby]').forEach(el=>el.setAttribute('aria-labelledby',el.getAttribute('aria-labelledby')+suffix));document.querySelector('#dialog-content').replaceChildren(clone);dialog.showModal();}
});
document.addEventListener('keydown',event=>{const tab=event.target.closest('[role="tab"]');if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tabs=[...tab.parentElement.querySelectorAll('[role="tab"]')];const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(tabs.indexOf(tab)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[index].click();tabs[index].focus();}if((event.metaKey||event.ctrlKey)&&event.key==='k'&&!document.querySelector('dialog[open]')){event.preventDefault();openProjects();}if(event.key==='Escape'){closeSidebar();}});
document.querySelector('#close-dialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>document.querySelector('#dialog-content').replaceChildren());
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
const sidebar = document.querySelector('#sidebar');
const shell = document.querySelector('.shell');
const mobile = matchMedia('(max-width: 760px)');
let desktopCollapsed = true;
let mobileOpen = false;
function syncSidebar() {
  const open = mobile.matches ? mobileOpen : !desktopCollapsed;
  shell.classList.toggle('sidebar-hidden', !mobile.matches && desktopCollapsed);
  sidebar.classList.toggle('is-open', mobile.matches && open);
  sidebar.inert = !open;
  sidebar.setAttribute('aria-hidden', String(!open));
  document.querySelector('.main').inert = mobile.matches && open;
  if(mobile.matches && open){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');}
  else {sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');}
  document.querySelector('#sidebar-backdrop').hidden = !(mobile.matches && open);
  const toggle = document.querySelector('#menu-toggle');
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open?'隐藏侧边栏':'显示侧边栏');
  toggle.title=open?'隐藏侧边栏':'显示侧边栏';
}
function closeSidebar() {
  const hadFocus = sidebar.contains(document.activeElement);
  mobileOpen = false;syncSidebar();
  if(mobile.matches && hadFocus) document.querySelector('#menu-toggle').focus();
}
function toggleSidebar() {
  if(mobile.matches) mobileOpen=!mobileOpen;
  else desktopCollapsed=!desktopCollapsed;
  syncSidebar();
  if(mobile.matches && mobileOpen)document.querySelector('#sidebar-close').focus();
  else document.querySelector('#menu-toggle').focus();
}
document.querySelector('#menu-toggle').addEventListener('click',toggleSidebar);
document.querySelector('#sidebar-close').addEventListener('click',toggleSidebar);
document.querySelector('#sidebar-backdrop').addEventListener('click',closeSidebar);
mobile.addEventListener('change',()=>{mobileOpen=false;syncSidebar();});
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key==='\\'&&!document.querySelector('dialog[open]')){event.preventDefault();toggleSidebar();}
  if(event.key==='Tab'&&mobile.matches&&mobileOpen&&!document.querySelector('dialog[open]')){
    const items=[...sidebar.querySelectorAll('button,a')];
    const first=items[0],last=items[items.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});
function newChat(){if(!currentProject){openProjects();return;}activeRequests.get(currentProject)?.abort();activeRequests.delete(currentProject);chatTurns[currentProject]=[];for(const [id,r] of retries)if(r.project===currentProject)retries.delete(id);list.querySelectorAll('[id^="reply-"]').forEach(el=>pending.delete(el.id));list.innerHTML=`<div class="empty-conversation"><h2>开启一段对话</h2><p>@序言，看看项目进展。</p></div>`;histories[currentProject]=list.innerHTML;closeSidebar();input.value='';syncInput();input.focus();}
document.querySelector('#new-chat').addEventListener('click',newChat);
list.innerHTML=initialMessages(currentProject);
renderNavigation();
syncSidebar();
syncMembersHeader();

const projectDialog = document.querySelector('#project-dialog');
const projectForm = document.querySelector('#project-form');
const projectName = document.querySelector('#project-name');
let projectFilter = 'active';
let editingProject = null;
let feedbackTimer;
function feedback(text) {
  const node=document.querySelector('#feedback');
  clearTimeout(feedbackTimer);node.textContent=text;node.hidden=false;
  feedbackTimer=setTimeout(()=>{node.hidden=true;},2600);
}
function renderManager() {
  const items=directory.list(projectFilter==='archived');
  document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===projectFilter)));
  document.querySelector('#managed-projects').innerHTML=items.map(({id,title})=>`<div class="managed-project"><span class="managed-icon">${icon('folder')}</span><div class="managed-name"><span>${escapeHtml(title)}</span>${id===currentProject?'<small>当前项目</small>':''}</div><div class="project-actions"><button class="text-button context-entry" data-context="${id}" aria-label="管理 ${escapeHtml(title)} 的上下文">上下文</button>${projectFilter==='active'?`<button class="text-button" data-rename="${id}" aria-label="重命名 ${escapeHtml(title)}">重命名</button><button class="text-button" data-archive="${id}" aria-label="归档 ${escapeHtml(title)}">归档</button>`:`<button class="text-button" data-restore="${id}" aria-label="恢复 ${escapeHtml(title)}">恢复</button>`}</div></div>`).join('') || `<div class="manager-empty">${projectFilter==='archived'?'还没有归档的项目':'暂无进行中的项目'}</div>`;
}
function cancelProjectEdit() {
  projectForm.hidden=true;editingProject=null;projectName.value='';
  document.querySelector('#project-error').hidden=true;
}
function openProjects() {
  closeSidebar();projectFilter='active';cancelProjectEdit();showProjectManager();renderManager();projectDialog.showModal();
}
function editProject(id=null) {
  editingProject=id;projectForm.hidden=false;
  document.querySelector('#project-name-label').textContent=id?'重命名项目':'新建项目';
  projectName.value=id?projects[id].title:'';
  document.querySelector('#project-error').hidden=true;
  projectName.focus();projectName.select();
}
document.querySelector('#manage-projects').addEventListener('click',openProjects);
document.querySelector('#close-projects').addEventListener('click',()=>projectDialog.close());
projectDialog.addEventListener('close',()=>{
  if(sidebar.inert)document.querySelector('#menu-toggle').focus();
});
document.querySelector('#add-project').addEventListener('click',()=>editProject());
document.querySelector('#cancel-project-edit').addEventListener('click',()=>{cancelProjectEdit();document.querySelector('#add-project').focus();});
projectDialog.addEventListener('click',event=>{
  const context=event.target.closest('[data-context]');if(context)openProjectContext(context.dataset.context);
  const filter=event.target.closest('[data-filter]');
  if(filter){projectFilter=filter.dataset.filter;cancelProjectEdit();renderManager();}
  const rename=event.target.closest('[data-rename]');if(rename)editProject(rename.dataset.rename);
  const archive=event.target.closest('[data-archive]');
  if(archive){
    const id=archive.dataset.archive;
    directory.archive(id);cancelProjectEdit();
    if(currentProject===id)renderProject(directory.list()[0]?.id??null);else renderNavigation();
    renderManager();document.querySelector('[data-filter="active"]').focus();feedback('项目已归档，可在“已归档”中恢复。');
  }
  const restore=event.target.closest('[data-restore]');
  if(restore){directory.restore(restore.dataset.restore);if(!currentProject)renderProject(restore.dataset.restore);else renderNavigation();renderManager();document.querySelector('[data-filter="archived"]').focus();feedback('项目已恢复。');}
});
projectForm.addEventListener('submit',event=>{
  event.preventDefault();
  try {
    if(editingProject){
      directory.rename(editingProject,projectName.value);
      if(editingProject===currentProject)document.querySelector('#project-title').textContent=projects[currentProject].title;
      cancelProjectEdit();renderNavigation();renderManager();document.querySelector('#add-project').focus();feedback('项目名称已更新。');
    }else{
      const id=directory.create(projectName.value);
      renderProject(id);projectDialog.close();input.focus();feedback('项目已创建。');
    }
  }catch(error){const node=document.querySelector('#project-error');node.textContent=error.message;node.hidden=false;projectName.focus();}
});

const memberDialog = document.querySelector('#member-dialog');
const memberPicker = document.querySelector('#member-picker');
const memberSearch = document.querySelector('#member-search');
const selectedMembers = new Set();
let memberProjectId = null;
function syncMembersHeader() {
  const button = document.querySelector('#members-button');
  button.hidden = !currentProject;
  if (currentProject) {
    const count = membership.list(currentProject).length;
    button.textContent = `${count} 位成员`;
    button.setAttribute('aria-label', `管理群聊成员，当前 ${count} 人和序言 Agent`);
  }
}
function memberAvatar(person) {
  return `<span class="avatar avatar-${person.avatar}" aria-hidden="true">${escapeHtml(person.initial)}</span>`;
}
function memberFeedback(text, error = false) {
  const node = document.querySelector('#member-feedback');
  node.textContent = text;
  node.classList.toggle('is-error', error);
}
function renderMembers() {
  const members = membership.list(memberProjectId);
  document.querySelector('#member-count').textContent = `${members.length} 位成员`;
  document.querySelector('#member-list').innerHTML = members.map(person => `<div class="member-row">
    ${memberAvatar(person)}<div class="member-name">${escapeHtml(person.name)}${person.id==='me'?'<span class="self-label">你</span>':''}<small>${escapeHtml(person.detail)}</small></div>
    ${person.role==='owner'?'<span class="member-role-label owner-label">群主</span>':`<div class="member-row-actions"><select data-member-role="${person.id}" aria-label="${escapeHtml(person.name)}的角色"><option value="member" ${person.role==='member'?'selected':''}>成员</option><option value="admin" ${person.role==='admin'?'selected':''}>管理员</option></select><button class="text-button remove-member" data-remove-member="${person.id}" aria-label="移出${escapeHtml(person.name)}">移出</button></div>`}
    </div>`).join('');
  syncMembersHeader();
}
function closeMemberPicker() {
  memberPicker.hidden = true;
  selectedMembers.clear();
  memberSearch.value = '';
  document.querySelector('#add-members').hidden = false;
}
function openMembers() {
  if (!currentProject) return;
  memberProjectId = currentProject;
  document.querySelector('#member-project-title').textContent = projects[memberProjectId].title;
  closeMemberPicker();renderMembers();
  memberFeedback('本地演示 · 成员修改在刷新后重置');
  memberDialog.showModal();
}
function renderMemberCandidates() {
  const query = memberSearch.value.trim().toLocaleLowerCase();
  const candidates = membership.candidates(memberProjectId);
  const matches = candidates.filter(person => person.name.toLocaleLowerCase().includes(query));
  document.querySelector('#member-candidates').innerHTML = matches.map(person => `<label class="member-candidate"><input type="checkbox" value="${person.id}" ${selectedMembers.has(person.id)?'checked':''}>${memberAvatar(person)}<span class="member-name">${escapeHtml(person.name)}<small>${escapeHtml(person.detail)}</small></span></label>`).join('') || `<p class="member-candidate-empty">${candidates.length?'没有找到这个成员':'工作空间的成员都已加入'}</p>`;
  syncMemberSelection();
}
function syncMemberSelection() {
  const button = document.querySelector('#confirm-add-members');
  button.disabled = selectedMembers.size === 0;
  button.textContent = selectedMembers.size ? `添加 ${selectedMembers.size} 位成员` : '添加';
}
document.querySelector('#members-button').addEventListener('click',openMembers);
document.querySelector('#close-members').addEventListener('click',()=>memberDialog.close());
memberDialog.addEventListener('close',()=>{closeMemberPicker();document.querySelector('#members-button').focus();});
document.querySelector('#add-members').addEventListener('click',()=>{
  closeMemberPicker();memberPicker.hidden=false;document.querySelector('#add-members').hidden=true;
  renderMemberCandidates();memberSearch.focus();
});
document.querySelector('#cancel-add-members').addEventListener('click',()=>{closeMemberPicker();document.querySelector('#add-members').focus();});
memberSearch.addEventListener('input',renderMemberCandidates);
document.querySelector('#member-candidates').addEventListener('change',event=>{
  const checkbox=event.target.closest('input[type="checkbox"]');
  if(!checkbox)return;
  if(checkbox.checked)selectedMembers.add(checkbox.value);else selectedMembers.delete(checkbox.value);
  syncMemberSelection();
});
memberPicker.addEventListener('submit',event=>{
  event.preventDefault();
  if(!selectedMembers.size)return;
  try {
    const added=membership.add(memberProjectId,'me',[...selectedMembers]);
    closeMemberPicker();renderMembers();document.querySelector('#add-members').focus();
    memberFeedback(`已添加 ${added.length} 位成员。`);
  }catch(error){memberFeedback(error.message,true);}
});
document.querySelector('#member-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-remove-member]');
  if(!button)return;
  try {
    const id=button.dataset.removeMember;
    membership.remove(memberProjectId,'me',id);
    renderMembers();if(!memberPicker.hidden)renderMemberCandidates();
    (memberPicker.hidden ? document.querySelector('#add-members') : memberSearch).focus();
    memberFeedback(`已将${membership.people.get(id).name}移出群聊，可通过“添加成员”重新加入。`);
  }catch(error){memberFeedback(error.message,true);}
});
document.querySelector('#member-list').addEventListener('change',event=>{
  const select=event.target.closest('[data-member-role]');
  if(!select)return;
  try {
    membership.setRole(memberProjectId,'me',select.dataset.memberRole,select.value);
    memberFeedback(`${membership.people.get(select.dataset.memberRole).name}已设为${select.value==='admin'?'管理员':'成员'}。`);
  }catch(error){renderMembers();memberFeedback(error.message,true);}
});

let contextProjectId = null;
function showProjectManager() {
  document.querySelector('#project-manager-view').hidden=false;
  document.querySelector('#project-context-view').hidden=true;
  projectDialog.setAttribute('aria-labelledby','project-manager-title');
  document.querySelector('#project-manager-feedback').textContent='本地演示 · 项目修改在刷新后重置';
}
function openProjectContext(id) {
  contextProjectId=id;
  const context=directory.getContext(id);
  document.querySelector('#context-project-name').textContent=projects[id].title;
  document.querySelector('#context-content').value=context;
  document.querySelector('#context-error').hidden=true;
  document.querySelector('#project-manager-view').hidden=true;
  document.querySelector('#project-context-view').hidden=false;
  projectDialog.setAttribute('aria-labelledby','project-context-title');
  projectDialog.scrollTop=0;
  document.querySelector('#context-content').focus();
}
function returnToProjectManager() {
  showProjectManager();
  projectDialog.querySelector(`[data-context="${contextProjectId}"]`)?.focus();
}
document.querySelector('#close-context').addEventListener('click',()=>projectDialog.close());
document.querySelector('#cancel-context').addEventListener('click',returnToProjectManager);
document.querySelector('#context-form').addEventListener('submit',event=>{
  event.preventDefault();
  try {
    directory.saveContext(contextProjectId,document.querySelector('#context-content').value);
    returnToProjectManager();
    document.querySelector('#project-manager-feedback').textContent='上下文已保存 · 本地演示，刷新后重置';
  }catch(error){const node=document.querySelector('#context-error');node.textContent=error.message;node.hidden=false;}
});

document.addEventListener('change', event => {
  const picker = event.target.closest('[data-fixture-picker]');
  if (!picker || !picker.value || !currentProject) return;
  const entry = snapshotCatalog.entries.find(e => e.ref.snapshotId === picker.value && e.scope.projectId === currentProject);
  if (!entry) return;
  list.insertAdjacentHTML('beforeend', message('agent', `<p class="message-text">打开${escapeHtml(entry.label)}，此前消息仍引用原快照。</p>${snapshot(currentProject, entry.ref.snapshotId)}`));
  picker.value = ''; histories[currentProject] = list.innerHTML; scrollDown();
});
document.addEventListener('click', event => {
  const reload = event.target.closest('[data-reload-snapshot]');
  if (!reload) return;
  const viewer = reload.closest('.snapshot-container').querySelector('snapshot-viewer');
  viewer.replaceWith(viewer.cloneNode(false));
});
