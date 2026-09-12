# 序言 · 项目群聊与动态快照

项目群聊已接通真实文本模型，并能从自由对话按需生成完整快照候选。快照经过统一打包、通用校验和隔离 viewer 后展示；数据与页面通过 manifest 绑定，业务数据结构不固定为看板或某个图表模板。

## 本地运行

要求 Node.js 22.9+。首次运行 `npm ci`，然后 `npm start`，打开打印的本地地址（默认 http://127.0.0.1:4173）。启动前自动构建，编辑源码后需重新启动预览。

只看 P1 样例无需模型密钥。需要真实对话或动态生成快照时，复制 `.env.example` 为 `.env` 并配置 `DEEPSEEK_API_KEY`。密钥只在服务端使用，不能复制到 dist 或提交。页面中新消息通过同源 `/api/chat` 返回文本；普通对话可由 DeepSeek 自行使用网页搜索，今天／最新／新闻等明确时效请求会要求先搜索并给出来源；明确要求快照、看板或报告时可进入动态快照分支。

项目由用户在页面中创建和删除。Timeline 项目不使用部署级项目或连接注册表：在项目的“上下文”窗口分别填写 `Timeline 地址`、`Timeline 看板 ID`、`Timeline 访问密码`，即可让宿主在相关请求中提供只读工具。原始上下文仍是唯一配置；密码仅在发给 DeepSeek 的临时副本中脱敏，也不会进入快照。没有 D1/R2 时，项目、对话、上下文和生成结果只保留在当前页面，刷新后消失。

## P1 已实现

- 7 个本地文件包：正常、空、边界数据、独立初始筛选状态，以及 CSV／二进制／Markdown 混合资源。
- manifest、query、数据、H5、初始状态和全部依赖的字节／hash／引用校验；对照可信目录 hash 后才执行。
- 隔离 viewer 与通用 `Snapshot.readBytes/readText/readJSON` 绑定，支持展开、筛选、视图切换、重新加载和错误恢复。
- 样例选择追加新消息，旧消息绑定原 snapshotId；预生成的新初始状态有独立 ID。相同 ID 的样例文件禁止覆写。
- 源码在 `src/web/`、`src/snapshot/`；`dist/` 是构建产物，禁止手工编辑。

P1 样例均为模拟数据。Timeline 只读适配器、模型工具调用、服务端真实项目配置和无状态展示路径已经实现并通过模拟响应测试，但目标看板密码尚未在本地配置，因此不能声称目标看板真实取数已经验收。公司 OAuth、真实成员映射、阿里云预发布、自动记忆和缓存仍未完成。D1/R2 与生成记录代码是可选存储原型，不是首发依赖。

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

模型代理仍有 100 KB 请求体、上下文／消息长度、上游超时及单实例限流。当前托管身份头不能替代公司 OAuth 和项目成员授权。生产环境优先评估阿里云，现有 Sites／D1／R2 不作为最终部署前提；当前改动未发布。

产品目标见 PRD.md；近期按 Timeline Agent Support 真实取数 → 项目数据全真 → 公司 OAuth → 阿里云首发推进，发布后再补持久化和缓存。详细计划见 `docs/PRODUCTION_RELEASE_PLAN_2026-09-12.md`。
