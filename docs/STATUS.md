# 实现状态 · 2026-09-23

## 2026-09-24 阿里云 K8s 优化部署

- 已将生产 Pod 从 Node + Nginx sidecar 收敛为单 Node 容器：Node 监听 `0.0.0.0:4173`，Service 直接转发到 `4173`，Ingress 保留 SSE 不缓冲配置。
- 已加入 `/api/health` startup/readiness/liveness 探针、`automountServiceAccountToken: false`、默认 seccomp、能力降权和 Node `SIGTERM` 优雅退出。
- 已清理 Claude Code 未使用的 optional 平台副本；镜像本地体积由约 664MiB 降至约 445MiB，集群拉取层约 175MiB。
- 2026-09-24 已部署到配置的 K8s namespace：单 Pod 为 `1/1 Ready`，HTTPS `/` 返回 200，`/api/health` 返回 configured=true，未登录 `/api/session` 返回 401。私有镜像 digest 和集群标识不写入仓库；证据见 `docs/testing/ALIYUN_K8S_DEPLOY_2026-09-24.md`。
- 本地 `npm run check` 和 `npm run test:e2e` 仍受 Windows 测试路径及未安装 Playwright 浏览器阻断；真实 DAO、项目持久化、DAO tag、Agent 安全反例与 Timeline 写入仍未验收。此次部署不代表生产阻断项已解除。

2026-09-22 并发／多用户隔离／定时自动化只读审查：当前单实例每用户最多 2 个运行、每分钟最多 20 次，但无整机总并发上限；生产项目准入和服务端可信上下文尚未实现。内存反例复现同项目多数据源秘密串用、已知秘密在普通响应字段中泄露给模型、回环 HTTPS 目标被接受、change-set actor 可由模型自报、同幂等键重复执行与预取消仍 spawn。**按现状阻断多用户生产与定时无人值守运行。** 本轮 `npm run check` 通过 53 项 Node 测试、构建和 7 个 fixture；`npm run test:e2e` 因沙箱禁止回环监听，获准重跑后 32 项通过。真实 DAO、阿里云容量和定时任务未验收。详情见 `docs/testing/CONCURRENCY_MULTIUSER_SCHEDULE_REVIEW_2026-09-22.md`。

GUI、快照协议、DeepSeek Agent Runtime、Timeline 真实只读和最小 DAO OAuth 登录门禁已形成可工作的本地基线。**当前阶段是 Phase 0：真实 DAO HTTPS OAuth 登录验收**；本地 mock 不能替代该验收。后续依次确认 DAO tag 契约、持久化最小项目聚合、完成项目准入与真实 Agent 数据验收，再做阿里云预发布／生产。快照历史持久化与缓存后移，但真实项目持久化是生产前提。当前尚未发布；权威顺序见 `docs/PRODUCTION_RELEASE_PLAN.md`。

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
- 用户项目与上下文：用户可新建、重命名、归档和删除项目；删除会同时清理当前页面中的上下文、对话、成员与生成引用。数据源地址、操作说明和访问秘密都只存在于该项目上下文，不再要求独立项目、数据源类型或连接注册表。
- 通用服务器端 Agent 读写链路：每个请求创建无持久化 Claude Code 会话和临时 MCP 配置；项目上下文中的一个或多个 HTTPS 路径成为 `project_http_request` 的 allowlist。密码和已识别响应 token 会转换为宿主引用，但审查已复现跨数据源秘密串用及普通响应字段脱敏遗漏，此边界尚未达到生产要求。工具允许 GET、登录 auth POST，以及经结构校验的 change-set 创建和带幂等键 commit；直接 PATCH／PUT／DELETE 和其他 POST 仍被拒绝。Runtime 没有 Bash、文件读写或任意 WebFetch 权限。
- 无存储生产路径：响应内携带完整快照包供当前页面校验、隔离展示，并明确提示刷新后消失；存储原型不在当前 Worker 路由中暴露。
- 当前页面仍是明确标注的本地演示壳；生产项目全真替换后必须移除硬编码项目、成员、消息和 fixture。
- 最小 DAO OAuth 登录门禁已实现：服务端 BFF 按当前待验证契约完成 Authorization Code + PKCE，不发送 `client_id`，并直接从 Token Endpoint 返回的 DAO JWT `user_id/user_name` 建立 session；profile URL 仅作为可选覆盖。浏览器只持有 HttpOnly session cookie，聊天和快照身份不再信任请求自报 header。本地内存 session、登录墙、退出、过期和测试绕过已有自动化覆盖；生产模式禁止测试绕过和 HTTP OAuth。本仓库不包含 OAuth mock；真实 DAO 只允许生产回调，必须在该环境验收，tag 项目授权尚未开始。

