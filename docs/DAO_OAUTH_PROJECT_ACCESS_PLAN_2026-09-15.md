# DAO OAuth 与项目 Tag 访问控制开发方案

更新日期：2026-09-21
状态：Phase 0 已实现，等待真实 DAO OAuth 配置和人工联调；Phase 1 以后待实施
范围：公司 OAuth 登录、DAO tag 访问判断、真实项目持久化、Agent Runtime 入口保护
不在本阶段：项目内细粒度角色、第三方系统操作策略、快照缓存、跨实例高可用 session

首个交付切片：只给现有网站增加 DAO OAuth 登录门禁；不读取 tag、不改变项目内行为，登录后与当前版本一致。

## 1. 背景与目标

序言项目通过服务端 Agent Runtime 调用 DeepSeek，并依据每个项目的上下文操作 Timeline 或其他第三方项目数据。项目上下文负责描述业务背景、数据源地址、接入协议和项目级秘密；它不负责证明当前用户身份。

公司统一登录和项目访问判断由 DAO 提供：

- OAuth/Auth 确认当前用户是谁。
- DAO 提供当前用户信息、权限、tag，以及用户能否访问某个 tag。
- 序言项目保存项目自身绑定的 tag，在用户进入项目时携带 OAuth 身份向 DAO 查询访问结果。
- 用户一旦通过项目级检查，项目内不再建立第二套读取、编辑、Agent 或 Timeline 权限体系。
- Timeline 等第三方系统的读写流程继续由项目上下文、Agent 指令和目标系统协议决定，不由 DAO 代管。

本方案基于以下上游材料：

- Timeline 仓库 commit `3bdc52feea3d0196cb99a3806b1d81922505f711`
- `timeline/docs/oauth-auth-integration.md`
- `timeline/skills/angrymiao-coin-api/`

上游 OAuth 文档描述的是 Timeline H5 的前端 PKCE 登录，且明确区分 OAuth token 与 Timeline 看板 token。本项目具有服务端 Agent 和第三方 API 代理能力，因此采用 BFF，而不是把 OAuth token 交给浏览器或 Agent。

## 2. 已确认的产品决策

### 2.0 交付顺序

认证与项目授权拆成两个可独立人工验收的能力：

1. **最高优先级：OAuth 登录门禁。** 先证明浏览器、序言服务端和 DAO OAuth 能完成真实登录、session、退出和 API 保护。登录成功后继续使用现有项目、GUI、Agent 和第三方数据源逻辑，不做 tag 判断。
2. **后续：项目 tag 授权。** 在真实登录稳定后，再接项目持久化、DAO tag 三态判断、多 tag 全量否决和 DAO 成员信息。

第一步不能宣称已经具备项目/tag 隔离，但必须保证未登录用户不能调用聊天、项目、快照或其他受保护 API。这样可以把 OAuth 协议问题和 DAO tag 产品逻辑分开定位。

### 2.1 身份与授权边界

完整请求链为：

```text
浏览器
  -> DAO OAuth 登录
  -> 序言服务端建立 BFF session
  -> 序言读取 DAO current-user/profile
  -> 用户选择或进入一个项目
  -> 序言将 OAuth 身份和项目全部 tag 交给 DAO 判断
  -> 所有 tag 均未被 DAO 明确拒绝时，签发短期项目访问租约
  -> 加载服务端保存的项目上下文和对话
  -> 为本轮 Agent 编译受控工具
  -> Agent 按项目上下文操作 Timeline 或其他系统
```

必须一直保持以下分工：

- OAuth access/refresh token 不进入浏览器 JavaScript、项目上下文、模型提示词、快照、普通日志或错误响应。
- DAO 只决定用户能否进入项目，不决定项目内第三方系统的具体操作。
- Timeline 密码及其换取的 board token 与 OAuth token 完全分离。
- 第三方数据源仍由项目上下文配置；不得建立部署级 Timeline/数据源注册表。
- 当前用户身份和 Agent 写操作 actor 只能由服务端可信 session 注入，不能由客户端或模型自报。

