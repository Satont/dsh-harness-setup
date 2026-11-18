#!/usr/bin/env bash
# dsh-desktop — open DeepSeek Harness (DSH) in a dedicated Chromium app-mode window.
#
# DSH (0.2.x) has no Linux desktop build: `dsh web` serves a browser UI and prints a
# one-shot authenticated URL (a fresh random token per launch). This wrapper keeps a
# single DSH server on a fixed port, parses that URL, and hands it to a Chromium-family
# browser in --app mode with a private profile, so the result behaves like a desktop app:
# its own window, its own taskbar entry/icon, persistent cookies and notification
# permission, and a 1:1 window/server lifecycle.
#
# Usage: dsh-desktop [--server-only | --window-only | --status | --stop] [--help]
#
# Environment overrides:
#   DSH_DESKTOP_PORT=3099        server port (fixed so the app has a stable origin)
#   DSH_DESKTOP_HOST=127.0.0.1   bind address
#   DSH_DESKTOP_DSH=/path/to/dsh dsh binary (default: `dsh` from PATH, then known installs)
#   DSH_DESKTOP_BROWSER=/path    Chromium-family binary (default: first working candidate)
#   DSH_DESKTOP_BROWSER_ARGS=""  extra browser flags, whitespace-separated
#   DSH_DESKTOP_OZONE=auto       --ozone-platform-hint value; set to "" to omit the flag
#   DSH_DESKTOP_WAIT=60          seconds to wait for the server URL

set -euo pipefail

PROG=${0##*/}
PORT=${DSH_DESKTOP_PORT:-3099}
HOST=${DSH_DESKTOP_HOST:-127.0.0.1}
STATE_HOME=${XDG_STATE_HOME:-$HOME/.local/state}
DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}
STATE_DIR=$STATE_HOME/dsh-desktop
PROFILE_DIR=$DATA_HOME/dsh-harness/chromium
SERVER_LOG=$STATE_DIR/server.log
PID_FILE=$STATE_DIR/server.pid
URL_FILE=$STATE_DIR/server.url
WAIT_SECONDS=${DSH_DESKTOP_WAIT:-60}
APP_CLASS=DshHarness
APP_NAME=dsh-harness

STARTED_BY_US=0
SERVER_PID=''
ENSURE_URL=''
BROWSER_PID=''
DSH_BIN=''
BROWSER_BIN=''

log() { printf '%s: %s\n' "$PROG" "$*" >&2; }
die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: dsh-desktop [MODE]

Open DeepSeek Harness in a dedicated Chromium app-mode window.

Modes:
  (none)         Start the DSH server if needed, then open the app window.
                 The server is stopped again when the window closes (only if this
                 invocation started it).
  --server-only  Start (or reuse) the managed server and keep running in the
                 foreground until stopped; prints the authenticated URL.
  --window-only  Open the window against an already running managed server.
  --status       Show resolved binaries, display, server state and URL.
  --stop         Stop the managed server (does not touch any other dsh instance).
  -h, --help     This help.

Environment:
  DSH_DESKTOP_PORT (default 3099), DSH_DESKTOP_HOST (127.0.0.1),
  DSH_DESKTOP_DSH, DSH_DESKTOP_BROWSER, DSH_DESKTOP_BROWSER_ARGS,
  DSH_DESKTOP_OZONE (default auto), DSH_DESKTOP_WAIT (60).
EOF
}

have_display() { [[ -n ${WAYLAND_DISPLAY:-} || -n ${DISPLAY:-} ]]; }

# ---------------------------------------------------------------- binaries ---

