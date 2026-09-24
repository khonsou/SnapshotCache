#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
K8S_DIR="$ROOT_DIR/deploy/k8s/prod"
K8S_NAMESPACE="${K8S_NAMESPACE:-}"
K8S_CONTEXT="${K8S_CONTEXT:-}"
APP_HOST="${APP_HOST:-}"
TLS_SECRET_NAME="${TLS_SECRET_NAME:-}"
APP_SECRET_NAME="${APP_SECRET_NAME:-}"
IMAGE_PULL_SECRET="${IMAGE_PULL_SECRET:-}"
REGISTRY="${REGISTRY:-}"
IMAGE_REPO="${IMAGE_REPO:-xuyan-agent}"
APP_PUBLIC_ORIGIN="${APP_PUBLIC_ORIGIN:-}"
VITE_AUTH_ORIGIN="${VITE_AUTH_ORIGIN:-}"
DAO_OAUTH_CLIENT_ID="${DAO_OAUTH_CLIENT_ID:-}"
DAO_OAUTH_AUTHORIZATION_URL="${DAO_OAUTH_AUTHORIZATION_URL:-}"
DAO_OAUTH_TOKEN_URL="${DAO_OAUTH_TOKEN_URL:-}"
DAO_OAUTH_REDIRECT_URI="${DAO_OAUTH_REDIRECT_URI:-}"
DAO_OAUTH_SCOPES="${DAO_OAUTH_SCOPES:-}"
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-v4-flash}"
DOCKER_BIN=""
KUBECTL_BIN=""

die() { echo "[xuyan] ERROR: $*" >&2; exit 1; }

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "$name is required in $ENV_FILE"
}

resolve_command() {
  local name="$1"
  if command -v "${name}.exe" >/dev/null 2>&1; then printf '%s\n' "${name}.exe"; return; fi
  if command -v "$name" >/dev/null 2>&1; then printf '%s\n' "$name"; return; fi
  die "missing command: $name"
}

kube() { "$KUBECTL_BIN" --context "$K8S_CONTEXT" "$@"; }

