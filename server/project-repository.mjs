import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ID = /^p-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const FILE = /^p-[0-9a-f-]{36}\.json$/u;

export class ProjectRepositoryError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function titleOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new ProjectRepositoryError('project_title_invalid', 400);
  return value.trim();
}

function contextOf(value) {
  if (typeof value !== 'string' || value.length > 10000) throw new ProjectRepositoryError('project_context_invalid', 400);
  return value.trim();
}

function secretKey(raw) {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]{43}=$/u.test(raw)) throw new ProjectRepositoryError('project_key_invalid', 503);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw new ProjectRepositoryError('project_key_invalid', 503);
  return key;
}

function seal(project, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(project), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
}

function unseal(bytes, key) {
  try {
    const item = JSON.parse(bytes);
    if (item.version !== 1) throw new Error('version');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new ProjectRepositoryError('project_data_unreadable', 503); }
}

export function createFileProjectRepository({ directory, encryptionKey, production = false, now = () => new Date(), idFactory = randomUUID } = {}) {
  if (!directory || typeof directory !== 'string') throw new ProjectRepositoryError('project_directory_missing', 503);
  const root = resolve(directory);
  let key;
  let gate = Promise.resolve();
  const locked = operation => {
    const current = gate.then(operation);
    gate = current.catch(() => {});
    return current;
  };
  const filename = id => {
    if (!ID.test(id || '')) throw new ProjectRepositoryError('project_not_found', 404);
    return join(root, `${id}.json`);
  };
  async function initialize() {
    if (key) return;
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (!(await stat(root)).isDirectory()) throw new ProjectRepositoryError('project_directory_invalid', 503);
    if (encryptionKey) key = secretKey(encryptionKey);
    else {
      if (production) throw new ProjectRepositoryError('project_key_missing', 503);
      const devKey = join(root, '.development-key');
      try { key = secretKey((await readFile(devKey, 'utf8')).trim()); }
      catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const candidate = randomBytes(32).toString('base64');
        try { await writeFile(devKey, candidate, { mode: 0o600, flag: 'wx' }); key = secretKey(candidate); }
        catch (writeError) {
          if (writeError?.code !== 'EEXIST') throw writeError;
          key = secretKey((await readFile(devKey, 'utf8')).trim());
        }
      }
    }
  }
  async function read(id) {
    await initialize();
    try { return unseal(await readFile(filename(id), 'utf8'), key); }
    catch (error) {
      if (error?.code === 'ENOENT') throw new ProjectRepositoryError('project_not_found', 404);
      throw error;
    }
  }
  async function all() {
    await initialize();
    const names = (await readdir(root)).filter(name => FILE.test(name));
    return Promise.all(names.map(name => read(name.slice(0, -5))));
  }
  async function persist(project) {
    const target = filename(project.id);
    const temp = join(root, `.write-${randomUUID()}`);
    try {
      await writeFile(temp, seal(project, key), { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } finally { await unlink(temp).catch(error => { if (error?.code !== 'ENOENT') throw error; }); }
  }
  async function uniqueTitle(title, exceptId) {
    if ((await all()).some(item => item.id !== exceptId && item.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      throw new ProjectRepositoryError('project_title_exists', 409);
    }
  }
  return {
    initialize,
    async list() {
      return (await all()).map(({ id, title, archived, createdAt, updatedAt, createdBy, contextVersion }) => ({ id, title, archived, createdAt, updatedAt, createdBy, contextVersion }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    get: read,
    async create({ title, actorId, actorName }) {
      return locked(async () => {
        const name = titleOf(title);
        await uniqueTitle(name);
        const timestamp = now().toISOString();
        const project = { id: `p-${idFactory()}`, title: name, archived: false, context: '', contextVersion: 1,
          createdBy: actorId, createdAt: timestamp, updatedAt: timestamp, messages: [], lastActorId: actorId, lastActorName: actorName || '' };
        filename(project.id);
        await persist(project);
        return project;
      });
    },
    async update(id, changes, actorId) {
      return locked(async () => {
        const project = await read(id);
        if (Object.hasOwn(changes, 'title')) {
          const name = titleOf(changes.title);
          await uniqueTitle(name, id);
          project.title = name;
        }
        if (Object.hasOwn(changes, 'archived')) {
          if (typeof changes.archived !== 'boolean') throw new ProjectRepositoryError('project_update_invalid', 400);
          project.archived = changes.archived;
        }
        if (Object.hasOwn(changes, 'context')) {
          const context = contextOf(changes.context);
          if (project.context !== context) { project.context = context; project.contextVersion++; }
        }
        project.updatedAt = now().toISOString();
        project.lastActorId = actorId;
        await persist(project);
        return project;
      });
    },
    async appendExchange(id, { message, reply, actorId, actorName, idempotencyKey, snapshotRef = null }) {
      return locked(async () => {
        const project = await read(id);
        const existing = project.messages.find(item => item.role === 'user' && item.idempotencyKey === idempotencyKey);
        if (existing) {
          if (existing.content !== message) throw new ProjectRepositoryError('project_request_replayed', 409);
          return { project, created: false, assistantMessage: project.messages[project.messages.indexOf(existing) + 1] || null };
        }
        const timestamp = now().toISOString();
        project.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: message, actorId, actorName: actorName || actorId, createdAt: timestamp, idempotencyKey });
        const assistantMessage = { id: `msg-${randomUUID()}`, role: 'assistant', content: reply, actorId: 'agent', actorName: '序言', createdAt: timestamp, snapshotRef };
        project.messages.push(assistantMessage);
        project.updatedAt = timestamp;
        project.lastActorId = actorId;
        await persist(project);
        return { project, created: true, assistantMessage };
      });
    },
    async clearConversation(id, actorId) {
      return locked(async () => {
        const project = await read(id);
        project.messages = [];
        project.updatedAt = now().toISOString();
        project.lastActorId = actorId;
        await persist(project);
        return project;
      });
    },
    async remove(id) {
      return locked(async () => {
        await read(id);
        await unlink(filename(id));
      });
    },
  };
}
