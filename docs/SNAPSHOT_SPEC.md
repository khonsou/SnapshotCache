# 快照数据协议 v1

状态：P1 已落实不可变包、机器可读 Schema、7 个完整样例及通用校验／viewer。缓存目录、active、TTL 等后续记录仍为设计，尚未实现。本文定义外层数据协议，不限定业务数据模型或视觉模板。

实现契约：`contracts/snapshot.schema.json`；当前 web/1 支持范围与绑定 API 见 [VIEWER_PROTOCOL.md](VIEWER_PROTOCOL.md)。

## 1. 核心决定

**快照是一个自包含、可校验、提交后不可变的结果包。外层统一，内层开放。**

```text
Snapshot
├── manifest.json       身份、资源清单、数据与表现层的绑定、内容校验值
├── query.json          标准化查询、相关上下文、实际数据来源版本
├── data/*              任意格式的数据：一个文件或多个文件
├── presentation/*      Agent 根据这份数据生成的浏览器表现层
└── assets/*            页面使用的图片、字体、脚本、解码器等依赖（可选）
```

路径目录是推荐组织方式，读取以 manifest 为准。Redis、对象存储、ZIP、IndexedDB 都只是承载方式，不影响快照身份。

产品的四个顶层模块以 [PRD v0.2](../PRD.md) 为准。下表只说明与快照相关的三类记录，不包含项目 Agent 的配置与记忆模型，也不是整个产品的模块划分。

必须拆开三类记录：

| 所属部分 | 对象 | 职责 | 是否可变 |
| --- | --- | --- | --- |
| 快照 | `SnapshotManifest` 与所有资源 | 保存这次查询的完整结果 | 提交后不可变 |
| 缓存管理 | `SnapshotCatalogRecord`、`CacheEntry`、`ActivePointer` | 存储位置、可用性、过期、命中统计、默认版本 | 可变 |
| 群聊表现 | `MessageSnapshotRef` | 消息引用某个确定快照 | 绑定后不随 active 更新 |

不能把 `lastAccessedAt`、TTL、访问计数、缓存优先级和下载签名 URL 写进不可变 manifest。

## 2. 快照的正式结构

机器可读 Schema 的根定义为 SnapshotManifest，QueryContext 与 MessageSnapshotRef 在同文件 `$defs` 中。包外缓存记录留待 P4。下文约束与 Schema 一起构成协议，跨文件引用、内容校验和状态转换不能只靠 JSON Schema 验证。

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `schemaVersion` | 是 | 外层协议版本，当前提案为 `1.0.0` |
| `snapshotId` | 是 | 服务端分配的唯一、不复用的快照 ID |
| `scope.tenantId / projectId` | 是 | 租户和项目隔离边界；单租户也明确填写 |
| `createdAt` | 是 | 完整结果生成时间，UTC RFC 3339 时间字符串 |
| `parentSnapshotId` | 否 | 由哪个旧快照刷新、改版或编辑而来，不是读取依赖 |
| `query.resourceId` | 是 | 指向保存完整 `QueryContext` 的 JSON 资源 |
| `query.fingerprint` | 是 | 该查询可安全复用结果的身份校验值 |
| `data.datasets` | 是 | 一个或多个数据集描述符；允许内容为空的数据集 |
| `data.contentHash` | 是 | 所有数据描述和数据资源的组合校验值 |
| `presentation` | 是 | 已构建的表现层入口、依赖、数据绑定、初始状态 |
| `resources` | 是 | 所有包内文件的唯一清单，不包含 manifest 自己 |
| `totalResourceBytes` | 是 | 清单内文件的字节数之和，不含 manifest 或容器开销 |
| `integrity.manifestHash` | 是 | 除 integrity 字段外，完整 manifest 的校验值 |
| `extensions` | 否 | 带命名空间的扩展元数据，例如 `com.example.audit` |

