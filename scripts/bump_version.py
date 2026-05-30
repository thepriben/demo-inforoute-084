#!/usr/bin/env python3
"""Bump semver, sync js/config.js from VERSION, and publish GitHub releases."""

from __future__ import annotations

import argparse
import subprocess
import sys

from project_meta import (
    CHANGELOG,
    bump_version,
    changelog_has_version,
    changelog_section,
    github_repo_slug,
    read_version,
    sync_config_js,
    write_version,
)


def cmd_show() -> int:
    version = read_version()
    print(version)
    if not changelog_has_version(version):
        print(f"warning: no [{version}] section in {CHANGELOG.name}", file=sys.stderr)
    return 0


def cmd_sync() -> int:
    version = read_version()
    changed = sync_config_js(version)
    print(f"{version} -> js/config.js ({'updated' if changed else 'already in sync'})")
    return 0


def cmd_bump(level: str, skip_changelog_check: bool) -> int:
    current = read_version()
    new_version = bump_version(current, level)
    write_version(new_version)
    sync_config_js(new_version)
    print(f"bumped {current} -> {new_version}")
    print("updated VERSION and js/config.js")
    if not skip_changelog_check and not changelog_has_version(new_version):
        print(
            f"\nnext: add a ## [{new_version}] section to {CHANGELOG.name}, "
            f"then commit, push, tag v{new_version}, and run:\n"
            f"  python3 scripts/bump_version.py release",
            file=sys.stderr,
        )
        return 2
    print(
        f"\nnext: commit, push, tag v{new_version}, then run:\n"
        f"  python3 scripts/bump_version.py release",
    )
    return 0


def github_release_exists(tag: str) -> bool:
    repo = github_repo_slug()
    result = subprocess.run(
        ["gh", "release", "view", tag, "--repo", repo],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def cmd_release(version: str | None, draft: bool, skip_existing: bool, notes_file: str | None) -> int:
    version = version or read_version()
    tag = f"v{version}"
    repo = github_repo_slug()

    if skip_existing and github_release_exists(tag):
        print(f"release {tag} already exists on {repo} (skipped)")
        return 0

    if notes_file:
        notes = open(notes_file, encoding="utf-8").read().strip()
    else:
        notes = changelog_section(version)
        if not notes:
            print(
                f"error: no ## [{version}] section in {CHANGELOG.name}. "
                f"Use --notes-file or update the changelog first.",
                file=sys.stderr,
            )
            return 1

    command = [
        "gh",
        "release",
        "create",
        tag,
        "--repo",
        repo,
        "--title",
        tag,
        "--notes",
        notes,
        "--latest",
    ]
    if draft:
        command.append("--draft")

    print(f"creating GitHub release {tag} on {repo}...")
    subprocess.run(command, check=True)
    print(f"release published: https://github.com/{repo}/releases/tag/{tag}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage dataroads-FR84 semver.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("show", help="Print current version from VERSION")
    sub.add_parser("sync", help="Write VERSION into js/config.js")

    bump_parser = sub.add_parser("bump", help="Bump semver in VERSION and sync js/config.js")
    bump_parser.add_argument("level", choices=("major", "minor", "patch"))
    bump_parser.add_argument(
        "--skip-changelog-check",
        action="store_true",
        help="Do not warn when CHANGELOG.md lacks the new version section",
    )

    release_parser = sub.add_parser(
        "release",
        help="Create a GitHub Release for v{VERSION} using CHANGELOG notes",
    )
    release_parser.add_argument(
        "--version",
        help="Release this version (default: read VERSION)",
    )
    release_parser.add_argument(
        "--notes-file",
        help="Use this file for release notes instead of CHANGELOG.md",
    )
    release_parser.add_argument(
        "--draft",
        action="store_true",
        help="Create a draft release",
    )
    release_parser.add_argument(
        "--force",
        action="store_true",
        help="Create even if a release for this tag already exists",
    )

    args = parser.parse_args()

    if args.command == "show":
        return cmd_show()
    if args.command == "sync":
        return cmd_sync()
    if args.command == "bump":
        return cmd_bump(args.level, args.skip_changelog_check)
    if args.command == "release":
        return cmd_release(
            args.version,
            args.draft,
            skip_existing=not args.force,
            notes_file=args.notes_file,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
