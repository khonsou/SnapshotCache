# 研发任务

更新日期：2026-09-22

当前顺序：**Phase 0 真实 DAO OAuth 验收（当前）→ Phase 1 DAO tag／成员契约 → Phase 2 最小项目持久化 → Phase 3 DAO 项目准入 → Phase 4 宿主安全收口与真实 Agent／数据／快照验收 → Phase 5 阿里云隔离、容量预发布与首发 → 发布后只读定时任务、快照持久化和缓存。** 已完成的 GUI、快照协议、DeepSeek Runtime 与 Timeline 读取作为基线维护。

首发允许无快照历史回放和缓存，但最小项目聚合必须在生产前持久化。详细顺序、测试范围和阻断条件见 `docs/PRODUCTION_RELEASE_PLAN.md`。下方 R0–R5 编号是已有任务线索，不再代表执行先后。

## 2026-09-22 审查新增阻断项

- ISOLATION-01 · Proposed：在 Phase 2/3 服务端可信项目聚合与 DAO 准入中，替换客户端项目/context 自报及会重用的 `local-N` ID；共享项目分别保存 `tenantId/projectId/actorId`，覆盖所有读写与 Agent 入口。
- ISOLATION-02 · Proposed（Phase 4）：为秘密引用绑定目标数据源、方法和用途；所有返回模型的字符串替换已知秘密；对私网/回环目标制定可验证的服务器出站策略；由宿主绑定 change-set 审计 actor。上线前以跨源、回环、普通字段泄密与伪造 actor 反例验收。
- CAPACITY-01 · Proposed（Phase 5）：在单实例首发前测量真实进程内存/时延/成本，设置整机和项目总并发、队列上限、预算及过载响应；子进程支持预取消、TERM→KILL、进程树与临时目录硬清理。明确并验收任务级 OS 隔离方案，禁止把独立进程等同于沙箱。
- SCHEDULE-01 · Proposed（生产首发验收后）：先确定 DAO 服务身份/用户委托契约，持久化任务及 `scheduleId + plannedFireTime` 唯一运行记录、租约、重试与停用/删除失效；外部调度器只传无秘密 ID。第一版限制为只读文本，自动快照依赖快照结果持久化，自动写入另需明确授权与目标端幂等验收。

证据与优先级见 `docs/testing/CONCURRENCY_MULTIUSER_SCHEDULE_REVIEW_2026-09-22.md`。下列原有阶段顺序仍有效。

## 当前下一包 · Phase 0 收口

- AUTH-REAL-01 · Next：在 DAO 已登记的 HTTPS 回调环境验证真实员工登录、`/api/session`、刷新、退出、过期及受保护 API；核对当前不发送 `client_id` 与 JWT 身份的真实契约。mock 通过不算退出。
- AUTH-REAL-02 · Next：在获批 HTTPS 环境核查生产 `Secure`／`HttpOnly` cookie、精确回调、禁用测试绕过、OAuth token 不进入浏览器／Agent／日志；更新脱敏联调证据。生产启动配置校验与本地自动化已完成。
- AUTH-REAL-03 · Next：取得已登记 HTTPS callback 域名/URI 与 DAO 真实 OAuth 配置契约后，在获批环境人工验收；步骤和证据模板见 `docs/testing/PHASE_0_DAO_OAUTH_ACCEPTANCE.md`。尚未联系 DAO、部署或执行真实验收。

## 随后开发包 · Phase 1–5

- DAO-CONTRACT-01 · Proposed：取得 user/tag 稳定标识、三态批量授权、成员接口和脱敏真实响应；验证 deny 与 not_found 可区分，DAO 错误失败关闭。
- PROJECT-STORE-01 · Proposed：实现服务端最小项目聚合与加密上下文；聊天从服务端加载项目，项目删除级联，重启后项目保留。
- DAO-ACCESS-01 · Proposed：多 tag 一票否决、10 分钟以内项目租约及失效机制，保护项目 CRUD、对话、上下文、快照和 Agent 入口；替换生产演示数据。
- AGENT-E2E-01 · Proposed：在专用测试看板验证 Timeline change-set 写入／回读、真实快照第二种表现及空／边界输入；其他数据源按真实上下文另测。
- CLOUD-E2E-01 · Proposed：阿里云单实例、项目数据库、HTTPS 回调、密钥、出站、任务级隔离、真实 1/2/4 并发压测、SSE 不缓冲、故障与回退演练；通过后小范围内部发布。

