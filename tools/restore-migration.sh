#!/usr/bin/env bash
# 在新电脑上还原「换机迁移包」。在项目根执行：
#
#   bash tools/restore-migration.sh
#
# 做四件事：放回密钥、放回签名证书（关键，否则 APK 装不上）、放回内部文档与记忆、装依赖。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/迁移包"

if [ ! -d "$PKG" ]; then
  echo "✗ 没找到 $PKG" >&2
  echo "  先从旧电脑把「迁移包」整个拷到项目根目录，再跑本脚本。" >&2
  exit 1
fi

echo "▸ 密钥"
if [ -f "$PKG/secrets/API key.txt" ]; then
  cp "$PKG/secrets/API key.txt" "$ROOT/"
  echo "  API key.txt"
fi
if [ -f "$PKG/secrets/env.local" ]; then
  cp "$PKG/secrets/env.local" "$ROOT/app/.env.local"
  echo "  app/.env.local"
fi

echo "▸ APK 签名证书（决定了能否覆盖安装旧包）"
if [ -f "$PKG/keystore/debug.keystore.bak" ]; then
  mkdir -p "$HOME/.android"
  if [ -f "$HOME/.android/debug.keystore" ]; then
    # 本机已有证书：旧的是这台机器自动生成的，签名不同会导致手机装不上，先挪走再覆盖
    mv "$HOME/.android/debug.keystore" "$HOME/.android/debug.keystore.this-machine.bak"
    echo "  已备份本机原证书为 debug.keystore.this-machine.bak"
  fi
  cp "$PKG/keystore/debug.keystore.bak" "$HOME/.android/debug.keystore"
  # 用 stdin 喂 md5sum：文件名含反斜杠时（如 Windows 的 %TEMP% 路径）它会输出
  # "\<hash> *<path>"，带转义前缀，会搅乱 Red line 比对（必须等于 1d1613ec...）
  echo "  已恢复统一签名证书（md5 $(md5sum < "$HOME/.android/debug.keystore" | cut -d' ' -f1)）"

  # 回写项目：pack-migration.sh 取证书的路径是 app/android/keystore/，不写回去的话
  # 这台机器下次跑 pack-migration.sh 会报「缺少证书」，打出一个装不上手机的迁移包。
  # 该路径被 .gitignore 的 *.keystore.* 拦住，不会进公开仓库。
  mkdir -p "$ROOT/app/android/keystore"
  cp "$HOME/.android/debug.keystore" "$ROOT/app/android/keystore/debug.keystore.bak"
  echo "  已回写 app/android/keystore/debug.keystore.bak（供 pack-migration.sh 使用）"
else
  echo "  ⚠ 迁移包里没有证书，打出的 APK 手机将无法覆盖安装" >&2
fi

echo "▸ 内部文档与记忆"
[ -d "$PKG/docs" ] && cp -n "$PKG"/docs/* "$ROOT/" 2>/dev/null || true
if [ -d "$PKG/memory" ]; then
  mkdir -p "$ROOT/.workbuddy/memory"
  cp -n "$PKG"/memory/*.md "$ROOT/.workbuddy/memory/" 2>/dev/null || true
fi
echo "  完成（已存在的文件不覆盖）"

echo "▸ 工具链检查"
if [ -d "$ROOT/.toolchain/jdk-21.0.12.1+1" ] && [ -d "$ROOT/.toolchain/sdk/platforms/android-35" ]; then
  echo "  .toolchain 就位"
else
  echo "  ✗ 缺少 .toolchain（需要整目录从旧电脑拷过来，约 2.3G）" >&2
  echo "    JDK: .toolchain/jdk-21.0.12.1+1   SDK: .toolchain/sdk" >&2
fi

echo "▸ Node 依赖"
if [ -d "$ROOT/app/node_modules" ]; then
  echo "  已存在，跳过（要重装就删掉 app/node_modules 再跑）"
else
  (cd "$ROOT/app" && npm ci)
fi

cat <<'EOF'

还原完成。验证三步：
  1) cd app && npm run build              # 能出 dist/
  2) bash tools/build-apk.sh --wb         # 能出「好好吃饭-x.y.z-wb.apk」
  3) 手机上覆盖安装，确认原有记录还在    # 签名对得上才不会丢数据

最后删掉 迁移包/ —— 里面是明文密钥。
EOF
