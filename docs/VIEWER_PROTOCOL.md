# Snapshot web/1：P1 运行接口

状态：P1 已实现的运行子集。业务数据结构不属于此接口；样例看板与报告只是两个消费者。

## 加载与信任

宿主持有可信的 `{snapshotId, manifestHash}` 与 scope。P1 的可信来源是随代码发布的 `examples/snapshots/catalog.json`；其固定项目作用域用于验证样例串用，不是真实成员授权。P2 替换为服务端授权目录。

顺序：按 ID 下载 manifest → Schema／scope／可信 hash／路径与限额校验 → 下载所有资源字节 → 引用、字节数、资源 hash、组合 hash 和入口校验 → 生成隔离文档 → 加载。失败时不创建可执行 iframe；P1 没有 ZIP 上传、缓存命中或动态提交 API。

上限在 `src/snapshot/validate.mjs`：manifest 128 KiB、每资源 1 MiB、总资源 4 MiB、64 个资源。元数据 JSON 嵌套深度有界；重复键、非法 Unicode 与非有限数拒绝。当前文件路径使用安全 ASCII 段，禁止空段、大小写冲突和符号链接。源数据文件保持原始字节，不强制转为 JSON。

## 支持的 H5 子集

- 单个自包含 HTML 入口，内联 CSS 与经典 JavaScript；可另存初始状态 JSON。
- 数据集可由多个任意 MIME 资源构成，HTML 通过 bindings 获取数据。
- 外链脚本、模块加载、多文件代码依赖、内嵌框架、表单、远程 URL 属性和主动跳转元标签在 P1 拒绝；不是声称这些依赖已经闭合。
- 这是 v1 viewer 当前支持范围，不是要求模型永远生成看板模板。P2 生成器必须先对齐支持范围，能力扩展需新增验收。

## 页面读取 API

宿主在页面脚本运行前提供只读接口 `window.Snapshot`：

```js
Snapshot.id                              // 当前 snapshotId
Snapshot.initialState                    // manifest 指定的初始状态，或 null
Snapshot.readBytes(binding, resourceId?)  // Uint8Array 副本
Snapshot.readText(binding, resourceId?)   // UTF-8 文本
Snapshot.readJSON(binding, resourceId?)   // 具体页面自行选择解析 JSON
```

省略 resourceId 时读取该数据集 entryResourceId。binding 必须在 manifest 中声明，resourceId 必须属于该数据集。数据以字节交付，CSV、Markdown、图片和其他二进制不会被通用层改造成固定 rows／columns。

接口不提供 fetch、模型连接、宿主文件系统、写入或缓存权限。页面可在自身内存中排序／筛选，重新加载恢复包内初始状态；保留新状态需要新包。P1 的“保存的筛选状态”样例已预生成新 ID，并通过测试证明 data hash 不变、presentation hash 改变。

## 运行边界

- iframe 使用 `sandbox="allow-scripts"`，没有 allow-same-origin；不允许弹窗、表单、顶层导航或宿主 DOM 访问。
- 宿主 CSP 使用 `frame-src blob:`；它限制子页面自导航，不能只靠 iframe sandbox。每次宿主 HTML 响应生成 nonce，供受控装载文档满足继承的脚本策略。
- 子文档另加 CSP：仅允许核对过的内联脚本 hash，阻止外部连接、嵌套 frame、worker、对象和表单。每个包的 CSS／脚本先做支持范围检查。
- 注入的 bindings 按实际字节传递；JSON 注入转义 `<`，避免数据变成 HTML／脚本。
- 资源路由统一以 octet-stream、attachment、nosniff 和 sandbox 策略返回，禁止把包内 H5 直接当宿主同源页面运行。
- 页面只向宿主报告 ready、高度和运行失败。宿主核对 source window、opaque origin、随机 channel 和 snapshotId；高度限制在 200–1000 px。没有动作执行消息桥。
- 移除页面或切换项目时中止未完成加载、释放 blob URL 和监听器；展开以同一个稳定引用重新装载。

浏览器隔离不能保证恶意脚本不消耗 CPU／内存，也不是通用恶意代码执行沙箱。P1 仅加载代码库中受控且可信 hash 固定的 dummy 包；P2 开放模型生成内容前还需验收生成资源预算与运行故障隔离。未经服务端权限设计，不把本地 scope 检查称为生产访问控制。