ensure_app_secret() {
  local has_deepseek=false
  local has_dao_secret=false
  if kube get secret "$APP_SECRET_NAME" -n "$K8S_NAMESPACE" >/dev/null 2>&1; then
    local patch_parts=()
    local encoded entry patch_file
    if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
      encoded="$(printf %s "$DEEPSEEK_API_KEY" | base64 | tr -d '\n')"
      printf -v entry '"DEEPSEEK_API_KEY":"%s"' "$encoded"
      patch_parts+=("$entry")
    fi
    if [[ -n "${DAO_OAUTH_CLIENT_SECRET:-}" ]]; then
      encoded="$(printf %s "$DAO_OAUTH_CLIENT_SECRET" | base64 | tr -d '\n')"
      printf -v entry '"DAO_OAUTH_CLIENT_SECRET":"%s"' "$encoded"
      patch_parts+=("$entry")
    fi
    if ((${#patch_parts[@]})); then
      local old_ifs="$IFS"
      IFS=,
      patch_file="$(mktemp)"
      printf '{"data":{%s}}\n' "${patch_parts[*]}" > "$patch_file"
      IFS="$old_ifs"
      if ! kube patch secret "$APP_SECRET_NAME" -n "$K8S_NAMESPACE" --type=merge --patch-file "$patch_file" >/dev/null; then
        rm -f "$patch_file"
        die "failed to update $K8S_NAMESPACE/$APP_SECRET_NAME"
      fi
      rm -f "$patch_file"
    fi
    kube get secret "$APP_SECRET_NAME" -n "$K8S_NAMESPACE" -o jsonpath='{.data.DEEPSEEK_API_KEY}' | grep -q . && has_deepseek=true
    kube get secret "$APP_SECRET_NAME" -n "$K8S_NAMESPACE" -o jsonpath='{.data.DAO_OAUTH_CLIENT_SECRET}' | grep -q . && has_dao_secret=true
    [[ "$has_deepseek" == true || -n "${DEEPSEEK_API_KEY:-}" ]] || echo "[xuyan] WARNING: $APP_SECRET_NAME lacks DEEPSEEK_API_KEY; Agent API will return 503"
    return
  fi

  if [[ -z "${DEEPSEEK_API_KEY:-}" && -z "${DAO_OAUTH_CLIENT_SECRET:-}" ]]; then
    echo "[xuyan] WARNING: no application secrets configured; deploying UI without Agent API access"
    return
  fi

  local args=(create secret generic "$APP_SECRET_NAME" -n "$K8S_NAMESPACE")
  [[ -n "${DEEPSEEK_API_KEY:-}" ]] && args+=(--from-literal="DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY")
  [[ -n "${DAO_OAUTH_CLIENT_SECRET:-}" ]] && args+=(--from-literal="DAO_OAUTH_CLIENT_SECRET=$DAO_OAUTH_CLIENT_SECRET")
  kube "${args[@]}" --dry-run=client -o yaml | kube apply -f - >/dev/null
  echo "[xuyan] created Secret: $K8S_NAMESPACE/$APP_SECRET_NAME"
}

docker_path() {
  if [[ "$DOCKER_BIN" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then wslpath -w "$1"; else printf '%s\n' "$1"; fi
}

render() {
  sed \
    -e "s|__API_IMAGE__|$API_IMAGE|g" \
    -e "s|__APP_HOST__|$APP_HOST|g" \
    -e "s|__TLS_SECRET_NAME__|$TLS_SECRET_NAME|g" \
    -e "s|__APP_SECRET_NAME__|$APP_SECRET_NAME|g" \
    -e "s|__IMAGE_PULL_SECRET__|$IMAGE_PULL_SECRET|g" \
    -e "s|__DEEPSEEK_MODEL__|$DEEPSEEK_MODEL|g" \
    -e "s|__APP_PUBLIC_ORIGIN__|$APP_PUBLIC_ORIGIN|g" \
    -e "s|__VITE_AUTH_ORIGIN__|$VITE_AUTH_ORIGIN|g" \
    -e "s|__DAO_OAUTH_CLIENT_ID__|$DAO_OAUTH_CLIENT_ID|g" \
    -e "s|__DAO_OAUTH_AUTHORIZATION_URL__|$DAO_OAUTH_AUTHORIZATION_URL|g" \
    -e "s|__DAO_OAUTH_TOKEN_URL__|$DAO_OAUTH_TOKEN_URL|g" \
    -e "s|__DAO_OAUTH_REDIRECT_URI__|$DAO_OAUTH_REDIRECT_URI|g" \
    -e "s|__DAO_OAUTH_SCOPES__|$DAO_OAUTH_SCOPES|g" \
    "$1"
}

apply_manifest() { render "$1" | kube apply -n "$K8S_NAMESPACE" -f -; }
dry_run_manifest() { render "$1" | kube apply --dry-run=server -n "$K8S_NAMESPACE" -f - >/dev/null; }

RELEASE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
if [[ -z "${IMAGE_TAG:-}" ]] && [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=all 2>/dev/null || true)" ]]; then
  RELEASE_TAG="$RELEASE_TAG-dirty-$(date +%Y%m%d%H%M%S)"
fi
API_IMAGE="$REGISTRY/$IMAGE_REPO:api-prod-$RELEASE_TAG"

DOCKER_BIN="$(resolve_command docker)"
KUBECTL_BIN="$(resolve_command kubectl)"
for required in K8S_NAMESPACE K8S_CONTEXT APP_HOST TLS_SECRET_NAME APP_SECRET_NAME IMAGE_PULL_SECRET REGISTRY APP_PUBLIC_ORIGIN VITE_AUTH_ORIGIN DAO_OAUTH_AUTHORIZATION_URL DAO_OAUTH_TOKEN_URL DAO_OAUTH_REDIRECT_URI DAO_OAUTH_SCOPES; do require_env "$required"; done
kube config get-contexts "$K8S_CONTEXT" >/dev/null 2>&1 || die "unknown Kubernetes context: $K8S_CONTEXT"
kube get namespace "$K8S_NAMESPACE" >/dev/null || die "namespace $K8S_NAMESPACE is unavailable"
kube get secret "$IMAGE_PULL_SECRET" -n "$K8S_NAMESPACE" >/dev/null || die "missing $K8S_NAMESPACE/$IMAGE_PULL_SECRET"
kube get secret "$TLS_SECRET_NAME" -n "$K8S_NAMESPACE" >/dev/null || die "missing TLS secret $K8S_NAMESPACE/$TLS_SECRET_NAME"
[[ "$APP_HOST" != */* ]] || die 'APP_HOST must be a hostname without a path'
if [[ "${DRY_RUN_ONLY:-false}" != true ]]; then
  ensure_app_secret
fi

echo "[xuyan] context: $K8S_CONTEXT"
echo "[xuyan] namespace: $K8S_NAMESPACE"
echo "[xuyan] host: https://$APP_HOST"
echo "[xuyan] API image: $API_IMAGE"

for manifest in configmap.yaml deployment.yaml service.yaml ingress.yaml; do dry_run_manifest "$K8S_DIR/$manifest"; done
if [[ "${DRY_RUN_ONLY:-false}" == true ]]; then
  echo "[xuyan] server-side dry-run passed"
  exit 0
fi

"$DOCKER_BIN" build -f "$(docker_path "$ROOT_DIR/deploy/docker/backend.Dockerfile")" -t "$API_IMAGE" "$(docker_path "$ROOT_DIR")"
"$DOCKER_BIN" push "$API_IMAGE"

apply_manifest "$K8S_DIR/configmap.yaml"
apply_manifest "$K8S_DIR/service.yaml"
apply_manifest "$K8S_DIR/deployment.yaml"
apply_manifest "$K8S_DIR/ingress.yaml"
kube rollout status deployment/xuyan-agent -n "$K8S_NAMESPACE" --timeout=300s
kube get deployment,pod,service,ingress -n "$K8S_NAMESPACE" -l 'app=xuyan-agent' -o wide
echo "[xuyan] deployed to https://$APP_HOST"
