const SNAPSHOT_TERMS = /(?:生成|做|整理|展示|画|创建).{0,12}(?:快照|可视化|图表|看板|报告|时间线|表格|仪表盘)|(?:快照|可视化|图表|看板|报告|时间线|表格|仪表盘).{0,12}(?:生成|做|整理|展示|画|创建)/i;
const TIMELINE_SOURCE_TERMS = /(?:timeline|agent\s*support|数据源|看板|卡片|事项)/i;
const FRESH_DATA_TERMS = /(?:读取|获取|拉取|查询|查看|看看|同步|刷新|调用|接入|分析|汇总|总结|核对|最新|当前|现在|现状|进展|进度|状态)/i;
const PROJECT_STATUS_TERMS = /(?:项目|看板).{0,12}(?:最新|当前|现在|现状|进展|进度|状态|情况|怎么样)|(?:最新|当前|现在|现状).{0,12}(?:项目|看板|进展|进度|状态|情况)/i;

export function decideResponseMode(text, requested = 'auto', { sourceType = null } = {}) {
  if (!['auto', 'text', 'snapshot'].includes(requested)) throw new Error('Invalid response mode');
  if (requested !== 'auto') return requested;
  const value = String(text || '');
  if (SNAPSHOT_TERMS.test(value)) return 'snapshot';
  if (sourceType === 'timeline' && ((TIMELINE_SOURCE_TERMS.test(value) && FRESH_DATA_TERMS.test(value)) || PROJECT_STATUS_TERMS.test(value))) return 'snapshot';
  return 'text';
}

export function validProjectKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}
