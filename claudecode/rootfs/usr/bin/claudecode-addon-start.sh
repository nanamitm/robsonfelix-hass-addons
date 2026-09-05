#!/bin/bash

\
  export HA_TOKEN="$SUPERVISOR_TOKEN" && \
  export HA_URL="http://supervisor/core" && \
  PERSIST_DIR=/homeassistant/.claudecode && \
  mkdir -p $PERSIST_DIR/config /root/.config && \
  printf '%s\n' \
    '# Claude Code - Home Assistant Add-on' \
    '' \
    '## Path Mapping' \
    '' \
    'In this add-on container, paths are mapped differently than HA Core:' \
    '- `/homeassistant` = HA config directory (equivalent to `/config` in HA Core)' \
    '- `/config` does NOT exist - always use `/homeassistant`' \
    '' \
    'When users mention `/config/...`, translate to `/homeassistant/...`' \
    '' \
    '## Available Paths' \
    '' \
    '| Path | Description | Access |' \
    '|------|-------------|--------|' \
    '| `/homeassistant` | HA configuration | read-write |' \
    '| `/share` | Shared folder | read-write |' \
    '| `/media` | Media files | read-write |' \
    '| `/ssl` | SSL certificates | read-only |' \
    '| `/backup` | Backups | read-only |' \
    '' \
    '## Home Assistant Integration' \
    '' \
    'Use the `homeassistant` MCP server to query entities and call services.' \
    '' \
    '## Reading Home Assistant Logs' \
    '' \
    '**Log levels (from most to least verbose):**' \
    '- `debug` - Only shown if explicitly enabled in configuration.yaml' \
    '- `info` - General information, shown by default' \
    '- `warning` - Warnings, always shown' \
    '- `error` - Errors, always shown' \
    '' \
    '**Commands to read logs:**' \
    '```bash' \
    '# View recent logs (ha CLI)' \
    'ha core logs 2>&1 | tail -100' \
    '' \
    '# Filter by keyword' \
    'ha core logs 2>&1 | grep -i keyword' \
    '' \
    '# Filter errors only' \
    'ha core logs 2>&1 | grep -iE "(error|exception)"' \
    '' \
    '# Alternative: read log file directly' \
    'tail -100 /homeassistant/home-assistant.log' \
    '```' \
    '' \
    '**To enable debug logging for an integration**, add to `configuration.yaml`:' \
    '```yaml' \
    'logger:' \
    '  default: info' \
    '  logs:' \
    '    custom_components.YOUR_INTEGRATION: debug' \
    '```' \
    '' \
    '**Key insight:** `_LOGGER.debug()` calls are invisible unless the logger level is set to debug. Use `_LOGGER.info()` or `_LOGGER.warning()` for logs that should always appear.' \
    > $PERSIST_DIR/CLAUDE.md && \
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
  if [ -z "$PLAYWRIGHT_HOST" ] && [ "$ENABLE_PLAYWRIGHT" = "true" ]; then \
    echo '[INFO] Auto-detecting Playwright Browser hostname...' && \
    PLAYWRIGHT_HOST=$(curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/addons | jq -r '.data.addons[] | select(.slug | endswith("playwright-browser") or endswith("_playwright-browser")) | .hostname' | head -1) && \
    if [ -n "$PLAYWRIGHT_HOST" ] && [ "$PLAYWRIGHT_HOST" != "null" ]; then \
      echo "[INFO] Found Playwright Browser: $PLAYWRIGHT_HOST"; \
    else \
      echo '[WARN] Playwright Browser add-on not found, using default hostname'; \
      PLAYWRIGHT_HOST="playwright-browser"; \
    fi; \
  fi && \
  REMOTE_CONTROL=$(jq -r '.enable_remote_control // false' /data/options.json) && \
  RC_SESSION_PREFIX=$(jq -r '.remote_control_session_prefix // "HomeAssistant"' /data/options.json) && \
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
  if ! grep -qw avx /proc/cpuinfo 2>/dev/null; then \
    echo '[WARN] This CPU does not expose AVX. Claude Code 2.1.113+ is a Bun-compiled'; \
    echo '[WARN] binary that requires it, so this add-on is running an older release.'; \
    echo '[WARN] On Proxmox set the VM CPU type to "host" (or x86-64-v3), then fully'; \
    echo '[WARN] stop and start the VM. Verify with: grep -o -m1 avx2 /proc/cpuinfo'; \
  fi && \
  BUILT_VERSION=$(cat /etc/claude-code-version 2>/dev/null || echo unknown) && \
  AUTO_UPDATE=$(jq -r '.auto_update_claude // false' /data/options.json) && \
  if [ "$AUTO_UPDATE" = "true" ]; then \
    echo "[WARN] auto_update_claude=true; the build verified $BUILT_VERSION, an update may install a release that cannot run" && \
    timeout 300 npm update -g @anthropic-ai/claude-code || echo '[WARN] Update failed; keeping the installed version'; \
    if ! timeout 30 claude --version < /dev/null > /dev/null 2>&1; then \
      echo "[ERROR] The updated Claude Code does not run here; rolling back to $BUILT_VERSION" && \
      timeout 300 npm install -g @anthropic-ai/claude-code@$BUILT_VERSION || echo '[ERROR] Rollback failed'; \
    fi; \
  else \
    echo "[INFO] Claude Code $BUILT_VERSION (verified at build time)"; \
  fi && \
  if timeout 30 claude --version < /dev/null > /dev/null 2>&1; then \
    CLAUDE_OK=true; \
  else \
    CLAUDE_OK=false; \
    echo '[ERROR] claude CLI did not respond within 30s - skipping MCP setup'; \
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
    timeout 30 claude mcp add-json playwright "{\"command\":\"npx\",\"args\":[\"--no-install\",\"@playwright/mcp\",\"--cdp-endpoint\",\"http://${PLAYWRIGHT_HOST}:9222\"]}" -s user && \
    echo "[INFO] Playwright MCP enabled (CDP: http://${PLAYWRIGHT_HOST}:9222)"; \
    echo '[INFO] Make sure the Playwright Browser add-on is installed and running'; \
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
    COLORS='background=#1e1e2e,foreground=#cdd6f4,cursor=#f5e0dc'; \
  else \
    COLORS='background=#eff1f5,foreground=#4c4f69,cursor=#dc8a78'; \
  fi && \
  if [ "$SESSION_PERSIST" = "true" ]; then \
    SHELL_CMD='tmux new-session -A -s claude'; \
  else \
    SHELL_CMD='bash --login'; \
  fi && \
  if [ "$REMOTE_CONTROL" = "true" ]; then export CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX="$RC_SESSION_PREFIX"; fi && \
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
        USAGE_POLL_SECONDS="$USAGE_POLL" CLAUDE_VERSION="$BUILT_VERSION"; \
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
    -t fontSize=$FONT_SIZE \
    -t fontFamily=Monaco,Consolas,monospace \
    -t scrollback=20000 \
    -t "theme=$COLORS" \
    $SHELL_CMD \

