# 实现状态 · 2026-09-27

2026-09-27 Phase 2 最小共享项目聚合已实现并通过本地自动化：服务端生成项目 ID，单实例 AES-256-GCM 文件仓库保存项目、上下文、共享文字对话和 actor，重启后恢复，删除级联；聊天只接受项目 ID 与消息并从服务端加载上下文／历史。Node 正式页面使用真实项目 API，不展示演示项目／成员；生产静态路径拒绝 dummy fixture。`npm run check` 通过 57 项 Node 测试、构建及 7 个 fixture；`npm run test:e2e` 通过 Chromium/WebKit 共 34 项。非生产本地 mock OAuth 点击登录流程已添加，生产配置禁止启用。真实 DAO 多员工与 DeepSeek/Timeline 的新链路仍待手工回归；文件仓库仅支持持久卷上的单实例，缓存未实现，不能据此宣布可生产发布。详见 `docs/testing/PHASE_2_PROJECT_PERSISTENCE_2026-09-27.md`。

用户确认真实环境 DAO OAuth 测试与验收已经完成。首发访问规则调整为：所有 DAO 已登录员工均可访问并使用站内共享项目；DAO tag 契约、成员列表及按项目 tag 限制访问后移。随后进行 Phase 4 宿主安全与真实 Agent 数据验收，并在首发前加入跨员工共享的高频只读文本问答缓存。用户确认属于真实环境验收结论；逐项脱敏 OAuth 测试记录尚未归档。生产发布门槛见 `docs/PRODUCTION_RELEASE_PLAN.md`。

以下 2026-09-24 及更早记录保留当时证据，不代表本轮 Phase 2 验收结果。

2026-09-24 部署团队提供的新 `.env` 已原样更新到本机被 Git 忽略的配置文件，文件权限保持 `0600`。原有 3 项配置保留，新增 15 项部署与 DAO OAuth 配置；Node 按生产模式解析后，Scope 为 `profile phone`，公网 origin 与精确回调匹配，现有生产 OAuth 启动配置校验通过。`npm run check` 通过（53 项 Node 测试、构建、7 个 fixture），`npm run test:e2e` 在允许本机监听后通过 32 项。新配置包含非空 `DAO_OAUTH_CLIENT_ID`，但其真实 DAO 契约尚未验证；文件未包含 `NODE_ENV`，部署时仍须由运行环境设为 `production`。这些只是本地配置及自动化证据，尚未部署或完成真实 DAO HTTPS 登录验收。详见 `docs/testing/PHASE_0_DAO_OAUTH_ACCEPTANCE.md`。

2026-09-22 并发／多用户隔离／定时自动化只读审查：当前单实例每用户最多 2 个运行、每分钟最多 20 次，但无整机总并发上限；生产项目准入和服务端可信上下文尚未实现。内存反例复现同项目多数据源秘密串用、已知秘密在普通响应字段中泄露给模型、回环 HTTPS 目标被接受、change-set actor 可由模型自报、同幂等键重复执行与预取消仍 spawn。**按现状阻断多用户生产与定时无人值守运行。** 本轮 `npm run check` 通过 53 项 Node 测试、构建和 7 个 fixture；`npm run test:e2e` 因沙箱禁止回环监听，获准重跑后 32 项通过。真实 DAO、阿里云容量和定时任务未验收。详情见 `docs/testing/CONCURRENCY_MULTIUSER_SCHEDULE_REVIEW_2026-09-22.md`。

GUI、快照协议、DeepSeek Agent Runtime、Timeline 真实只读和最小 DAO OAuth 登录门禁已形成可工作的本地基线。**当前阶段是 Phase 2：最小项目聚合持久化。** 后续收口宿主安全、真实 Agent 数据与项目级只读问答缓存，再做阿里云预发布／生产。快照历史持久化与快照缓存后移；当前尚未发布，权威顺序见 `docs/PRODUCTION_RELEASE_PLAN.md`。

## 2026-09-12 产品路线调整（历史口径，已由统一计划修订）

- 生产环境很可能使用阿里云，不再把 Sites D1/R2 当作既定生产架构。
- 当前 D1/R2、Drizzle、run 和项目生成记录实现保留为可选存储适配器原型，不继续投入真实绑定验收。
- 首发可暂不持久化快照包及其历史回放；后来确认项目准入必须依赖服务端可信的最小项目聚合，因此项目本身、上下文、tag 和对话必须在生产前持久化。
- 首发的硬门槛改为真实 Timeline 数据、真实项目配置、公司 OAuth、服务端授权、快照完整性和 viewer 隔离。
- 更新后的执行计划见 `docs/PRODUCTION_RELEASE_PLAN.md`；原 9 月 12 日计划与 ADR-0003 保留历史背景，按最新澄清理解。

## 已实现的生产首发切片

