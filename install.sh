#!/usr/bin/env bash
#
# One-shot installer for the MongoDB cleanup tool. macOS only.
#
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | bash
#
# or, from a checkout you already have:
#
#   ./install.sh
#
# It fetches the code, installs a private copy of Node.js, puts a
# `mongo-cleanup` command on your PATH, and walks you through connecting to
# your database. Nothing is installed system-wide and nothing needs sudo.
#
# Options:
#   --system-node   use the Node.js already on this machine instead of
#                   downloading a private one (for development)

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/OWNER/REPO.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/share/mongo-cleanup}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
COMMAND_NAME="mongo-cleanup"

# Pinned so every install gets a runtime that has actually been tested with
# this tool. Bump deliberately; the checksum is fetched from the same release.
NODE_VERSION="${NODE_VERSION:-v24.20.0}"
NODE_DIST="${NODE_DIST:-https://nodejs.org/dist}"
MIN_NODE_MAJOR=18

USE_SYSTEM_NODE="${USE_SYSTEM_NODE:-0}"
for arg in "$@"; do
  case "$arg" in
    --system-node) USE_SYSTEM_NODE=1 ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^#\{1,2\} \{0,1\}//'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; RESET=""
fi

step() { printf '\n%s==>%s %s\n' "$BOLD" "$RESET" "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '    %s!%s %s\n' "$RED" "$RESET" "$1"; }
die()  { printf '\n%sInstall failed:%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# When piped from curl, stdin is the script itself — read answers from the
# terminal instead, so prompts here and in setup.js get a real person.
# Existing and readable isn't enough: with no controlling terminal (cron, a
# container, some CI shells) /dev/tty is there but opening it fails.
if (: < /dev/tty) 2>/dev/null; then
  TTY=/dev/tty
else
  TTY=""
fi

# Ask a yes/no question on the terminal. Defaults to yes; answers no when
# there's nobody to ask, so an unattended run never hangs.
confirm() {
  local reply
  [ -n "$TTY" ] || return 1
  printf '    %s [Y/n] ' "$1"
  read -r reply < "$TTY"
  case "$reply" in n|N|no|NO|No) return 1 ;; *) return 0 ;; esac
}

# ---------------------------------------------------------------- checks ----

[ "$(uname -s)" = "Darwin" ] ||
  die "This installer is for macOS only (found $(uname -s))."

step "Checking prerequisites"

if ! have git; then
  info "git is missing. macOS ships it with the Xcode command line tools."
  if confirm "Install them now? (a system dialog will open)"; then
    xcode-select --install 2>/dev/null || true
    die "Finish the install in the dialog that opened, then run this again."
  fi
  die "git is required. Install it with: xcode-select --install"
fi
info "git $(git --version | awk '{print $3}')"

# ------------------------------------------------------------- the code ----

# Running from inside a checkout? Use it instead of cloning over the top.
SOURCE_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  CANDIDATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -f "$CANDIDATE/cleanup.js" ] && SOURCE_DIR="$CANDIDATE"
fi

if [ -n "$SOURCE_DIR" ]; then
  step "Using the checkout you're running from"
  INSTALL_DIR="$SOURCE_DIR"
  info "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  step "Updating the existing install"
  git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH" ||
    die "Could not reach $REPO_URL. Check your internet connection."
  git -C "$INSTALL_DIR" reset --quiet --hard "origin/$BRANCH"
  info "$INSTALL_DIR"
else
  step "Downloading the tool"
  case "$REPO_URL" in
    *OWNER/REPO*) die "REPO_URL is still the placeholder. Set it at the top of install.sh." ;;
  esac
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR" ||
    die "Could not clone $REPO_URL. Check your internet connection."
  info "$INSTALL_DIR"
fi

# ----------------------------------------------------------- the runtime ----

RUNTIME_DIR="$INSTALL_DIR/runtime"

node_major_of() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$USE_SYSTEM_NODE" = "1" ]; then
  step "Using the system Node.js"
  have node || die "--system-node was given but no node is on PATH."
  [ "$(node_major_of node)" -ge "$MIN_NODE_MAJOR" ] ||
    die "Node.js $MIN_NODE_MAJOR or newer is required (found $(node --version))."
  NODE_BIN="$(command -v node)"
  info "$NODE_BIN ($(node --version))"
