#!/usr/bin/env bash
# 打一个可以直接装的安卓 APK。
#
#   bash tools/build-apk.sh          # 离线版：dist 内嵌进 APK（origin https://localhost）
#   bash tools/build-apk.sh --wb     # WorkBuddy 版：加载托管链接上的页面（无中间页，需带 sharecode）
#
#   --no-sync  跳过 `cap sync`。插件没变时用它：sync 的 update 阶段会 rm 掉
#              capacitor-cordova-android-plugins（69 个文件）→ 撞上工作区的批量删除保护
#              （阈值 50 个/轮）而失败；而 copy 阶段（dist → assets/public）在此之前就已完成。
#              跳过时本脚本自己校验 /assets/public 与 dist 是否一致。
#   --no-build 跳过 npm run build（沿用现有 dist）。
#
# 产出：../../好好吃饭-<版本>-offline.apk / -wb.apk
#
# 工具链是自带在仓库外的 .toolchain/ 里的（JDK 21 + Android SDK 35 + Gradle 缓存），
# 不依赖机器上装没装 Android Studio，也不污染系统环境变量。
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$APP_DIR/.." && pwd)"
TOOL="$ROOT/.toolchain"

MODE=offline
NO_BUILD=0
NO_SYNC=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --no-sync) NO_SYNC=1 ;;
    --offline) MODE=offline ;;
    --wb) MODE=wb ;;
    *) echo "未知参数：$arg（只支持 --wb / --offline / --no-build / --no-sync）" >&2; exit 1 ;;
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

# local.properties 存的是 SDK 绝对路径，换机/换盘符后必然失效，Gradle 会直接报
# 「SDK location not found」。每次构建都按当前工具链重写，省掉手工改。
printf 'sdk.dir=%s\n' \
  "$(cygpath -w "$TOOL/sdk" | sed -e 's/\\/\\\\/g' -e 's/:/\\:/g')" \
  > "$APP_DIR/android/local.properties"

# 在线版先确认线上真的活着，别打出一个指向挂掉地址的包
if [ "$MODE" != "offline" ]; then
  LIVE_URL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('capacitor.config.wb.json','utf8')).server.url)")"
  echo "▸ 检查线上可用性 $LIVE_URL"
  CODE="$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$LIVE_URL" || echo 000)"
  # WorkBuddy 托管没有中间页，首页就应该是 200；不是 200 说明凭证/部署有问题
  if [ "$CODE" != "200" ]; then
    echo "  ✗ 首页返回 $CODE（预期 200：可能是 sharecode 失效或还没发布）" >&2
    exit 1
  fi
fi

if [ "$NO_BUILD" = "1" ]; then
  echo "▸ 跳过构建（沿用现有 dist）"
else
  echo "▸ 构建 Web 资源"
  npm run build
fi

# 不重定向 stdout：cap CLI 的报错也走 stdout，吞掉之后失败时会完全无头绪
echo "▸ 同步到安卓工程"
if [ "$NO_SYNC" = "1" ]; then
  # 跳过 sync 就必须自己确认资源真的是新的，否则会打出一个装着上一次 dist 的包
  DIST_SW="$(grep -m1 'const VERSION' dist/sw.js)"
  AS_SW="$(grep -m1 'const VERSION' android/app/src/main/assets/public/sw.js 2>/dev/null || echo '(缺失)')"
  if [ "$DIST_SW" != "$AS_SW" ]; then
    echo "  ✗ assets/public 与 dist 不是同一版（dist: $DIST_SW / assets: $AS_SW）" >&2
    echo "    先跑一次 npx cap sync android，或去掉 --no-sync" >&2
    exit 1
  fi
  echo "  跳过 cap sync（插件未变）；assets/public 已与 dist 同版：$DIST_SW"
else
  npx cap sync android
fi

echo "▸ 写入加载模式"
node tools/apk-config.mjs "$MODE"

echo "▸ Gradle 编译（首次会下载依赖，之后增量很快）"
cd "$APP_DIR/android"
./gradlew.bat assembleDebug --no-daemon -q

APK="$APP_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
VER="$(grep -oP 'versionName "\K[^"]+' "$APP_DIR/android/app/build.gradle" | head -1)"
NAME=$([ "$MODE" = wb ] && echo wb || echo offline)
OUT="$ROOT/好好吃饭-${VER}-${NAME}.apk"
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
