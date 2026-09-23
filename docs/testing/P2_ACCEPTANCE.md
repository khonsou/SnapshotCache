# P2 验收证据（开发中）

日期：2026-09-21

状态：Claude Code Agent Runtime 重构已通过 Node 测试、构建、浏览器回归和真实 DeepSeek 冒烟；目标 Timeline 真实读取已由人工验收，受控 change-set 写入待验收。2026-09-12 产品路线调整后，真实 Sites D1/R2 不再是首发阻断项；本记录不等于公司 OAuth 或阿里云生产验收。

2026-09-21 已实现最小 DAO OAuth 登录门禁，但真实 DAO 仅允许生产回调；以下自动化证据不等于真实 DAO 登录验收，也不包含 tag 项目授权。

路线说明：D1/R2 相关检查继续记录快照存储原型能力，但生产首发以 `docs/PRODUCTION_RELEASE_PLAN.md` 为准。快照历史可暂不持久化，必须明确刷新和历史回放限制；真实项目聚合持久化是生产前提。

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

- `npm test`：40/40 通过；覆盖项目上下文编译通用 HTTP 工具、HTTPS 路径边界、读取／登录方法边界、密码和响应 token 的宿主引用、多轮鉴权取数、接入说明缺少绝对地址时禁止静默退化、模型错误否认已挂载工具时强制首次调用、工作无关问题、快照兼容路径和 DeepSeek 网页搜索。
- `npm run build`：通过；构建期仍校验 7 个明确标注的 dummy fixture，未读取 `.env`。
- `npm run test:e2e`：24/24 通过，Chromium 与 WebKit 各 12 个场景；覆盖用户创建项目、在唯一上下文配置 Timeline、内联完整包隔离加载、刷新后消失，以及删除项目连同本地上下文和对话。
- `node --env-file-if-exists=.env scripts/eval-live-model.mjs`：真实 DeepSeek 普通文本调用成功；面对“这个看板一共有多少张卡片”时按上下文连续执行 `GET meta → GET agent-doc → POST auth → GET items`，回答“1 张卡片”并标明数据来源。密码和 token 均未进入模型请求。隔离的快照兼容用例也通过，repairCount=0、4 个资源、8,804 字节。工具 HTTP 响应为受控模拟数据，此项未使用真实看板密码。
- Timeline 公开探测：目标前缀下 `/api/meta` 返回 protocol 19.2、server 1.0.0、`items.read` 等能力与限额；根域同名端点返回 404。公开 `/api/agent-doc` 为降级摘要。

以上 2026-09-12 在线模型／工具循环证据属于重构前实现，仅作为历史记录，不代表当前 Claude Code Runtime 已完成目标 Timeline 验收。

## 2026-09-13 Agent Runtime 重构证据

