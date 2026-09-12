'use strict';

// In-memory project organization for the presentation prototype.
class ProjectDirectory {
  constructor(projects) {
    this.projects = projects;
    this.archived = new Set();
    this.sequence = 0;
    this.contexts = new Map();
  }

  list(archived = false) {
    return Object.entries(this.projects)
      .filter(([id]) => this.archived.has(id) === archived)
      .map(([id, project]) => ({ id, title: project.title }));
  }

  validateName(value, exceptId) {
    const name = value.trim();
    if (!name) throw new Error('请输入项目名称。');
    if (name.length > 40) throw new Error('项目名称最多 40 个字符。');
    if (Object.entries(this.projects).some(([id, p]) => id !== exceptId && p.title.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('这个项目名称已存在，请换一个名称。');
    }
    return name;
  }

  create(value) {
    const title = this.validateName(value);
    const id = `local-${++this.sequence}`;
    this.projects[id] = {title, isNew: true, subtitle: '', summary: '', metrics: [], channels: [], tasks: [], bars: []};
    return id;
  }

  rename(id, value) {
    if (!Object.hasOwn(this.projects, id)) throw new Error('项目不存在。');
    this.projects[id].title = this.validateName(value, id);
  }

  archive(id) {
    if (!Object.hasOwn(this.projects, id)) throw new Error('项目不存在。');
    this.archived.add(id);
  }

  restore(id) { this.archived.delete(id); }

  remove(id) {
    if (!Object.hasOwn(this.projects, id)) throw new Error('项目不存在。');
    delete this.projects[id];
    this.archived.delete(id);
    this.contexts.delete(id);
  }

  getContext(id) {
    if (!Object.hasOwn(this.projects, id)) throw new Error('项目不存在。');
    return this.contexts.get(id) || '';
  }

  saveContext(id, content) {
    if (!Object.hasOwn(this.projects, id)) throw new Error('项目不存在。');
    if (content.length > 10000) throw new Error('项目上下文最多 10,000 个字符。');
    this.contexts.set(id, content.trim());
  }
}
