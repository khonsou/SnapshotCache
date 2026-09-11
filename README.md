# 序言 · P1 快照与表现层

项目群聊已接通真实文本模型；P1 增加完整 dummy 快照包、通用校验和隔离回放。数据与页面通过 manifest 绑定，业务数据结构不固定为看板或某个图表模板。

## 本地运行

要求 Node.js 22.9+。首次运行 `npm ci`，然后 `npm start`，打开打印的本地地址（默认 http://127.0.0.1:4173）。启动前自动构建，编辑源码后需重新启动预览。

只看 P1 样例无需模型密钥。需要真实文本对话时，复制 `.env.example` 为 `.env` 并配置 `DEEPSEEK_API_KEY`。密钥只在服务端使用，不能复制到 dist 或提交。页面中新消息仍通过同源 `/api/chat` 获取纯文本回复，不会动态生成快照。

## P1 已实现

- 7 个本地文件包：正常、空、边界数据、独立初始筛选状态，以及 CSV／二进制／Markdown 混合资源。
- manifest、query、数据、H5、初始状态和全部依赖的字节／hash／引用校验；对照可信目录 hash 后才执行。
- 隔离 viewer 与通用 `Snapshot.readBytes/readText/readJSON` 绑定，支持展开、筛选、视图切换、重新加载和错误恢复。
- 样例选择追加新消息，旧消息绑定原 snapshotId；预生成的新初始状态有独立 ID。相同 ID 的样例文件禁止覆写。
- 源码在 `src/web/`、`src/snapshot/`；`dist/` 是构建产物，禁止手工编辑。

P1 样例均为模拟数据，不读取真实 Timeline。项目、成员、上下文和新增会话消息仍为页面内存状态，刷新回到初始样例；文件包本身可重复读取。当前没有真实成员授权、数据库／对象存储、自动记忆、动态快照生成或缓存管理。P1 的静态可信目录只适用于 dummy 包。

## 检查与开发

- `npm run check`：代码测试、构建、快照文件完整性检查。
- `npm run fixtures:generate`：从 `examples/source/` 和生成脚本核对／创建样例；改内容须使用新 ID，已有文件不会覆写。
- `npx playwright install chromium webkit`：安装浏览器测试运行时。
- `npm run build` 后执行 `npm run test:e2e`：本地 Chromium／WebKit 验收，模型使用模拟响应，无需真实密钥。
- `npm run backup`：生成 `.backups/` 下的源码压缩包，排除 .env；仅是本机备份。

机器契约：`contracts/snapshot.schema.json`。运行范围与数据绑定接口：`docs/VIEWER_PROTOCOL.md`。实际实现／验收记录：`docs/STATUS.md`、`docs/testing/P1_ACCEPTANCE.md`。

当前 web/1 支持自包含 HTML、内联 CSS／经典脚本及可选初始状态；数据集允许任意 MIME 原始字节。多文件代码依赖、外部网络、ZIP 上传和宿主动作 API 尚不支持。当前 UI 使用两类样例页面证明通用协议，不将业务模板固化到校验器。

## 构建与部署

`scripts/build.mjs` 使用 esbuild 生成前端及 Cloudflare Worker 兼容的 `dist/server/index.js`，复制既有 Sites 配置；明确白名单仅包括公开资源和验证通过的 dummy 包，不读取 .env。`server/local.mjs` 复用生成的 Worker 资源路由，本地聊天调用继续使用回环开发模式。

模型代理仍有 100 KB 请求体、上下文／消息长度、上游超时及单实例限流。生产身份依赖 Sites 转发的可信用户头；它不能替代未来项目成员授权。发布仍通过 Sites，当前 P1 改动未发布，也未改变访问范围。

产品目标见 PRD.md；后续按 P2 Agent 动态生成 → P3 Timeline 真实项目 → P4 缓存推进。
