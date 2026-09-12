'use strict';

// Demo workspace directory and per-project membership. No external invitations.
const workspacePeople = [
  {id:'me', name:'林安', detail:'产品设计', initial:'林', avatar:'me'},
  {id:'lu', name:'陆遥', detail:'项目负责人', initial:'陆', avatar:'lu'},
  {id:'qiao', name:'乔一', detail:'品牌设计', initial:'乔', avatar:'qiao'},
  {id:'chen', name:'陈序', detail:'前端开发', initial:'陈', avatar:'me'},
  {id:'xu', name:'许知', detail:'内容运营', initial:'许', avatar:'qiao'},
  {id:'zhou', name:'周予', detail:'数据分析', initial:'周', avatar:'lu'}
];

class ProjectMembers {
  constructor(people, ownerId) {
    this.people = new Map(people.map(person => [person.id, person]));
    if (!this.people.has(ownerId)) throw new Error('群主必须属于工作空间。');
    this.ownerId = ownerId;
    this.groups = new Map();
  }

  ensure(projectId) {
    if (!projectId) throw new Error('请先选择项目。');
    if (!this.groups.has(projectId)) this.groups.set(projectId, new Map([[this.ownerId, 'owner']]));
    return this.groups.get(projectId);
  }

  list(projectId) {
    return [...this.ensure(projectId)].map(([id, role]) => ({...this.people.get(id), role}));
  }

  candidates(projectId) {
    const group = this.ensure(projectId);
    return [...this.people.values()].filter(person => !group.has(person.id));
  }

  requireManager(projectId, actorId) {
    const role = this.ensure(projectId).get(actorId);
    if (role !== 'owner' && role !== 'admin') throw new Error('只有群主或管理员可以管理成员。');
    return role;
  }

  add(projectId, actorId, ids) {
    this.requireManager(projectId, actorId);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.some(id => !this.people.has(id))) throw new Error('只能添加工作空间内的成员。');
    const group = this.ensure(projectId);
    const added = uniqueIds.filter(id => !group.has(id));
    added.forEach(id => group.set(id, 'member'));
    return added;
  }

  setRole(projectId, actorId, targetId, role) {
    const group = this.ensure(projectId);
    if (group.get(actorId) !== 'owner') throw new Error('只有群主可以调整管理员。');
    if (!group.has(targetId)) throw new Error('该成员已不在群聊中。');
    if (group.get(targetId) === 'owner') throw new Error('群主身份不能在这里修改。');
    if (!['admin', 'member'].includes(role)) throw new Error('请选择有效的成员角色。');
    group.set(targetId, role);
  }

  remove(projectId, actorId, targetId) {
    const actorRole = this.requireManager(projectId, actorId);
    const group = this.ensure(projectId);
    const targetRole = group.get(targetId);
    if (!targetRole) throw new Error('该成员已不在群聊中。');
    if (targetRole === 'owner') throw new Error('不能移出群主。');
    if (targetRole === 'admin' && actorRole !== 'owner') throw new Error('只有群主可以移出管理员。');
    group.delete(targetId);
  }

  removeProject(projectId) { this.groups.delete(projectId); }
}
