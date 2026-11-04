#!/usr/bin/env bash
# 把「迁移包」和「.toolchain」拷到 U 盘/移动硬盘，并逐项核对（数量 + 总字节数）。
#
#   bash tools/copy-to-drive.sh /h/临时目录        # 目标目录（Git Bash 写法）
#   bash tools/copy-to-drive.sh /h/临时目录 --check # 只核对，不拷贝
#
# 会在目标目录下建「好好吃饭-迁移」，里面直接放 迁移包/ 和 .toolchain/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_ROOT="${1:-}"
MODE="${2:-copy}"

if [ -z "$DEST_ROOT" ]; then
  echo "用法：bash tools/copy-to-drive.sh <盘符>   例如 bash tools/copy-to-drive.sh /g" >&2
  exit 1
fi
if [ ! -d "$DEST_ROOT" ]; then
  echo "✗ 找不到盘符：$DEST_ROOT（G 盘要写成 /g）" >&2
  exit 1
fi

DEST="$DEST_ROOT/好好吃饭-迁移"

count_files() { find "$1" -type f 2>/dev/null | wc -l; }
count_bytes() { du -sb "$1" 2>/dev/null | cut -f1; }

verify() {
  local src="$1" dst="$2" name="$3" ok=1
  local sf df sb db
  sf=$(count_files "$src"); sb=$(count_bytes "$src")
  if [ -d "$dst" ]; then
    df=$(count_files "$dst"); db=$(count_bytes "$dst")
  else
    df=0; db=0
  fi
  if [ "$sf" = "$df" ] && [ "$sb" = "$db" ]; then
    printf '  ✓ %-12s 文件 %s 个 / %s 字节\n' "$name" "$sf" "$sb"
  else
    printf '  ✗ %-12s 源 %s 个/%s 字节  目标 %s 个/%s 字节\n' "$name" "$sf" "$sb" "$df" "$db"
    ok=0
  fi
  return $((1 - ok))
}

if [ "$MODE" != "--check" ]; then
  echo "▸ 检查目标盘"
  FREE_KB=$(df -k "$DEST_ROOT" | tail -1 | awk '{print $4}')
  NEED_KB=$(( ($(count_bytes "$ROOT/.toolchain") + $(count_bytes "$ROOT/迁移包")) / 1024 / 1024 * 11 / 10 ))
  echo "  可用 $((FREE_KB/1024/1024))G，需要约 $((NEED_KB/1024/1024))G"
  if [ "$FREE_KB" -lt "$NEED_KB" ]; then
    echo "  ✗ 空间不足" >&2
    exit 1
  fi

  mkdir -p "$DEST"
  echo "▸ 拷贝迁移包（小，几秒）"
  cp -r "$ROOT/迁移包/" "$DEST/迁移包/"
  echo "▸ 拷贝工具链（2.3G，约 3~10 分钟，别拔盘）"
  cp -r "$ROOT/.toolchain" "$DEST/"
fi

echo
echo "▸ 核对（数量 + 字节数必须完全一致）"
verify "$ROOT/迁移包" "$DEST/迁移包" "迁移包" || true
verify "$ROOT/.toolchain" "$DEST/.toolchain" ".toolchain" || true

cat <<EOF

完成。目标：$DEST
拔盘前确认上面两行都是 ✓。
到新电脑后，把这个目录里的「迁移包」和「.toolchain」放回项目根，再跑 tools/restore-migration.sh
EOF