### 2.2 项目 tag 语义

- 项目默认可以没有 tag。
- 一个项目可以绑定多个 tag。
- 无 tag 的项目允许所有已通过 DAO OAuth 登录的公司用户访问，不允许匿名访问。
- DAO 明确返回某个 `用户 + tag` 组合无权访问时，整个项目拒绝访问。
- DAO 明确返回 tag 不存在时，该 tag 不产生权限限制。
- 多 tag 采用全量否决规则：任意一个 tag 返回 deny，项目即 deny。
- DAO 超时、网络失败、协议错误和未知响应不是 tag 不存在，不能按 allow 处理。
- 用户通过项目访问检查后，第一阶段在项目内拥有全部能力，包括查看、对话、编辑上下文、使用 Agent、修改项目/tag 和删除项目。

对应的决策算法：

```text
if 没有有效 OAuth session:
    DENY_UNAUTHENTICATED

if project.tags 为空:
    ALLOW

decisions = DAO.check_access(current_user, project.tags)

if decisions 中任一项为 DENY:
    DENY_FORBIDDEN

if decisions 全部为 ALLOW 或 NOT_FOUND:
    ALLOW

if DAO 超时、不可用、返回缺项或未知状态:
    ERROR_FAIL_CLOSED
```

### 2.3 tag 数据不缓存权限关系

本项目需要持久化“项目绑定了什么 tag”，但不得持久化“某用户永久拥有某 tag”。用户与 tag 的关系始终由 DAO 决定，并通过有期限的访问租约缓存。

建议保存 tag 的稳定标识和当前显示名：

```json
{
  "key": "DAO 稳定 tag ID 或规范化 tag key",
  "label": "界面显示名称"
}
```

这里保存稳定 ID 不会导致权限滞后：每次租约刷新仍使用当前 OAuth 身份向 DAO 查询该 ID。稳定 ID 的作用只是防止 DAO 重命名后旧名称被误判为 `NOT_FOUND` 并意外公开项目。

如果 DAO 只支持按名称判断，则必须补充以下语义之一：

1. tag 名称是不可变唯一 key，修改的只是 display name；或
2. DAO 对重命名/删除的受控 tag 保留 tombstone/alias，不能把旧名称简单返回为不存在。

自定义 tag 也应送往 DAO 做三态判断。它当前不存在时为 `NOT_FOUND`，未来 DAO 创建同名/同 key tag 后会自动变成受控 tag。本地不保存 `用户 -> tag` 权限副本。

项目 tag 的修改属于项目内操作。因为第一阶段所有已获准用户同权，已进入项目的用户可以删掉受控 tag，从而把项目改为面向所有已登录用户开放。这是当前产品规则的直接结果，必须在 UI 中提示并记录最小审计信息；若未来不接受该风险，再增加项目管理员角色，而不是在本阶段暗中增加规则。

## 3. DAO 必须提供的接口契约

现有 `angrymiao-coin-api` 已知能力：

- customer `GET /api/permission/current-user`
- customer `GET /api/task-tag`
- admin `GET /api/tags`

仅使用 `/api/task-tag` 无法区分：

- tag 不存在；
- tag 存在但当前用户无权访问。

因此项目访问检查不能通过“当前用户 tag 列表里没有该 tag”直接得出结论。DAO 需要提供用户态、非管理员的三态访问判断接口，建议语义如下：

```http
POST /api/tag-access/check
Authorization: Bearer <current-user-token>
Content-Type: application/json

{
  "tags": ["tag-a", "tag-b"]
}
```

```json
{
  "subject": "stable-user-id",
  "decisions": [
    { "tag": "tag-a", "decision": "allow" },
    { "tag": "tag-b", "decision": "not_found" }
  ],
  "evaluated_at": "2026-09-15T12:00:00Z"
}
```

