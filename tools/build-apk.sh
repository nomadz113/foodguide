#!/usr/bin/env bash
# 打一个可以直接装的安卓 APK。
#
#   bash tools/build-apk.sh          # 离线版：dist 内嵌进 APK（origin https://localhost）
#   bash tools/build-apk.sh --live   # 腾讯云版：加载 CloudBase 上的页面（有 8 小时访问提示中间页）
#   bash tools/build-apk.sh --wb     # WorkBuddy 版：加载托管链接上的页面（无中间页，需带 sharecode）
#
# 产出：../../每日摄入-<版本>-offline.apk / -online.apk / -wb.apk
#
# 工具链是自带在仓库外的 .toolchain/ 里的（JDK 21 + Android SDK 35 + Gradle 缓存），
# 不依赖机器上装没装 Android Studio，也不污染系统环境变量。
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$APP_DIR/.." && pwd)"
TOOL="$ROOT/.toolchain"

MODE=offline
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --live) MODE=live ;;
    --offline) MODE=offline ;;
    --wb) MODE=wb ;;
    *) echo "未知参数：$arg（只支持 --live / --wb / --offline）" >&2; exit 1 ;;
  esac
done

if [ ! -d "$TOOL/jdk-21.0.12.1+1" ]; then
  echo "缺少 JDK：$TOOL/jdk-21.0.12.1+1" >&2
  exit 1
fi
if [ ! -d "$TOOL/sdk/platforms/android-35" ]; then
  echo "缺少 Android SDK：$TOOL/sdk" >&2
  exit 1
fi

export JAVA_HOME="$(cygpath -w "$TOOL/jdk-21.0.12.1+1")"
export ANDROID_HOME="$(cygpath -w "$TOOL/sdk")"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="$(cygpath -w "$TOOL/gradle-home")"

cd "$APP_DIR"

# 在线版先确认线上真的活着，别打出一个指向挂掉地址的包
if [ "$MODE" != "offline" ]; then
  CFG=$([ "$MODE" = wb ] && echo capacitor.config.wb.json || echo capacitor.config.live.json)
  LIVE_URL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$CFG','utf8')).server.url)")"
  echo "▸ 检查线上可用性 $LIVE_URL"
  CODE="$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$LIVE_URL" || echo 000)"
  if [ "$MODE" = "wb" ]; then
    # WorkBuddy 托管没有中间页，首页就应该是 200；不是 200 说明凭证/部署有问题
    if [ "$CODE" != "200" ]; then
      echo "  ✗ 首页返回 $CODE（预期 200：可能是 sharecode 失效或还没发布）" >&2
      exit 1
    fi
  elif [ "$CODE" != "200" ]; then
    echo "  ⚠ 首页返回 $CODE（腾讯云默认域名的中间页本身是 404，可忽略；网络故障才需处理）"
  fi
fi

if [ "$NO_BUILD" = "1" ]; then
  echo "▸ 跳过构建（沿用现有 dist）"
else
  echo "▸ 构建 Web 资源"
  npm run build
fi

echo "▸ 同步到安卓工程"
# 不重定向 stdout：cap CLI 的报错也走 stdout，吞掉之后失败时会完全无头绪
npx cap sync android

echo "▸ 写入加载模式"
node tools/apk-config.mjs "$MODE"

echo "▸ Gradle 编译（首次会下载依赖，之后增量很快）"
cd "$APP_DIR/android"
./gradlew.bat assembleDebug --no-daemon -q

APK="$APP_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
VER="$(grep -oP 'versionName "\K[^"]+' "$APP_DIR/android/app/build.gradle" | head -1)"
NAME=$([ "$MODE" = live ] && echo online || ([ "$MODE" = wb ] && echo wb || echo offline))
OUT="$ROOT/每日摄入-${VER}-${NAME}.apk"
cp "$APK" "$OUT"

echo "▸ 校验内嵌配置"
node -e '
const { execSync } = require("child_process");
const out = process.argv[1];
const raw = execSync(`unzip -p "${out}" assets/capacitor.config.json`).toString();
const c = JSON.parse(raw);
console.log(`  server.url = ${c.server?.url || "(无，内嵌 assets)"}`);
' "$OUT"

echo "▸ 校验签名"
"$TOOL/sdk/build-tools/35.0.0/apksigner.bat" verify "$OUT" && echo "  签名有效"

echo
echo "完成：$OUT"
ls -lh "$OUT" | awk '{print "  体积 " $5}'
