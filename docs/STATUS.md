# 实现状态 · 2026-09-11

P1：开发与自动验收完成，待用户体验验收；本次没有发布到线上。

## 已具备

- 统一快照协议：manifest、query、任意 MIME 数据集、H5 与依赖清单、初始状态、完整性 hash、稳定消息引用。
- 7 个真实文件包：3 个项目样例、空数据、边界数据、独立筛选初始状态、CSV／二进制混合报告。全部明确为 dummy 数据。
- Node 与浏览器共用的校验链路；Schema、可信 hash、scope、资源字节、引用、路径、版本和 runtime 支持范围检查。
- 通过宿主校验后加载的隔离 viewer；通用 readBytes／readText／readJSON 绑定，展开、切视图、筛选、重载及错误恢复。
- 样例生成脚本只允许同 ID 字节完全相同；新初始状态样例有新 ID，旧包不变。
- 现有真实文本模型代理和项目／成员管理界面保留；源码迁至 src/web，构建统一输出前端与 Worker。
- 项目规则、ADR、任务列表、依赖锁、统一检查与本地源码备份入口已建立。

自动验收：19 项 Node 测试，18 项浏览器测试（9 个场景 × Chromium / WebKit）；详情见 testing/P1_ACCEPTANCE.md。

## 仍未实现

- Agent 动态生成快照、Timeline 鉴权／取数；所给看板密码未写入文件或快照。
- 生产项目／成员／消息持久化及真实数据权限；项目管理与会话历史仍在内存，刷新重置。
- 新建任意业务快照的用户操作入口；P1 通过固定样例与脚本验证新版本。
- 模型长期记忆、自动上下文、动态连接凭据及生产生成任务恢复。
- active、查询复用、TTL、Redis、IndexedDB、Service Worker 或 Cache Storage 缓存。

## 使用边界

P1 的目录与 scope 检查保护固定 dummy 样例引用，不是生产成员鉴权；包文件按本地构建白名单提供。当前 web/1 viewer 支持自包含 H5，任意 MIME 数据可原样绑定，未支持多文件脚本依赖或 ZIP 上传。详细能力与限制见 VIEWER_PROTOCOL.md。

页面中手工打开的样例消息仍是本次浏览状态；刷新会回到固定的初始样例。文件包和已记录的 snapshotId 不随浏览变化。

备份：`npm run backup` 生成 `.backups/source-<UTC>.tgz`，采用明确源码白名单排除 .env 和秘密。它是本机检查点，不是异地备份；当前尚未配置 Git remote。
