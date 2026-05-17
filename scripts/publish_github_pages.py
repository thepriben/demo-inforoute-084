#!/usr/bin/env python3
"""Create the GitHub repository, push main, and enable GitHub Pages."""

from __future__ import annotations

import getpass
import json
import argparse
import subprocess
import urllib.error
import urllib.request
from typing import Any


DEFAULT_OWNER = "thepriben"
REPO = "demo-inforoute-084"
API_ROOT = "https://api.github.com"
API_VERSION = "2026-03-10"


def github_request(token: str, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{API_ROOT}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "demo-inforoute-084-publisher",
            "X-GitHub-Api-Version": API_VERSION,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            content = response.read().decode("utf-8")
            payload = json.loads(content) if content else {}
            return response.status, payload
    except urllib.error.HTTPError as error:
        content = error.read().decode("utf-8")
        try:
            payload = json.loads(content) if content else {}
        except json.JSONDecodeError:
            payload = {"message": content}
        return error.code, payload


def api_message(payload: dict[str, Any]) -> str:
    return str(payload.get("message") or payload)


def prompt_macos_hidden(prompt: str) -> str:
    script = (
        'display dialog '
        + json.dumps(prompt)
        + ' default answer "" with hidden answer '
        + 'buttons {"Annuler", "OK"} default button "OK" '
        + 'with title "Publication GitHub Pages"'
    )
    result = subprocess.run(["osascript", "-e", script], text=True, capture_output=True, check=False)

    if result.returncode != 0:
        return ""

    marker = "text returned:"
    if marker not in result.stdout:
        return ""

    return result.stdout.split(marker, 1)[1].strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", default=DEFAULT_OWNER, help="GitHub account or organization")
    parser.add_argument("--gui", action="store_true", help="Ask for the token with a macOS hidden dialog")
    args = parser.parse_args()

    owner = args.owner
    if args.gui:
        token = prompt_macos_hidden(
            "Collez un token GitHub, pas votre mot de passe. "
            "Token classique: scopes repo + workflow."
        )
    else:
        owner = input(f"Compte GitHub [{DEFAULT_OWNER}]: ").strip() or DEFAULT_OWNER
        token = getpass.getpass("Token GitHub (masque, pas le mot de passe): ").strip()

    if not token:
        print("Aucun token fourni, arret.")
        return 1

    code, user = github_request(token, "GET", "/user")
    if code != 200:
        print(f"Authentification GitHub refusee: {api_message(user)}")
        return 1

    login = user.get("login")
    print(f"Authentifie comme {login}.")
    if login and login.lower() != owner.lower():
        print(f"Attention: le token appartient a {login}, publication demandee sous {owner}.")

    repo_path = f"/repos/{owner}/{REPO}"
    code, repo = github_request(token, "GET", repo_path)

    if code == 200:
        print(f"Depot deja present: {repo.get('html_url')}")
    elif code == 404:
        code, repo = github_request(
            token,
            "POST",
            "/user/repos",
            {
                "name": REPO,
                "description": "Prototype cartographique statique Inforoute 084",
                "private": False,
                "auto_init": False,
                "has_issues": True,
                "has_projects": False,
                "has_wiki": False,
            },
        )
        if code != 201:
            print(f"Creation du depot impossible: {api_message(repo)}")
            return 1
        print(f"Depot cree: {repo.get('html_url')}")
    else:
        print(f"Verification du depot impossible: {api_message(repo)}")
        return 1

    subprocess.run(["git", "remote", "set-url", "origin", f"https://github.com/{owner}/{REPO}.git"], check=True)
    subprocess.run(
        ["git", "credential", "approve"],
        input=f"protocol=https\nhost=github.com\nusername={owner}\npassword={token}\n\n",
        text=True,
        check=True,
    )

    print("Push de main vers GitHub...")
    subprocess.run(["git", "push", "-u", "origin", "main"], check=True)

    pages_path = f"{repo_path}/pages"
    code, pages = github_request(token, "GET", pages_path)

    if code == 200:
        print(f"GitHub Pages deja actif: {pages.get('html_url')}")
    else:
        code, pages = github_request(token, "POST", pages_path, {"build_type": "workflow"})
        if code not in (201, 202):
            check_code, check_pages = github_request(token, "GET", pages_path)
            if check_code == 200:
                pages = check_pages
                print(f"GitHub Pages actif: {pages.get('html_url')}")
            else:
                print(f"Activation GitHub Pages impossible: {api_message(pages)}")
                return 1
        else:
            print("GitHub Pages active en mode GitHub Actions.")

    code, pages = github_request(token, "GET", pages_path)
    if code == 200:
        print(f"URL GitHub Pages: {pages.get('html_url')}")
        print(f"Statut Pages: {pages.get('status', 'inconnu')} / build_type={pages.get('build_type', 'inconnu')}")

    print(f"Depot GitHub: https://github.com/{owner}/{REPO}")
    print("Termine cote publication initiale. Le workflow Pages peut prendre une ou deux minutes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
