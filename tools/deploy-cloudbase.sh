#!/usr/bin/env bash
# 一条命令把当前代码发到腾讯云 CloudBase 静态托管，并做线上验收。
#
#   bash tools/deploy-cloudbase.sh            # 构建 + 部署 + 验收
#   bash tools/deploy-cloudbase.sh --no-check # 只构建 + 部署
#
# 环境 ID 记在 app/.cloudbase/project.json 里，不写死在本脚本。
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_ID="${CLOUDBASE_ENV_ID:-$(node -e 'const fs=require("fs");const p=".cloudbase/project.json";const o=JSON.parse(fs.readFileSync(p,"utf8"));process.stdout.write(o.envId||"")')}"
if [ -z "$ENV_ID" ]; then
  echo "✗ 没有环境 ID：先在 .cloudbase/project.json 写 envId，或设置 CLOUDBASE_ENV_ID" >&2
  exit 1
fi

echo "▸ 环境: $ENV_ID"

# 1. 构建。base 是 './'，托管在子路径也能用
npm run build

# 2. 部署（hosting 不支持版本管理，同路径覆盖）
# 注意：--json 的输出里仍混有上传进度行，所以下面只从第一个 '{' 开始解析
echo "▸ 上传 dist …"
mkdir -p .cloudbase
tcb hosting deploy ./dist --env-id "$ENV_ID" --json > .cloudbase/last-deploy.log 2>&1
node -e '
const fs = require("fs");
const raw = fs.readFileSync(".cloudbase/last-deploy.log", "utf8");
const i = raw.indexOf("{");
if (i < 0) { console.error(raw.slice(-800)); process.exit(1); }
const r = JSON.parse(raw.slice(i));
const d = r.data || {};
console.log(`▸ 上传 ${d.successCount}/${d.totalFiles} 个文件，失败 ${d.failedCount}`);
if (d.failedCount) process.exit(1);
fs.writeFileSync(".cloudbase/last-url.txt", d.url + "\n");
console.log(`▸ 访问地址: ${d.url}`);
'

if [ "${1:-}" = "--no-check" ]; then
  exit 0
fi

# 3. 线上验收：默认域名有中间页，脚本会自己点掉再判定
URL="$(tr -d '\r\n' < .cloudbase/last-url.txt)"
echo "▸ 线上验收 $URL"
node tools/check-gate.mjs "$URL"
