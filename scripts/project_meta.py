"""Shared project metadata: version, repository, User-Agent helpers."""

from __future__ import annotations

import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
VERSION_FILE = ROOT / "VERSION"
CONFIG_JS = ROOT / "js" / "config.js"
CHANGELOG = ROOT / "CHANGELOG.md"

APP_NAME = os.environ.get("APP_NAME", "dataroads-FR84")
REPOSITORY = os.environ.get("APP_REPOSITORY", "https://github.com/thepriben/dataroads-FR84")

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
_CONFIG_VERSION_RE = re.compile(r"(version:\s*['\"])([^'\"]+)(['\"])")


def read_version() -> str:
    if not VERSION_FILE.exists():
        raise FileNotFoundError(f"Missing version file: {VERSION_FILE}")
    version = VERSION_FILE.read_text(encoding="utf-8").strip()
    if not _VERSION_RE.fullmatch(version):
        raise ValueError(f"Invalid semver in {VERSION_FILE}: {version!r}")
    return version


def write_version(version: str) -> None:
    if not _VERSION_RE.fullmatch(version.strip()):
        raise ValueError(f"Invalid semver: {version!r}")
    VERSION_FILE.write_text(f"{version.strip()}\n", encoding="utf-8")


def parse_version(version: str) -> tuple[int, int, int]:
    match = _VERSION_RE.fullmatch(version.strip())
    if not match:
        raise ValueError(f"Invalid semver: {version!r}")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def bump_version(current: str, level: str) -> str:
    major, minor, patch = parse_version(current)
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    if level == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError(f"Unknown bump level: {level!r}")


def sync_config_js(version: str | None = None) -> bool:
    version = version or read_version()
    content = CONFIG_JS.read_text(encoding="utf-8")
    updated, count = _CONFIG_VERSION_RE.subn(rf"\g<1>{version}\g<3>", content, count=1)
    if count != 1:
        raise RuntimeError(f"Could not update version in {CONFIG_JS}")
    if updated == content:
        return False
    CONFIG_JS.write_text(updated, encoding="utf-8")
    return True


def user_agent(
    app_name: str | None = None,
    version: str | None = None,
    repository: str | None = None,
) -> str:
    name = app_name or APP_NAME
    ver = version or read_version()
    repo = repository or REPOSITORY
    return f"{name}/{ver} ({repo})"


def changelog_has_version(version: str) -> bool:
    if not CHANGELOG.exists():
        return False
    heading = f"## [{version}]"
    return heading in CHANGELOG.read_text(encoding="utf-8")


def github_repo_slug() -> str:
    repo = REPOSITORY.rstrip("/")
    if repo.endswith(".git"):
        repo = repo[:-4]
    prefix = "https://github.com/"
    if repo.startswith(prefix):
        return repo[len(prefix) :]
    return os.environ.get("GITHUB_REPOSITORY", "thepriben/dataroads-FR84")


def changelog_section(version: str) -> str | None:
    if not CHANGELOG.exists():
        return None

    heading = f"## [{version}]"
    text = CHANGELOG.read_text(encoding="utf-8")
    start_idx = text.find(heading)
    if start_idx == -1:
        return None

    body_start = text.find("\n", start_idx)
    if body_start == -1:
        return None
    body_start += 1

    next_heading = text.find("\n## [", body_start)
    section = text[body_start:next_heading if next_heading != -1 else len(text)]

    lines: list[str] = []
    for line in section.splitlines():
        if line.startswith("[") and "]: http" in line:
            break
        lines.append(line)

    body = "\n".join(lines).strip()
    if not body:
        return None

    slug = github_repo_slug()
    return (
        f"{body}\n\n"
        f"Voir le [CHANGELOG complet](https://github.com/{slug}/blob/main/CHANGELOG.md)."
    )
