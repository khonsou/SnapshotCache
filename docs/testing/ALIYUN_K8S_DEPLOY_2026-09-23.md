# 阿里云 K8s Prod 清单检查 · 2026-09-23

范围：只新增镜像/K8s 部署配置，不修改应用源码；目标 namespace、域名和镜像仓库均来自本地 `.env`。

## 已验证

- 目标 context、namespace、镜像拉取 Secret 和 TLS Secret 均存在；当前没有 PVC。
- ConfigMap、Deployment、Service、Ingress 均通过 `kubectl apply --dry-run=server`；只做 server-side dry-run，没有创建或更新集群资源。
- `bash -n deploy/deploy.sh` 通过；脚本不再要求 OAuth 确认变量，复用现有应用 Secret 或从环境变量创建；无 DeepSeek key 时仍可部署 UI，但 Agent API 返回 503。OAuth 仍需单独验收。
- 当时目标 namespace 中没有可用的应用 DeepSeek key Secret。
- 更新后的 ConfigMap、Deployment、Service、Ingress 再次通过 server-side dry-run。部署脚本实际运行时因 `DEEPSEEK_API_KEY` 未设置且 Secret 不存在而安全停止；`default` 中没有现存 `app=xuyan-agent` 资源。

## 未验证 / 未执行

- 本次未运行 `docker build` / push：部署在必需的 DeepSeek key 检查处停止。此前 `npm ci` 因系统磁盘空间不足（ENOSPC）失败，因此 Docker build stage 与 `npm run build` 尚未完成。
- 生产域名由本地 `.env` 注入 ConfigMap/Ingress；当时 DNS 尚未完成配置。
- DAO 是否登记精确回调 `https://xuyan.angrymiao.com/oauth/callback` 尚未验收。
- DAO 生产授权/Token 端点与 scope 契约未确认。
- 没有创建应用 Secret，没有 kubectl apply/rollout，没有访问站点或真实 OAuth 验收。

当前部署配置按源码现状不挂 NAS：项目、上下文与对话仍在浏览器内存，挂载 PVC 不会使其持久化。配置的单副本 `Recreate` 与 Nginx sidecar 只解决当前 Node loopback listener、Ingress 和 SSE 代理，不改变应用数据语义。
