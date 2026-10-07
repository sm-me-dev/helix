#!/usr/bin/env bash
#
# helix installer — Linux, macOS, WSL, Git Bash.
#
# Quick start (once the repo is public):
#   curl --fail --proto '=https' --tlsv1.2 -sSL \
#     https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh \
#     -o /tmp/helix-install.sh
#   less /tmp/helix-install.sh   # inspect before running
#   bash /tmp/helix-install.sh
#
# One-liner (convenient, higher trust — see docs/INSTALL.md):
#   curl --fail --proto '=https' --tlsv1.2 -sSL \
#     https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh | bash
#
# The installer never needs sudo and never touches system dirs.
# Everything happens in user space (default: ~/helix).
#
# Exit codes: 0 ok, 1 usage/env error, 2 missing dependency, 3 network/git error,
#             4 node toolchain error, 5 install/verify error.

set -Eeuo pipefail
shopt -s inherit_errexit 2>/dev/null || true
IFS=$'\n\t'

VERSION="1.0.0"
REPO_URL="https://github.com/sm-me-dev/helix.git"
MIN_NODE_MAJOR=20
PREFERRED_NODE_MAJOR=22
DEFAULT_DIR="${HOME}/helix"
DEFAULT_REF="main"

DIR="${HELIX_DIR:-$DEFAULT_DIR}"
REF="${HELIX_REF:-$DEFAULT_REF}"
ASSUME_YES=0
DRY_RUN=0
SKIP_NODE=0
SKIP_DEPS=0
SKIP_PLAYWRIGHT=0
NO_VERIFY=0

# ---------- logging ----------
_use_color=0
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  _use_color=1
fi

_c() { [[ $_use_color -eq 1 ]] && printf '\033[%sm' "$1" || true; }
_rst() { [[ $_use_color -eq 1 ]] && printf '\033[0m' || true; }

log_info() { printf '%s[helix]%s %s\n' "$(_c 34)" "$(_rst)" "$*"; }
log_ok() { printf '%s[helix]%s %s\n' "$(_c 32)" "$(_rst)" "$*"; }
log_warn() { printf '%s[helix warn]%s %s\n' "$(_c 33)" "$(_rst)" "$*" >&2; }
log_error() { printf '%s[helix error]%s %s\n' "$(_c 31)" "$(_rst)" "$*" >&2; }

die() { log_error "$*"; exit "${2:-1}"; }

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

usage() {
  cat <<USAGE
helix installer v${VERSION} — Linux / macOS / WSL / Git Bash

Usage:
  bash install.sh [options]
  curl .../scripts/install.sh | bash -s -- [options]

Options:
  --dir PATH          Install directory (default: \$HELIX_DIR or ~/helix)
  --ref REF           Git branch, tag, or commit (default: \$HELIX_REF or main)
  --yes, -y           Non-interactive (assume yes)
  --dry-run           Print what would happen, change nothing
  --skip-node         Do not check or install Node.js
  --skip-deps         Do not run npm ci/install
  --skip-playwright   Do not install Playwright Chromium
  --no-verify         Skip typecheck verification
  --trace             Enable 'set -x' debugging
  --version           Print version and exit
  --help, -h          Show this help and exit

Env:
  HELIX_DIR, HELIX_REF, NO_COLOR, GH_TOKEN (private-repo clone over HTTPS)

Examples:
  bash install.sh --dir ~/code/helix --ref main
  bash install.sh --dry-run
  HELIX_DIR=~/helix bash install.sh --yes --skip-playwright
USAGE
}

# ---------- args ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a value}"; shift 2 ;;
    --dir=*) DIR="${1#*=}"; shift ;;
    --ref) REF="${2:?--ref needs a value}"; shift 2 ;;
    --ref=*) REF="${1#*=}"; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-node) SKIP_NODE=1; shift ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    --skip-playwright) SKIP_PLAYWRIGHT=1; shift ;;
    --no-verify) NO_VERIFY=1; shift ;;
    --trace) set -x; shift ;;
    --version) printf 'helix-install %s\n' "$VERSION"; exit 0 ;;
    --help|-h) usage; exit 0 ;;
    --) shift; break ;;
    -*) die "Unknown option: $1 (see --help)" 1 ;;
    *) die "Unexpected argument: $1 (see --help)" 1 ;;
  esac
done

