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
def rewrite(text, base, extra=''):
    """Point filesystem locations at the scratch dir, leaving shell syntax and jq intact.
    The add-on's own files under /usr/share/claudecode-addon come from the source tree."""
    # The substitutions below insert paths that themselves contain /root or /tmp
    # (rootfs, a scratch dir under /tmp), so they run after the generic rewrite.
    text = re.sub(r'/homeassistant|/root\b|/data|/tmp|/etc/claude-code-version' + extra,
                  lambda m: str(base / m.group().lstrip('/')), text)
    text = text.replace('/usr/share/claudecode-addon', str(addon / 'rootfs/usr/share/claudecode-addon'))
    return text.replace('/usr/local/bin/', str(base / 'bin') + '/')


STUBS = {
    # Records every claude invocation, so the MCP registrations can be checked.
    'claude': '#!/bin/bash\nprintf "%s\\n" "$*" >> "$TEST_BASE/claude-calls"\nexit 0\n',
    'curl': '#!/bin/bash\necho \'{"data":{"addons":[{"slug":"test_playwright-browser"}]}}\'\n',
    'tmux': '#!/bin/bash\nprintf "%s\\n" "$*" >> "$TEST_BASE/tmux-calls"\n',
    'npm': '#!/bin/bash\nprintf "%s\\n" "$*" >> "$TEST_BASE/npm-calls"\n',
    'stdin-runner.sh': '#!/bin/bash\ntouch "$TEST_BASE/runner-started"\n',
    'ttyd': ('#!/bin/bash\nprintf "%s\\n" "$@" > "$TEST_BASE/args"\npwd > "$TEST_BASE/cwd"\n'
             'printf "%s\\n" "$AUTO_LAUNCH_ARGS" > "$TEST_BASE/auto-launch-args"\n'
             'printf "%s\\n" "$CLAUDE_FLAGS" > "$TEST_BASE/claude-flags"\n'
             'sleep 0.5\n'),   # the stdin runner is started in the background just before
}


def boot(base, options):
    """Run the real entrypoint against `options`; return the CompletedProcess."""
    for folder in ('homeassistant', 'root', 'data', 'tmp', 'bin'):
        (base / folder).mkdir(parents=True, exist_ok=True)
    (base / 'data/options.json').write_text(json.dumps(options))
    for name, body in STUBS.items():
        file = base / 'bin' / name
        file.write_text(body)
        file.chmod(0o755)
    entrypoint = base / 'startup.sh'
    entrypoint.write_text(rewrite(source, base))
    env = dict(os.environ, PATH=f'{base}/bin:' + os.environ['PATH'],
               SUPERVISOR_TOKEN='test-only', TEST_BASE=str(base))
    return subprocess.run(['bash', str(entrypoint)], env=env, capture_output=True, text=True,
                          timeout=15, stdin=subprocess.DEVNULL)


def read(path):
    return path.read_text() if path.exists() else ''


for enabled in (False, True):
    with tempfile.TemporaryDirectory(prefix='claude-startup-') as tmp:
        base = Path(tmp)
        result = boot(base, {
            'auto_update_claude': False, 'usage_sensors': False,
            'enable_mcp': enabled, 'enable_playwright_mcp': enabled,
            'enable_remote_control': enabled, 'session_persistence': enabled,
            'remote_control_server': enabled, 'remote_control_permission_mode': 'plan',
            'auto_launch_claude': 'continue' if enabled else 'off',
            'extra_npm_packages': ['some-mcp@1.0.0', ''] if enabled else [],
            'working_directory': str(base / 'homeassistant')})
        assert result.returncode == 0, result.stderr
        assert not result.stderr, result.stderr
        assert (base / 'args').exists(), result.stdout
        assert (base / 'cwd').read_text().strip() == str(base / 'homeassistant')
        assert (base / 'runner-started').exists(), 'stdin task runner was not started'
        persist = base / 'homeassistant/.claudecode'
        settings = json.loads((persist / 'settings.json').read_text())
        assert settings['statusLine']['type'] == 'command'
        assert settings.get('remoteControlAtStartup', False) == enabled
        claude_md = (persist / 'CLAUDE.md').read_text()
        assert '`debug`' in claude_md and '@~/.claude/CLAUDE.user.md' in claude_md
        assert (persist / 'CLAUDE.user.md').exists()
        args = (base / 'args').read_text().splitlines()
        assert args[args.index('--index') + 1] == '/usr/share/ttyd/index.html'
        theme = next(arg for arg in args if arg.startswith('theme='))
        assert json.loads(theme.split('=', 1)[1])['background'] == '#1e1e2e'
        calls = read(base / 'claude-calls')
        tmux_calls = read(base / 'tmux-calls')
        npm_calls = read(base / 'npm-calls')
        if enabled:
            assert args[-6:] == ['tmux', 'new-session', '-A', '-s', 'claude',
                                 str(base / 'bin/claude-auto-launch')], args
            assert (base / 'auto-launch-args').read_text().split() == ['--continue', '--remote-control']
            assert (base / 'claude-flags').read_text().strip() == '--remote-control'
            pw = next(line for line in calls.splitlines() if line.startswith('mcp add-json playwright '))
            assert json.loads(pw[len('mcp add-json playwright '):].rsplit(' -s ', 1)[0]) == {
                'command': str(base / 'bin/playwright-mcp-launch'), 'env': {'PLAYWRIGHT_CDP_HOST': ''}}, pw
            assert 'new-session -d -s rc' in tmux_calls and '--permission-mode plan' in tmux_calls, tmux_calls
            npm = [c for c in npm_calls.splitlines() if c.startswith('install ')]
            assert npm == [f'install -g --prefix={persist}/npm-global some-mcp@1.0.0'], npm
            assert 'Auto-launch: continue' in result.stdout
        else:
            assert args[-2:] == ['bash', '--login'], args
            assert (base / 'auto-launch-args').read_text().strip() == ''
            assert 'add-json playwright' not in calls
            assert not tmux_calls and not npm_calls, (tmux_calls, npm_calls)
            assert 'Auto-launch: off' in result.stdout
        print(f'PASS: startup reaches ttyd with MCP/Playwright/remote-control/auto-launch={enabled}')


# remote_control_server without enable_remote_control warns and starts nothing;
# auto-launch without tmux runs the wrapper directly.
with tempfile.TemporaryDirectory(prefix='claude-startup-') as tmp:
    base = Path(tmp)
    result = boot(base, {
        'auto_update_claude': False, 'usage_sensors': False, 'enable_mcp': False,
        'session_persistence': False, 'remote_control_server': True,
        'remote_control_permission_mode': 'bogus', 'auto_launch_claude': 'new',
        'working_directory': str(base / 'homeassistant')})
    assert result.returncode == 0, result.stderr
    assert 'remote_control_server requires enable_remote_control' in result.stdout, result.stdout
    assert 'Unknown remote_control_permission_mode: bogus' in result.stdout, result.stdout
    assert not (base / 'tmux-calls').exists()
    args = (base / 'args').read_text().splitlines()
    assert args[-1] == str(base / 'bin/claude-auto-launch'), args
    assert (base / 'auto-launch-args').read_text().strip() == ''
    print('PASS: remote_control_server needs enable_remote_control; auto-launch without tmux')


def run_update(installed, latest, arch='x86_64', broken=''):
    """Boot with auto_update_claude on; return (stdout, npm install calls)."""
    with tempfile.TemporaryDirectory(prefix='claude-update-') as tmp:
        base = Path(tmp)
        script = rewrite(source, base, '|/proc/cpuinfo')
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
            'stdin-runner.sh': '#!/bin/bash\nexit 0\n',
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
