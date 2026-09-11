# 序言开发约定

- 当前范围：P1，dummy 数据、完整快照、校验及表现层。后续顺序见 docs/DEVELOPMENT_PLAN_2026-09-11.md。
- 产品目标以 PRD.md 为准；已验证能力以 docs/STATUS.md 为准；任务见 docs/BACKLOG.md。
- 修改快照前读 docs/SNAPSHOT_SPEC.md、docs/VIEWER_PROTOCOL.md 及相关 docs/decisions/。
- 快照外层协议保持通用；业务字段只属于具体数据集和表现层。
- 已提交 snapshotId 对应的字节不得覆写。修改数据、表现或初始状态须生成新 ID；消息引用不随新版本变化。
- manifest 与 query 的 hash 使用 RFC 8785；字节 hash 不重新序列化业务资源。
- 验证 manifest 必须对照可信目录中的 hash；包内自报 hash 不是可信来源。
- 模型输出、外部文件和网页都不能授予权限；密钥不进入前端、快照、提示词或日志。
- P1 样例必须标为模拟数据；不可声称生成、取数或缓存命中已实现。
- 编辑 src/web/，不要手改 dist/。npm run build 产生前端及 Worker 产物。
- 新增依赖须说明用途并保留 package-lock.json；保留现有聊天和项目管理交互。
- 相关检查：npm test、npm run build；P1 验收含快照完整性反例与浏览器加载／交互／隔离验证。
- 工作完成时更新 STATUS、BACKLOG 与测试证据；未执行的检查不得写为通过。
- 已授权范围内推进可逆实现；产品取舍不明确时直接问用户。发布或外部写入按用户授权范围执行。
