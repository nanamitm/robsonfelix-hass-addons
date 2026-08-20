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

installed=$(cat "$VERSION_FILE" 2>/dev/null || true)
if [ "$version" = "$installed" ] && [ -x "$BIN_DIR/codex" ]; then
    echo "[install-codex] codex $version already installed"
    exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Each of these tarballs holds exactly one file, named after the asset without
# the .tar.gz suffix.
install_asset() {
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
    # Replace in place: an update runs while the old binary may still be open.
    mv "$tmp/${asset%.tar.gz}" "$dest.new"
    chmod +x "$dest.new"
    mv "$dest.new" "$dest"
}

install_asset "codex-$TARGET.tar.gz" "$BIN_DIR/codex"

# Codex looks for bubblewrap next to its own executable before falling back to
# PATH, and panics without it as soon as a sandboxed command runs. Only the
# read-only and workspace-write sandbox modes need it, so a failure here is not
# fatal.
if ! install_asset "bwrap-$TARGET.tar.gz" "$BIN_DIR/codex-resources/bwrap"; then
    echo "[install-codex] bubblewrap unavailable; only sandbox_mode=danger-full-access will work" >&2
fi

"$BIN_DIR/codex" --version > /dev/null 2>&1 || {
    echo "[install-codex] the installed binary does not run" >&2
    exit 1
}

mkdir -p "$(dirname "$VERSION_FILE")"
printf '%s\n' "$version" > "$VERSION_FILE"
echo "[install-codex] codex $version installed"
