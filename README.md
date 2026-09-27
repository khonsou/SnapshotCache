# 序言 · 项目群聊与动态快照

项目群聊已接入真实服务器端 Agent Runtime：Claude Code 只作为运行框架，推理 endpoint、API key、模型和计费均使用 DeepSeek。Agent 能在同一会话中按需调用项目数据源或生成完整快照候选。Agent 文本回复支持受净化的 GFM Markdown 展示，用户消息仍按纯文本处理。快照经过统一打包、通用校验和隔离 viewer 后展示；数据与页面通过 manifest 绑定，业务数据结构不固定为看板或某个图表模板。

## 本地运行

要求 Node.js 22.9+。首次运行 `npm ci`（会安装锁定版本的 Claude Code Runtime），然后 `npm start`，打开打印的本地地址（默认 http://127.0.0.1:4173）。启动前自动构建，编辑源码后需重新启动预览。

本地手工测试使用 `XUYAN_MOCK_OAUTH=true PORT=4174 npm start`，打开 `http://127.0.0.1:4174/`，点击“登录”后在本地模拟页点击“以本地测试用户登录”。模拟页只在非生产模式启用，不连接 DAO；真实 DAO 的 HTTPS 回调仍需在真实环境验收。当前本地项目和对话保存在 `.local/projects/`，重启后保留；不要删除其中的 `.development-key`，否则已有本地数据无法解密。

只看 P1 样例无需模型密钥。需要真实对话或动态生成快照时，复制 `.env.example` 为 `.env` 并配置 `DEEPSEEK_API_KEY`。密钥只在服务端使用，不能复制到 dist 或提交。页面中新消息通过同源 `/api/chat` 启动一次无持久化 Agent 会话；Claude Code 的所有 Anthropic 环境变量都指向 DeepSeek Anthropic endpoint，旧的 `deepseek-flash` 配置会在运行时规范为 `deepseek-v4-flash`。Agent 可自行使用 DeepSeek 原生 WebSearch。明确要求可视化交付时，Agent 调用 `submit_snapshot`，宿主再执行快照协议与安全校验。宿主不使用关键词或拒绝话术规则替 Agent 做语义决策。

聊天页面会通过同一个 POST 请求接收 Agent 进度事件，逐次显示数据源编号、受控操作类别、实际 HTTP 状态、耗时与等待时间；执行记录默认收起，摘要持续显示当前步骤，空间不足时横向滚动（尊重系统减少动态效果设置），可按需展开完整记录。未声明流式接收的客户端仍得到 JSON。进度事件只包含固定枚举和宿主确认的数值，不包含模型思考、工具参数、URL、第三方响应或密钥；没有新的可观察动作时只更新等待时间。部署时反向代理必须关闭 `/api/chat` 的响应缓冲，否则页面仍会在结束时一次性收到全部事件。

Phase 0 已加入 DAO OAuth 登录门禁，用户确认真实环境验收完成。BFF 未配置 `DAO_OAUTH_CLIENT_ID` 时不发送 `client_id`，配置后会发送。生产环境必须设置 `NODE_ENV=production`、浏览器实际访问的 HTTPS `APP_PUBLIC_ORIGIN` 和 DAO 已登记的精确 `DAO_OAUTH_REDIRECT_URI`。OAuth code、access token 和可选 refresh token 只由服务端处理，浏览器仅持有 HttpOnly session cookie。测试身份绕过和 HTTP OAuth 地址在生产模式下均不可用。第一阶段 session 存在单个 Node 进程内，服务重启后需要重新登录。

项目由用户在页面中创建和删除，不使用部署级项目或数据源连接注册表。项目“上下文”同时承载背景、数据源地址、凭据和 Agent 接入说明；宿主按每次请求临时把其中列出的 HTTPS 地址编译成请求级 MCP 工具，Claude Code Runtime 可以连续完成协议探测、在线文档读取、鉴权、查询、分析和受控 change-set 写入。当前允许 GET、登录 `POST .../auth`、创建 `POST .../change-sets` 及带 `Idempotency-Key` 的 `POST .../change-sets/:id/commit`；仍禁止直接 PATCH／PUT／DELETE 和其他 POST。密码和响应 token 当前会在已识别字段中转换为临时宿主引用；审查已发现跨数据源引用串用和普通响应字段脱敏遗漏，生产前必须修复，不能声称所有原值都不会进入模型。Runtime 不获得 Bash、项目文件或任意 WebFetch 权限。当前 Node 页面已将项目、上下文和共享文字对话加密保存在服务端；刷新后恢复。快照包仍只在当次页面会话中展示，刷新后不可历史回放。生产部署须配置单实例持久挂载的 `PROJECT_DATA_DIR` 和 32 字节 base64 `PROJECT_ENCRYPTION_KEY`，妥善备份两者；未配置时生产进程拒绝启动。此首版文件仓库不支持多实例共享写入或数据库级备份恢复，阿里云预发布前须确认单实例与持久卷方案。