约束：

- 每个输入 tag 必须有且只有一个结果。
- decision 只能是 `allow`、`deny`、`not_found`。
- 缺项、重复项和未知值按协议错误处理并 fail closed。
- 接口必须使用当前用户 token，不能接受客户端自报 user ID。
- 返回稳定 subject，用于核对 OAuth profile，避免 token/用户串用。
- 建议返回 tag 的稳定 ID、display name 和版本/更新时间。
- 批量检查应有明确数量、请求体、分页和限速上限。

团队即将补充 tag 成员接口。在新文档提交前：

- 项目访问功能只依赖三态访问判断，不依赖完整成员列表。
- 生产 UI 不显示硬编码成员。
- 成员窗口可以暂时显示“成员信息由 DAO 管理”，或隐藏入口。
- 收到新接口文档后再确定成员列表、搜索和分页表现；成员编辑仍不在第一阶段范围。

## 4. BFF OAuth 设计

### 4.1 为什么使用 BFF

BFF 负责 OAuth code 交换、token 保存和 DAO API 调用。浏览器只持有不可读的 session cookie。这样可以避免 OAuth token 被前端脚本、浏览器存储或 Agent 获取。

服务端路由建议：

```text
GET  /auth/login
GET  /oauth/callback
GET  /api/session
POST /auth/logout
```

登录流程：

1. 服务端生成 transaction ID、state、PKCE verifier/challenge 和受校验的 return path。
2. transaction 保存于服务端内存，浏览器只获得短期关联 cookie。
3. 浏览器整页跳转到 DAO/Auth authorize endpoint。
4. callback 严格校验 error、state、一次性 transaction、redirect URI 和 code。
5. 服务端调用 token endpoint 交换 code。
6. 服务端使用 DAO current-user/profile 获取稳定用户身份，不依赖业务服务自行猜测 token 是 JWT 还是 opaque。
7. 服务端旋转 session ID，保存 token、profile、scope 和过期时间。
8. callback URL 清除 code/state 后跳回经过校验的同源路径。

### 4.2 Cookie 与 CSRF

生产 session cookie：

- 随机高熵 opaque ID，服务端只保存其 hash 或不可逆索引。
- `Secure`
- `HttpOnly`
- `Path=/`
- 不设置 `Domain`
- 优先使用 `__Host-Http-` 前缀（以目标运行环境支持情况为准）。
- OAuth 回调兼容性验证前使用 `SameSite=Lax`；若 Auth 与应用部署方式允许，再收紧为 `Strict`。

所有写请求必须继续校验同源 `Origin`/`Sec-Fetch-Site`，并加入独立 CSRF token 或等价的服务端防护。SameSite 不能作为唯一 CSRF 防线。

### 4.3 第一阶段 session 保存

第一阶段在确认生产单实例、接受服务重启后重新登录的前提下使用进程内 session：

- 进程重启使全部 session 失效。
- session 有容量上限、按过期时间清理，不能无限增长。
- 不把 session/token 写入本地文件、项目记录或普通日志。
- 不支持多实例，不宣称高可用。
- 如果 token endpoint 返回 refresh token，第一阶段可以不使用并安全丢弃；session 绝对期限应短于 access token 有效期。

扩容或 HA 前切换到 Redis 共享 session store：

- session 接口与业务代码分离，内存和 Redis 实现使用同一契约。
- Redis 只保存 session，不与快照缓存混用命名空间或生命周期。
- 支持 logout、管理员撤权事件和安全事件的主动失效。
- refresh token 如需保存，必须加密并支持轮换；遵循授权服务器的 replay detection/rotation 契约。

### 4.4 建议时限

权威规范没有规定统一的授权缓存时长。RFC 7662 要求权衡 DAO 压力与撤权后的陈旧窗口，并且缓存不得超过 token 的 `exp`。OWASP 建议所有 session 同时具备服务端 idle timeout 和 absolute timeout。

