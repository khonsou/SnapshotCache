# 阿里云 K8s 优化部署证据 · 2026-09-24

范围：删除 Nginx sidecar，Node 直接监听 Pod `4173`；增加直接健康探针、ServiceAccount token 关闭、优雅退出和生产镜像 optional 平台包清理。

## 已执行

- `npm ci` 成功。
- `npm run build` 成功，生成 7 个已校验 fixture 的 Worker 产物。
- `npm run fixtures:verify` 成功，7 个 fixture 通过 schema、scope、引用、字节和 hash 校验。
- `bash -n deploy/deploy.sh`、`node --check server/local.mjs` 成功。
- 部署脚本完成 K8s server-side dry-run，随后构建、推送并 apply ConfigMap、Service、Deployment、Ingress。
- 镜像：由本地 `.env` 中的 `REGISTRY`、`IMAGE_REPO` 和脚本生成的 release tag 决定。
- 镜像 digest：已在私有发布记录中保存，不写入开源仓库。
- Claude Code 版本门禁输出 `2.1.270`；`npm prune --omit=dev --omit=optional` 后保留运行所需 CLI，删除未使用的平台副本。
- 本地镜像体积约 `445.3MiB`；Kubelet 记录本次镜像拉取层约 `183.6MB`。优化前本地镜像约 `664.3MiB`。

## 线上验收

- context、namespace、Pod 名称和 Service endpoint：来自本地 `.env` 与运行时集群，均不写入开源仓库；Pod 验收为 `1/1 Ready`，重启 `0`
- `/`：HTTPS `200`，`text/html`
- `/api/health`：HTTPS `200`，`{"configured":true}`
- `/api/session`：未登录 HTTPS `401`
- `/api/chat`：未登录 HTTPS `401`
- DNS：已按本地 `.env` 中的 `APP_HOST` 验证解析和 HTTPS
- TLS：使用本地 `.env` 中的 `TLS_SECRET_NAME` / `K8S_NAMESPACE`
- 应用 Secret：使用本地 `.env` 中的 `APP_SECRET_NAME`，未在日志中输出密钥

## 未通过或未执行

- `npm run check` 未通过：Windows 路径测试把 URL pathname 拼成 `E:\\E:\\SnapshotCache`；Claude Runtime 测试的路径断言只接受 `/`。本次未修改业务测试。
- `npm run test:e2e` 未通过：本机未安装 Playwright Chromium/WebKit 可执行文件，32 项均在浏览器启动前失败。
- 真实 DAO OAuth 登录、项目持久化、DAO tag 准入、Agent 越权反例和真实 Timeline 写入仍未验收。

此次部署证明了镜像、K8s 路由和基础 HTTPS 健康链路可运行，不改变上述生产阻断项。
