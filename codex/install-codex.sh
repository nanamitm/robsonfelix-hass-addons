#!/bin/sh
# Install the packaged Codex CLI into /opt/codex/<version> and link it into
# /usr/local/bin. Run at build time and again at startup when
# auto_update_codex is on.
#
# Codex has to be installed as its complete release package, not as the bare
# binary: the TUI starts a shared background server (the app-server daemon) by
# default, and that refuses to run unless the CLI sits inside a package with a
# codex-package.json manifest ("this CLI has no complete local package"). The
# package also carries the helpers Codex looks for relative to that manifest -
# bubblewrap for the sandbox modes, the code-mode host and ripgrep - so they no
# longer have to be fetched one by one.
#
# The package deliberately does not live under CODEX_HOME the way the upstream
# installer puts it: CODEX_HOME here is /homeassistant/.codex, which is part of
# every Home Assistant backup, and the package unpacks to ~450 MB.
#
# Release metadata comes from releases.openai.com rather than the GitHub API,
# which rate-limits unauthenticated callers to 60 requests per hour per IP -
# shared by everyone behind the same address.
set -eu

ARCH="${1:-${BUILD_ARCH:-}}"
CHANNEL_URL="https://releases.openai.com/codex/channels/latest"
BIN_DIR=/usr/local/bin
PKG_ROOT=/opt/codex
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

CODEX_LINK="$BIN_DIR/codex"
PKG_DIR="$PKG_ROOT/$version"

# The manifest is checked as well as the binaries, so an install made by an
# earlier version of this script - bare binaries in /usr/local/bin, no
# package - is replaced even when its version is already the latest.
installed=$(cat "$VERSION_FILE" 2>/dev/null || true)
if [ "$version" = "$installed" ] \
    && [ -f "$PKG_DIR/codex-package.json" ] \
    && [ -x "$PKG_DIR/bin/codex" ] \
    && [ -x "$PKG_DIR/bin/codex-code-mode-host" ] \
    && [ -x "$PKG_DIR/codex-resources/bwrap" ] \
    && [ "$(readlink "$CODEX_LINK" 2>/dev/null)" = "$PKG_DIR/bin/codex" ]; then
    echo "[install-codex] codex $version already installed"
    exit 0
fi

asset="codex-package-$TARGET.tar.gz"
url=$(printf '%s' "$meta" | jq -r --arg a "$asset" '.assets[] | select(.name == $a) | .browser_download_url')
want=$(printf '%s' "$meta" | jq -r --arg a "$asset" '.assets[] | select(.name == $a) | .digest' | sed 's/^sha256://')
if [ -z "$url" ] || [ "$url" = "null" ]; then
    echo "[install-codex] release $version has no asset named $asset" >&2
    exit 1
fi

# Staged next to the live package so the final swap is a rename on the same
# filesystem. Each version gets its own directory, so the package the link
# currently points at is never modified in place. Nothing that already works is touched until the new package has
# been fetched, verified and proved to run here.
tmp=$(mktemp -d)
staged="$PKG_DIR.new"
trap 'rm -rf "$tmp" "$staged"' EXIT
rm -rf "$staged"

curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors "$url" -o "$tmp/$asset"
if [ -n "$want" ] && [ "$want" != "null" ]; then
    got=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
    if [ "$got" != "$want" ]; then
        echo "[install-codex] checksum mismatch for $asset" >&2
        exit 1
    fi
fi

# The tarball has the package layout at its root: codex-package.json, bin/,
# codex-resources/ and codex-path/.
mkdir -p "$staged"
tar xzf "$tmp/$asset" -C "$staged"
rm -f "$tmp/$asset"

pkg_version=$(jq -r '.version' "$staged/codex-package.json" 2>/dev/null || true)
if [ "$pkg_version" != "$version" ]; then
    echo "[install-codex] $asset is not a codex $version package (got: ${pkg_version:-none})" >&2
    exit 1
fi

# Prove the new CLI runs before replacing the working one. This is what turns a
# broken upstream release into a warning and an unchanged install, rather than
# an add-on with no usable codex until the image is rebuilt - the failure mode
# the Claude Code add-on this derives from had to recover from.
if ! "$staged/bin/codex" --version > /dev/null 2>&1; then
    echo "[install-codex] codex $version does not run here; keeping the installed version" >&2
    exit 1
fi

# The package ships these, but warn rather than fail if a release drops one,
# matching what each of them costs when it is missing.
if [ ! -x "$staged/codex-resources/bwrap" ]; then
    echo "[install-codex] package has no bubblewrap; only sandbox_mode=danger-full-access will work" >&2
fi
if [ ! -x "$staged/bin/codex-code-mode-host" ]; then
    echo "[install-codex] package has no code-mode host; code mode will stay disabled" >&2
fi

# Commit: move the package into place, then repoint the link with a rename so
# /usr/local/bin/codex always resolves to one complete package - the old one
# until the rename, the new one after it. The one exception is a reinstall of
# the version already linked (a release missing a helper fails the guard on
# every run), where the link dangles between the rm and the mv below.
rm -rf "$PKG_DIR"
mv "$staged" "$PKG_DIR"
ln -sfn "$PKG_DIR/bin/codex" "$CODEX_LINK.new"
mv -f "$CODEX_LINK.new" "$CODEX_LINK"

# Only now drop the packages no longer linked, including a running session's:
# Linux keeps an executing binary alive until it exits.
for dir in "$PKG_ROOT"/*; do
    [ "$dir" = "$PKG_DIR" ] || rm -rf "$dir"
done

# Clear out what earlier versions of this script installed as loose files.
# /usr/local/bin/codex itself was just replaced by the link above.
rm -rf "$BIN_DIR/codex-code-mode-host" "$BIN_DIR/codex-resources"

mkdir -p "$(dirname "$VERSION_FILE")"
printf '%s\n' "$version" > "$VERSION_FILE"
echo "[install-codex] codex $version installed"