首发默认值：

```text
OAuth/BFF session absolute timeout: 8 小时
OAuth/BFF session idle timeout:     30 分钟
项目 tag access lease:              10 分钟
OAuth transaction timeout:          5 分钟
```

规则：

- 时限全部由服务端执行，客户端倒计时只用于提示。
- access lease 不得超过 session 或 access token 的剩余有效期。
- 10 分钟内进入同一项目不重复请求 DAO；项目内各操作只验证 session 和租约，不再区分操作类型。
- 租约过期后的下一次项目请求重新查询 DAO。
- DAO 明确 deny 时立即拒绝并删除旧 allow 租约。
- DAO 不可用时，尚未过期的 allow 租约可继续使用；租约过期后返回可重试的 503，不按 `not_found` 放行。
- 修改项目 tag、logout、session 轮换时立即清除相关租约。
- 后续若 DAO 提供撤权 webhook、back-channel logout 或事件流，应主动清除 session/租约，把最长撤权窗口缩短到事件传播时间。
- 上线后依据 DAO 可用性、调用量和撤权要求在 1–30 分钟范围内调整租约，不把 10 分钟写死在业务逻辑中。

参考：

- [RFC 9700 / BCP 240](https://datatracker.ietf.org/doc/rfc9700/)：OAuth 2.0 Security Best Current Practice
- [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html)：Token Introspection 的缓存与撤权权衡
- [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html)：Token Revocation
- [OAuth 2.0 for Browser-Based Applications](https://datatracker.ietf.org/doc/rfc10017/)：BFF、HttpOnly/Secure cookie 和 CSRF 防护
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)：idle/absolute timeout 和服务端失效
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)：联邦身份场景中的 session 与重新认证

## 5. 项目真实数据模型

最小生产数据以项目为聚合根，不建立第二套项目注册表或数据源连接表：

```text
Project
  id
  name
  tags[]
  context
  conversation/messages
  createdBy              # 审计字段，不作为访问授权
  createdAt / updatedAt
```

要求：

- `projectId` 由服务端生成，不能接受客户端指定覆盖。
- tag 绑定是项目事实，由服务端加载后送 DAO 检查；不能信任请求体自报 tag。
- 用户/tag 权限关系不落入项目表。
- 项目上下文原文只从服务端项目聚合加载；客户端发起聊天时不再提交一份可替换的上下文。
- 数据源密码仍位于项目上下文这个唯一配置入口，但持久化时必须使用应用级加密；调用 Agent 前转换为临时宿主引用。
- 删除项目时级联删除上下文、对话、tag 绑定、秘密、临时生成引用和对应授权租约。
- snapshot/cache 的长期持久化仍是独立后续工作。

当前快照把 `tenantId` 等同于用户 ID，不适合多人共享项目。接入真实身份后应拆分：

```text
tenantId: DAO 公司/工作空间标识（若第一阶段只有一个公司，可使用固定内部 tenant）
projectId: 服务端项目 ID
actorId: 当前 DAO 稳定用户 ID
```

快照和项目资源按 `tenantId + projectId` 归属，访问时检查当前用户的项目租约；`actorId` 只用于审计和操作来源。

## 6. 服务端接口与中间件

建议引入四个边界模块：

```text
AuthClient
  beginLogin()
  exchangeCode()
  getCurrentUser()
  logoutOrRevoke()

SessionStore
  create()
  get()
  rotate()
  touch()
  delete()

DaoAuthorizationClient
  checkTagAccess(userToken, tagKeys[])
  listCurrentUserTags(userToken)
  listTagMembers(...)       # 等待团队新契约

ProjectRepository
  create/get/update/delete
  loadContext/loadMessages
```

统一中间件：

```text
requireSession(request)
requireProjectAccess(session, projectId)
requireSameOriginAndCsrf(request)
```

现有入口调整方向：