resolve_dsh() {
  local candidate pattern quiet=${1:-}
  if [[ -n ${DSH_DESKTOP_DSH:-} ]]; then
    [[ -x $DSH_DESKTOP_DSH ]] || { [[ $quiet == --quiet ]] && return 1; die "DSH_DESKTOP_DSH=$DSH_DESKTOP_DSH is not executable"; }
    printf '%s\n' "$DSH_DESKTOP_DSH"
    return 0
  fi
  candidate=$(command -v dsh 2>/dev/null || true)
  if [[ -n $candidate && -x $candidate ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  # Known non-PATH installs: bunx cache, bun global, npm global.
  for pattern in \
    "$HOME/.local/share/mise/installs/node/"*/bin/dsh \
    "$HOME/.local/share/mise/shims/dsh" \
    '/tmp/bunx-*/@deepseek-ai/dsh@latest/node_modules/.bin/dsh' \
    "$HOME/.bun/install/global/node_modules/.bin/dsh" \
    "$HOME/.bun/bin/dsh" \
    "$HOME/.npm-global/bin/dsh" \
    "$HOME/.npm/bin/dsh" \
    "$HOME/.local/bin/dsh" \
    '/usr/local/bin/dsh' \
    '/usr/bin/dsh'; do
    while IFS= read -r candidate; do
      if [[ -n $candidate && -x $candidate ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done < <(compgen -G "$pattern" 2>/dev/null || true)
  done
  [[ $quiet == --quiet ]] && return 1
  cat >&2 <<'EOF'
dsh-desktop: cannot find the `dsh` binary.

Install DSH (npm i -g @deepseek-ai/dsh) or put the launcher on PATH, e.g.:

  export PATH="/tmp/bunx-1000-@deepseek-ai/dsh@latest/node_modules/.bin:$PATH"

or point the wrapper at it explicitly:

  DSH_DESKTOP_DSH=/path/to/node_modules/.bin/dsh dsh-desktop
EOF
  exit 1
}

# Chromium-family check: the binary must exist, run, and be Chromium-based.
browser_works() {
  local bin=$1 out
  [[ -x $bin ]] || return 1
  out=$(timeout 10 "$bin" --version 2>/dev/null) || return 1
  [[ ${out,,} == *chrom* ]]
}

resolve_browser() {
  local candidate quiet=${1:-}
  if [[ -n ${DSH_DESKTOP_BROWSER:-} ]]; then
    [[ -x $DSH_DESKTOP_BROWSER ]] || { [[ $quiet == --quiet ]] && return 1; die "DSH_DESKTOP_BROWSER=$DSH_DESKTOP_BROWSER is not executable"; }
    browser_works "$DSH_DESKTOP_BROWSER" \
      || { [[ $quiet == --quiet ]] && return 1; die "DSH_DESKTOP_BROWSER=$DSH_DESKTOP_BROWSER does not run or is not Chromium-based"; }
    printf '%s\n' "$DSH_DESKTOP_BROWSER"
    return 0
  fi
  # Prefer a well-known system Chrome/Chromium (newer = better Wayland/notification support).
  # Helium first: a real Chromium build (no "Chrome for Testing" banner).
  for candidate in \
    helium-browser helium \
    google-chrome-stable google-chrome chromium chromium-browser \
    brave-browser brave microsoft-edge-stable microsoft-edge \
    vivaldi-stable vivaldi; do
    candidate=$(command -v -- "$candidate" 2>/dev/null || true)
    [[ -n $candidate ]] || continue
    if browser_works "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  for candidate in \
    /opt/google/chrome/chrome \
    /usr/bin/helium-browser \
    /usr/lib/chromium/chromium \
    /snap/bin/chromium; do
    if browser_works "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  # Playwright's Google Chrome for Testing builds (a reliable fallback on this host).
  while IFS= read -r candidate; do
    if browser_works "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(compgen -G "$HOME/.cache/ms-playwright/chromium-*/chrome-linux64/chrome" 2>/dev/null | sort -Vr)
  [[ $quiet == --quiet ]] && return 1
  cat >&2 <<'EOF'
dsh-desktop: no working Chromium-family browser found.

Notes:
  * Firefox/Zen cannot run in app mode with a separate profile, so they are not used.
  * On this host /usr/bin/chromium is broken (missing libsimdutf.so.36).
  * Install google-chrome-stable / fix chromium, or point at a working binary:
      DSH_DESKTOP_BROWSER=/path/to/chrome dsh-desktop
EOF
  exit 1
}

resolve_node() {
  local candidate pattern
  candidate=$(command -v node 2>/dev/null || true)
  if [[ -n $candidate && -x $candidate ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  for pattern in \
    "$HOME/.local/share/mise/installs/node/"*/bin/node \
    "$HOME/.bun/bin/node" \
    "$HOME/.nvm/versions/node/"*/bin/node \
    /usr/local/bin/node \
    /usr/bin/node; do
    while IFS= read -r candidate; do
      if [[ -n $candidate && -x $candidate ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done < <(compgen -G "$pattern" 2>/dev/null || true)
  done
  return 1
}

# Desktop launchers start with a minimal environment: no mise shims, no ~/.local/bin,
# no login-shell PATH. Rebuild the PATH the user gets in a terminal, then put the
# resolved node/dsh next to it, so the server, its shebang (`#!/usr/bin/env node`)
# and the agent's own shell tools all work the same as when started from a terminal.
prepare_runtime() {
  local login_path node_bin
  if [[ -n ${SHELL:-} && -x ${SHELL:-} ]]; then
    login_path=$(timeout 3 "$SHELL" -lc 'printf %s "$PATH"' 2>/dev/null || true)
    [[ -n $login_path ]] && PATH=$login_path
  fi
  node_bin=$(resolve_node || true)
  if [[ -n $node_bin ]]; then
    PATH="$(dirname "$node_bin"):$PATH"
  fi
  if [[ -n ${DSH_BIN:-} ]]; then
    PATH="$(dirname "$DSH_BIN"):$PATH"
  fi
  PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
  export PATH
  if [[ -z $node_bin ]]; then
    log "warning: no node binary found; a dsh launcher whose shebang is '#!/usr/bin/env node' will fail"
  fi
  DSH_NODE_BIN=$node_bin
}

# ------------------------------------------------------------------ server ---

server_pid_alive() {
  local pid cmd
  [[ -f $PID_FILE ]] || return 1
  pid=$(head -n1 "$PID_FILE" 2>/dev/null || true)
  [[ ${pid:-} =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  # Guard against PID reuse: the process must look like our dsh server.
  if [[ -r /proc/$pid/cmdline ]]; then
    cmd=$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)
    [[ $cmd == *dsh* ]] || return 1
    [[ $cmd == *"web"* ]] || return 1
  fi
  printf '%s\n' "$pid"
}

server_url() {
  local url
  [[ -f $URL_FILE ]] || return 1
  url=$(head -n1 "$URL_FILE" 2>/dev/null || true)
  [[ $url == http://* && $url == *token=* ]] || return 1
  printf '%s\n' "$url"
}

port_listening() {
  (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null
}

wait_for_url() {
  local deadline=$((SECONDS + WAIT_SECONDS)) line url
  while ((SECONDS < deadline)); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      log "DSH server exited during startup; last log lines:"
      tail -n 20 "$SERVER_LOG" >&2 || true
      return 1
    fi
    line=$(grep -m1 -oE 'dsh web: https?://[^[:space:]]+' "$SERVER_LOG" 2>/dev/null || true)
    if [[ -n $line ]]; then
      url=${line#dsh web: }
      url=${url%$'\r'}
      if [[ $url == *token=* ]]; then
        printf '%s\n' "$url"
        return 0
      fi
    fi
    sleep 0.25
  done
  return 1
}

start_server() {
  mkdir -p "$STATE_DIR"
  if port_listening; then
    die "port $HOST:$PORT is already in use by another process.
Refusing to touch it (it may be the user's own DSH server). Set DSH_DESKTOP_PORT to a free port."
  fi
  log "starting DSH server on $HOST:$PORT"
  : >"$SERVER_LOG"
  nohup "$DSH_BIN" web --port "$PORT" --no-open --host "$HOST" >>"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  STARTED_BY_US=1
  printf '%s\n' "$SERVER_PID" >"$PID_FILE"
}

# Sets ENSURE_URL (not echoed) because STARTED_BY_US/SERVER_PID must survive in the
# caller's shell — command substitution would run this in a subshell and drop them.
ensure_server() {
  local pid url
  if pid=$(server_pid_alive) && url=$(server_url); then
    log "reusing managed DSH server (pid $pid)"
    ENSURE_URL=$url
    return 0
  fi
  rm -f "$PID_FILE" "$URL_FILE"
  start_server
  url=$(wait_for_url) || {
    stop_server
    die "DSH server did not print an authenticated URL within ${WAIT_SECONDS}s (log: $SERVER_LOG)"
  }
  printf '%s\n' "$url" >"$URL_FILE"
  ENSURE_URL=$url
}

stop_server() {
  local pid
  if pid=$(server_pid_alive); then
    log "stopping managed DSH server (pid $pid)"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE" "$URL_FILE"
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ ${STARTED_BY_US:-0} == 1 ]]; then
    stop_server
  fi
  exit "$rc"
}

# ----------------------------------------------------------------- browser ---

launch_browser() {
  local url=$1
  local -a args extra=()
  # One profile per browser family: switching browsers (Chrome for Testing ->
  # Helium) must not hand the URL off to the other browser's live singleton.
  local profile=$PROFILE_DIR
  case $BROWSER_BIN in
    *helium*) profile=$PROFILE_DIR-helium ;;
    *ms-playwright*) profile=$PROFILE_DIR-cft ;;
  esac
  mkdir -p "$profile"
  args=(
    "--app=$url"
    "--class=$APP_CLASS"
    "--name=$APP_NAME"
    "--user-data-dir=$profile"
    --no-first-run
    --no-default-browser-check
    --password-store=basic
    --window-size=1440,900
  )
  # Prefer a native Wayland window when the session offers one; empty disables the flag.
  local ozone=${DSH_DESKTOP_OZONE-auto}
  if [[ -n $ozone ]]; then
    args+=("--ozone-platform-hint=$ozone")
  fi
  if [[ -n ${DSH_DESKTOP_BROWSER_ARGS:-} ]]; then
    read -r -a extra <<<"$DSH_DESKTOP_BROWSER_ARGS"
    args+=("${extra[@]}")
  fi
  log "opening app window ($BROWSER_BIN)"
  "$BROWSER_BIN" "${args[@]}" &
  BROWSER_PID=$!
  wait "$BROWSER_PID" 2>/dev/null || true
  BROWSER_PID=''
}

# -------------------------------------------------------------------- modes ---

mode_status() {
  local pid url browser_state
  DSH_BIN=$(resolve_dsh --quiet || true)
  BROWSER_BIN=$(resolve_browser --quiet || true)
  printf 'dsh binary:   %s\n' "${DSH_BIN:-<not found>}"
  printf 'node binary:  %s\n' "$(resolve_node 2>/dev/null || printf '<not found>')"
  printf 'browser:      %s\n' "${BROWSER_BIN:-<not found>}"
  printf 'display:      %s\n' "$(have_display && printf 'yes (WAYLAND_DISPLAY=%s DISPLAY=%s)' "${WAYLAND_DISPLAY:-}" "${DISPLAY:-}" || printf 'no')"
  printf 'state dir:    %s\n' "$STATE_DIR"
  printf 'browser data: %s\n' "$PROFILE_DIR"
  if [[ -n $BROWSER_BIN ]]; then
    browser_state=$("$BROWSER_BIN" --version 2>/dev/null || true)
    [[ -n $browser_state ]] && printf 'browser ver:  %s\n' "$browser_state"
    case $BROWSER_BIN in
      *ms-playwright*) printf 'note:         Chrome for Testing shows a "for automated testing" banner; install Helium/Chrome for a clean window\n' ;;
    esac
  fi
  if pid=$(server_pid_alive) && url=$(server_url); then
    printf 'server:       running (pid %s) on %s:%s\n' "$pid" "$HOST" "$PORT"
    printf 'url:          %s\n' "$url"
  else
    printf 'server:       not running\n'
    printf 'port check:   %s\n' "$(port_listening && printf 'in use by another process (leave it alone)' || printf 'free')"
  fi
}

mode_stop() {
  stop_server
  log "stopped (only the managed server on $HOST:$PORT was touched)"
}

mode_server_only() {
  local url
  DSH_BIN=$(resolve_dsh)
  prepare_runtime
  ensure_server
  url=$ENSURE_URL
  log "server ready: $url"
  if [[ ${STARTED_BY_US:-0} == 1 ]]; then
    log "running in the foreground; press Ctrl-C (or run '$PROG --stop') to stop"
    # Wait for the child; trap handles signals.
    wait "$SERVER_PID" || true
    exit 0
  fi
  # Reused an existing managed server: nothing to supervise here.
  exit 0
}

mode_window_only() {
  local url pid
  have_display || die "no graphical display (WAYLAND_DISPLAY/DISPLAY unset); use --server-only for headless use"
  pid=$(server_pid_alive) || die "no managed server is running; launch '$PROG' or '$PROG --server-only' first"
  url=$(server_url) || die "server pid $pid is running but its URL file is missing; run '$PROG --stop' then '$PROG'"
  prepare_runtime
  BROWSER_BIN=$(resolve_browser)
  launch_browser "$url"
}

mode_app() {
  local url
  have_display || die "no graphical display (WAYLAND_DISPLAY/DISPLAY unset); use --server-only for headless use"
  DSH_BIN=$(resolve_dsh)
  prepare_runtime
  BROWSER_BIN=$(resolve_browser)
  ensure_server
  url=$ENSURE_URL
  log "authenticated URL acquired"
  launch_browser "$url"
  log "window closed"
}

main() {
  [[ $# -eq 0 ]] && set -- --app
  while (($#)); do
    case $1 in
      --app) MODE=app ;;
      --server-only) MODE=server-only ;;
      --window-only) MODE=window-only ;;
      --status) MODE=status ;;
      --stop) MODE=stop ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
  done
  MODE=${MODE:-app}

  mkdir -p "$STATE_DIR"
  trap cleanup EXIT INT TERM

  case $MODE in
    app) mode_app ;;
    server-only) mode_server_only ;;
    window-only) mode_window_only ;;
    status) mode_status; trap - EXIT INT TERM ;;
    stop) mode_stop; trap - EXIT INT TERM ;;
    *) die "internal error: unknown mode $MODE" ;;
  esac
}

main "$@"