`snapshotId` 回答“是哪一次结果”，hash 回答“内容有没有变化”，两者不能混用。即使数据完全相同，重新生成表现层也可以产生新快照 ID。

## 3. 任意数据如何装进去

### 资源是原始字节，数据集是资源的组织方式

每个 `Resource` 包含：

```text
id         包内逻辑 ID，例如 data.metrics
path       包内相对路径，例如 data/metrics.json
mediaType  原始文件的 MIME 类型，例如 application/json
byteLength 文件的原始字节数
sha256     原始文件字节的 SHA-256，不对文件内容重新序列化
```

每个 `Dataset` 包含：

```text
id                 数据集 ID，例如 metrics
entryResourceId    数据集入口文件
resourceIds        构成该数据集的完整文件清单，必须包含入口
schemaResourceId?  可选的数据格式说明或业务 Schema，必须在 resourceIds 内
```

**不定义通用的 `rows`、`columns`、`chartType` 或 `data: any` 作为快照协议。** 这些属于具体数据或具体表现层。

| 数据形态 | 保存方法 | 表现层如何使用 |
| --- | --- | --- |
| 对象、数组、树、图 | JSON 文件；业务结构自定义 | 绑定到对应数据集，由页面解析 |
| 表格、大量记录 | CSV、Arrow、Parquet 等 | 同时打包页面需要的解析器；MVP 不要求支持所有格式 |
| 文本、报告 | TXT、Markdown、PDF 等 | 页面选择合适的阅读或可视化方式 |
| 图片、音频、视频 | 原始二进制文件 | 使用浏览器能力或随包解码器 |
| 混合、多文件、分片 | 一个入口索引文件加多个资源 | 数据集清单列出全部文件，索引决定业务顺序 |

不能序列化的内存指针、打开的连接、无限流不能直接成为快照。必须截取成有边界的文件，或记录某个确定版本。只有外部 URL 而没有冻结内容的包，不满足完整回放要求。

不在 JSON 中强制内嵌 Base64 大文件。大文件可以在存储层按 hash 去重，但逻辑上仍是这个包的完整资源；导出时必须可还原。

## 4. 任意表现层如何绑定数据

```json
{
  "runtime": "web",
  "runtimeVersion": "1",
  "entryResourceId": "view.index",
  "resourceIds": ["view.index"],
  "bindings": {"metrics": "metrics", "brief": "brief"},
  "contentHash": "sha256:…"
}
```

- `runtime: web` 约束运行环境，不约束视觉形式。表格、看板、流程图、日历、Canvas、WebGL 或交互页面都能编译为这个入口。
- v1 每个快照有一个 HTML 入口，内部可包含任意页面、路由和视图。未知 runtime 或 runtimeVersion 必须拒绝执行并显示不兼容状态。
- `resourceIds` 列出表现层完整依赖，包括脚本、样式、图片、字体、WASM、解码器；数据依赖通过 `bindings` 明确引用。
- `bindings` 的键是页面使用的名称，值是 `data.datasets[].id`。例如页面读取 `metrics`，宿主便知道它实际绑定哪一份数据。
- 可选 `initialStateResourceId` 指向初始交互状态文件，也属于表现层资源。例如初始日期、筛选条件、选中节点、地图位置。
- 排序、展开、筛选等本次浏览状态留在 viewer 内存，不回写快照。用户要保存修改、添加批注或更新业务数据，应产生独立操作，必要时生成子快照。
- 保证的是冻结的数据、代码、资源和初始状态可以回放；不承诺跨浏览器、GPU、字体栅格化后的逐像素一致，也不承诺重新运行 Agent 会生成相同内容。

v1 Agent 生成页面默认在独立隔离环境执行。包内内容不能自行获得宿主凭据或扩大权限。宿主负责把已验证资源交给 viewer；包不携带 Cookie、令牌或可长期使用的签名 URL。

