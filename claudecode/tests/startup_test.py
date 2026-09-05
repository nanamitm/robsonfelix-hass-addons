"""Run the real startup shell with isolated files and stubbed external services."""
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile

addon = Path(__file__).resolve().parents[1]
source = (addon / 'rootfs/usr/bin/claudecode-addon-start.sh').read_text()
dockerfile = (addon / 'Dockerfile').read_text()
cmd = next(line[4:] for line in dockerfile.splitlines() if line.startswith('CMD '))
assert json.loads(cmd) == ['/bin/bash', '/usr/bin/claudecode-addon-start.sh']
for enabled in (False, True):
    with tempfile.TemporaryDirectory(prefix='claude-startup-') as tmp:
        base = Path(tmp)
        # Rewrite only filesystem locations, leaving shell syntax and jq intact.
        script = re.sub(r'/homeassistant|/root|/data|/tmp|/etc/claude-code-version',
                        lambda m: str(base / m.group().lstrip('/')), source)
        for folder in ('homeassistant', 'root', 'data', 'tmp', 'bin'):
            (base / folder).mkdir(parents=True, exist_ok=True)
        options = {'auto_update_claude': False, 'usage_sensors': False,
                   'enable_mcp': enabled, 'enable_playwright_mcp': enabled,
                   'enable_remote_control': enabled, 'session_persistence': enabled,
                   'working_directory': str(base / 'homeassistant')}
        (base / 'data/options.json').write_text(json.dumps(options))
        for name, body in {
            'claude': '#!/bin/bash\nexit 0\n',
            'curl': '#!/bin/bash\necho \'{"data":{"addons":[{"slug":"test_playwright-browser","hostname":"browser"}]}}\'\n',
            'ttyd': '#!/bin/bash\nprintf "%s\\n" "$@" > "$TEST_ARGS"\npwd > "$TEST_CWD"\n',
        }.items():
            file = base / 'bin' / name
            file.write_text(body)
            file.chmod(0o755)
        entrypoint = base / 'startup.sh'
        entrypoint.write_text(script)
        env = dict(os.environ, PATH=f'{base}/bin:' + os.environ['PATH'],
                   SUPERVISOR_TOKEN='test-only', TEST_ARGS=str(base / 'args'), TEST_CWD=str(base / 'cwd'))
        result = subprocess.run(['bash', str(entrypoint)], env=env, capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        assert not result.stderr, result.stderr
        assert (base / 'args').exists(), result.stdout
        assert (base / 'cwd').read_text().strip() == str(base / 'homeassistant')
        settings = json.loads((base / 'homeassistant/.claudecode/settings.json').read_text())
        assert settings['statusLine']['type'] == 'command'
        assert settings.get('remoteControlAtStartup', False) == enabled
        assert '`debug`' in (base / 'homeassistant/.claudecode/CLAUDE.md').read_text()
        assert ('tmux' if enabled else 'bash') in (base / 'args').read_text()
        print(f'PASS: startup reaches ttyd with MCP/Playwright/remote-control={enabled}')
