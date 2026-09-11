# P1 验收记录

日期：2026-09-11。范围：本地工作区 P1 实现；基线提交 fd80d58 后的未提交工作。未发布到线上，未使用真实模型额度或读取 Timeline 看板。

## 自动检查结果

- `npm test`：19 项通过（原有 API 5 项 + 快照相关 14 项）。
- `npm run build`：前端与 Worker 打包成功，构建验证所有可信目录中的包；未读取 .env。
- `npm run fixtures:verify`：7 个包完整性验证通过。
- `npm run fixtures:generate`：可重复生成／核对相同字节；既有 snapshotId 不覆写。
- `npm run test:e2e`：18 项通过（Chromium、WebKit 各 9 项）。

测试运行于本机 Node v25.2.1；项目要求 Node >=22.9，本次未另外运行 Node 22。浏览器运行时由锁定的 Playwright 安装；固定测试服务监听 127.0.0.1:54319。正式本地预览为 127.0.0.1:4173。

## 证据覆盖

- 文件与协议：合法、空和混合字节数据；hash／大小；JCS 数值和 Unicode 排序；重复 JSON 键、非法 Unicode、非有限数；版本、日期、MIME、scope；路径、大小写冲突、符号链接；错误绑定、缺件与隐藏文件；固定源版本；父引用和初始状态 hash 分离。
- 生命周期：同 ID 幂等核验、拒绝覆写；新状态生成独立 ID；旧消息保留原引用；重载不调用模型。
- 交互：筛选、键盘 tab、移动端布局、展开关闭、项目切换、刷新、空／边界内容和 CSV／二进制显示。
- 失败恢复：坏文件拒绝运行、重新加载恢复；运行脚本错误与不允许的导航转为不可用状态。
- 隔离：opaque iframe 无法读宿主 DOM／localStorage；fetch、图片外传和跨站自导航被策略阻断。测试在网络拦截层确认无外发请求，而非仅统计浏览器 request 事件。
- 回归：原有模型代理输入／身份头／错误／并发测试，聊天 UI 使用模拟模型响应验证纯文本与快照并存。

测试发现并修复：浏览器测试的筛选标签定位、Chromium 对 CSP 拦截事件与错误页面的不同报告方式，以及 viewer 运行失败／异常导航的状态恢复。未通过的早期运行不计入最终通过数。

## 可复核入口

测试源码：`tests/snapshot.test.mjs`、`tests/api.test.mjs`、`tests/browser/snapshot.spec.mjs`。
本机详细浏览器报告：`playwright-report/index.html`（生成文件，不提交）。
协议：`contracts/snapshot.schema.json`、`docs/SNAPSHOT_SPEC.md`、`docs/VIEWER_PROTOCOL.md`。
真实样例文件：`examples/snapshots/catalog.json` 及对应 snapshotId 目录。

## 产品验收建议

打开本地预览，检查初始快照的筛选与展开；在“验证样例”中依次打开空数据、边界数据、保存的筛选状态和 CSV／二进制报告；确认它们追加为新消息，旧快照仍可重新加载。业务视觉仅为 dummy 消费者，不冻结未来模型生成的表现形式。

当前自动验收通过不表示生产权限或通用恶意代码执行沙箱已就绪。P2 需补齐动态生成资源预算与服务端提交／授权，P3 才验证真实业务来源，P4 才验证缓存。
