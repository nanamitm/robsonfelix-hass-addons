ARG BUILD_FROM

# Build a current ttyd web client: the one embedded in the ttyd 1.7.7 binary
# predates OSC 52 clipboard support, so startup serves this build via --index.
# Built with yarn so ttyd's lockfile is honored (npm resolves newer transitive
# deps and fails type-checking). Everything is pinned - ttyd commit, corepack,
# lockfile deps. COREPACK_INTEGRITY_KEYS=0 keeps the pinned corepack working
# across npm signing-key rotations; integrity comes from the yarn.lock
# checksums. Drop this stage and --index once a ttyd release newer than 1.7.7
# ships.
#
# Do NOT use FROM --platform=$BUILDPLATFORM here: that variable only exists
# under BuildKit, and the Supervisor's classic builder fails to parse the line.
FROM ${BUILD_FROM} AS ttyd-client
RUN apk add --no-cache curl nodejs npm
ARG TTYD_CLIENT_COMMIT=2922cb89f518bae4d0fcf4d757a7419638fc71fc
RUN curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
        "https://github.com/tsl0922/ttyd/archive/${TTYD_CLIENT_COMMIT}.tar.gz" \
        | tar xz && mv "ttyd-${TTYD_CLIENT_COMMIT}" /ttyd
WORKDIR /ttyd/html
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_NPM_REGISTRY=https://registry.npmjs.org \
    COREPACK_INTEGRITY_KEYS=0
RUN npm install -g corepack@0.35.0 && corepack enable && \
    yarn install --immutable && yarn run inline

FROM ${BUILD_FROM}

# Labels
LABEL org.opencontainers.image.title="Codex for Home Assistant"
LABEL org.opencontainers.image.description="OpenAI Codex CLI with web terminal and HA integration"
LABEL org.opencontainers.image.source="https://github.com/nanamitm/robsonfelix-hass-addons"
LABEL org.opencontainers.image.licenses="MIT"

# Environment setup
ENV \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color

# Keep all Codex state in the Home Assistant config directory so that sign-in,
# sessions and user config survive add-on restarts, rebuilds and reinstalls.
ENV CODEX_HOME=/homeassistant/.codex

# Install system dependencies (ttyd installed separately as static binary).
# procps-ng replaces BusyBox ps: Codex's app-server daemon runs
# `ps -p PID -o stat= -o lstart=`, which BusyBox ps does not support.
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
    procps-ng \
    socat \
    docker-cli \
    && update-ca-certificates

# Install ttyd static binary (avoids libwebsockets issues)
ARG BUILD_ARCH
RUN case "${BUILD_ARCH}" in \
        amd64) TTYD_ARCH="x86_64" ;; \
        aarch64) TTYD_ARCH="aarch64" ;; \
        *) TTYD_ARCH="x86_64" ;; \
    esac && \
    curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
        "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${TTYD_ARCH}" -o /usr/bin/ttyd && \
    chmod +x /usr/bin/ttyd
COPY --from=ttyd-client /ttyd/html/dist/inline.html /usr/share/ttyd/index.html

# Install the Codex CLI from the official release channel. The same script runs
# again at startup when auto_update_codex is on, so the installed version is not
# pinned to the image build date.
COPY install-codex.sh /usr/local/bin/install-codex.sh
RUN chmod +x /usr/local/bin/install-codex.sh && /usr/local/bin/install-codex.sh "${BUILD_ARCH}"

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

# Install Home Assistant CLI (ha command). Both architectures this add-on
# supports are published upstream, so a 404 here is a real failure.
ARG HA_CLI_VERSION=5.2.0
RUN curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
        "https://github.com/home-assistant/cli/releases/download/${HA_CLI_VERSION}/ha_${BUILD_ARCH}" \
        -o /usr/local/bin/ha && \
    chmod +x /usr/local/bin/ha

RUN mkdir -p \
    /homeassistant \
    /etc/codex \
    /root/.config \
    /root/.local/bin

# Shell config, tmux config, global AGENTS.md and the startup script.
COPY rootfs /
RUN chmod +x /usr/bin/codex-addon-start.sh && \
    echo 'source ~/.bashrc' > /root/.profile

# The usage bridge has no dependencies to install, but a syntax error in it
# would otherwise only surface as a restart loop on a user's system.
RUN for f in /usr/share/codex-addon/usage-bridge/*.js; do node --check "$f"; done

ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /homeassistant

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:7681/ || exit 1

ENTRYPOINT []
CMD ["/usr/bin/codex-addon-start.sh"]