- `/api/chat`：客户端只提交 `projectId`、messages/request 和幂等键；服务端校验项目租约后加载项目名称和上下文。
- snapshot 列表、manifest、resource：先执行相同项目访问检查，不能继续按请求 header 的用户 ID 直接隔离。
- 项目 CRUD、上下文、tag、对话接口：全部要求有效 session；项目资源要求有效项目租约。
- 项目列表：返回当前用户能访问的项目。为避免 N 个项目产生 N 次串行 DAO 调用，批量收集 tag 后调用 DAO 批量判断，再按项目的全量否决规则过滤。
- 本地开发身份只能在显式测试模式使用；生产构建不得信任客户端可伪造的 `oai-authenticated-user-id`。

## 7. Agent Runtime 集成规则

授权完成后，现有 Agent 运行方式保持不变：Claude Code 仅作为 Agent Runtime 框架，模型 endpoint、key 和计费使用 DeepSeek。

进入 Agent 前必须完成：

1. 验证 BFF session。
2. 验证或复用当前项目 access lease。
3. 从服务端项目聚合读取上下文。
4. 对上下文秘密做宿主引用替换。
5. 按上下文声明的 HTTPS 范围临时编译 `project_http_request`。

明确禁止：

- 把 OAuth/DAO Bearer token 作为项目 secret 交给模型。
- 允许模型直接运行 `angrymiao-coin --token ...`。
- 因用户拥有某个 DAO tag 而扩大上下文之外的数据源地址或 HTTP 方法。
- 让模型自报当前 user、project、tag 或 change-set actor。
- 把 DAO 的项目准入结论解释为第三方系统内部的字段/动作权限。

Timeline 写操作是否直接 commit、是否需要 change-set review，以及其他第三方系统的操作纪律，全部由项目上下文和目标系统协议决定。本 OAuth 层只负责在 Agent 启动前给出项目级 allow/deny。

## 8. GUI 方案

### 8.1 登录与会话

- 未登录只显示公司账号登录入口，不加载任何项目事实。
- 登录后通过 `/api/session` 获取安全裁剪的 profile。
- session 过期时保留未提交输入并重新走 OAuth，成功后回到原同源路径。
- 提供退出入口；退出清除服务端 session、项目租约和浏览器 cookie。

### 8.2 项目与 tag

- 项目创建默认无 tag，因此所有已登录公司用户可访问。
- tag 选择器从 DAO 当前用户 tag 接口读取可选项，并允许输入自定义 tag。
- 支持多选，并明确提示“任一受控 tag 拒绝即无法进入”。
- 修改为无 tag 或只含 DAO 不存在的 tag 时，显示“项目将对所有已登录公司用户开放”的强提示。
- tag 的权限状态只作展示，最终结果由服务端决定。
- UI 不提供绕过 DAO 检查的“本地允许”开关。

### 8.3 成员

- 删除现有硬编码演示成员和前端自维护角色在生产路径中的权威性。
- 成员全部来自 DAO。
- 在 DAO 成员接口更新前，成员管理入口改为只读说明或暂时隐藏。
- 第一阶段即使展示成员，也不提供本项目内添加、移除或升降级操作。

## 9. 实施阶段

### Phase 0：最小 DAO OAuth 登录门禁（最高优先级）

目标：在不改变现有网站项目行为的前提下，先完成真实 DAO OAuth 登录。

Phase 0 使用 DAO/Auth 已部署的固定登录契约：authorize/token 端点、`profile phone` scope，以及 Token Endpoint 返回的 DAO JWT 身份。当前调用不发送 `client_id`，`DAO_OAUTH_CLIENT_ID` 和 `DAO_OAUTH_PROFILE_URL` 都不是本地启动前置；DAO 后续若分配显式 client 或要求额外 profile 查询，再通过环境变量覆盖。

实现内容：

