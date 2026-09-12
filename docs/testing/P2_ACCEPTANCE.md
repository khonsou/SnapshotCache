# P2 验收证据（开发中）

日期：2026-09-12

状态：本地生产纵向切片通过；目标 Timeline 真实取数因服务端密码未配置而待验收。2026-09-12 产品路线调整后，真实 Sites D1/R2 不再是首发阻断项；本记录不等于公司 OAuth 或阿里云生产验收。

路线说明：D1/R2 相关检查继续记录原型能力，但生产首发以 `docs/PRODUCTION_RELEASE_PLAN_2026-09-12.md` 为准。首发允许无状态，必须明确刷新和历史回放限制。

## 可恢复基线

- P1 基线 commit：`bb24a09 Complete P1 snapshot foundation and approve P2 plan`
- 本地源码备份：`.backups/source-2026-09-11T13-18-02-910Z.tgz`
- 本次未发布，未应用 D1 迁移，未写入真实 R2。

## 2026-09-11 已执行检查

- `npm test`：28/28 通过。
- `npm run build`：通过；统一生成前端和 Worker，构建期校验 7 个 dummy 快照。
- `npm run test:e2e`：20/20 通过，Chromium 与 WebKit 各 10 个场景。
- `npm audit --omit=dev --json`：生产依赖 0 个已知漏洞。
- `npm audit --json`：4 个 moderate，均为开发期 `drizzle-kit` 的间接依赖链；未进入 Worker 运行时，npm 当前建议的修复是不兼容降级，因此未强制修复。

## 2026-09-12 已执行检查

- `npm test`：35/35 通过；新增用户项目上下文作为唯一 Timeline 连接记录、密码对 DeepSeek／响应脱敏、无完整连接不访问，以及配置 Timeline 后仍正常回答工作无关问题的回归测试。
- `npm run build`：通过；构建期仍校验 7 个明确标注的 dummy fixture，未读取 `.env`。
- `npm run test:e2e`：24/24 通过，Chromium 与 WebKit 各 12 个场景；覆盖用户创建项目、在唯一上下文配置 Timeline、内联完整包隔离加载、刷新后消失，以及删除项目连同本地上下文和对话。
- `node --env-file=.env scripts/eval-live-model.mjs`：真实 DeepSeek 普通文本调用成功；真实 DeepSeek 选择 `timeline_read_board` 工具后，使用受控模拟 Timeline 响应生成并校验完整快照成功，repairCount=0、4 个资源、9,375 字节。此项未访问真实 Timeline 看板。
- Timeline 公开探测：目标前缀下 `/api/meta` 返回 protocol 19.2、server 1.0.0、`items.read` 等能力与限额；根域同名端点返回 404。公开 `/api/agent-doc` 为降级摘要。

## 已覆盖

- 只在明确快照／看板／报告等语义下自动分流，或由受控调用者显式指定快照；普通文本对话回归。
- SnapshotDraft 严格字段、MIME、大小和 ID 校验；模型不能设置受信 ID、scope、query 或 hash。
- 首次候选失败时只回馈结构化错误码，最多修复一次；第二次失败记录 failed，不生成目录。
- 恶意表现层反例在候选校验阶段被拒绝并修复；P1 CSP/沙箱的网络、宿主读取和自导航反例继续通过。
- 同一用户／项目／幂等键只提交一次；重放不再调用模型。
- 不同用户或项目读取目录、manifest 和资源时返回 404。
- 存储失败会把 run 收敛为 failed，不保留 staging 成功假象。
- 动态快照可在当前回复打开；首发无持久化路径刷新后消失，不显示项目生成历史。
- 无 D1/R2 时可返回完整内联包，由当前页面沿用同一校验／隔离链路加载；界面明确提示刷新后消失。
- 用户项目的对话与上下文共享生命周期；Timeline 地址、board ID 和密码由上下文声明，不维护独立服务器项目／连接注册表。原始上下文是唯一配置，密码仅在发给 DeepSeek 的副本中脱敏。
- 模型仅能调用一个只读 Timeline 工具；目标实例、board 和密码引用不可由模型改变，密码与 token 未进入模型请求或快照。
- 已配置 Timeline 项目中的读取、查询、最新状态和项目进展类请求会从 `auto` 路由到快照工具链；普通概念讨论仍保留文本回复，且不再错误宣称系统没有 HTTP／Timeline 工具。
- 项目上下文不限制话题；配置 Timeline 的项目仍会把工作无关问题作为普通 DeepSeek 对话处理，不强行拉回项目。

## 原 P2 尚未执行的验收

1. 在真实 Sites 预览／发布环境应用 Drizzle 迁移，验证 D1 事务、R2 条件写、回读 hash 和跨请求回放；该项已移到发布后存储选型，不阻断无状态首发。
2. 用完整固定问题集执行真实模型评测，记录首次／修复后合规率、字节量、延迟和错误类型；当前只完成普通文本及一类工具快照最小样本。
3. 用真实 Timeline 响应产生至少两种结构明显不同的页面，逐字段对照并进行产品体验验收；当前因密码未配置而未执行。
4. 发布前重跑全量检查；实际发布环境改为优先评估阿里云，不再预设 Sites 版本或 D1/R2 迁移。