- 撤销未提交的拒绝纠正／调用轨迹补丁；删除关键词响应分流、实时搜索判断、拒绝话术正则、强制工具调用和候选 prompt 修复循环。
- 固定 `@anthropic-ai/claude-code@2.1.270`；Claude Code 只作为服务器端 Agent 执行框架，本地 Node 每个请求启动无持久化会话，模型 endpoint、key 与计费均使用 DeepSeek，并只加载请求级 MCP。
- `npm test`：41/41 通过；新增 Agent Runtime 注入、失败关闭、临时目录、项目内固定二进制、工具白名单、MCP 快照提交、密钥隔离，以及“询问现有看板必须文本回答”的 Agent 合约测试。
- `npm run build`：通过；构建期校验 7 个 dummy fixture。Worker 不具备 Node 子进程 Runtime 时聊天明确失败，不回退到普通模型补全。
- 真实 DeepSeek 文本冒烟：Claude Code Runtime 返回有效 session、Agent turns 和 `provider: deepseek`／`model: deepseek-v4-flash`，正常文本结果。
- 真实 DeepSeek 快照冒烟：Claude Code Runtime 在 2 个 Agent turns 中实际调用 `submit_snapshot`，宿主生成 `项目进度快照` 并通过统一快照校验，来源正确标为 `user-provided`。
- 真实 DeepSeek 项目 HTTP 冒烟：请求经 `POST /api/chat` 进入 Claude Code Runtime，在 2 个 Agent turns 中实际调用 `project_http_request`，成功读取目标 Timeline 前缀下的公开 `/api/meta`，返回 protocol 19.2、server 1.0.0、能力和限额；响应含真实 session ID 及工具调用记录。此项未使用项目密码，不代表 auth／items 已验收。
- 与人工问题相同的“统计项目看板总卡片数，其中未完成多少”使用 `responseMode: auto` 实测返回 `mode: text`，只调用 `project_http_request`，未调用 `submit_snapshot`；无密码诊断从公开 boards 列表确认总数 177，对需要卡片明细的未完成数明确报告需鉴权。
- 真实 DeepSeek WebSearch 冒烟：升级 Claude Code 2.1.270 并移除会禁用服务器侧工具的 `--bare` 后，DeepSeek `deepseek-v4-flash` 在 2 个 Agent turns 中实际调用 WebSearch，返回 DeepSeek 官方文档标题与 URL。
- 多步失败根因：旧运行时的默认 `--max-budget-usd 0.20` 使用框架成本估算提前终止，错误 subtype 为 `error_max_budget_usd`；默认预算上限已移除，仅在运维显式配置正数时启用，HTTP 超时和并发限制继续生效。
- `npm run test:e2e`：24/24 通过，Chromium 与 WebKit 各 12 个场景；覆盖项目创建、上下文配置、聊天／快照现有交互、刷新重置和项目删除清理。
- 2026-09-14 人工验收确认目标 Timeline 真实读取已通过。宿主随后开放受控 `POST .../change-sets` 和带 `Idempotency-Key` 的 `POST .../change-sets/:id/commit`；单元测试覆盖合法提案，以及任意 POST、非法结构和缺失幂等键的拒绝。本轮未向真实看板发送写请求。
- 加入 Markdown 表现层依赖后，`npm audit --omit=dev --json` 报告 15 个生产依赖中 0 个已知漏洞；完整依赖树仍有 4 个 moderate 开发依赖问题。

## 已覆盖

- 2026-09-22 Agent 执行记录执行 `npm run check`：52/52 Node、Worker 构建、7 个 fixture 通过；执行 `npm run test:e2e`：32/32 Chromium／WebKit 通过。覆盖多数据源逐次编号、读取／鉴权类别、真实状态码与耗时、失败标注、中断后未确认返回、最终回复折叠记录、默认收起、窄宽度横向滚动与减少动态效果，以及 URL／响应／密钥不进入进度事件。另以真实 DeepSeek Runtime 对 Timeline 公开根路径做只读冒烟：模型发起 6 次 `project_http_request`，每次均收到实际 404，步骤编号、失败状态和耗时正确上报；这不构成目标看板读取验收。真实 DeepSeek 页面会话和阿里云代理流式转发仍待人工验收。
- 2026-09-21 Agent 进度流执行 `npm run check`：52/52 Node、Worker 构建、7 个 fixture 通过；执行 `npm run test:e2e`：30/30 Chromium／WebKit 通过。验证真实运行时的工具事件映射、进度先于最终结果、旧 JSON 兼容、工具参数／密钥不进入进度事件，以及页面中状态和等待时间先于最终回复出现。阿里云代理流式转发与真实长耗时 DeepSeek 会话尚未人工验收。
- 2026-09-21 在临时本机 4187 服务执行 HTTP 冒烟：`/api/chat` 响应为 `text/event-stream`、`X-Accel-Buffering: no`，先收到 `progress: accepted`，再收到最终 503（刻意不提供模型密钥），证明本地 Node 传输层不会缓存全部事件；未调用 DeepSeek。测试服务已停止。
- 2026-09-21 OAuth Phase 0 执行 `npm run check`：49/49 Node、Worker 构建和 7 个 fixture 通过；新增 BFF Authorization Code + PKCE、state、一次性 transaction、默认不发送 `client_id`、JWT `user_id/user_name` 身份、可选 profile 查询、内存 session、过期、退出、生产 cookie、开放重定向、跨站退出、无效端点失败关闭、身份 header 伪造，以及生产模式拒绝 HTTP OAuth 和测试绕过。真实 DAO 登录仍需在已登记的 HTTPS 回调域名验收。
- 2026-09-21 执行 `npm run test:e2e`：28/28 通过，Chromium 与 WebKit 各 14 个场景；新增未登录时只显示 DAO 登录墙、项目工作区不渲染的浏览器验证，登录后的原有 GUI、对话、快照和项目管理回归保持通过。浏览器回归使用显式 `XUYAN_AUTH_BYPASS=true`，不代表真实 OAuth 服务联调。