# ---------- helpers ----------
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || return 1
}

confirm() {
  if [[ $ASSUME_YES -eq 1 || $DRY_RUN -eq 1 ]]; then
    return 0
  fi
  local reply
  printf '%s [y/N]: ' "$1" >&2
  read -r reply < /dev/tty || return 1
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

os_id() {
  local k="${OSTYPE:-}"
  case "$k" in
    darwin*) printf 'macos\n' ;;
    linux*) printf 'linux\n' ;;
    msys*|cygwin*) printf 'windows-bash\n' ;;
    *) case "$(uname -s 2>/dev/null || printf unknown)" in
         Darwin) printf 'macos\n' ;;
         Linux) printf 'linux\n' ;;
         MINGW*|MSYS*|CYGWIN*) printf 'windows-bash\n' ;;
         *) printf 'unknown\n' ;;
       esac ;;
  esac
}

is_wsl() {
  [[ -f /proc/version ]] && grep -qi microsoft /proc/version 2>/dev/null
}

node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '0'
}

trap_err() {
  local code=$?
  log_error "Installer failed (exit ${code}) at line ${1}. Re-run with --trace for details."
}
trap 'trap_err $LINENO' ERR

# ---------- preflight ----------
main() {
  local os
  os="$(os_id)"
  log_info "helix installer v${VERSION} — os=${os} ref=${REF} dir=${DIR}"

  if is_wsl; then
    log_info "WSL detected — Linux path is used. For a native setup see docs/INSTALL.md (PowerShell)."
  fi
  if [[ "$os" == "unknown" ]]; then
    die "Unsupported OS: ${OSTYPE:-?} / $(uname -s 2>/dev/null || printf '?'). See docs/INSTALL.md." 1
  fi

  need_cmd git || die "git is required but not found. Install git first (see docs/INSTALL.md)." 2
  if ! need_cmd curl; then
    need_cmd wget || die "curl (or wget) is required but neither was found." 2
  fi

  # ----- Node -----
  if [[ $SKIP_NODE -eq 0 ]]; then
    if need_cmd node; then
      local major
      major="$(node_major)"
      if [[ "$major" =~ ^[0-9]+$ ]] && [[ "$major" -ge $MIN_NODE_MAJOR ]]; then
        if [[ "$major" -ne $PREFERRED_NODE_MAJOR ]]; then
          log_warn "Node v${major} detected — works (>=${MIN_NODE_MAJOR}), recommended: v${PREFERRED_NODE_MAJOR} LTS."
        else
          log_ok "Node $(node --version) detected."
        fi
      else
        log_warn "Node v${major} is too old (need >=${MIN_NODE_MAJOR}). Will try to install Node ${PREFERRED_NODE_MAJOR}."
        install_node "$os" || die "Could not install Node automatically. Install Node ${PREFERRED_NODE_MAJOR} LTS manually, or re-run with --skip-node." 4
      fi
    else
      log_info "Node not found — will install Node ${PREFERRED_NODE_MAJOR} LTS."
      install_node "$os" || die "Could not install Node automatically. Install Node ${PREFERRED_NODE_MAJOR} LTS manually, or re-run with --skip-node." 4
    fi
  else
    log_info "--skip-node: leaving the Node toolchain alone."
  fi

  if ! need_cmd npm; then
    die "npm is required but was not found (even after the Node step). Install Node ${PREFERRED_NODE_MAJOR} LTS first." 2
  fi

  # ----- repo -----
  if [[ -d "$DIR/.git" ]]; then
    log_info "Existing checkout at ${DIR} — updating to '${REF}'."
    if [[ $DRY_RUN -eq 1 ]]; then
      printf '[dry-run] git -C %s fetch origin + checkout %s + pull\n' "$DIR" "$REF"
    else
      git -C "$DIR" fetch origin --prune || die "git fetch failed (network or private-repo auth?)." 3
      git -C "$DIR" checkout "$REF" || die "git checkout '${REF}' failed." 3
      git -C "$DIR" pull --ff-only origin "$REF" || log_warn "No fast-forward update available — keeping local state."
    fi
  else
    if [[ -e "$DIR" ]]; then
      die "${DIR} exists but is not a git checkout. Use --dir to pick another path." 1
    fi
    log_info "Cloning ${REPO_URL} (${REF}) into ${DIR}."
    if ! confirm "Clone helix into ${DIR}?"; then
      die "Aborted by user." 1
    fi
    if [[ $DRY_RUN -eq 1 ]]; then
      printf '[dry-run] git clone --branch %s --depth 1 %s %s\n' "$REF" "$REPO_URL" "$DIR"
    else
      git clone --branch "$REF" --depth 1 "$REPO_URL" "$DIR" \
        || die "git clone failed. Private repo? Try: gh auth login, then re-run. (GH_TOKEN is honored.)" 3
    fi
  fi

  # ----- env file (never overwrite) -----
  if [[ -f "$DIR/.env" ]]; then
    log_info ".env already exists — leaving it untouched."
  elif [[ -f "$DIR/.env.example" ]]; then
    log_info "Creating .env from .env.example (local only, never committed)."
    run cp "$DIR/.env.example" "$DIR/.env"
  else
    log_warn "No .env.example found — skipping .env creation."
  fi

  # ----- deps -----
  if [[ $SKIP_DEPS -eq 0 ]]; then
    log_info "Installing dependencies (npm ci, fallback: npm install)."
    if [[ $DRY_RUN -eq 1 ]]; then
      printf '[dry-run] npm --prefix %s ci\n' "$DIR"
    else
      if ! (cd "$DIR" && npm ci --no-audit --no-fund); then
        log_warn "npm ci failed (usually lockfile drift) — trying npm install."
        (cd "$DIR" && npm install --no-audit --no-fund) \
          || die "Dependency install failed." 5
      fi
    fi
  else
    log_info "--skip-deps: skipping npm install."
  fi

  # ----- playwright (optional, chromium only) -----
  if [[ $SKIP_PLAYWRIGHT -eq 0 && $SKIP_DEPS -eq 0 ]]; then
    if [[ -f "$DIR/package.json" ]] && grep -q '"playwright"' "$DIR/package.json"; then
      log_info "Installing Playwright Chromium (used by browser QA)."
      if [[ $DRY_RUN -eq 1 ]]; then
        printf '[dry-run] npx --prefix %s playwright install chromium\n' "$DIR"
      else
        (cd "$DIR" && npx playwright install chromium) \
          || log_warn "Playwright browser install failed — continuing (re-run: npx playwright install chromium)."
      fi
    fi
  fi

  # ----- verify -----
  if [[ $NO_VERIFY -eq 0 && $SKIP_DEPS -eq 0 ]]; then
    log_info "Verifying (npm run typecheck)."
    if [[ $DRY_RUN -eq 1 ]]; then
      printf '[dry-run] npm --prefix %s run typecheck\n' "$DIR"
    else
      (cd "$DIR" && npm run typecheck) || die "Typecheck failed — see output above." 5
    fi
  else
    log_info "Verification skipped (--no-verify or --skip-deps)."
  fi

  log_ok "Done. Next steps:"
  printf '  cd %s\n' "$DIR"
  printf '  npm run dev      # http://localhost:8080\n'
  printf 'Full guide: docs/INSTALL.md\n'
}