- 实现 BFF `GET /auth/login`、`GET /oauth/callback`、`GET /api/session`、`POST /auth/logout`。
- 实现 Authorization Code + PKCE、state、一次性登录 transaction 和同源 return path。
- 使用进程内 SessionStore；浏览器只持有 HttpOnly opaque session cookie。
- 登录后从 DAO Token Endpoint 返回的 JWT `user_id/user_name` 取得稳定用户 ID 和显示信息；显式配置 profile URL 时可额外查询覆盖。
- 网站启动时先检查 `/api/session`；未登录只显示登录入口，不初始化项目界面。
- `/api/chat`、快照和后续受保护 API 统一要求有效 session。
- 当前生产身份不再依赖客户端可伪造的 `oai-authenticated-user-id`；明确测试模式仍可保留本地身份。
- 登录成功后保持当前 GUI、项目内存数据、项目上下文、Agent Runtime、Timeline 和快照行为不变。
- 服务重启后 session 失效并要求重新登录，页面如实提示。
- 真实 DAO 回调白名单目前只有生产地址；本仓库不包含 mock OAuth 服务。Phase 0 的真实登录退出条件只能在已登记的 HTTPS 回调域名验收，不能由 localhost 测试替代。

Phase 0 明确不做：

- 不调用 DAO tag、permission 或成员接口。
- 不根据 tag 过滤项目。
- 不改项目创建、成员、上下文和 Agent 操作规则。
- 不进行项目数据持久化迁移。
- 不实现 Redis、refresh token 长会话或多实例 session。
- 不宣称已经实现项目级授权。

退出条件：真实 DAO 用户可以登录、刷新页面、访问现有功能并退出；未登录或 session 失效的用户无法调用受保护 API；OAuth/DAO token 不进入浏览器 JavaScript、项目上下文、Agent 或日志。

### Phase 1：DAO tag/成员契约探测

交付：真实响应记录和接口契约，不改业务授权语义。

- 使用测试账号取得脱敏的 token、profile、permission、task-tag 响应样例。
- 确认/补充批量三态 tag access endpoint。
- 等待并吸收 DAO tag 成员接口的新提交。
- 验证同一用户、允许用户、拒绝用户、未知 tag 和 DAO 异常五种结果。
- 补齐预发布/生产 OAuth client、redirect URI、logout/revoke 和撤权事件契约。

退出条件：服务端能区分 `allow`、`deny`、`not_found` 和系统错误，且有稳定 user/tag 标识。

### Phase 2：项目聚合持久化

- 实现平台无关 ProjectRepository。
- 把项目、tag、上下文和对话从前端内存迁至服务端。
- 聊天接口改为服务端加载项目上下文。
- 完成项目删除级联与上下文秘密加密。
- 按目标阿里云产品选择关系型持久化实现；不让业务层依赖 D1/R2。

退出条件：浏览器不能通过篡改请求体替换项目 tag 或上下文，服务重启后项目仍存在。

### Phase 3：DAO 项目准入和 GUI

- 实现批量 tag 判断、10 分钟租约、fail-closed 和缓存失效。
- 项目列表、详情、CRUD、聊天和快照全部接入 `requireProjectAccess`。
- 接入多 tag GUI、自定义 tag 和开放范围警告。
- 移除硬编码成员；在新 DAO 文档到位后增加只读成员展示。

退出条件：允许、拒绝、无 tag、未知 tag、多 tag 一票否决均符合本方案。

### Phase 4：Agent 与真实数据纵向验收

- 经项目租约启动 DeepSeek Agent Runtime。
- 验证 Timeline 及至少一个不同类型数据源。
- 验证 Timeline OAuth/DAO token、看板 token 和项目秘密互不串用。
- 验证真实 user ID 写入审计 actor，但模型不能修改 actor。

退出条件：真实用户只能通过获准项目启动 Agent，项目内行为继续忠实遵循上下文和目标协议。

### Phase 5：阿里云预发布和生产切片