- 2026-09-14 受控写权限变更后重跑 `npm run check`：41/41 Node 通过，Worker 构建和 7 个 fixture 校验通过。
- 2026-09-14 重跑 `npm run test:e2e`：24/24 通过，Chromium 与 WebKit 各 12 个场景。
- 2026-09-14 Markdown 表现层变更后再次执行 `npm run check`：41/41 Node、Worker 构建和 7 个 fixture 通过；`npm run test:e2e`：26/26 通过。新场景在 Chromium 与 WebKit 验证标题、列表、表格、代码块、引用、外链、用户纯文本保留，以及 script／img 不进入 DOM。
- 2026-09-14 产品负责人已在本地对话页完成 Markdown 表现层人工验收并确认通过。
- 写入工具单元证据使用模拟 HTTP 宿主，未向真实 Timeline 提交 change-set；真实写入结果必须以页面手工测试与写后回读为准。

- 每轮请求都进入 Agent Runtime；Agent 根据完整对话理解明确的快照／可视化要求，或遵循受控调用者显式模式。读取看板和卡片等普通问答保持文本回复，宿主不做语义关键词匹配。
- SnapshotDraft 严格字段、MIME、大小和 ID 校验；模型不能设置受信 ID、scope、query 或 hash。
- Agent 通过 `submit_snapshot` MCP 提交一次完整候选；候选校验失败即明确失败，不用宿主 prompt 规则尝试修复，也不生成目录。
- 恶意表现层反例在候选校验阶段被拒绝；P1 CSP/沙箱的网络、宿主读取和自导航反例继续通过。
- 同一用户／项目／幂等键只提交一次；重放不再调用模型。
- 不同用户或项目读取目录、manifest 和资源时返回 404。
- 存储失败会把 run 收敛为 failed，不保留 staging 成功假象。
- 动态快照可在当前回复打开；首发无持久化路径刷新后消失，不显示项目生成历史。
- 无 D1/R2 时可返回完整内联包，由当前页面沿用同一校验／隔离链路加载；界面明确提示刷新后消失。
- 用户项目的对话与上下文共享生命周期；上下文同时承载背景、数据源配置和 Agent 操作说明，不维护独立服务器项目／连接注册表。密码在模型请求中替换为宿主引用，认证响应中的 token 同样以引用参与后续 HTTP 调用。
- Claude Code Runtime 没有 Bash、文件读写或任意 WebFetch；只开放 WebSearch、限定到上下文 HTTPS 路径的 `project_http_request` 和 `submit_snapshot`。项目 HTTP 宿主只允许 GET、登录 auth POST、校验后的 change-set 创建和带幂等键 commit；密码与响应 token 只存在于临时 MCP 宿主引用中。
- 上下文列出 HTTPS 数据源时，每轮 Agent 会话都加载相应 `project_http_request`；是否调用以及调用步骤由 Agent 结合完整对话决定，不再由 Timeline 类型、末条消息关键词或拒绝话术正则驱动。
- 上下文没有绝对 HTTPS 地址时仍正常进入 Agent Runtime，只是不挂载项目 HTTP 工具；宿主不再用“像不像 Agent 指南”的正则提前拒绝请求。
- 项目上下文不限制话题；配置 Timeline 的项目仍会把工作无关问题作为普通 DeepSeek 对话处理，不强行拉回项目。
- 普通对话由 Claude Code Runtime 使用 DeepSeek 官方 Anthropic 兼容接口；WebSearch 是允许的运行时工具，是否使用由 Agent 决定。

## 原 P2 尚未执行的验收

1. 在真实 Sites 预览／发布环境应用 Drizzle 迁移，验证 D1 事务、R2 条件写、回读 hash 和跨请求回放；该项已移到发布后存储选型，不阻断无状态首发。
2. 用完整固定问题集执行真实模型评测，记录首次／修复后合规率、字节量、延迟和错误类型；当前只完成普通文本及一类工具快照最小样本。
3. 用真实 Timeline 响应产生至少两种结构明显不同的页面，逐字段对照并进行产品体验验收；当前因密码未配置而未执行。
4. 发布前重跑全量检查；实际发布环境改为优先评估阿里云，不再预设 Sites 版本或 D1/R2 迁移。