当前自动证据：53 项 Node 测试、7 个 fixture 校验、Worker 构建和 32 项 Chromium／WebKit 回归通过。本轮新增生产 OAuth 启动配置约束测试；Phase 0 HTTPS 验收 runbook/evidence template 已建立，仍无真实 DAO 或部署证据。OAuth 覆盖 PKCE、state、一次性 transaction、DAO JWT 身份、可选 profile 查询、内存 session、服务端过期、退出、生产 cookie、开放重定向、跨站退出和伪造身份 header；浏览器覆盖未登录登录墙、登录后原有功能及执行中进度展示。真实 DeepSeek + Claude Code 2.1.270 已完成普通文本、DeepSeek 原生 WebSearch、`submit_snapshot` MCP 快照，以及经本地聊天 API 调用目标 Timeline 的 `project_http_request` 会话；响应明确返回 provider `deepseek`、model `deepseek-v4-flash`、真实 session、turns 和实际工具。原来的关键词分流、实时搜索判断、拒绝话术正则、强制工具调用和候选 prompt 修复循环已经移除。目标 Timeline 真实读取已由人工验收通过；受控 change-set 写入的宿主权限和模拟越权反例已完成，但尚未对真实看板执行写入。详情见 `docs/testing/P2_ACCEPTANCE.md`。

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
- 生产项目全真验收；用户项目／上下文路径已实现，但当前页面状态刷新后重置，尚未建立服务端可信的最小项目聚合并完成 DAO tag 项目准入。真实成员来自 DAO，相关接口待确认。
- 真实 DAO OAuth 人工联调与 tag 项目授权；最小 BFF 登录门禁已经实现，本地 mock 人工测试通过，但实际授权、token 与 HTTPS 回调尚未在 DAO 已登记域名验证，tag 与成员能力未接入。
- 2026-09-23：已准备 prod K8s 与镜像构建配置；Node 应用由同 Pod Nginx sidecar 转发到 loopback listener。配置不挂 NAS PVC，因为当前 Node 路径不写项目/对话文件；这不提供用户数据持久化。清单经 server-side dry-run 通过；当时因部署环境未提供 `DEEPSEEK_API_KEY` 安全停止，没有创建 Secret、构建/推送镜像或 apply。DAO 精确回调未验收。证据见 `docs/testing/ALIYUN_K8S_DEPLOY_2026-09-23.md`。
- Phase 0 OAuth HTTPS 验收包已准备：生产 Node 启动要求显式 HTTPS 公网 origin、同 origin 的精确 `/oauth/callback`、显式 HTTPS DAO authorize/token endpoints 与 scopes，并拒绝生产 HTTP/bypass；变量名级错误不回显配置值。操作步骤与脱敏证据模板见 `docs/testing/PHASE_0_DAO_OAUTH_ACCEPTANCE.md`。真实 DAO 值、部署与登录均未进行，Phase 0 仍未验收。
- 真实 Agent Runtime 的第二种快照表现、空／边界输入和产品体验复核；当前已完成普通文本与一类 `submit_snapshot` 快照的真实运行时冒烟测试，不再保留 prompt 修复路径。
- 独立的快照模式切换控件；当前 P2 入口是对话中明确要求快照／看板／报告。
- 模型长期记忆、自动上下文、动态连接凭据及生产生成任务恢复。
- active、查询复用、TTL、Redis、IndexedDB、Service Worker 或 Cache Storage 缓存。

## 明确后移的能力

- D1/R2 快照存储原型及快照对象存储的生产集成；最小项目聚合的数据库持久化不可后移。
- 快照与普通消息的跨会话持久化、刷新回放和模型离线回放。
- 查询复用、active、TTL、生成协调及各级缓存。

上述能力缺失不阻断首发，但产品界面不能声称结果已保存或可历史回放。发布后先补持久化，再依据真实延迟和 token 成本补缓存。

依赖审计：Agent Runtime 已固定到 `@anthropic-ai/claude-code@2.1.270`；新增 `marked@18.0.13` 和 `dompurify@3.4.15` 分别用于 Markdown 解析与 DOM 净化。`npm audit --omit=dev --json` 报告 15 个生产依赖中 0 个已知漏洞，完整依赖树仍有 4 个 moderate 开发依赖问题。

## 使用边界

P1 的目录与 scope 检查保护固定 dummy 样例引用，不是生产成员鉴权；包文件按本地构建白名单提供。当前 web/1 viewer 支持自包含 H5，任意 MIME 数据可原样绑定，未支持多文件脚本依赖或 ZIP 上传。详细能力与限制见 VIEWER_PROTOCOL.md。

页面中手工打开的样例消息仍是本次浏览状态；刷新会回到固定的初始样例。文件包和已记录的 snapshotId 不随浏览变化。

备份：`npm run backup` 生成 `.backups/source-<UTC>.tgz`，采用明确源码白名单排除 .env 和秘密。它是本机检查点，不是异地备份。当前 GitHub 远端为 `khonsou/SnapshotCache`；最近代码检查点 `67552be` 已推送至 `codex/production-r0-r2`。