- 单实例首发使用内存 session，并明确重启重新登录。
- 配置域名、TLS、回调、出站、密钥托管、日志脱敏、健康检查和回退。
- 运行真实 OAuth -> DAO tag -> 项目 -> Agent -> Timeline/快照端到端验收。
- 扩容或 HA 前实现 Redis SessionStore 并完成迁移测试。

## 10. 测试范围

### 10.0 Phase 0 最小登录验收

- 未登录打开网站只显示 DAO 登录入口，现有项目界面不初始化。
- 点击登录跳转到正确 DAO authorize 地址，携带正确 client、redirect、scope、state 和 PKCE challenge。
- 成功 callback 建立 HttpOnly session，并回到原同源页面。
- 登录后现有项目切换、对话、上下文、Agent、Timeline 和快照行为不变。
- 刷新页面保持登录；主动退出后立即失效。
- 服务重启后旧 cookie 不可恢复 session，并进入重新登录流程。
- 未登录、伪造 cookie、过期 session 访问 `/api/chat` 和快照 API 均返回 401。
- callback 取消、state 错误、code 重放、token 交换失败都有明确错误，不进入项目页面。
- OAuth access/refresh token 不出现在 LocalStorage、SessionStorage、页面源码、网络业务响应、Agent 输入或普通日志。
- Phase 0 不发起 DAO tag、permission 或成员请求，证明登录门禁与 tag 授权尚未耦合。

### 10.1 OAuth/session 单元测试

- authorize URL、PKCE S256、state、一次性 transaction。
- callback 缺 code、OAuth error、state 不匹配、code 重放和 transaction 过期。
- return path 只能是同源 path/query/hash，拒绝绝对外链和协议相对地址。
- session ID 旋转、随机性、容量和过期清理。
- idle、absolute、token expiry 的边界。
- cookie 的 Secure、HttpOnly、SameSite、Path、Domain。
- logout 和进程重启后 session 失效。
- CSRF、Origin 和 Sec-Fetch-Site 反例。

### 10.2 DAO 契约与授权测试

- 单 tag allow、deny、not_found。
- 多 tag 全 allow、allow + not_found、任一 deny。
- 空 tag 项目允许已登录用户。
- 未登录用户无论 tag 如何都拒绝。
- 缺项、重复项、未知 decision、subject 不匹配均 fail closed。
- 401、403、429、500、超时、断网、非 JSON 和超大响应。
- 分页、批量上限、tag Unicode/大小写/空格规范化。
- allow 租约复用、10 分钟过期重查、修改 tag 清除缓存。
- DAO 不可用时未过期租约可用、过期租约返回 503。
- 缓存绝不超过 session/access token `exp`。

### 10.3 项目数据与越权测试

- 客户端伪造 `projectId`、tag、context、createdBy。
- 用户 A 不能访问 DAO 对其 deny 的项目。
- 用户 A 的项目租约不能用于用户 B 或其他项目。
- 修改 tag 后旧租约不能继续使用。
- 删除项目后上下文、对话、tag、秘密和租约全部不可读取。
- 无 tag/未知 tag 的项目对所有已登录公司用户开放。
- 受控 tag 被删除或重命名时符合 DAO 明确三态语义。
- 同一共享项目的快照按 tenant/project 归属，不按 actor 分裂。

### 10.4 Agent 与秘密测试

- OAuth access/refresh token 不出现在 Agent prompt、MCP 配置、工具参数和工具结果。
- OAuth token 不出现在项目上下文、快照、错误响应、浏览器存储或普通日志。
- Timeline 密码和 board token 仍只使用临时宿主引用。
- 模型尝试扩大 URL、HTTP 方法、项目范围或伪造 actor 时被宿主阻止。
- 项目 deny 时 Agent Runtime 完全不启动，也不产生第三方请求。
- 项目 allow 后，读取/写入行为只受项目上下文和目标系统协议约束。

### 10.5 浏览器 E2E