install_node() {
  local os="$1"
  case "$os" in
    macos)
      if need_cmd brew; then
        log_info "Installing Node via Homebrew."
        run brew install "node@${PREFERRED_NODE_MAJOR}" || run brew install node
        return 0
      fi
      die "Homebrew not found. Install from https://nodejs.org or: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"" 4
      ;;
    linux)
      # Prefer fnm (user-space, no sudo) when available or installable.
      if need_cmd fnm; then
        run fnm install "$PREFERRED_NODE_MAJOR" && run fnm use "$PREFERRED_NODE_MAJOR"
        return 0
      fi
      if need_cmd apt-get; then
        log_warn "System package manager path needs sudo — prefer a user-space manager."
        log_info "Install fnm (https://github.com/Schniz/fnm), then: fnm install ${PREFERRED_NODE_MAJOR}"
        return 1
      fi
      log_info "Install fnm (https://github.com/Schniz/fnm), then: fnm install ${PREFERRED_NODE_MAJOR}"
      return 1
      ;;
    windows-bash)
      log_info "Git Bash detected — install Node ${PREFERRED_NODE_MAJOR} LTS via winget in PowerShell:"
      printf '  winget install OpenJS.NodeJS.LTS\n'
      return 1
      ;;
    *) return 1 ;;
  esac
}

main "$@"