## 已完成基线 · 1–4

- GUI-01 · Done：项目群聊、项目切换、成员和上下文入口、快照挂载、移动端与键盘基础交互。后续只做真实数据替换和发布回归。
- GUI-02 · Done：Agent 回复支持受净化 GFM Markdown，完成标题、列表、引用、表格、代码和链接的聊天密度优化；用户输入仍按纯文本显示，模型 HTML／脚本／远程图片不获得执行或加载权限。
- GUI-03 · Implemented：Agent 执行记录默认收起，摘要中持续显示当前步骤；窄宽度横向滚动，减少动态效果时静止，展开列表内部限高滚动。逐次保留数据源编号、受控操作、HTTP 状态、耗时与等待时间；只展示宿主确认的事实，不展示思考、URL、参数或响应正文。旧 JSON 客户端兼容；真实 DeepSeek 页面手测和阿里云反向代理的流式转发待验收。
- SNAP-01 · Done：统一 SnapshotManifest / QueryContext / MessageSnapshotRef、任意 MIME 数据、真实字节 hash、通用校验器和隔离 viewer；7 个 dummy fixture 仅用于回归。
- MODEL-01 · Done：DeepSeek 通过固定版本 Claude Code Agent Runtime 接入，服务端密钥、输入限制、错误处理、普通对话、页面回归和目标数据源鉴权读取已验证。
- GEN-01 · Review：文本／快照在同一 Agent Runtime 中处理；Agent 可调用 `submit_snapshot` MCP，宿主继续负责严格 SnapshotDraft、受信字段、hash 和隔离展示。已移除关键词分流和 prompt 修复，待第二种表现、空／边界样本和产品复核。
- STORE-PROTOTYPE · Parked：D1/R2、Drizzle、run、目录及刷新回放已形成可选原型；不再作为首发前置，未来存储选型时复用其接口和测试经验。

## R0 · 冻结当前基线

- R0-01 · Done：Agent Runtime、受控项目 HTTP 读写、Markdown 与执行进度表现层已审查；代码检查点 `67552be` 已推送。
- R0-02 · In progress：普通文本、一类快照和目标 Timeline 读取已通过真实 DeepSeek + Claude Code Runtime；待第二种表现、空／边界和产品复核。
- R0-03 · Done：最新检查点通过 52 项 Node、7 个 fixture、Worker 构建及 32 项 Chromium／WebKit 回归；覆盖 Runtime 隔离、临时 MCP、文本／快照契约、Markdown、Agent 进度和现有项目管理交互。

## R1 · Timeline Agent Support 真实数据

- TL-01 · In progress：实际 API 基址、公开 meta、protocol 19.2、能力、限额、目标密码鉴权和真实卡片读取已验证；分页边界、revision 和 401／403／429 真实错误响应待验收。
- TL-02 · Implemented：平台无关 HTTP 工具宿主和 Timeline 参考适配器已实现；运行路径只从当前用户项目上下文临时编译 HTTPS 范围与秘密引用，不解析或登记数据源类型，响应 token 只在当次 MCP 进程中存在。测试覆盖路径越权、任意 POST 拒绝、change-set 结构校验、commit 幂等键、密钥和 token 引用。
- TL-03 · In progress：真实 Claude Code Runtime 已能加载请求级 MCP；普通文本、快照提交和目标 Timeline 读取已在线验证。受控 change-set 宿主权限已实现，待页面真实写入和回读验收。
- AGENT-RUNTIME-01 · Review：已用 `@anthropic-ai/claude-code@2.1.270` 替换仓库内手写模型／工具循环；Claude Code 只作为框架，模型 endpoint、key 与计费均为 DeepSeek。会话无持久化、临时目录自动删除、隔离用户设置，禁止 Bash／文件／WebFetch／子 Agent 工具，只开放 DeepSeek WebSearch、`project_http_request` 和 `submit_snapshot`。Node、构建、浏览器、真实 WebSearch 和 Timeline 读取已通过；待真实 change-set 写入验收后 Done。
- AGENT-HTTP-01 · Implemented：项目上下文直接承载 Agent 接入指南；每轮临时编译路径受限的 `project_http_request` MCP。当前开放 GET、登录 auth POST、结构合法的 change-set 创建和带 `Idempotency-Key` 的 commit；其他 POST 及直接 PATCH／PUT／DELETE 仍禁止。
- TL-04 · In progress：真实看板读取已由人工验收通过；待在页面执行一次明确、可回读的 change-set，验证创建、commit、幂等键、变更后版本与目标字段。

