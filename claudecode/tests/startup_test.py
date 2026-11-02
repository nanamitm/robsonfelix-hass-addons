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
        args = (base / 'args').read_text().splitlines()
        assert args[args.index('--index') + 1] == '/usr/share/ttyd/index.html'
        theme = next(arg for arg in args if arg.startswith('theme='))
        assert json.loads(theme.split('=', 1)[1])['background'] == '#1e1e2e'
        print(f'PASS: startup reaches ttyd with MCP/Playwright/remote-control={enabled}')


def run_update(installed, latest, arch='x86_64', broken=''):
    """Boot with auto_update_claude on; return (stdout, npm install calls)."""
    with tempfile.TemporaryDirectory(prefix='claude-update-') as tmp:
        base = Path(tmp)
        script = re.sub(r'/homeassistant|/root|/data|/tmp|/etc/claude-code-version|/proc/cpuinfo',
                        lambda m: str(base / m.group().lstrip('/')), source)
        for folder in ('homeassistant', 'root', 'data', 'tmp', 'bin', 'etc', 'proc'):
            (base / folder).mkdir(parents=True, exist_ok=True)
        (base / 'data/options.json').write_text(json.dumps({
            'auto_update_claude': True, 'usage_sensors': False, 'enable_mcp': False,
            'session_persistence': False, 'working_directory': str(base / 'homeassistant')}))
        (base / 'etc/claude-code-version').write_text('1.0.0\n')
        # An x86 CPU without AVX still lists other flags; ARM never lists avx.
        (base / 'proc/cpuinfo').write_text('flags : fpu sse2\n')
        (base / 'version').write_text(installed)
        for name, body in {
            'claude': f'#!/bin/bash\nv=$(cat "$TEST_BASE/version")\n[ "$v" != "{broken}" ] || exit 1\necho "$v (Claude Code)"\n',
            'npm': f'#!/bin/bash\nif [ "$1" = view ]; then echo "{latest}"; exit 0; fi\n'
                   'echo "$*" >> "$TEST_BASE/npm-calls"\necho "${3##*@}" > "$TEST_BASE/version"\n',
            'uname': f'#!/bin/bash\necho {arch}\n',
            'ttyd': '#!/bin/bash\nexit 0\n',
        }.items():
            file = base / 'bin' / name
            file.write_text(body)
            file.chmod(0o755)
        entrypoint = base / 'startup.sh'
        entrypoint.write_text(script)
        env = dict(os.environ, PATH=f'{base}/bin:' + os.environ['PATH'],
                   SUPERVISOR_TOKEN='test-only', TEST_BASE=str(base))
        result = subprocess.run(['bash', str(entrypoint)], env=env, capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        calls = base / 'npm-calls'
        return result.stdout, calls.read_text().splitlines() if calls.exists() else []


# The fake CPU has no AVX, so these two cover the x86 and ARM sides of the gate.
out, calls = run_update('2.0.0', '3.0.0')
assert 'lacks AVX' in out and not calls, out
out, calls = run_update('2.0.0', '2.0.0', arch='aarch64')
assert 'does not expose AVX' not in out and 'Claude Code 2.0.0 (already current)' in out and not calls, out
out, calls = run_update('2.0.0', '3.0.0', arch='aarch64')
assert calls == ['install -g @anthropic-ai/claude-code@3.0.0'], calls
out, calls = run_update('2.0.0', '3.0.0', arch='aarch64', broken='3.0.0')
assert calls[-1] == 'install -g @anthropic-ai/claude-code@2.0.0', calls
print('PASS: AVX gate and auto-update skip, install and rollback')