## P1 已实现

- 7 个本地文件包：正常、空、边界数据、独立初始筛选状态，以及 CSV／二进制／Markdown 混合资源。
- manifest、query、数据、H5、初始状态和全部依赖的字节／hash／引用校验；对照可信目录 hash 后才执行。
- 隔离 viewer 与通用 `Snapshot.readBytes/readText/readJSON` 绑定，支持展开、筛选、视图切换、重新加载和错误恢复。
- 样例选择追加新消息，旧消息绑定原 snapshotId；预生成的新初始状态有独立 ID。相同 ID 的样例文件禁止覆写。
- 源码在 `src/web/`、`src/snapshot/`；`dist/` 是构建产物，禁止手工编辑。

P1 样例均为模拟数据，只在显式开发演示与自动化回归中使用；Node 正式页面不展示演示项目。Claude Code Runtime、请求级项目 HTTP MCP、快照提交和当次展示路径已经实现；普通文本、快照提交和目标 Timeline 真实读取已验收，受控 change-set 写入待真实手工验收。用户确认真实 DAO OAuth 验收完成；共享项目聚合代码与本地自动化已完成，真实多员工／DeepSeek 回归、项目级高频只读问答缓存、阿里云预发布仍未完成。DAO tag 准入、真实成员目录、自动记忆和快照缓存后移。D1/R2 与生成记录代码是可选快照存储原型，不是首发依赖。

## 检查与开发

- `npm run check`：代码测试、构建、快照文件完整性检查。
- `npm run fixtures:generate`：从 `examples/source/` 和生成脚本核对／创建样例；改内容须使用新 ID，已有文件不会覆写。
- `npx playwright install chromium webkit`：安装浏览器测试运行时。
- `npm run build` 后执行 `npm run test:e2e`：本地 Chromium／WebKit 验收，模型使用模拟响应，无需真实密钥。
- `npm run backup`：生成 `.backups/` 下的源码压缩包，排除 .env；仅是本机备份。

机器契约：`contracts/snapshot.schema.json`。运行范围与数据绑定接口：`docs/VIEWER_PROTOCOL.md`。实际实现／验收记录：`docs/STATUS.md`、`docs/testing/P1_ACCEPTANCE.md`。

当前 web/1 支持自包含 HTML、内联 CSS／经典脚本及可选初始状态；数据集允许任意 MIME 原始字节。多文件代码依赖、外部网络、ZIP 上传和宿主动作 API 尚不支持。当前 UI 使用两类样例页面证明通用协议，不将业务模板固化到校验器。

## 构建与部署

`scripts/build.mjs` 使用 esbuild 生成前端及当前 Cloudflare Worker 兼容的 `dist/server/index.js`；明确白名单仅包括公开资源和验证通过的 dummy 包，不读取 .env。`server/local.mjs` 复用生成的 Worker 资源路由，本地聊天调用继续使用回环开发模式。

Agent API 仍有 100 KB 请求体、上下文／消息长度、180 秒上游超时及进程内每用户限流；尚无整机总并发上限。用户确认真实 DAO OAuth 验收完成；首发所有已登录员工共享站内项目，不做 DAO tag 项目授权。生产环境优先评估阿里云，并要求运行环境支持锁定版本的 Node/Claude Code 子进程；现有 Sites／D1／R2 不作为最终部署前提，Worker 路径不会回退到普通模型补全。当前改动未发布。

产品目标见 PRD.md；Phase 2 最小共享项目聚合已实现并通过本地自动化，待真实身份和 Agent 数据回归后关闭。随后收口宿主安全与真实 Agent 数据链路，再实现跨员工复用高频只读问答的项目缓存，最后进入阿里云预发布与首发。快照历史持久化和快照缓存后移；权威计划见 `docs/PRODUCTION_RELEASE_PLAN.md`。