R1 验收：真实 Timeline 数据可以稳定回答或生成协议合规快照；用户明确指令的写入只能通过合法 change-set 和幂等 commit 发生，没有 dummy 补数、伪造来源、直接写入或秘密泄露。

## R2 · 项目数据全真替换

- REAL-01 · Implemented：用户可随时新建、重命名、归档和删除项目；删除同步清理本地对话、上下文、成员和生成引用，不建立第二套服务器项目配置。
- REAL-02 · In progress：Timeline 地址、board ID 和访问密码由用户项目上下文声明；密码在发送 DeepSeek 前脱敏。当前刷新后重置；生产前须将项目、tag、上下文与对话作为一个服务端聚合持久化并级联删除。
- REAL-03 · Removed：取消部署级 `XUYAN_PROJECTS_JSON`／连接注册表作为生产方案；服务端保存单一项目聚合，用户-tag 访问关系由 DAO 判断。
- REAL-04 · Blocked：需要在用户创建项目的上下文中填入目标连接信息后，核对真实 Timeline 请求与快照 provenance。

R2 验收：生产目标项目不含模拟业务事实，所有业务数据和上下文都有真实配置或 Timeline 响应依据。

## R3 · 公司 OAuth 与真实授权（实际执行从 Phase 0 开始）

- AUTH-00 · Implemented：最高优先级的最小 DAO OAuth 门禁已实现；BFF 按当前待验证契约不发送 `client_id`，Authorization Code + PKCE、state、同源 return path、JWT 身份、进程内 session、HttpOnly cookie、退出和 API 身份注入已有自动化覆盖。登录后保持现有项目与 Agent 行为且不读取 tag；真实 DAO 登录待生产回调环境验收。本仓库不包含 OAuth mock 服务。
- AUTH-01 · In progress：核对开发、预发布和生产 redirect URI、scope、logout/revoke 及各环境配置；Phase 0 不要求额外 profile URL，DAO 后续若分配独立 client 可通过环境变量覆盖。
- AUTH-02 · Review：登录、回调、内存 session、退出和过期处理已实现；覆盖 state、PKCE、一次性 transaction、cookie 和身份 header 伪造。真实 DAO 响应与生产 HTTPS cookie 待联调。
- AUTH-03 · Proposed：根据服务端项目 tag 与 OAuth 身份向 DAO 查询项目准入；不另建本地成员权限或 Timeline 可见范围映射。生产环境不得接受客户端伪造身份。
- AUTH-04 · Proposed：覆盖未登录、过期、跨用户、跨项目、成员移出、权限撤销和敏感信息泄露反例。

R3 验收：用户和项目数据全部真实，身份与授权只能由可信 OAuth 和服务端规则确定，严重越权为零。

## R4–R5 · 阿里云预发布与生产首发

- CLOUD-01 · Proposed：确认阿里云运行产品、网络、域名、TLS、出站策略、超时／并发、密钥托管和日志方案。
- CLOUD-02 · Proposed：把 Cloudflare 特有入口与 D1/R2 放到可选平台适配层；首发快照生成可无跨会话存储，但项目聚合必须持久化。
- CLOUD-03 · Proposed：在阿里云预发布环境跑通真实 OAuth → 真实项目 → Timeline → 模型 → 快照 → viewer。
- RELEASE-01 · Proposed：完成配置清单、构建、健康检查、日志脱敏、回退演练和安全／真实性阻断检查。
- RELEASE-02 · Proposed：向明确授权的内部用户小范围发布，观察失败率、延迟、模型与 Timeline 错误及 token 成本。

首发验收：真实用户能在 DAO 获准的持久项目中自由对话，并从真实数据生成可核对快照；页面明确说明快照结果刷新后可能消失，不能暗示项目本身会消失。

## 发布后 · 持久化与缓存

- PERSIST-01 · Deferred：根据阿里云架构选择数据库／对象存储，先持久化消息引用和不可变快照，恢复刷新及跨会话回放。
- PERSIST-02 · Deferred：持久 run、幂等恢复、失败清理、备份和恢复。
- CACHE-01 · Deferred：查询规范化、active CAS、TTL、同查询生成协调和新鲜度。
- CACHE-02 · Deferred：服务端／浏览器缓存、容量、隔离、淘汰和成本优化。

持久化优先于缓存。选型以真实流量、响应时间和 token 消耗证据为准，不预设 D1/R2、Redis 或阿里云具体产品。
