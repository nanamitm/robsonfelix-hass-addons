#!/bin/bash

\
  export HA_TOKEN="$SUPERVISOR_TOKEN" && \
  export HA_URL="http://supervisor/core" && \
  PERSIST_DIR=/homeassistant/.claudecode && \
  mkdir -p $PERSIST_DIR/config /root/.config && \
  cp /usr/share/claudecode-addon/CLAUDE.addon.md $PERSIST_DIR/CLAUDE.md && \
  touch $PERSIST_DIR/CLAUDE.user.md && \
  if [ ! -L /root/.claude ]; then rm -rf /root/.claude; ln -s $PERSIST_DIR /root/.claude; fi && \
  if [ ! -L /root/.config/claude-code ]; then rm -rf /root/.config/claude-code; ln -s $PERSIST_DIR/config /root/.config/claude-code; fi && \
  if [ ! -L /root/.claude.json ]; then touch $PERSIST_DIR/.claude.json; rm -f /root/.claude.json; ln -s $PERSIST_DIR/.claude.json /root/.claude.json; fi && \
  FONT_SIZE=$(jq -r '.terminal_font_size // 14' /data/options.json) && \
  THEME=$(jq -r '.terminal_theme // "dark"' /data/options.json) && \
  WORKING_DIR=$(jq -r '.working_directory // "/homeassistant"' /data/options.json) && \
  SESSION_PERSIST=$(jq -r 'if .session_persistence == null then true else .session_persistence end' /data/options.json) && \
  ENABLE_MCP=$(jq -r 'if .enable_mcp == null then true else .enable_mcp end' /data/options.json) && \
  ENABLE_PLAYWRIGHT=$(jq -r '.enable_playwright_mcp // false' /data/options.json) && \
  PLAYWRIGHT_HOST=$(jq -r '.playwright_cdp_host // ""' /data/options.json) && \
  REMOTE_CONTROL=$(jq -r '.enable_remote_control // false' /data/options.json) && \
  RC_SESSION_PREFIX=$(jq -r '.remote_control_session_prefix // "HomeAssistant"' /data/options.json) && \
  RC_SERVER=$(jq -r '.remote_control_server // false' /data/options.json) && \
  RC_PERMISSION_MODE=$(jq -r '.remote_control_permission_mode // "default"' /data/options.json) && \
  USAGE_SENSORS=$(jq -r 'if .usage_sensors == null then true else .usage_sensors end' /data/options.json) && \
  USAGE_POLL=$(jq -r '.usage_poll_seconds // 300' /data/options.json) && \
  SETTINGS_FILE=/root/.claude/settings.json && \
  [ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE" && \
  jq 'if .permissions.allow then .permissions.allow |= map(select((type != "string") or (startswith("Glob(") | not))) else . end' "$SETTINGS_FILE" > /tmp/settings.tmp && \
  mv /tmp/settings.tmp "$SETTINGS_FILE" && \
  if ! jq -e '.statusLine' "$SETTINGS_FILE" > /dev/null 2>&1; then \
    jq '.statusLine = {"type":"command","command":"node /usr/share/claudecode-addon/usage-bridge/statusline.js"}' "$SETTINGS_FILE" > /tmp/settings.tmp && \
    mv /tmp/settings.tmp "$SETTINGS_FILE" && \
    echo '[INFO] Claude usage statusLine capture enabled'; \
  else \
    echo '[INFO] Preserving existing Claude statusLine configuration'; \
  fi && \
  if jq -e '.mcpServers.homeassistant.env.HASS_TOKEN' "$SETTINGS_FILE" > /dev/null 2>&1; then \
    jq 'del(.mcpServers.homeassistant.env.HASS_TOKEN)' "$SETTINGS_FILE" > /tmp/settings.tmp && \
    mv /tmp/settings.tmp "$SETTINGS_FILE" && \
    echo '[INFO] Removed a Supervisor token that older versions persisted into settings.json'; \
    echo '[INFO] That file lives in your HA config dir and is included in backups'; \
  fi && \
  HAS_AVX=true && \
  if uname -m | grep -qE '^(x86_64|amd64|i[3-6]86)$' && ! grep -qw avx /proc/cpuinfo 2>/dev/null; then \
    HAS_AVX=false; \
    echo '[WARN] This CPU does not expose AVX. Claude Code 2.1.113+ is a Bun-compiled'; \
    echo '[WARN] binary that requires it, so this add-on is running an older release.'; \
    echo '[WARN] On Proxmox set the VM CPU type to "host" (or x86-64-v3), then fully'; \
    echo '[WARN] stop and start the VM. Verify with: grep -o -m1 avx2 /proc/cpuinfo'; \
  fi && \
  BUILT_VERSION=$(cat /etc/claude-code-version 2>/dev/null || echo unknown) && \
  INSTALLED_VERSION= && \
  if [ "$HAS_AVX" = "true" ]; then \
    INSTALLED_VERSION=$(timeout 30 claude --version < /dev/null 2>/dev/null | awk '{print $1}'); \
  fi && \
  { [ -n "$INSTALLED_VERSION" ] || INSTALLED_VERSION=$BUILT_VERSION; } && \
  AUTO_UPDATE=$(jq -r '.auto_update_claude // false' /data/options.json) && \
  if [ "$AUTO_UPDATE" != "true" ]; then \
    echo "[INFO] Claude Code $INSTALLED_VERSION"; \
  elif [ "$HAS_AVX" = "false" ]; then \
    echo '[WARN] auto_update_claude is on, but this CPU lacks AVX; skipping the update'; \
    echo "[INFO] Claude Code $INSTALLED_VERSION"; \
  else \
    LATEST=$(timeout 60 npm view @anthropic-ai/claude-code version 2>/dev/null || echo ''); \
    if [ -z "$LATEST" ]; then \
      echo "[WARN] npm registry unreachable; keeping Claude Code $INSTALLED_VERSION"; \
    elif [ "$LATEST" = "$INSTALLED_VERSION" ]; then \
      echo "[INFO] Claude Code $INSTALLED_VERSION (already current)"; \
    else \
      echo "[INFO] Updating Claude Code $INSTALLED_VERSION -> $LATEST"; \
      timeout 300 npm install -g @anthropic-ai/claude-code@$LATEST || echo '[WARN] Update failed; keeping the installed version'; \
      if timeout 30 claude --version < /dev/null > /dev/null 2>&1; then \
        INSTALLED_VERSION=$(timeout 30 claude --version < /dev/null 2>/dev/null | awk '{print $1}'); \
      else \
        echo "[ERROR] Claude Code $LATEST does not run here; rolling back to $INSTALLED_VERSION"; \
        timeout 300 npm install -g @anthropic-ai/claude-code@$INSTALLED_VERSION || echo '[ERROR] Rollback failed'; \
      fi; \
    fi; \
  fi && \
  EXTRA_NPM_PREFIX=/homeassistant/.claudecode/npm-global && \
  EXTRA_PKGS=$(jq -r '.extra_npm_packages // [] | map(select(. != null and . != "")) | join(" ")' /data/options.json) && \
  if [ -n "$EXTRA_PKGS" ]; then \
    mkdir -p "$EXTRA_NPM_PREFIX" && \
    echo "[INFO] Installing extra_npm_packages: $EXTRA_PKGS" && \
    { timeout 600 npm install -g --prefix="$EXTRA_NPM_PREFIX" $EXTRA_PKGS 2>&1 | tail -5; \
      [ "${PIPESTATUS[0]}" -eq 0 ] || echo '[WARN] Some extra_npm_packages failed to install'; }; \
  fi && \
  if timeout 30 claude --version < /dev/null > /dev/null 2>&1; then \
    CLAUDE_OK=true; \
  else \
    CLAUDE_OK=false; \
    echo '[ERROR] claude CLI did not respond within 30s - skipping MCP setup and auto-launch'; \
    echo '[ERROR] The terminal will still start so you can debug from inside the add-on'; \
  fi && \
  if [ "$CLAUDE_OK" = "true" ]; then \
    timeout 30 claude mcp remove homeassistant -s user > /dev/null 2>&1 || true; \
    timeout 30 claude mcp remove playwright -s user > /dev/null 2>&1 || true; \
  fi && \
  if [ "$CLAUDE_OK" = "true" ] && [ "$ENABLE_MCP" = "true" ]; then \
    timeout 30 claude mcp add-json homeassistant '{"command":"hass-mcp"}' -s user && \
    SETTINGS_FILE=/root/.claude/settings.json && \
    ALLOWED_TOOLS='["mcp__homeassistant__get_version","mcp__homeassistant__get_entity","mcp__homeassistant__list_entities","mcp__homeassistant__search_entities_tool","mcp__homeassistant__domain_summary_tool","mcp__homeassistant__list_automations","mcp__homeassistant__get_history","mcp__homeassistant__get_error_log","Read(/homeassistant/**)","Read(/config/**)","Read(/share/**)","Read(/media/**)","Grep(/homeassistant/**)","Grep(/config/**)"]' && \
    jq --argjson tools "$ALLOWED_TOOLS" '.permissions.allow = ($tools + (.permissions.allow // []) | unique)' $SETTINGS_FILE > /tmp/settings.tmp && mv /tmp/settings.tmp $SETTINGS_FILE && \
    echo '[INFO] MCP configured with Home Assistant integration'; \
    echo '[INFO] Pre-authorized read-only MCP tools'; \
  elif [ "$ENABLE_MCP" = "true" ]; then \
    echo '[WARN] MCP is enabled but was skipped: the claude CLI is not responding'; \
  else \
    echo '[INFO] MCP disabled'; \
  fi && \
  if [ "$CLAUDE_OK" = "true" ] && [ "$ENABLE_PLAYWRIGHT" = "true" ]; then \
    PW_MCP_JSON=$(jq -nc --arg host "$PLAYWRIGHT_HOST" '{command:"/usr/local/bin/playwright-mcp-launch", env:{PLAYWRIGHT_CDP_HOST:$host}}') && \
    timeout 30 claude mcp add-json playwright "$PW_MCP_JSON" -s user && \
    if [ -n "$PLAYWRIGHT_HOST" ]; then \
      echo "[INFO] Playwright MCP enabled (host override: $PLAYWRIGHT_HOST)"; \
    else \
      echo '[INFO] Playwright MCP enabled (hostname auto-detected each time the MCP server starts)'; \
    fi; \
  elif [ "$ENABLE_PLAYWRIGHT" = "true" ]; then \
    echo '[WARN] Playwright MCP is enabled but was skipped: the claude CLI is not responding'; \
  else \
    echo '[INFO] Playwright MCP disabled'; \
  fi && \
  if [ "$REMOTE_CONTROL" = "true" ]; then \
    jq '.remoteControlAtStartup = true' "$SETTINGS_FILE" > /tmp/settings.tmp && mv /tmp/settings.tmp "$SETTINGS_FILE" && \
    echo '[INFO] Remote Control enabled - Claude Code will auto-start with remote control'; \
  else \
    jq 'del(.remoteControlAtStartup)' "$SETTINGS_FILE" > /tmp/settings.tmp && mv /tmp/settings.tmp "$SETTINGS_FILE"; \
    echo '[INFO] Remote Control auto-start disabled'; \
  fi && \
  if [ "$THEME" = "dark" ]; then \
    COLORS='{"background":"#1e1e2e","foreground":"#cdd6f4","cursor":"#f5e0dc"}'; \
  else \
    COLORS='{"background":"#eff1f5","foreground":"#4c4f69","cursor":"#dc8a78"}'; \
  fi && \
  AUTO_LAUNCH=$(jq -r '.auto_launch_claude // "off"' /data/options.json) && \
  if [ "$CLAUDE_OK" != "true" ]; then AUTO_LAUNCH=off; fi && \
  CLAUDE_FLAGS="" && \
  if [ "$REMOTE_CONTROL" = "true" ]; then CLAUDE_FLAGS="--remote-control"; fi && \
  case "$AUTO_LAUNCH" in \
    continue) AUTO_LAUNCH_ARGS="--continue $CLAUDE_FLAGS" ;; \
    new) AUTO_LAUNCH_ARGS="$CLAUDE_FLAGS" ;; \
    *) AUTO_LAUNCH=off; AUTO_LAUNCH_ARGS="" ;; \
  esac && \
  export CLAUDE_FLAGS AUTO_LAUNCH_ARGS && \
  echo "[INFO] Auto-launch: $AUTO_LAUNCH" && \
  if [ "$SESSION_PERSIST" = "true" ]; then \
    if [ "$AUTO_LAUNCH" != "off" ]; then \
      SHELL_CMD='tmux new-session -A -s claude /usr/local/bin/claude-auto-launch'; \
    else \
      SHELL_CMD='tmux new-session -A -s claude'; \
    fi; \
  else \
    if [ "$AUTO_LAUNCH" != "off" ]; then \
      SHELL_CMD='/usr/local/bin/claude-auto-launch'; \
    else \
      SHELL_CMD='bash --login'; \
    fi; \
  fi && \
  if [ "$REMOTE_CONTROL" = "true" ]; then export CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX="$RC_SESSION_PREFIX"; fi && \
  case "$RC_PERMISSION_MODE" in \
    default|acceptEdits|auto|plan|dontAsk) ;; \
    *) echo "[WARN] Unknown remote_control_permission_mode: $RC_PERMISSION_MODE; using default"; RC_PERMISSION_MODE=default ;; \
  esac && \
  if [ "$REMOTE_CONTROL" = "true" ] && [ "$RC_SERVER" = "true" ] && [ "$CLAUDE_OK" = "true" ]; then \
    if tmux new-session -d -s rc -c /homeassistant "while true; do claude remote-control --permission-mode $RC_PERMISSION_MODE; echo '[rc] claude remote-control exited, restarting in 30s'; sleep 30; done"; then \
      echo "[INFO] Remote Control server started (permission mode: $RC_PERMISSION_MODE) - view it with: tmux attach -t rc"; \
    else \
      echo '[WARN] Failed to start the Remote Control server'; \
    fi; \
  elif [ "$RC_SERVER" = "true" ] && [ "$REMOTE_CONTROL" != "true" ]; then \
    echo '[WARN] remote_control_server requires enable_remote_control - server not started'; \
  elif [ "$RC_SERVER" = "true" ]; then \
    echo '[WARN] Remote Control server is enabled but was skipped: the claude CLI is not responding'; \
  fi && \
  { /usr/local/bin/stdin-runner.sh <&0 & } && \
  if [ "$USAGE_SENSORS" = "true" ]; then \
    (while true; do \
      SERVICE=$(curl -fsS -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/services/mqtt 2>/dev/null || true); \
      MQTT_HOST=$(printf '%s' "$SERVICE" | jq -r '.data.host // empty'); \
      if [ -z "$MQTT_HOST" ]; then echo '[WARN] Claude usage sensors need an MQTT broker; retrying in 30s'; sleep 30; continue; fi; \
      export MQTT_HOST MQTT_PORT=$(printf '%s' "$SERVICE" | jq -r '.data.port // 1883') \
        MQTT_SSL=$(printf '%s' "$SERVICE" | jq -r '.data.ssl // false') \
        MQTT_USERNAME=$(printf '%s' "$SERVICE" | jq -r '.data.username // empty') \
        MQTT_PASSWORD=$(printf '%s' "$SERVICE" | jq -r '.data.password // empty') \
        CLAUDE_HOME="$PERSIST_DIR" CLAUDE_STATUSLINE_FILE="$PERSIST_DIR/statusline-rate-limits.json" \
        USAGE_POLL_SECONDS="$USAGE_POLL" CLAUDE_VERSION="$INSTALLED_VERSION"; \
      node /usr/share/claudecode-addon/usage-bridge/index.js || true; sleep 10; \
    done) & \
  fi && \
  if [ -d "$WORKING_DIR" ]; then \
    cd "$WORKING_DIR"; \
  else \
    echo "[WARN] working_directory does not exist: $WORKING_DIR; falling back to /homeassistant"; \
    cd /homeassistant; \
  fi && \
  exec ttyd --port 7681 --writable --ping-interval 30 --max-clients 5 \
    --index /usr/share/ttyd/index.html \
    -t fontSize=$FONT_SIZE \
    -t fontFamily=Monaco,Consolas,monospace \
    -t scrollback=20000 \
    -t "theme=$COLORS" \
    $SHELL_CMD \

