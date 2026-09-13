# 研发任务

更新日期：2026-09-13

当前顺序已确认：**GUI → 快照协议 → 模型接入 → 自由对话生成快照 → Timeline Agent Support 真实取数 → 项目数据全真 → 公司 OAuth → 阿里云生产发布 → 持久化与缓存优化。**

首发允许无缓存、无跨会话持久化；不得因此放宽真实身份、项目授权、数据来源、快照完整性或 viewer 隔离要求。详细范围见 `docs/PRODUCTION_RELEASE_PLAN_2026-09-12.md` 和 ADR-0003。

## 已完成基线 · 1–4

- GUI-01 · Done：项目群聊、项目切换、成员和上下文入口、快照挂载、移动端与键盘基础交互。后续只做真实数据替换和发布回归。
- SNAP-01 · Done：统一 SnapshotManifest / QueryContext / MessageSnapshotRef、任意 MIME 数据、真实字节 hash、通用校验器和隔离 viewer；7 个 dummy fixture 仅用于回归。
- MODEL-01 · Done：DeepSeek 文本模型代理、服务端密钥、输入限制、错误处理与普通对话回归。
- GEN-01 · Review：文本／快照意图分流、严格 SnapshotDraft、一次修复、服务端受信字段、动态展示和失败收敛已通过本地自动测试；普通文本和一类工具快照已通过真实模型最小调用，待第二种表现及空／边界／修复样本和产品复核后冻结。
- STORE-PROTOTYPE · Parked：D1/R2、Drizzle、run、目录及刷新回放已形成可选原型；不再作为首发前置，未来存储选型时复用其接口和测试经验。

## R0 · 冻结当前基线

- R0-01 · In progress：代码与文档已审查更新；待建立 Git 提交检查点。
- R0-02 · In progress：普通文本、通用 HTTP Agent 的 Timeline 文本问答和一类 Timeline 工具快照已通过真实 DeepSeek；待真实目标密码验收、第二种表现、空／边界、非法候选／修复和产品复核。
- R0-03 · Done：38 项 Node、7 个 fixture、Worker 构建和 24 项 Chromium／WebKit 场景通过；已覆盖用户项目上下文、DeepSeek 网页搜索、无状态内联快照、刷新消失、项目删除、通用 HTTP 地址／方法边界和密钥引用。

## R1 · Timeline Agent Support 真实数据

- TL-01 · In progress：实际 API 基址、公开 meta、protocol 19.2、能力和限额已探测；鉴权响应、真实分页、revision 和错误响应待目标密码验证。
- TL-02 · Implemented：平台无关只读适配器与 `timeline_read_board` 工具白名单已实现；地址、board 和密码从当前用户项目上下文临时解析，token 只在当次宿主调用中存在。测试覆盖 401 单次重试、403 不重试、能力和过滤器拒绝。
- TL-03 · Implemented：真实模型工具调用已同时接入普通文本和快照流程，不依赖末条消息关键词；工具结果记录 source、protocol、revision／观察时间并作为不可信数据处理。受控模拟 Timeline 响应的在线模型文本问答与快照评测均通过。
- AGENT-HTTP-01 · Implemented：项目上下文可直接承载 Agent 接入指南；服务器按请求临时提供受路径约束的 `project_http_request`，真实 DeepSeek 已连续完成 meta → agent-doc → auth → items。当前只开放 GET 与登录 auth POST，写操作和确认策略待读取链路真实验收后扩展。
- TL-04 · Blocked：需要用户在目标项目上下文中配置看板密码后，读取真实数据、验证 401/403/429/超时与字段缺失，并生成至少两类可逐字段核对的快照。

R1 验收：真实 Timeline 只读数据可以稳定生成协议合规快照；没有 dummy 补数、写操作、伪造来源或秘密泄露。

## R2 · 项目数据全真替换

- REAL-01 · Implemented：用户可随时新建、重命名、归档和删除项目；删除同步清理本地对话、上下文、成员和生成引用，不建立第二套服务器项目配置。
- REAL-02 · In progress：Timeline 地址、board ID 和访问密码由用户项目上下文声明；原始上下文是唯一记录，密码在发送 DeepSeek 前脱敏，已通过模拟响应验证。当前刷新后重置，生产持久化与级联删除待 OAuth 数据模型。
- REAL-03 · Removed：取消部署级 `XUYAN_PROJECTS_JSON`／连接注册表作为生产方案；服务器只处理项目对话和上下文，权限由后续 OAuth 成员关系负责。
- REAL-04 · Blocked：需要在用户创建项目的上下文中填入目标连接信息后，核对真实 Timeline 请求与快照 provenance。

R2 验收：生产目标项目不含模拟业务事实，所有业务数据和上下文都有真实配置或 Timeline 响应依据。

## R3 · 公司 OAuth 与真实授权

- AUTH-01 · Proposed：确认公司 OAuth/OIDC issuer、client ID、audience、redirect URI、scope、claims 和环境配置方式。
- AUTH-02 · Proposed：完成登录、回调、session／token 校验、退出和过期处理；覆盖 state、nonce、PKCE 或适用的等价保护。
- AUTH-03 · Proposed：建立 OAuth 用户到项目成员和 Timeline 可见范围的服务端映射；移除生产环境可伪造身份入口。
- AUTH-04 · Proposed：覆盖未登录、过期、跨用户、跨项目、成员移出、权限撤销和敏感信息泄露反例。

R3 验收：用户和项目数据全部真实，身份与授权只能由可信 OAuth 和服务端规则确定，严重越权为零。

## R4–R5 · 阿里云预发布与生产首发

- CLOUD-01 · Proposed：确认阿里云运行产品、网络、域名、TLS、出站策略、超时／并发、密钥托管和日志方案。
- CLOUD-02 · Proposed：把 Cloudflare 特有入口与 D1/R2 放到可选平台适配层；首发业务链路可无状态运行。
- CLOUD-03 · Proposed：在阿里云预发布环境跑通真实 OAuth → 真实项目 → Timeline → 模型 → 快照 → viewer。
- RELEASE-01 · Proposed：完成配置清单、构建、健康检查、日志脱敏、回退演练和安全／真实性阻断检查。
- RELEASE-02 · Proposed：向明确授权的内部用户小范围发布，观察失败率、延迟、模型与 Timeline 错误及 token 成本。

首发验收：真实用户能在生产项目中自由对话，并从获准的 Timeline 数据生成可核对快照；页面明确说明刷新后结果可能消失。

## 发布后 · 持久化与缓存

- PERSIST-01 · Deferred：根据阿里云架构选择数据库／对象存储，先持久化消息引用和不可变快照，恢复刷新及跨会话回放。
- PERSIST-02 · Deferred：持久 run、幂等恢复、失败清理、备份和恢复。
- CACHE-01 · Deferred：查询规范化、active CAS、TTL、同查询生成协调和新鲜度。
- CACHE-02 · Deferred：服务端／浏览器缓存、容量、隔离、淘汰和成本优化。

持久化优先于缓存。选型以真实流量、响应时间和 token 消耗证据为准，不预设 D1/R2、Redis 或阿里云具体产品。