- 网页请求现在进入固定版本的 Claude Code Agent Runtime；Claude Code 仅作为执行框架，所有推理请求、API key、模型与计费均指向 DeepSeek Anthropic 兼容接口。文本／快照由 Agent 在同一运行时内决定，快照通过 `submit_snapshot` MCP 提交并继续执行严格 `SnapshotDraft` 校验。
- 模型只能产生不可信候选；snapshot/run/message ID、scope、query、时间、hash 和提交状态由服务端生成并复用 P1 统一校验。
- Sites `DB`/`BUCKET` 绑定声明、D1 Drizzle schema 与两个初始迁移；R2 资源先写、回读校验后才在 D1 登记 committed。
- 已保留快照 run、幂等提交和持久化路由原型，首发生产路由当前不启用这些能力。
- 聊天中可校验并展示响应携带的完整快照包；当前页面刷新后消失，不声称已保存或可历史回放。
- Agent 文本回复使用 `marked` 解析 GFM Markdown，再经 `DOMPurify` 白名单净化；已支持标题、列表、任务列表、引用、表格、行内代码、代码块和外链。模型原始 HTML 按文本展示，远程图片不加载；用户消息仍为纯文本。
- 聊天进度使用同一 POST 的可选事件流：Claude Code 原有 `stream-json` 的初始化／工具事件被压缩为固定、安全的状态，页面实时显示每次受控调用的数据源编号、操作类别、可确认的 HTTP 状态、耗时与等待时间。执行记录默认收起，摘要持续显示当前步骤；窄宽度横向滚动并尊重减少动态效果设置，展开列表内部限高。没有新事件时只显示本阶段等待，不虚构模型内部步骤。不将模型思考、工具参数、URL、响应正文或密钥放入进度事件；旧 JSON 客户端仍可使用。阿里云代理是否会缓冲该流待预发布验证。
- Timeline Agent Support 参考适配器仍保留协议发现、密码换 token、分页读取和错误收敛测试；实际对话运行时不解析或注册 Timeline 类型，而是仅按项目上下文中的 HTTPS 范围临时挂载通用 MCP HTTP 工具。
- 用户项目与上下文：正式 Node 页面可新建、重命名、归档和删除服务端持久项目；删除会清理共享上下文和文字对话。数据源地址、操作说明和访问秘密只存在于该项目上下文，不要求独立项目、数据源类型或连接注册表。
- 通用服务器端 Agent 读写链路：每个请求创建无持久化 Claude Code 会话和临时 MCP 配置；项目上下文中的一个或多个 HTTPS 路径成为 `project_http_request` 的 allowlist。密码和已识别响应 token 会转换为宿主引用，但审查已复现跨数据源秘密串用及普通响应字段脱敏遗漏，此边界尚未达到生产要求。工具允许 GET、登录 auth POST，以及经结构校验的 change-set 创建和带幂等键 commit；直接 PATCH／PUT／DELETE 和其他 POST 仍被拒绝。Runtime 没有 Bash、文件读写或任意 WebFetch 权限。
- 无存储生产路径：响应内携带完整快照包供当前页面校验、隔离展示，并明确提示刷新后消失；存储原型不在当前 Worker 路由中暴露。
- 当前 Node 默认页面使用服务端真实项目聚合；旧演示壳仅可在非生产 `XUYAN_DEMO_UI=true` 下用于 fixture 回归。快照历史包仍未持久化。
- 最小 DAO OAuth 登录门禁已实现：服务端 BFF 完成 Authorization Code + PKCE，未配置 client ID 时不发送 `client_id`，配置后发送；BFF 直接从 Token Endpoint 返回的 DAO JWT `user_id/user_name` 建立 session，profile URL 仅作为可选覆盖。浏览器只持有 HttpOnly session cookie，聊天和快照身份不再信任请求自报 header。本地内存 session、登录墙、退出、过期及非生产 mock OAuth 已有自动化覆盖；生产模式禁止 mock、测试绕过和 HTTP OAuth。用户已确认真实环境 OAuth 验收完成，逐项脱敏记录待归档；首发不实施 tag 项目授权。

此前 Agent 基线证据：53 项 Node 测试、7 个 fixture 校验、Worker 构建和 32 项 Chromium／WebKit 回归通过；Phase 2 新证据见本文顶部。生产 OAuth 启动配置约束测试和 HTTPS 验收模板已建立；用户确认真实环境验收，逐项脱敏证据尚未归档。OAuth 自动测试覆盖 PKCE、state、一次性 transaction、DAO JWT 身份、可选 profile 查询、内存 session、服务端过期、退出、生产 cookie、开放重定向、跨站退出和伪造身份 header；浏览器覆盖未登录登录墙、登录后原有功能及执行中进度展示。真实 DeepSeek + Claude Code 2.1.270 已完成普通文本、DeepSeek 原生 WebSearch、`submit_snapshot` MCP 快照，以及经本地聊天 API 调用目标 Timeline 的 `project_http_request` 会话；响应明确返回 provider `deepseek`、model `deepseek-v4-flash`、真实 session、turns 和实际工具。原来的关键词分流、实时搜索判断、拒绝话术正则、强制工具调用和候选 prompt 修复循环已经移除。目标 Timeline 真实读取已由人工验收通过；受控 change-set 写入的宿主权限和模拟越权反例已完成，但尚未对真实看板执行写入。详情见 `docs/testing/P2_ACCEPTANCE.md`。