回放模式禁止依赖未冻结的远程业务请求。更改数据的按钮只能向宿主提交动作意图，经宿主授权后执行；不得在旧快照内部悄悄更新结果。iframe 的网络限制需要 CSP/资源网关配合，不能仅依靠 sandbox。

P1 资源装载与数据绑定接口见 VIEWER_PROTOCOL.md，支持自包含 HTML 与只读字节 API。动作 API 尚未实现；动态模块与多文件代码依赖必须等 viewer 明确支持后接入。

## 5. 查询身份：哪些条件相同才可复用

`query.json` 保存 `QueryContext`：

```text
identity
  intent              标准化意图 name + version
  parameters          任意 JSON 对象；所有省略默认值先展开
  contextHash         影响答案的项目／对话上下文摘要，无相关上下文时为 null
  authorization       scopeHash + policyVersion，由可信权限层计算
  locale / timezone   会影响数据解释或页面内容的区域设置
  sourceSelections    [{ sourceId, revision }]；revision=null 表示“最新”
  presentationRequest 结果表现的语义要求，例如时间线、货币单位；普通视觉版本不放这里
observations          实际取得的 [{ sourceId, revision, observedAt }]
originalText?         可选原始提问；不直接参与查询身份
```

“今天”“本周”等必须在 `parameters` 中转换为确定的时间范围，同时保留 timezone。集合型参数排序、单位和默认值规范化规则由 `intent.version` 定义；不允许随意排序业务上有意义的数组。

权限身份至少覆盖租户、项目、可见数据范围、字段过滤和权限策略版本；含用户专属内容时须包含用户维度。不可仅相信 Agent 声称“权限相同”。每次按 ID 回放仍须重新检查当前权限，hash 不是授权凭据。

使用 latest 时，`observations` 记录实际数据版本，但不进入 queryFingerprint，因此可以找到同一个 active 指针，再依据过期／失效策略决定是否刷新。使用固定 revision 时，它进入 identity，且实际取得的 revision 必须完全匹配。没有版本号的数据源要记录 `revision: null` 与观察时间，并依靠 TTL／主动失效管理新鲜度。

两个自然语言问题不能只因“语义很像”就共享结果。只有可信规范化器给出完全相同的 identity，才是协议层的缓存命中。

## 6. 校验值的精确定义

统一记号：`H(bytes) = "sha256:" + lowercaseHex(SHA-256(bytes))`。`JCS(x)` 是 RFC 8785 规范化后输出的 UTF-8 字节。不能用普通 `JSON.stringify` 或任意语言的简单 key 排序代替完整 JCS 实现。

1. **资源 hash**：`Resource.sha256 = H(文件原始字节)`。HTTP 压缩不影响它；先还原传输编码，再核对原始字节。ZIP 重打包也不改变它。
2. **查询 fingerprint**：`H(JCS({ identityVersion: "1", scope: manifest.scope, identity: query.identity }))`。
3. **数据 hash**：`H(JCS({ datasets: manifest.data.datasets, resources: 数据资源完整描述符数组 }))`。
4. **表现 hash**：`H(JCS({ definition: presentation去掉contentHash后的对象, resources: 表现资源完整描述符数组 }))`。
5. **manifest hash**：`H(JCS(manifest去掉整个integrity字段后的对象))`。integrity 不包含自身，避免循环计算。

计算前：manifest.resources、datasets 按 ASCII id 升序排列；每个 resourceIds 数组按 ASCII resource ID 升序排列；源选择和观察数组按 sourceId 升序排列。数据／表现 hash 中的资源描述符，分别取其 resourceIds 的并集并按 id 排序。**不改变任何业务文件内部的顺序或字节。**

精度超过 JSON 安全范围的业务数值使用带约定的字符串或二进制数据格式。协议内 byteLength/count 等整数不得超过 `2^53-1`。所有元数据拒绝重复键、非有限数和无效 Unicode。