- 首次登录、取消登录、成功 callback、刷新、退出和过期重登。
- 登录后返回原项目路径，开放重定向被拒绝。
- 项目 tag 多选、DAO tag、自定义 tag、无 tag 和开放警告。
- 用户只能看到获准项目；直接输入项目 URL 仍需服务端检查。
- DAO deny 后项目不可打开、聊天和快照请求均失败。
- 移动端、键盘和已有聊天/快照交互不回退。
- 生产页面不出现硬编码成员和 dummy 业务事实。

### 10.6 真实预发布验收

- 至少三个 DAO 账号：允许、拒绝、tag 关系变更。
- 至少三个项目：无 tag、单受控 tag、多 tag 一票否决。
- DAO tag 新建、重命名、删除和用户撤权。
- DAO 短暂故障、限流、恢复以及租约过期行为。
- 真实 Timeline 读取和一次可回读写入。
- 真实 DeepSeek 普通对话、工具调用和快照生成。
- 服务重启后项目保留、session 失效并可重新登录。
- 日志、监控、浏览器网络面板和快照包敏感信息扫描。

## 11. 发布阻断条件

以下任一项成立不得生产发布：

1. 生产仍信任客户端可伪造的身份 header。
2. 仅凭 `/api/task-tag` 列表缺失就把 tag 当作不存在并放行。
3. DAO 系统错误、超时或未知响应被当成 `not_found`。
4. 浏览器或 Agent 能获得 OAuth/DAO token。
5. 客户端可以自报项目 tag/context 绕过服务端项目记录。
6. 任一 deny tag 没有阻断多 tag 项目。
7. 项目拒绝后仍能读取对话、快照或启动 Agent。
8. 项目 tag 修改后旧 allow 租约仍然有效。
9. 共享项目继续以 actorId 作为 tenantId，导致成员数据分裂或越权。
10. 生产仍显示硬编码成员或把 dummy 数据当成真实项目。

## 12. 待外部信息

Phase 0 固定 client、authorize/token 和 JWT 身份契约已经确认；后续 tag 授权与生产部署仍需 DAO/Auth 团队提供或确认：

- 开发、预发布、生产 redirect URI 白名单。
- logout、revoke 地址及独立 client 的后续迁移安排（如有）。
- scope 和 OAuth 错误契约。
- token、profile、permission、task-tag 的脱敏真实样例。
- 批量三态 tag access API，尤其是 `deny` 与 `not_found` 的可区分语义。
- 稳定 user ID、tenant/workspace ID、稳定 tag ID/key 和重命名语义。
- tag 成员列表接口的新文档。
- 限速、超时、分页、审计和撤权事件能力。

目标阿里云环境仍需确认：

- 正式域名和 OAuth callback。
- 单实例产品及持久磁盘/关系数据库选择。
- 未来 Redis 规格和网络边界。
- Auth、DAO、Timeline、DeepSeek 的出站访问和 TLS 信任链。
- 密钥托管、日志脱敏和回退方式。

## 13. 完成定义

本阶段完成时应满足：

- 所有用户必须通过 DAO OAuth 登录。
- 浏览器只持有受保护的 opaque BFF session cookie。
- 项目与 tag、上下文和对话是服务端可信项目数据。
- 用户与 tag 的关系始终来自 DAO，不在本地建立永久权限副本。
- 多 tag 全量否决、无 tag/明确不存在 tag 开放的规则可被自动测试证明。
- 项目准入之后不建立项目内细粒度权限，Agent 行为仍由项目上下文和第三方协议决定。
- DAO/OAuth token 与 Timeline/项目秘密完全隔离。
- 未授权用户无法通过项目 URL、聊天、快照或 Agent 工具绕过检查。
- 单实例重启导致重新登录的边界被明确展示；项目数据本身不丢失。
- 真实 OAuth、真实 DAO tag、真实项目、DeepSeek Agent 和 Timeline 在阿里云预发布环境纵向通过。
