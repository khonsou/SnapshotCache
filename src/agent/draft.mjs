import { hashJSON } from '../snapshot/json.mjs';
import { packSnapshot } from '../snapshot/pack.mjs';
import { validatePackage } from '../snapshot/validate.mjs';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const mediaExtensions = new Map([
  ['application/json', 'json'],
  ['text/csv', 'csv'],
  ['text/markdown', 'md'],
  ['text/plain', 'txt'],
]);

function candidateError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function extractJSONObject(content) {
  let value = content.trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1];
  try { return JSON.parse(value); }
  catch { throw candidateError('draft_json_invalid'); }
}

export function parseSnapshotDraft(content) {
  const value = extractJSONObject(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw candidateError('draft_shape_invalid');
  const allowed = new Set(['mode', 'reply', 'title', 'datasets', 'presentation', 'notes']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw candidateError('draft_field_unknown');
  if (value.mode !== 'snapshot') throw candidateError('draft_mode_invalid');
  if (typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 6000) throw candidateError('draft_reply_invalid');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) throw candidateError('draft_title_invalid');
  if (!Array.isArray(value.datasets) || value.datasets.length < 1 || value.datasets.length > 8) throw candidateError('draft_datasets_invalid');
  const ids = new Set();
  const datasets = value.datasets.map(dataset => {
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) throw candidateError('draft_dataset_invalid');
    if (Object.keys(dataset).some(key => !['id', 'mediaType', 'content'].includes(key))) throw candidateError('draft_dataset_field_unknown');
    if (!idPattern.test(dataset.id) || ids.has(dataset.id)) throw candidateError('draft_dataset_id_invalid');
    ids.add(dataset.id);
    if (!mediaExtensions.has(dataset.mediaType)) throw candidateError('draft_dataset_media_invalid');
    let body;
    if (dataset.mediaType === 'application/json') {
      if (dataset.content === undefined) throw candidateError('draft_dataset_content_invalid');
      try { body = JSON.stringify(dataset.content, null, 2) + '\n'; }
      catch { throw candidateError('draft_dataset_content_invalid'); }
    } else {
      if (typeof dataset.content !== 'string') throw candidateError('draft_dataset_content_invalid');
      body = dataset.content;
    }
    return { id: dataset.id, mediaType: dataset.mediaType, body };
  });
  const presentation = value.presentation;
  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation) || Object.keys(presentation).some(key => !['html', 'initialState'].includes(key))) throw candidateError('draft_presentation_invalid');
  if (typeof presentation.html !== 'string' || presentation.html.length < 40 || presentation.html.length > 900000) throw candidateError('draft_html_invalid');
  if (presentation.initialState !== undefined && (!presentation.initialState || typeof presentation.initialState !== 'object' || Array.isArray(presentation.initialState))) throw candidateError('draft_state_invalid');
  if (value.notes !== undefined && (!Array.isArray(value.notes) || value.notes.length > 20 || value.notes.some(note => typeof note !== 'string' || note.length > 500))) throw candidateError('draft_notes_invalid');
  return {
    reply: value.reply.trim(),
    title: value.title.trim(),
    datasets,
    html: presentation.html,
    initialState: presentation.initialState,
    notes: value.notes || [],
  };
}

export async function buildQueryContext({ scope, project, context, text, createdAt, requestedMode, source = null, policyVersion = 'p2-owner-scope-v1' }) {
  const selectedSource = source || { sourceId: 'user-provided', revision: null, observedAt: createdAt };
  return {
    identity: {
      intent: { name: 'agent.snapshot.generate', version: 'p2-1' },
      parameters: { project, request: text },
      contextHash: context ? await hashJSON({ context }) : null,
      authorization: { scopeHash: await hashJSON(scope), policyVersion },
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      sourceSelections: [{ sourceId: selectedSource.sourceId, revision: selectedSource.revision ?? null }],
      presentationRequest: { runtime: 'web/1', responseMode: requestedMode },
    },
    observations: [{ sourceId: selectedSource.sourceId, revision: selectedSource.revision ?? null, observedAt: selectedSource.observedAt }],
    originalText: text,
  };
}

export async function buildSnapshotCandidate({ draft, snapshotId, scope, createdAt, query, model, contractVersion = 'p2-1', source = null }) {
  const resources = [{ id: 'query.context', path: 'query.json', mediaType: 'application/json', body: JSON.stringify(query, null, 2) + '\n' }];
  const datasets = [];
  for (const dataset of draft.datasets) {
    const resourceId = `data.${dataset.id}`;
    resources.push({ id: resourceId, path: `data/${dataset.id}.${mediaExtensions.get(dataset.mediaType)}`, mediaType: dataset.mediaType, body: dataset.body });
    datasets.push({ id: dataset.id, entryResourceId: resourceId, resourceIds: [resourceId] });
  }
  const presentationIds = ['view.index'];
  resources.push({ id: 'view.index', path: 'presentation/index.html', mediaType: 'text/html', body: draft.html });
  if (draft.initialState !== undefined) {
    presentationIds.push('view.state');
    resources.push({ id: 'view.state', path: 'presentation/state.json', mediaType: 'application/json', body: JSON.stringify(draft.initialState, null, 2) + '\n' });
  }
  const packed = await packSnapshot({
    snapshotId,
    scope,
    createdAt,
    query,
    datasets,
    presentation: {
      runtime: 'web', runtimeVersion: '1', entryResourceId: 'view.index', resourceIds: presentationIds,
      bindings: Object.fromEntries(draft.datasets.map(dataset => [dataset.id, dataset.id])),
      ...(draft.initialState !== undefined ? { initialStateResourceId: 'view.state' } : {}),
    },
    resources,
    extensions: { 'com.xuyan.generation': {
      simulated: !source,
      sourceKind: source ? 'timeline' : 'user-provided',
      model,
      contractVersion,
      notes: draft.notes,
      ...(source ? { source: { sourceId: source.sourceId, revision: source.revision ?? null, observedAt: source.observedAt, protocolVersion: source.protocolVersion, boardId: source.boardId } } : {}),
    } },
  });
  const ref = { snapshotId, manifestHash: packed.manifest.integrity.manifestHash };
  const pkg = await validatePackage(packed.bytes, packed.files, ref, scope);
  return { ...packed, ...pkg, ref, title: draft.title };
}