三个 hash 的作用不同：数据不变但页面变化，data.contentHash 保持相同、presentation.contentHash 改变；入口初始状态变了，表现 hash 改变；TTL 调整或文件迁移则不改变任何包内 hash。

校验值保证完整性，不证明来源可信。可信目录保存 `manifestHash`，加载者对照该值验证；不能仅相信同一下载包自己声明的 hash。

## 7. 缓存与生命周期独立管理

### SnapshotCatalogRecord：持久目录

字段：`snapshotId`、`scope`、`manifestHash`、`status`、`committedAt`、`retainUntil`、`locations`。

- 只有所有资源完整且校验通过，才创建 `status: available` 的目录记录。
- `locations` 保存持久对象定位信息，可因迁移改变，不保存公开永久 URL 或凭据。
- `retainUntil` 是最早可物理删除的时间；null 只表示没有时间保留底线，不表示绕过消息引用保护。
- `available → deleting → deleted` 管理持久存储删除；deleted 保留 tombstone，不复用 ID。
- 消息仍引用的快照必须受保留策略保护。引用关系以持久消息／引用账本为准，不能只凭 Redis 中可能丢失的计数判断可删除。
- 明确删除后，历史消息仍保留 snapshotId，并显示“快照已删除”；不会替换为当前 active。

### CacheEntry：每个缓存实例的可变条目

字段：`cacheId`、`snapshotId`、`status: resident | evicted`、`cachedAt`、`lastAccessedAt`、`softExpiresAt`、`hardExpiresAt`、`accessCount`、`priority`、`residentBytes`。

`cacheId` 区分服务端热缓存和不同浏览器的本地缓存，不把所有客户端状态混成一个全局访问时间。缓存层可选择更短的 TTL，不能超过可信服务端为这次复用允许的新鲜度边界。

| 条件 | 自动查询结果 | 是否修改快照 |
| --- | --- | --- |
| `now < softExpiresAt` | 可直接复用 | 否 |
| `softExpiresAt ≤ now < hardExpiresAt` | 可展示旧结果并后台刷新，明确标为过期 | 否 |
| `now ≥ hardExpiresAt` | 不可作为新查询的有效命中；重新生成或报告不可用 | 否 |
| 缓存条目被淘汰 | 从持久包重新装载；仍须检查新鲜度 | 否 |

按历史消息明确回放旧结果，与为新查询选择默认结果是两种操作。前者在权限与保留策略允许时可以读取超过 hard TTL 的快照，同时保留原始时间；不得把旧结果说成最新。

**加载一个旧包不能重置它的数据新鲜度。** 重新装载可更新 cachedAt，但 soft/hard 到期时间必须继承可信新鲜度期限。具体 TTL 值由业务策略决定，不在协议中硬编码。

### ActivePointer：当前默认版本

字段：`scope`、`queryFingerprint`、`snapshotId`、`revision`、`updatedAt`。组合 `(tenantId, projectId, queryFingerprint)` 唯一。

- active 是指针关系，不是快照内部状态；一个历史快照可以不再 active，但仍完整可读。
- 更新用 revision 做 compare-and-swap。生成锁只能避免重复工作，不能替代提交时的并发检查。
- 获胜指针必须指向已提交、同 scope、同 queryFingerprint 的 available 快照。过期但未刷新的指针允许存在；命中时仍检查新鲜度。
- 生成或提交失败不移动旧指针。CAS 失败的新包保持为非 active 历史包，由保留策略处理。
- 先持久化完整包并验证，再写目录，最后切换 active。各存储间不能用一个真实事务覆盖时，要保证操作幂等、可恢复；不在协议里虚构跨 Redis／对象存储的原子事务。

早期 PRD v0.1 的单一 `staging → committed → active → stale → evicted` 应拆成：

```text
生成任务： staging → validated → committed，或 failed
持久目录： available → deleting → deleted
默认版本： ActivePointer → 某个已提交快照
新鲜程度： fresh / stale / expired，由期限推导
缓存驻留： resident / evicted，每个缓存实例各自管理
```

