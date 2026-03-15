#!/bin/bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ORACLE_HOST="${ORACLE_HOST:-127.0.0.1}"
ORACLE_PORT="${ORACLE_PORT:-8000}"
ORACLE_HEALTH_URL="${ORACLE_HEALTH_URL:-http://${ORACLE_HOST}:${ORACLE_PORT}/docs}"
ORACLE_RUNTIME_ROOT="${ORACLE_RUNTIME_ROOT:-${HOME}/.cache/pg3-oracle}"
ORACLE_VENV_DIR="${ORACLE_VENV_DIR:-${ORACLE_RUNTIME_ROOT}/venv}"
ORACLE_LOG_FILE="${ORACLE_LOG_FILE:-${ORACLE_RUNTIME_ROOT}/oracle.log}"
ORACLE_PID_FILE="${ORACLE_PID_FILE:-${ORACLE_RUNTIME_ROOT}/oracle.pid}"
ORACLE_REQUIREMENTS_FILE="${ORACLE_REQUIREMENTS_FILE:-${SCRIPT_DIR}/requirements.txt}"
ORACLE_SERVER_FILE="${ORACLE_SERVER_FILE:-${SCRIPT_DIR}/server.py}"
ORACLE_REQUIREMENTS_STAMP="${ORACLE_REQUIREMENTS_STAMP:-${ORACLE_RUNTIME_ROOT}/requirements.sha256}"
ORACLE_PYTHON_BIN="${ORACLE_PYTHON_BIN:-python3}"
ORACLE_START_TIMEOUT_SECONDS="${ORACLE_START_TIMEOUT_SECONDS:-90}"
ORACLE_START_POLL_SECONDS="${ORACLE_START_POLL_SECONDS:-2}"
ORACLE_INSTALL_PLAYWRIGHT="${ORACLE_INSTALL_PLAYWRIGHT:-auto}"
ORACLE_PLAYWRIGHT_BROWSER="${ORACLE_PLAYWRIGHT_BROWSER:-chromium}"

/bin/mkdir -p "${ORACLE_RUNTIME_ROOT}"

venv_python() {
  echo "${ORACLE_VENV_DIR}/bin/python"
}

venv_pip() {
  echo "${ORACLE_VENV_DIR}/bin/pip"
}

http_ready() {
  if command -v curl >/dev/null 2>&1; then
    curl --silent --fail --max-time 2 "${ORACLE_HEALTH_URL}" >/dev/null 2>&1
    return $?
  fi

  "${ORACLE_PYTHON_BIN}" - "${ORACLE_HEALTH_URL}" <<'PY' >/dev/null 2>&1
import sys
import urllib.request

url = sys.argv[1]
with urllib.request.urlopen(url, timeout=2) as response:
    if response.status >= 400:
        raise SystemExit(1)
PY
}

find_server_pids() {
  ps -eo pid=,command= | awk -v target="${ORACLE_SERVER_FILE}" '
    index($0, target) && $0 !~ /awk/ { print $1 }
  '
}

requirements_fingerprint() {
  "${ORACLE_PYTHON_BIN}" - "${ORACLE_REQUIREMENTS_FILE}" <<'PY'
import hashlib
import pathlib
import sys

requirements_path = pathlib.Path(sys.argv[1])
digest = hashlib.sha256(requirements_path.read_bytes()).hexdigest()
print(digest)
PY
}

module_smoke_test() {
  local python_bin
  python_bin="$(venv_python)"

  "${python_bin}" - <<'PY' >/dev/null
import crawl4ai  # noqa: F401
import fastapi  # noqa: F401
import pydantic  # noqa: F401
import uvicorn  # noqa: F401
PY
}

browser_cache_present() {
  compgen -G "${HOME}/.cache/ms-playwright/chromium*" >/dev/null 2>&1 || \
    compgen -G "${HOME}/.cache/ms-playwright/chromium_headless_shell*" >/dev/null 2>&1
}

needs_bootstrap() {
  local python_bin
  python_bin="$(venv_python)"

  if [[ ! -x "${python_bin}" || ! -f "${ORACLE_VENV_DIR}/pyvenv.cfg" ]]; then
    return 0
  fi

  if ! module_smoke_test; then
    return 0
  fi

  if [[ ! -f "${ORACLE_REQUIREMENTS_STAMP}" ]]; then
    return 0
  fi

  local current_hash
  current_hash="$(requirements_fingerprint)"
  if [[ "$(cat "${ORACLE_REQUIREMENTS_STAMP}")" != "${current_hash}" ]]; then
    return 0
  fi

  return 1
}

