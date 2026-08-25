#!/usr/bin/env python3
"""Structural checks on the add-on config.

These exist because of a real failure: v0.2.2 shipped a zero-byte
`codex/config.yaml`. Nothing errored - the Supervisor simply stopped listing the
add-on, and it vanished from the store while installed copies carried on. A
broken add-on config fails silently by nature, so it is checked here instead.

This is deliberately about structure, not style. Opinions about which keys an
add-on ought to set are the linter's job, and that one runs advisory.
"""

import re
import sys
from pathlib import Path

import yaml

ADDON = Path("codex")
REQUIRED = ("name", "version", "slug", "arch", "options", "schema")

failures: list[str] = []


def check(condition: object, message: str) -> bool:
    if condition:
        print(f"ok    {message}")
        return True
    print(f"FAIL  {message}")
    failures.append(message)
    return False


config_path = ADDON / "config.yaml"
raw = config_path.read_text() if config_path.is_file() else ""

if not check(raw.strip(), f"{config_path} exists and is not empty"):
    # Everything below reads the parsed config, so there is nothing left to say.
    sys.exit(1)

try:
    config = yaml.safe_load(raw)
except yaml.YAMLError as err:
    check(False, f"{config_path} parses as YAML ({err})")
    sys.exit(1)

check(isinstance(config, dict), f"{config_path} is a mapping")
for key in REQUIRED:
    check(key in config, f"{config_path} has '{key}'")

if isinstance(config.get("options"), dict) and isinstance(config.get("schema"), dict):
    # An option with no schema entry is rejected by the Supervisor at install
    # time, and a schema entry with no option is a default nobody gets.
    missing = set(config["options"]) - set(config["schema"])
    check(not missing, f"every option has a schema entry (missing: {sorted(missing)})")
    unused = set(config["schema"]) - set(config["options"])
    check(not unused, f"every schema entry has a default (extra: {sorted(unused)})")

# Home Assistant only offers an update when the version changes, so a fix
# without a bump never reaches an installed add-on.
version = str(config.get("version", ""))
changelog = (ADDON / "CHANGELOG.md").read_text()
newest = re.search(r"^## \[([^\]]+)\]", changelog, re.M)
check(newest, "CHANGELOG.md has a version heading")
if newest:
    check(
        version == newest.group(1),
        f"config.yaml version ({version}) matches the newest CHANGELOG entry ({newest.group(1)})",
    )

# apparmor.txt names the profile after the slug; a mismatch means the profile is
# silently not applied.
apparmor = ADDON / "apparmor.txt"
if apparmor.is_file():
    check(
        f"profile {config.get('slug')} " in apparmor.read_text(),
        f"apparmor.txt declares 'profile {config.get('slug')}'",
    )

print()
if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("all checks passed")