## 已具备

- 统一快照协议：manifest、query、任意 MIME 数据集、H5 与依赖清单、初始状态、完整性 hash、稳定消息引用。
- 7 个真实文件包：3 个项目样例、空数据、边界数据、独立筛选初始状态、CSV／二进制混合报告。全部明确为 dummy 数据。
- Node 与浏览器共用的校验链路；Schema、可信 hash、scope、资源字节、引用、路径、版本和 runtime 支持范围检查。
- 通过宿主校验后加载的隔离 viewer；通用 readBytes／readText／readJSON 绑定，展开、切视图、筛选、重载及错误恢复。
- 样例生成脚本只允许同 ID 字节完全相同；新初始状态样例有新 ID，旧包不变。
- 现有项目／成员管理界面保留；本地 Node 入口接入 Claude Code Agent Runtime，Worker 构建仅保留静态与协议兼容，未配置 Node Runtime 时聊天明确失败而不回退到普通模型补全。
- 项目规则、ADR、任务列表、依赖锁、统一检查与本地源码备份入口已建立。

开工前 P1 基线验收：19 项 Node 测试，18 项浏览器测试（9 个场景 × Chromium / WebKit）；详情见 testing/P1_ACCEPTANCE.md。

## 生产首发仍未完成

- 目标 Timeline 看板的真实受控写入验收；真实读取已通过，但 change-set 创建、commit、幂等重试及写后回读尚未在目标看板执行。
- 生产项目全真验收；项目／上下文／文字对话的服务端聚合和 API 已实现，但真实多员工身份及 DeepSeek/Timeline 新链路尚未回归，单实例文件存储的持久卷、备份和密钥保管尚未在阿里云验收。
- 首发项目 API 已接入 DAO BFF 身份；用户已确认真实 OAuth 验收完成，tag 与成员目录能力后移。
- 阿里云运行形态、密钥托管、域名、OAuth 回调、预发布环境和发布回退尚未确定或验收。
- Phase 0 OAuth HTTPS 验收包已准备：生产 Node 启动要求显式 HTTPS 公网 origin、同 origin 的精确 `/oauth/callback`、显式 HTTPS DAO authorize/token endpoints 与 scopes，并拒绝生产 HTTP/bypass；变量名级错误不回显配置值。用户已确认真实环境测试通过，逐项脱敏记录仍待归档，见 `docs/testing/PHASE_0_DAO_OAUTH_ACCEPTANCE.md`。
- 真实 Agent Runtime 的第二种快照表现、空／边界输入和产品体验复核；当前已完成普通文本与一类 `submit_snapshot` 快照的真实运行时冒烟测试，不再保留 prompt 修复路径。
- 独立的快照模式切换控件；当前 P2 入口是对话中明确要求快照／看板／报告。
- 模型长期记忆、自动上下文、动态连接凭据及生产生成任务恢复。
- 项目级持久化的只读问答缓存与用量统计；active、快照查询复用、Redis、IndexedDB、Service Worker 或 Cache Storage 缓存。

## 明确后移的能力

- D1/R2 快照存储原型及快照对象存储的生产集成；最小项目聚合的数据库持久化不可后移。
- 快照与普通消息的跨会话持久化、刷新回放和模型离线回放。
- 快照查询复用、active、生成协调及各级快照缓存；只读文本问答缓存已提前纳入首发计划。

上述快照能力缺失不阻断首发，但产品界面不能声称快照已保存或可历史回放。首发前先补项目持久化和共享问答缓存；快照持久化与快照缓存后续实施。

依赖审计：Agent Runtime 已固定到 `@anthropic-ai/claude-code@2.1.270`；新增 `marked@18.0.13` 和 `dompurify@3.4.15` 分别用于 Markdown 解析与 DOM 净化。`npm audit --omit=dev --json` 报告 15 个生产依赖中 0 个已知漏洞，完整依赖树仍有 4 个 moderate 开发依赖问题。

## 使用边界

P1 的目录与 scope 检查保护固定 dummy 样例引用，不是生产成员鉴权；包文件按本地构建白名单提供。当前 web/1 viewer 支持自包含 H5，任意 MIME 数据可原样绑定，未支持多文件脚本依赖或 ZIP 上传。详细能力与限制见 VIEWER_PROTOCOL.md。

页面中手工打开的样例消息仍是本次浏览状态；刷新会回到固定的初始样例。文件包和已记录的 snapshotId 不随浏览变化。

备份：`npm run backup` 生成 `.backups/source-<UTC>.tgz`，采用明确源码白名单排除 .env 和秘密。它是本机检查点，不是异地备份。当前 GitHub 远端为 `khonsou/SnapshotCache`；最近代码检查点 `e8d4f4c` 已推送至 `codex/production-r0-r2`。
