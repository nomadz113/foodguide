#!/usr/bin/env bash
# 生成「换机迁移包」：把不能进 Git 的东西集中到一个目录，拷到新电脑后跑 restore-migration.sh 即还原。
#
#   bash tools/pack-migration.sh
#
# 包含：密钥（DashScope）、APK 签名证书、内部决策文档、AI 项目记忆。
# 不含：.toolchain（2.3G，单独拷）、node_modules、安装包、截图素材。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/迁移包"

# 只删自己生成的那个目录，路径必须严格等于预期
if [ -e "$OUT" ]; then
  [ "$OUT" = "$ROOT/迁移包" ] || { echo "拒绝删除：$OUT" >&2; exit 1; }
  rm -rf "$OUT"
fi
mkdir -p "$OUT/secrets" "$OUT/keystore" "$OUT/docs" "$OUT/memory"

echo "▸ 密钥"
if [ -f "$ROOT/API key.txt" ]; then
  cp "$ROOT/API key.txt" "$OUT/secrets/"
  echo "  API key.txt"
fi
if [ -f "$ROOT/app/.env.local" ]; then
  cp "$ROOT/app/.env.local" "$OUT/secrets/env.local"
  echo "  app/.env.local → secrets/env.local"
fi

echo "▸ APK 签名证书"
KS="$ROOT/app/android/keystore/debug.keystore.bak"
if [ -f "$KS" ]; then
  cp "$KS" "$OUT/keystore/"
  echo "  debug.keystore.bak（md5 $(md5sum "$KS" | cut -d' ' -f1)）"
else
  echo "  ✗ 缺少 $KS —— 新机器将无法覆盖安装 APK" >&2
fi

echo "▸ 内部决策文档"
n=0
for f in "$ROOT"/*.md "$ROOT"/*.html; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in
    换机初始化.md|README.md) continue ;;
  esac
  cp "$f" "$OUT/docs/" && n=$((n+1))
done
echo "  $n 个文件"

echo "▸ AI 项目记忆"
if [ -d "$ROOT/.workbuddy/memory" ]; then
  cp "$ROOT"/.workbuddy/memory/*.md "$OUT/memory/" 2>/dev/null || true
  echo "  $(ls "$OUT/memory" | wc -l) 个文件"
fi

cat > "$OUT/README-先看我.md" <<'EOF'
# 换机迁移包

这个目录里的东西**不能进 Git**（含密钥/证书/内部文档），拷到新电脑后：

1. 把整个 `迁移包/` 目录放到新电脑的项目根目录下（和 `app/`、`tools/` 同级）
2. 在项目根执行 `bash tools/restore-migration.sh`
3. 删掉 `迁移包/`（还原完就没用了，留着等于把密钥放在桌面上）

`.toolchain/`（2.3G 工具链）不在这里，单独整目录拷：
    项目根/.toolchain
EOF

echo
echo "完成：$OUT"
du -sh "$OUT" | awk '{print "  体积 " $1}'
echo "  下一步：整个 迁移包/ + .toolchain/ 拷到新电脑，再跑 tools/restore-migration.sh"
