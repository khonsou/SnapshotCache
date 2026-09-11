# ADR-0001：先完成通用快照包与表现层

状态：Accepted（P1 研发范围由用户授权；实现取舍由本阶段落实）
日期：2026-09-11

## 依据与决定

用户确认先 dummy 快照与表现层，再 Agent 动态生成，再真实 Timeline 项目，最后缓存。用户进一步明确：快照未来由模型按上下文取数并生成表现层，当前样例业务不重要，必须确保数据结构完整。

保留统一 manifest 与任意 MIME 数据资源；数据字段、业务模板、图表类型不进入外层协议。首批样例包括 JSON + Markdown、空／边界数据和 CSV + 原始二进制；使用看板与报告两种页面验证通用加载接口。

P1 以真实文件包与静态可信目录实现闭环，暂不接数据库、真实看板、模型生成或缓存。客户端校验不替代未来的服务端权限。新版本采用新 snapshotId，已存在的包只允许字节完全一致的验证，不允许覆盖。

## 取舍

- 选择 Ajv 2020-12 与 ajv-formats，构建时生成独立校验代码，浏览器不动态编译 Schema。
- 选择 canonicalize 实现 RFC 8785，jsonc-parser 辅助拒绝重复 JSON 键，Web Crypto 计算 SHA-256；通过 RFC 数值／排序向量及恶意输入测试验证。
- 选择 parse5 校验支持的 HTML 子集，CSP + opaque iframe + 受控绑定处理装载。P1 仅支持自包含 HTML 与内联脚本／样式，不做任意模块图打包。
- 使用 esbuild 打包现有原生 JS 界面；不为了 P1 重写 React。源码迁到 src/web，dist 为构建输出。
- 使用 node:test 做契约和字节校验；Playwright 验证浏览器交互与运行边界。新增依赖保存 npm 锁文件。

## 后果与后续

Agent 可沿用同一协议和加载链路，但 P2 必须补齐持久提交、真实授权、模型候选校验及生成资源预算。改变 runtime 支持范围需追加协议说明和反例测试；改样例页面时不能重写已存在的样例 ID。

P4 才加入 active、TTL、查询复用、并发生成锁和淘汰；P1 的幂等写包不代表这些能力已实现。

来源：[RFC 8785](https://www.rfc-editor.org/info/rfc8785/)、[Ajv 独立校验器](https://ajv.js.org/standalone.html)、项目 SNAPSHOT_SPEC 与 VIEWER_PROTOCOL。