缓存条目淘汰不等于永久删除；active 指针消失不等于包消失。持久目录和保留／引用信息不能只存于启用淘汰的 Redis 中。

## 8. 群聊如何引用与交互

`MessageSnapshotRef = { snapshotId, manifestHash }`。消息自己的 messageId、正文、作者和时间属于群聊模型，不塞进快照。

群聊根据引用向可信宿主请求快照，宿主从已验证 manifest 读取入口。消息中不保存可能失效的对象 URL，也不允许消息自带任意 HTML 入口替代 manifest。

“命中缓存”属于本次加载事件，不属于快照内容。同一个 snapshotId 在一次浏览里命中 IndexedDB，在另一次浏览里可能从对象存储加载。UI 状态建议区分 `cache-hit`、`archive-loaded`、`generated`、`stale`、`unavailable`；这些暂为展示事件枚举，不是快照 schema 的字段。

本次筛选／缩放可以在 viewer 中临时变化；刷新源数据或保存一个新的确定状态，要生成新快照并在新消息中引用，旧消息保持不变。

## 9. 提交前必须满足的不变量

1. Schema 和协议版本受支持；时间字段显式执行 format 校验，且 `softExpiresAt ≤ hardExpiresAt`。
2. resource id、dataset id、资源路径不重复；所有引用均能找到。bindings 必须指向已声明数据集。
3. query 入口 mediaType 是 application/json；web 表现入口是 text/html；初始状态为 application/json。dataset 的 schemaResourceId 仅描述业务格式，不改变外层协议。
4. 所有文件均在资源清单中；所有资源被 query、数据集或表现层引用，不留下隐藏依赖或孤立文件。
5. 路径只能是包内安全相对路径；禁止绝对路径、`..`、空路径段、反斜杠、百分号编码、符号链接、ZIP 重复条目及大小写冲突。容器解包同时限制文件数、单文件大小、总大小和解压倍率；实际数值属于部署配置。
6. entry 和 schema/state 文件在对应资源清单中；数据和表现层依赖完整闭合。页面引用非包内资源时，不能提交为离线可回放快照。
7. 各资源实际字节数、资源 hash、组合 hash、manifest hash 与 totalResourceBytes 全部核对成功。
8. 固定源 revision 与 observations 一致；权限和 context 指纹由可信层校验。
9. parent 若存在，必须存在且属于同租户、同项目；子快照仍完整自包含，不依赖父快照文件存活。
10. 提交后资源、身份、manifest 均不可覆写。修改 query、数据、表现层、绑定或初始状态，均创建新 snapshotId。

Schema 校验通过只表示外层形状合规，不代表业务结论正确、代码可信或资源依赖已经闭合。这些由独立的提交校验步骤负责。

## 10. MVP 与后续扩展的边界

先实现一种协议、一个 web runtime、一个完整包格式。数据集支持任意 MIME 文件；当前 Demo 常见的 JSON 只是其中一种。

先不引入多运行时、增量／差分包、表现层模板注册中心和复杂权限声明。以后可在保持包外引用和缓存模型稳定的前提下扩展。未知主版本拒绝读取；命名空间扩展可以忽略，但不得改变安全边界、hash 算法或已定义字段语义。

P1 已补充 JSON + Markdown + H5、空与边界数据、独立初始状态，以及 CSV + 二进制 + Markdown + H5 样例。全部位于 examples/snapshots，hash 与大小来自真实文件，通过 npm run fixtures:verify 核验。

依据：[RFC 8785 / JCS](https://www.rfc-editor.org/rfc/rfc8785.html) 定义规范化字节；[JSON Schema 2020-12](https://json-schema.org/draft/2020-12) 定义外层校验格式；[MDN iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) 说明页面隔离限制。其余字段和状态模型是本项目的设计提案。