else
  case "$(uname -m)" in
    arm64)  NODE_ARCH="arm64" ;;   # Apple Silicon
    x86_64) NODE_ARCH="x64" ;;     # Intel
    *)      die "Unsupported processor: $(uname -m)" ;;
  esac

  NODE_BIN="$RUNTIME_DIR/bin/node"
  TARBALL="node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"

  if [ -x "$NODE_BIN" ] && [ "v$("$NODE_BIN" -p 'process.versions.node')" = "$NODE_VERSION" ]; then
    step "Node.js $NODE_VERSION is already installed"
    info "$RUNTIME_DIR"
  else
    step "Installing a private copy of Node.js $NODE_VERSION ($NODE_ARCH)"
    info "This is used only by this tool. Nothing else on your Mac changes."

    TMP="$(mktemp -d)"
    # shellcheck disable=SC2064 — expand TMP now, not at trap time
    trap "rm -rf '$TMP'" EXIT

    curl -fL --progress-bar -o "$TMP/$TARBALL" "$NODE_DIST/$NODE_VERSION/$TARBALL" ||
      die "Could not download Node.js. Check your internet connection."

    # The release's own checksum file, so a truncated or tampered download is
    # caught before anything is extracted.
    curl -fsSL -o "$TMP/SHASUMS256.txt" "$NODE_DIST/$NODE_VERSION/SHASUMS256.txt" ||
      die "Could not download the Node.js checksum file."
    (cd "$TMP" && grep " $TARBALL\$" SHASUMS256.txt | shasum -a 256 -c --status) ||
      die "The downloaded Node.js failed its checksum check. Try again."

    rm -rf "$RUNTIME_DIR"
    mkdir -p "$RUNTIME_DIR"
    tar -xzf "$TMP/$TARBALL" -C "$RUNTIME_DIR" --strip-components 1 ||
      die "Could not unpack Node.js."

    # 65 MB of C++ headers and man pages that only matter when compiling
    # native addons against Node. Nothing here does.
    rm -rf "$RUNTIME_DIR/include" "$RUNTIME_DIR/share" "$RUNTIME_DIR/CHANGELOG.md"

    rm -rf "$TMP"
    trap - EXIT
    info "$RUNTIME_DIR ($(du -sh "$RUNTIME_DIR" | awk '{print $1}') on disk)"
  fi
fi

# npm's launcher is a #!/usr/bin/env node script, so the runtime has to be
# first on PATH for the duration of the install.
NODE_BIN_DIR="$(dirname "$NODE_BIN")"

step "Installing dependencies"
(cd "$INSTALL_DIR" && PATH="$NODE_BIN_DIR:$PATH" npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null) ||
  die "Could not install dependencies — see the npm output above."
info "done"

# ---------------------------------------------------------- the command ----

step "Adding the '$COMMAND_NAME' command"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/$COMMAND_NAME" <<LAUNCHER
#!/usr/bin/env bash
exec "$NODE_BIN" "$INSTALL_DIR/cleanup.js" "\$@"
LAUNCHER
chmod +x "$BIN_DIR/$COMMAND_NAME"
info "$BIN_DIR/$COMMAND_NAME"

# $BIN_DIR is the standard user bin directory, but it isn't always on PATH.
ON_PATH=0
case ":$PATH:" in *":$BIN_DIR:"*) ON_PATH=1 ;; esac

if [ "$ON_PATH" -eq 0 ]; then
  case "$(basename "${SHELL:-zsh}")" in
    zsh)  PROFILE="$HOME/.zshrc" ;;
    bash) PROFILE="$HOME/.bash_profile" ;;
    *)    PROFILE="$HOME/.profile" ;;
  esac

  LINE="export PATH=\"$BIN_DIR:\$PATH\""
  if ! grep -qsF "$LINE" "$PROFILE"; then
    printf '\n# Added by the mongo-cleanup installer\n%s\n' "$LINE" >> "$PROFILE"
    info "Added $BIN_DIR to your PATH in $PROFILE"
  fi
  warn "Open a new terminal before running '$COMMAND_NAME' for the first time."
fi

# ------------------------------------------------------------ the .env -----

step "Connecting to your database"
if [ -n "$TTY" ]; then
  (cd "$INSTALL_DIR" && "$NODE_BIN" scripts/setup.js < "$TTY")
else
  warn "No terminal available for the questions — finish setup later by running:"
  info "cd $INSTALL_DIR && ./install.sh"
fi

printf '\n%sInstalled.%s Run %s%s%s whenever the database gets full.\n' \
  "$GREEN" "$RESET" "$BOLD" "$COMMAND_NAME" "$RESET"
printf '%sTo reconfigure later: %s%s\n' \
  "$DIM" "$COMMAND_NAME --setup" "$RESET"
