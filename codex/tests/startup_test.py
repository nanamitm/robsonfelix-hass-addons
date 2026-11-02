"""Run the real startup script with isolated files and stubbed external services."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

addon = Path(__file__).resolve().parents[1]
source = (addon / 'rootfs/usr/bin/codex-addon-start.sh').read_text()
shipped = addon / 'rootfs/usr/share/codex-addon'
TOKEN = 'test-only-supervisor-token'


def boot(options=None, setup=None):
    """Boot once; return the temp dir handle, the isolated root and the stdout."""
    tmp = tempfile.TemporaryDirectory(prefix='codex-startup-')
    base = Path(tmp.name)
    # Rewrite only filesystem locations, leaving shell syntax and jq intact.
    script = re.sub(r'/homeassistant|/data|/etc/codex|/usr/share/codex-addon',
                    lambda m: str(base / m.group().lstrip('/')), source)
    for folder in ('homeassistant/.codex', 'data', 'bin', 'usr/share/codex-addon'):
        (base / folder).mkdir(parents=True)
    for name in ('AGENTS.md', 'AGENTS.md.superseded'):
        (base / 'usr/share/codex-addon' / name).write_bytes((shipped / name).read_bytes())
    defaults = {'usage_sensors': False, 'working_directory': str(base / 'homeassistant')}
    (base / 'data/options.json').write_text(json.dumps({**defaults, **(options or {})}))
    for name, body in {
        'codex': '#!/bin/bash\n[ "$1" = mcp ] && { echo "homeassistant  hass-mcp"; exit 0; }\necho "codex-cli 1.2.3"\n',
        'ttyd': '#!/bin/bash\nprintf "%s\\n" "$@" > "$TEST_ARGS"\npwd > "$TEST_CWD"\n',
    }.items():
        file = base / 'bin' / name
        file.write_text(body)
        file.chmod(0o755)
    if setup:
        setup(base)
    entrypoint = base / 'startup.sh'
    entrypoint.write_text(script)
    env = dict(os.environ, PATH=f'{base}/bin:' + os.environ['PATH'], SUPERVISOR_TOKEN=TOKEN,
               CODEX_HOME=str(base / 'homeassistant/.codex'),
               TEST_ARGS=str(base / 'args'), TEST_CWD=str(base / 'cwd'))
    result = subprocess.run(['bash', str(entrypoint)], env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    assert (base / 'args').exists(), result.stdout
    return tmp, base, result.stdout


# Defaults: reaches ttyd, with the generated config and terminal arguments.
tmp, base, out = boot()
args = (base / 'args').read_text().splitlines()
assert args[args.index('--index') + 1] == '/usr/share/ttyd/index.html'
theme = next(arg for arg in args if arg.startswith('theme='))
assert json.loads(theme.split('=', 1)[1])['background'] == '#1e1e2e'
assert 'tmux' in args
assert (base / 'cwd').read_text().strip() == str(base / 'homeassistant')
config = (base / 'etc/codex/config.toml').read_text()
assert 'sandbox_mode = "danger-full-access"' in config
assert 'env_vars = ["HA_URL", "HA_TOKEN"]' in config
assert TOKEN not in config
assert 'codex login --device-auth' in out
tmp.cleanup()
print('PASS: defaults reach ttyd and keep the token out of the config')

# Options reach the config, and a quote in a string option cannot corrupt it.
tmp, base, _ = boot({'model': 'a"b', 'model_reasoning_effort': 'high', 'enable_mcp': False,
                     'terminal_theme': 'light', 'session_persistence': False})
config = (base / 'etc/codex/config.toml').read_text()
assert 'model = "a\\"b"' in config
assert 'model_reasoning_effort = "high"' in config
assert 'mcp_servers.homeassistant' not in config
args = (base / 'args').read_text().splitlines()
assert 'tmux' not in args
theme = next(arg for arg in args if arg.startswith('theme='))
assert json.loads(theme.split('=', 1)[1])['background'] == '#eff1f5'
tmp.cleanup()
print('PASS: options reach the config and terminal')

# A missing working_directory falls back instead of killing the terminal.
tmp, base, out = boot({'working_directory': '/does/not/exist'})
assert 'falling back to' in out
assert (base / 'cwd').read_text().strip() == str(base / 'homeassistant')
tmp.cleanup()
print('PASS: a missing working_directory falls back')


# A package directory from an older version is replaced by a link into /data,
# and daemon state left behind without its package is cleared.
def stale_daemon(root):
    (root / 'homeassistant/.codex/packages/old').mkdir(parents=True)
    daemon = root / 'homeassistant/.codex/app-server-daemon'
    daemon.mkdir()
    (daemon / 'daemon.pid').write_text('1')
    (daemon / 'keep.me').write_text('x')


tmp, base, _ = boot(setup=stale_daemon)
assert os.readlink(base / 'homeassistant/.codex/packages') == str(base / 'data/codex-packages')
assert not (base / 'homeassistant/.codex/app-server-daemon/daemon.pid').exists()
assert (base / 'homeassistant/.codex/app-server-daemon/keep.me').exists()
tmp.cleanup()


# The state belongs to a live package when the package is still there.
def daemon_with_package(root):
    stale_daemon(root)
    (root / 'data/codex-packages/app-server-daemon').mkdir(parents=True)
    (root / 'data/codex-packages/app-server-daemon/current').write_text('x')


tmp, base, _ = boot(setup=daemon_with_package)
assert (base / 'homeassistant/.codex/app-server-daemon/daemon.pid').exists()
tmp.cleanup()
print('PASS: package link and stale daemon state')

# AGENTS.md: installed when absent, and its marker records what was installed.
current = (shipped / 'AGENTS.md').read_bytes()
tmp, base, _ = boot()
assert (base / 'homeassistant/.codex/AGENTS.md').read_bytes() == current
assert (base / 'homeassistant/.codex/.agents-md-installed.sha256').read_text().strip() == \
    hashlib.sha256(current).hexdigest()
tmp.cleanup()


# A file the user edited is left alone.
def edited(root):
    (root / 'homeassistant/.codex/AGENTS.md').write_text('my own notes\n')


tmp, base, out = boot(setup=edited)
assert (base / 'homeassistant/.codex/AGENTS.md').read_text() == 'my own notes\n'
assert 'has been edited' in out
tmp.cleanup()


# A copy an earlier version shipped is refreshed, even with no marker.
def superseded(root):
    old = 'instructions from an earlier version\n'
    (root / 'homeassistant/.codex/AGENTS.md').write_text(old)
    digest = hashlib.sha256(old.encode()).hexdigest()
    with (root / 'usr/share/codex-addon/AGENTS.md.superseded').open('a') as file:
        file.write(f'{digest}  test\n')


tmp, base, _ = boot(setup=superseded)
assert (base / 'homeassistant/.codex/AGENTS.md').read_bytes() == current
tmp.cleanup()
print('PASS: AGENTS.md is refreshed only while it is the add-on copy')