bootstrap_env() {
  if ! needs_bootstrap; then
    echo "Oracle environment is already healthy at ${ORACLE_VENV_DIR}"
    return
  fi

  echo "Bootstrapping Oracle environment at ${ORACLE_VENV_DIR}"
  /bin/rm -rf "${ORACLE_VENV_DIR}"
  "${ORACLE_PYTHON_BIN}" -m venv "${ORACLE_VENV_DIR}"

  local pip_bin
  local python_bin
  pip_bin="$(venv_pip)"
  python_bin="$(venv_python)"

  "${pip_bin}" install --upgrade pip 'setuptools<81' wheel
  "${pip_bin}" install -r "${ORACLE_REQUIREMENTS_FILE}"

  case "${ORACLE_INSTALL_PLAYWRIGHT}" in
    true)
      "${python_bin}" -m playwright install "${ORACLE_PLAYWRIGHT_BROWSER}"
      ;;
    auto)
      if ! browser_cache_present; then
        "${python_bin}" -m playwright install "${ORACLE_PLAYWRIGHT_BROWSER}"
      fi
      ;;
    false)
      ;;
    *)
      echo "Unsupported ORACLE_INSTALL_PLAYWRIGHT=${ORACLE_INSTALL_PLAYWRIGHT}" >&2
      exit 1
      ;;
  esac

  module_smoke_test
  requirements_fingerprint > "${ORACLE_REQUIREMENTS_STAMP}"
}

stop_server() {
  local pids=()

  if [[ -f "${ORACLE_PID_FILE}" ]]; then
    pids+=("$(cat "${ORACLE_PID_FILE}")")
  fi

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && pids+=("${pid}")
  done < <(find_server_pids || true)

  if [[ "${#pids[@]}" -eq 0 ]]; then
    rm -f "${ORACLE_PID_FILE}"
    return
  fi

  local unique_pids
  unique_pids="$(printf '%s\n' "${pids[@]}" | sort -u | tr '\n' ' ')"
  if [[ -n "${unique_pids// }" ]]; then
    /bin/kill -TERM ${unique_pids} 2>/dev/null || true
    /bin/sleep 3
    /bin/kill -KILL ${unique_pids} 2>/dev/null || true
  fi

  rm -f "${ORACLE_PID_FILE}"
}

wait_for_health() {
  local elapsed=0
  while (( elapsed < ORACLE_START_TIMEOUT_SECONDS )); do
    if http_ready; then
      return 0
    fi
    /bin/sleep "${ORACLE_START_POLL_SECONDS}"
    elapsed=$((elapsed + ORACLE_START_POLL_SECONDS))
  done

  echo "Oracle failed to become healthy at ${ORACLE_HEALTH_URL}" >&2
  if [[ -f "${ORACLE_LOG_FILE}" ]]; then
    echo "--- Oracle log tail ---" >&2
    tail -n 80 "${ORACLE_LOG_FILE}" >&2 || true
  fi
  return 1
}

start_server() {
  if http_ready; then
    echo "Oracle already healthy at ${ORACLE_HEALTH_URL}"
    return
  fi

  bootstrap_env
  stop_server

  local python_bin
  python_bin="$(venv_python)"

  /bin/mkdir -p "$(dirname "${ORACLE_LOG_FILE}")"
  nohup env PYTHONUNBUFFERED=1 "${python_bin}" "${ORACLE_SERVER_FILE}" >> "${ORACLE_LOG_FILE}" 2>&1 &
  echo $! > "${ORACLE_PID_FILE}"

  wait_for_health
}

status() {
  echo "oracle_runtime_root=${ORACLE_RUNTIME_ROOT}"
  echo "oracle_venv_dir=${ORACLE_VENV_DIR}"
  echo "oracle_log_file=${ORACLE_LOG_FILE}"
  echo "oracle_health_url=${ORACLE_HEALTH_URL}"
  if http_ready; then
    echo "oracle_health=healthy"
  else
    echo "oracle_health=offline"
  fi

  local pids
  pids="$(find_server_pids || true)"
  if [[ -n "${pids}" ]]; then
    echo "oracle_pids=${pids//$'\n'/,}"
  else
    echo "oracle_pids="
  fi
}

COMMAND="${1:-ensure}"

case "${COMMAND}" in
  bootstrap)
    bootstrap_env
    ;;
  start)
    start_server
    ;;
  ensure)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server
    start_server
    ;;
  health)
    if http_ready; then
      echo "healthy"
    else
      echo "offline" >&2
      exit 1
    fi
    ;;
  status)
    status
    ;;
  *)
    echo "Usage: $0 [bootstrap|start|ensure|stop|restart|health|status]" >&2
    exit 1
    ;;
esac
