#!/usr/bin/env bash
#
# 安装 web-game-manager 为 macOS 系统级 LaunchDaemon（开机自启）。
#
# 用法（需要 sudo）：
#   sudo bash scripts/install-launchd.sh install    # 装入 /Library/LaunchDaemons 并启动
#   sudo bash scripts/install-launchd.sh uninstall  # 卸载 daemon（保留 plist 副本以便回滚）
#   sudo bash scripts/install-launchd.sh status     # 打印当前状态
#
# 前置条件：
#   - 已用 `git pull` 把 packaging/launchd/*.plist 同步到本机；
#   - 项目部署在 /Users/mac/code/web-game-manager；
#   - node 装在 /usr/local/bin/node（plist 里是绝对路径，改机器需相应修改 plist）。
set -euo pipefail

LABEL="com.yuyue.web-game-manager"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_PLIST="${ROOT_DIR}/packaging/launchd/${LABEL}.plist"
DST_PLIST="/Library/LaunchDaemons/${LABEL}.plist"

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "此操作需要 root：请重新用 sudo 执行。" >&2
    exit 1
  fi
}

# 存在旧版就先 bootout（idempotent 安装）。
bootout_if_loaded() {
  if launchctl print "system/${LABEL}" >/dev/null 2>&1; then
    echo "→ 卸载已加载的 ${LABEL}…"
    launchctl bootout "system/${LABEL}" || true
  fi
}

# 让 shell-daemon 版本（scripts/web-service.sh 起的）先退场，避免抢 8787 端口。
stop_shell_daemon() {
  local pid_file="${ROOT_DIR}/.run/web.pid"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "→ 检测到 shell-daemon PID=${pid}，先停掉…"
      # 用项目脚本停，它会校验进程归属，不会误杀。
      bash "${SCRIPT_DIR}/web-service.sh" stop || true
    fi
  fi
}

install_cmd() {
  require_root
  if [[ ! -f "${SRC_PLIST}" ]]; then
    echo "找不到 ${SRC_PLIST}，请先 git pull。" >&2
    exit 1
  fi
  stop_shell_daemon
  bootout_if_loaded

  echo "→ 复制 plist 到 ${DST_PLIST}…"
  install -o root -g wheel -m 0644 "${SRC_PLIST}" "${DST_PLIST}"

  echo "→ launchctl bootstrap…"
  launchctl bootstrap system "${DST_PLIST}"
  launchctl enable "system/${LABEL}"

  echo "→ 等待端口 8787 起来…"
  local attempt
  for attempt in {1..30}; do
    if lsof -nP -tiTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "✓ 已启动。"
      status_cmd
      return 0
    fi
    sleep 0.5
  done
  echo "⚠️ 30 秒内未监听 8787，请查看 .run/web.log。" >&2
  status_cmd
  exit 1
}

uninstall_cmd() {
  require_root
  bootout_if_loaded
  if [[ -f "${DST_PLIST}" ]]; then
    echo "→ 备份并删除 ${DST_PLIST}…"
    cp "${DST_PLIST}" "${DST_PLIST}.bak"
    rm -f "${DST_PLIST}"
  fi
  echo "✓ 已卸载。plist 备份：${DST_PLIST}.bak"
}

status_cmd() {
  if launchctl print "system/${LABEL}" >/dev/null 2>&1; then
    launchctl print "system/${LABEL}" | grep -E "^\s+(state|pid|last exit code|program)\b" || true
  else
    echo "未加载。"
  fi
}

case "${1:-}" in
  install)   install_cmd ;;
  uninstall) uninstall_cmd ;;
  status)    status_cmd ;;
  *)
    echo "用法：sudo bash scripts/install-launchd.sh {install|uninstall|status}" >&2
    exit 1
    ;;
esac
