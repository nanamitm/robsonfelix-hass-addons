ARG BUILD_FROM

# Build a current ttyd web client: the one embedded in the ttyd 1.7.7 binary
# predates OSC 52 clipboard support, so startup serves this build via --index.
# Built with yarn so ttyd's lockfile is honored (npm resolves newer transitive
# deps and fails type-checking). Everything is pinned - ttyd commit, corepack,
# lockfile deps. The source comes through git rather than a GitHub archive: git
# verifies the content against the commit hash, and archives are generated on
# demand, so a checksum of one can break without the source changing.
# COREPACK_INTEGRITY_KEYS=0 keeps the pinned corepack working across npm
# signing-key rotations; integrity comes from the yarn.lock checksums. Drop this
# stage and --index once a ttyd release newer than 1.7.7 ships.
#
# Do NOT use FROM --platform=$BUILDPLATFORM here: that variable only exists
# under BuildKit, and the Supervisor's classic builder fails to parse the line.
FROM ${BUILD_FROM} AS ttyd-client
RUN apk add --no-cache git nodejs npm
ARG TTYD_CLIENT_COMMIT=2922cb89f518bae4d0fcf4d757a7419638fc71fc
RUN git init -q /ttyd && cd /ttyd && \
    git fetch -q --depth 1 https://github.com/tsl0922/ttyd "${TTYD_CLIENT_COMMIT}" && \
    git checkout -q FETCH_HEAD
WORKDIR /ttyd/html
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_NPM_REGISTRY=https://registry.npmjs.org \
    COREPACK_INTEGRITY_KEYS=0
RUN npm install -g corepack@0.35.0 && corepack enable && \
    yarn install --immutable && yarn run inline

FROM ${BUILD_FROM}

# Labels
LABEL maintainer="nanamitm"
LABEL org.opencontainers.image.title="Claude Code for Home Assistant"
LABEL org.opencontainers.image.description="Claude Code CLI with web terminal and HA integration"
LABEL org.opencontainers.image.source="https://github.com/nanamitm/robsonfelix-hass-addons"
LABEL org.opencontainers.image.licenses="MIT"

# Environment setup
ENV \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color

# Install system dependencies (ttyd installed separately as static binary)
RUN apk add --no-cache \
    bash \
    curl \
    git \
    github-cli \
    jq \
    nodejs \
    npm \
    openssh-client \
    libstdc++ \
    ncurses \
    vim \
    nano \
    tmux \
    coreutils \
    findutils \
    grep \
    sed \
    gawk \
    ca-certificates \
    openssl \
    ripgrep \
    p7zip \
    poppler-utils \
    socat \
    docker-cli \
    && update-ca-certificates

# Install ttyd static binary (avoids libwebsockets issues)
ARG BUILD_ARCH
RUN case "${BUILD_ARCH}" in \
        amd64) TTYD_ARCH="x86_64" TTYD_SHA256="8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55" ;; \
        aarch64) TTYD_ARCH="aarch64" TTYD_SHA256="b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165" ;; \
        *) echo "Unsupported architecture: ${BUILD_ARCH}" >&2; exit 1 ;; \
    esac && \
    curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
        "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${TTYD_ARCH}" -o /usr/bin/ttyd && \
    echo "${TTYD_SHA256}  /usr/bin/ttyd" | sha256sum -c - && \
    chmod +x /usr/bin/ttyd
COPY --from=ttyd-client /ttyd/html/dist/inline.html /usr/share/ttyd/index.html

# Install Claude Code.
# 2.1.113 replaced the JS entrypoint with a Bun-compiled native binary, whose
# JavaScriptCore requires AVX. Hosts that lack it - notably VMs exposing the
# generic kvm64 CPU model - cannot run 2.1.113+ (it deadlocks or dies with
# SIGILL). Fix that at the hypervisor (Proxmox CPU type "host"), not here.
# No version is hardcoded: take latest when it runs, otherwise the newest
# release that passes a smoke test, so the add-on still builds on such hosts.
COPY install-claude.sh /usr/local/bin/install-claude.sh
RUN chmod +x /usr/local/bin/install-claude.sh && /usr/local/bin/install-claude.sh

# Install hass-mcp for Home Assistant integration and pymodbus for Modbus operations
RUN pip3 install --no-cache-dir --break-system-packages hass-mcp pymodbus pyserial

# Install mbpoll (Modbus command line tool) from source
RUN apk add --no-cache --virtual .build-deps \
    build-base \
    cmake \
    libmodbus-dev \
    && git clone https://github.com/epsilonrt/mbpoll.git /tmp/mbpoll \
    && cd /tmp/mbpoll \
    && mkdir build && cd build \
    && cmake .. \
    && make \
    && make install \
    && cd / \
    && rm -rf /tmp/mbpoll \
    && apk del .build-deps \
    && apk add --no-cache libmodbus

# Pre-cache Playwright MCP server (npx cache avoids /usr/local/bin/mcp conflict with hass-mcp)
ENV NPM_CONFIG_CACHE=/root/.npm
RUN npx @playwright/mcp --version || true

# Install Home Assistant CLI (ha command)
# Pinned and retried: a transient DNS failure used to abort the whole build
# (curl exit 6). Upstream publishes only amd64 and aarch64, so other arches skip
# the CLI with a warning instead of failing the build on a 404.
ARG HA_CLI_VERSION=5.2.0
RUN case "${BUILD_ARCH}" in \
        amd64|aarch64) \
            curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
                "https://github.com/home-assistant/cli/releases/download/${HA_CLI_VERSION}/ha_${BUILD_ARCH}" \
                -o /usr/local/bin/ha && \
            chmod +x /usr/local/bin/ha ;; \
        *) \
            echo "[WARN] Home Assistant CLI is not published for ${BUILD_ARCH}; the 'ha' command will be unavailable" ;; \
    esac

# Create necessary directories (NOT /root/.claude - will be symlinked at runtime)
RUN mkdir -p \
    /homeassistant \
    /root/.config \
    /root/.local/bin

# Shell and tmux config.
# These were heredocs (RUN cat > file << 'EOF'), which require BuildKit and a
# `# syntax=docker/dockerfile:1.4` directive. Builders without heredoc support
# parsed the body as Dockerfile instructions ("unknown instruction: set").
# COPY works on every builder and needs no syntax image.
COPY rootfs/root/.tmux.conf /root/.tmux.conf
COPY rootfs/root/.bashrc /root/.bashrc
COPY rootfs/usr/share/claudecode-addon/usage-bridge /usr/share/claudecode-addon/usage-bridge
RUN for f in /usr/share/claudecode-addon/usage-bridge/*.js; do node --check "$f"; done

# Ensure .bashrc is sourced for login shells too
RUN echo 'source ~/.bashrc' > /root/.profile

# Set up PATH
ENV PATH="/root/.local/bin:${PATH}"

# Set working directory
WORKDIR /homeassistant

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:7681/ || exit 1

# Keep shell quoting out of Dockerfile JSON parsing.
COPY rootfs/usr/bin/claudecode-addon-start.sh /usr/bin/claudecode-addon-start.sh
RUN bash -n /usr/bin/claudecode-addon-start.sh
ENTRYPOINT []
CMD ["/bin/bash", "/usr/bin/claudecode-addon-start.sh"]
