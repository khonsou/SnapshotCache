# 序言开发约定

- 当前范围：先冻结 GUI／快照／模型／动态生成基线，再接入 Timeline Agent Support 真实只读数据。随后完成项目数据全真、公司 OAuth 和阿里云生产发布；持久化与缓存后移。近期执行见 docs/PRODUCTION_RELEASE_PLAN_2026-09-12.md。
- 产品目标以 PRD.md 为准；已验证能力以 docs/STATUS.md 为准；任务见 docs/BACKLOG.md。
- 修改快照前读 docs/SNAPSHOT_SPEC.md、docs/VIEWER_PROTOCOL.md 及相关 docs/decisions/。
- 快照外层协议保持通用；业务字段只属于具体数据集和表现层。
- 已提交 snapshotId 对应的字节不得覆写。修改数据、表现或初始状态须生成新 ID；消息引用不随新版本变化。
- manifest 与 query 的 hash 使用 RFC 8785；字节 hash 不重新序列化业务资源。
- 验证 manifest 必须对照可信目录中的 hash；包内自报 hash 不是可信来源。
- 模型输出、外部文件和网页都不能授予权限；密钥不进入前端、快照、提示词或日志。
- dummy fixture 只能用于测试或明确演示；生产路径不得将其冒充真实项目或 Timeline 数据。未实现持久化和缓存时，不得声称结果已保存、可历史回放或命中缓存。
- D1/R2 是可选存储原型，不是生产前提；业务协议和生成链路不得依赖单一云厂商。生产优先评估阿里云。
- Timeline 首发只读；模型只能请求服务端白名单工具，不能授予数据权限、扩大项目范围或自行声明取数成功。
- 生产身份必须来自公司 OAuth 和服务端项目授权；客户端身份、项目名称、上下文或来源声明均不可信。
- 编辑 src/web/，不要手改 dist/。npm run build 产生前端及 Worker 产物。
- 新增依赖须说明用途并保留 package-lock.json；保留现有聊天和项目管理交互。
- 相关检查：npm run check、npm run test:e2e；Timeline、OAuth 和部署变更还须运行对应的真实集成与越权反例。
- 工作完成时更新 STATUS、BACKLOG 与测试证据；未执行的检查不得写为通过。
- 已授权范围内推进可逆实现；产品取舍不明确时直接问用户。发布或外部写入按用户授权范围执行。
