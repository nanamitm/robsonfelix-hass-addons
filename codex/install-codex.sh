#!/bin/sh
# Install the Codex CLI, and the bubblewrap helper it needs for its sandbox
# modes, into /usr/local/bin. Run at build time and again at startup when
# auto_update_codex is on.
#
# The binary deliberately does not live under CODEX_HOME the way the upstream
# installer puts it: CODEX_HOME here is /homeassistant/.codex, which is part of
# every Home Assistant backup, and the release unpacks to ~250 MB.
#
# Release metadata comes from releases.openai.com rather than the GitHub API,
# which rate-limits unauthenticated callers to 60 requests per hour per IP -
# shared by everyone behind the same address.
set -eu

ARCH="${1:-${BUILD_ARCH:-}}"
CHANNEL_URL="https://releases.openai.com/codex/channels/latest"
BIN_DIR=/usr/local/bin
VERSION_FILE=/etc/codex/installed-version

case "$ARCH" in
    amd64 | x86_64) TARGET=x86_64-unknown-linux-musl ;;
    aarch64 | arm64) TARGET=aarch64-unknown-linux-musl ;;
    *)
        echo "[install-codex] unsupported architecture: ${ARCH:-<unset>}" >&2
        exit 1
        ;;
esac

meta=$(curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors "$CHANNEL_URL")
version=$(printf '%s' "$meta" | jq -r '.tag_name | sub("^rust-v"; "")')
if [ -z "$version" ] || [ "$version" = "null" ]; then
    echo "[install-codex] could not resolve the latest release" >&2
    exit 1
fi

CODEX_BIN="$BIN_DIR/codex"
CODE_MODE_BIN="$BIN_DIR/codex-code-mode-host"
BWRAP_BIN="$BIN_DIR/codex-resources/bwrap"

# All three have to be present, not just the CLI: the helpers install
# non-fatally, so a transient failure to fetch one would otherwise be frozen in
# place until upstream cuts a new release.
installed=$(cat "$VERSION_FILE" 2>/dev/null || true)
if [ "$version" = "$installed" ] \
    && [ -x "$CODEX_BIN" ] \
    && [ -x "$CODE_MODE_BIN" ] \
    && [ -x "$BWRAP_BIN" ]; then
    echo "[install-codex] codex $version already installed"
    exit 0
fi

tmp=$(mktemp -d)

# Downloads one asset and leaves it at "$dest.new", ready to be moved into
# place. Nothing that already works is touched until every artifact has been
# fetched and the new CLI has proved it runs here.
#
# Each of these tarballs holds exactly one file, named after the asset without
# the .tar.gz suffix.
stage_asset() {
    asset="$1"
    dest="$2"

    url=$(printf '%s' "$meta" | jq -r --arg a "$asset" '.assets[] | select(.name == $a) | .browser_download_url')
    want=$(printf '%s' "$meta" | jq -r --arg a "$asset" '.assets[] | select(.name == $a) | .digest' | sed 's/^sha256://')
    if [ -z "$url" ] || [ "$url" = "null" ]; then
        echo "[install-codex] release $version has no asset named $asset" >&2
        return 1
    fi

    curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors "$url" -o "$tmp/$asset"
    if [ -n "$want" ] && [ "$want" != "null" ]; then
        got=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
        if [ "$got" != "$want" ]; then
            echo "[install-codex] checksum mismatch for $asset" >&2
            return 1
        fi
    fi

    tar xzf "$tmp/$asset" -C "$tmp"
    mkdir -p "$(dirname "$dest")"
    mv "$tmp/${asset%.tar.gz}" "$dest.new"
    chmod +x "$dest.new"
}

# Drop anything staged but not committed, so a failed run never leaves a
# half-installed .new file behind for the next one to pick up.
trap 'rm -rf "$tmp" "$CODEX_BIN.new" "$CODE_MODE_BIN.new" "$BWRAP_BIN.new"' EXIT

stage_asset "codex-$TARGET.tar.gz" "$CODEX_BIN"

# Prove the new CLI runs before replacing the working one. This is what turns a
# broken upstream release into a warning and an unchanged install, rather than
# an add-on with no usable codex until the image is rebuilt - the failure mode
# the Claude Code add-on this derives from had to recover from.
if ! "$CODEX_BIN.new" --version > /dev/null 2>&1; then
    echo "[install-codex] codex $version does not run here; keeping the installed version" >&2
    exit 1
fi

# Codex looks for bubblewrap next to its own executable before falling back to
# PATH, and panics without it as soon as a sandboxed command runs. Only the
# read-only and workspace-write sandbox modes need it, so a failure here is not
# fatal.
bwrap_ok=true
if ! stage_asset "bwrap-$TARGET.tar.gz" "$BWRAP_BIN"; then
    bwrap_ok=false
    echo "[install-codex] bubblewrap unavailable; only sandbox_mode=danger-full-access will work" >&2
fi

# Code mode runs tool calls as code in a separate host process, which Codex
# looks for next to its own executable. Without it Codex warns on every start
# and fails code mode closed, so ship it too.
code_mode_ok=true
if ! stage_asset "codex-code-mode-host-$TARGET.tar.gz" "$CODE_MODE_BIN"; then
    code_mode_ok=false
    echo "[install-codex] code-mode host unavailable; code mode will stay disabled" >&2
fi

# Commit. The CLI goes last so that a crash midway leaves the old CLI paired
# with the old helpers rather than the other way round.
if [ "$bwrap_ok" = true ]; then
    mv "$BWRAP_BIN.new" "$BWRAP_BIN"
fi
if [ "$code_mode_ok" = true ]; then
    mv "$CODE_MODE_BIN.new" "$CODE_MODE_BIN"
fi
mv "$CODEX_BIN.new" "$CODEX_BIN"

# Only claim this version once every artifact is in place, so a partial install
# is retried on the next start instead of being skipped by the guard above.
if [ "$bwrap_ok" = true ] && [ "$code_mode_ok" = true ]; then
    mkdir -p "$(dirname "$VERSION_FILE")"
    printf '%s\n' "$version" > "$VERSION_FILE"
fi
echo "[install-codex] codex $version installed"
