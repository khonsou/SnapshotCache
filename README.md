# 序言 · 项目群聊与动态快照

项目群聊已接入真实服务器端 Agent Runtime：Claude Code 只作为运行框架，推理 endpoint、API key、模型和计费均使用 DeepSeek。Agent 能在同一会话中按需调用项目数据源或生成完整快照候选。Agent 文本回复支持受净化的 GFM Markdown 展示，用户消息仍按纯文本处理。快照经过统一打包、通用校验和隔离 viewer 后展示；数据与页面通过 manifest 绑定，业务数据结构不固定为看板或某个图表模板。

## 本地运行

要求 Node.js 22.9+。首次运行 `npm ci`（会安装锁定版本的 Claude Code Runtime），然后 `npm start`，打开打印的本地地址（默认 http://127.0.0.1:4173）。启动前自动构建，编辑源码后需重新启动预览。

真实 DAO 目前只登记生产回调，localhost 不能完成真实 OAuth 登录；本仓库不包含模拟 OAuth 服务。上线前必须在已登记的 HTTPS 回调域名上验证完整登录、刷新、退出和 API 门禁。

只看 P1 样例无需模型密钥。需要真实对话或动态生成快照时，复制 `.env.example` 为 `.env` 并配置 `DEEPSEEK_API_KEY`。密钥只在服务端使用，不能复制到 dist 或提交。页面中新消息通过同源 `/api/chat` 启动一次无持久化 Agent 会话；Claude Code 的所有 Anthropic 环境变量都指向 DeepSeek Anthropic endpoint，旧的 `deepseek-flash` 配置会在运行时规范为 `deepseek-v4-flash`。Agent 可自行使用 DeepSeek 原生 WebSearch。明确要求可视化交付时，Agent 调用 `submit_snapshot`，宿主再执行快照协议与安全校验。宿主不使用关键词或拒绝话术规则替 Agent 做语义决策。

Phase 0 已加入 DAO OAuth 登录门禁。按照目前确认的 DAO 服务契约，BFF 不发送 `client_id`，并从 DAO 返回的 JWT `user_id/user_name` 建立 session；该契约仍需在真实 DAO 回调环境验收。生产环境必须设置 `NODE_ENV=production`、浏览器实际访问的 HTTPS `APP_PUBLIC_ORIGIN` 和 DAO 已登记的精确 `DAO_OAUTH_REDIRECT_URI`。OAuth code、access token 和可选 refresh token 只由服务端处理，浏览器仅持有 HttpOnly session cookie。测试身份绕过和 HTTP OAuth 地址在生产模式下均不可用。第一阶段 session 存在单个 Node 进程内，服务重启后需要重新登录。

项目由用户在页面中创建和删除，不使用部署级项目或数据源连接注册表。项目“上下文”同时承载背景、数据源地址、凭据和 Agent 接入说明；宿主按每次请求临时把其中列出的 HTTPS 地址编译成请求级 MCP 工具，Claude Code Runtime 可以连续完成协议探测、在线文档读取、鉴权、查询、分析和受控 change-set 写入。当前允许 GET、登录 `POST .../auth`、创建 `POST .../change-sets` 及带 `Idempotency-Key` 的 `POST .../change-sets/:id/commit`；仍禁止直接 PATCH／PUT／DELETE 和其他 POST。密码和响应 token 都转换为临时宿主引用，原值不会发送给模型或写入快照。Runtime 不获得 Bash、项目文件或任意 WebFetch 权限。没有 D1/R2 时，项目、对话、上下文和生成结果只保留在当前页面，刷新后消失。

## P1 已实现

- 7 个本地文件包：正常、空、边界数据、独立初始筛选状态，以及 CSV／二进制／Markdown 混合资源。
- manifest、query、数据、H5、初始状态和全部依赖的字节／hash／引用校验；对照可信目录 hash 后才执行。
- 隔离 viewer 与通用 `Snapshot.readBytes/readText/readJSON` 绑定，支持展开、筛选、视图切换、重新加载和错误恢复。
- 样例选择追加新消息，旧消息绑定原 snapshotId；预生成的新初始状态有独立 ID。相同 ID 的样例文件禁止覆写。
- 源码在 `src/web/`、`src/snapshot/`；`dist/` 是构建产物，禁止手工编辑。

P1 样例均为模拟数据。Claude Code Runtime、请求级项目 HTTP MCP、快照提交和无状态展示路径已经实现；普通文本、快照提交和目标 Timeline 真实读取已验收，受控 change-set 写入待页面手工验收。公司 OAuth、真实成员映射、阿里云预发布、自动记忆和缓存仍未完成。D1/R2 与生成记录代码是可选存储原型，不是首发依赖。

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

Agent API 仍有 100 KB 请求体、上下文／消息长度、180 秒上游超时及单实例限流。当前托管身份头不能替代公司 OAuth 和项目成员授权。生产环境优先评估阿里云，并要求运行环境支持锁定版本的 Node/Claude Code 子进程；现有 Sites／D1／R2 不作为最终部署前提，Worker 路径不会回退到普通模型补全。当前改动未发布。

产品目标见 PRD.md；近期按 Timeline Agent Support 真实取数 → 项目数据全真 → 公司 OAuth → 阿里云首发推进，发布后再补持久化和缓存。详细计划见 `docs/PRODUCTION_RELEASE_PLAN_2026-09-12.md`。
