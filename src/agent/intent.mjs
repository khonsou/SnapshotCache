const SNAPSHOT_TERMS = /(?:生成|做|整理|展示|画|创建).{0,12}(?:快照|可视化|图表|看板|报告|时间线|表格|仪表盘)|(?:快照|可视化|图表|看板|报告|时间线|表格|仪表盘).{0,12}(?:生成|做|整理|展示|画|创建)/i;

export function decideResponseMode(text, requested = 'auto') {
  if (!['auto', 'text', 'snapshot'].includes(requested)) throw new Error('Invalid response mode');
  if (requested !== 'auto') return requested;
  return SNAPSHOT_TERMS.test(String(text || '')) ? 'snapshot' : 'text';
}

export function validProjectKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}
