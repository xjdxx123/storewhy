"""Read-only checks for the hackathon Data, Build and Power layers.

Run with the project virtualenv. Add --live to send a short model request.
Credentials are loaded from .env.local and are never printed.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent.parent
RESULTS: list[dict[str, str]] = []


def report(status: str, check: str, detail: str) -> None:
    RESULTS.append({"status": status, "check": check, "detail": detail})
    print(f"[{status}] {check}: {detail}", flush=True)


def command(*args: str, timeout: int = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def http(url: str, *, headers=None, payload=None, timeout=15):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers=headers or {})
    # Local checks must not accidentally route through a shell's HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=timeout) as response:
        body = response.read()
        return response.status, json.loads(body) if body else None


def safe_failure(check: str, error: Exception) -> None:
    if isinstance(error, urllib.error.HTTPError):
        report("FAIL", check, f"HTTP {error.code}; check credentials and service configuration")
    elif isinstance(error, (urllib.error.URLError, TimeoutError)):
        report("BLOCKED", check, "service is unreachable or timed out")
    elif isinstance(error, subprocess.TimeoutExpired):
        report("BLOCKED", check, "command timed out; service may still be starting")
    else:
        report("FAIL", check, f"unexpected {type(error).__name__}; no secrets or response bodies logged")


def check_build() -> None:
    report("PASS" if sys.version_info >= (3, 10) else "FAIL", "Python", sys.version.split()[0])
    for package in ("openai", "python-dotenv", "requests"):
        try:
            report("PASS", package, importlib.metadata.version(package))
        except importlib.metadata.PackageNotFoundError:
            report("BLOCKED", package, "not installed in this virtualenv")
    report("PASS" if sys.prefix != sys.base_prefix else "BLOCKED", "virtualenv", ".venv active" if sys.prefix != sys.base_prefix else "run .venv/bin/python setup/check_environment.py")


def check_docker() -> None:
    docker = shutil.which("docker")
    bundled = Path("/Applications/Docker.app/Contents/Resources/bin/docker")
    if not docker and bundled.exists():
        docker = str(bundled)
    if not docker:
        report("BLOCKED", "Docker", "Docker Desktop is not installed")
        return
    try:
        version = command(docker, "--version")
        report("PASS" if version.returncode == 0 else "FAIL", "Docker CLI", version.stdout.strip() if version.returncode == 0 else "CLI failed")
        compose = command(docker, "compose", "version")
        report("PASS" if compose.returncode == 0 else "FAIL", "Docker Compose", compose.stdout.strip() if compose.returncode == 0 else "Compose plugin unavailable")
        info = command(docker, "info", "--format", "{{json .}}", timeout=20)
        if info.returncode:
            report("BLOCKED", "Docker daemon", "finish Docker Desktop first-run setup and start the engine")
            return
        state = json.loads(info.stdout)
        memory = state.get("MemTotal", 0) / 1024**3
        cpus = state.get("NCPU", 0)
        report("PASS" if memory >= 6 and cpus >= 4 else "FAIL", "Docker resources", f"{memory:.1f} GiB, {cpus} CPUs; guide recommends 8 GiB and at least 4 CPUs")
    except Exception as error:
        safe_failure("Docker", error)


def check_zetaris() -> None:
    ui = os.getenv("ZETARIS_BASE_URL", "http://localhost:3001").rstrip("/")
    try:
        request = urllib.request.Request(ui)
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=8) as response:
            body = response.read(100000).decode("utf-8", errors="replace")
            identified = response.status == 200 and "zetaris" in body.lower()
            report("PASS" if identified else "BLOCKED", "Zetaris UI", "HTTP 200; Zetaris page identified" if identified else "port responds but page could not be identified as Zetaris")
    except Exception as error:
        safe_failure("Zetaris UI", error)
    token = os.getenv("ZETARIS_API_KEY", "").strip()
    if not token:
        report("BLOCKED", "Zetaris SQL", "set ZETARIS_API_KEY in .env.local after installing Zetaris")
        return
    base = os.getenv("ZETARIS_REST_URL", "http://localhost:8888/api/v1.0").rstrip("/")
    headers = {"Authorization": f"Bearer {token}", "X-Org-ID": os.getenv("ZETARIS_ORG_ID", "1"), "X-Request-ID": str(uuid.uuid4()), "Content-Type": "application/json"}
    try:
        _, reply = http(base + "/sql-editor/sqls/run", headers=headers, payload={"queryId": str(uuid.uuid4()), "sql": "SELECT 1 AS one", "source": "SqlEditor", "limit": 1}, timeout=60)
        rows = reply.get("data") if isinstance(reply, dict) else None
        ok = bool(rows) and isinstance(rows[0], list) and str(rows[0][0]) == "1"
        report("PASS" if ok else "FAIL", "Zetaris SQL", "SELECT 1 returned 1" if ok else "query response did not contain the expected value")
    except Exception as error:
        safe_failure("Zetaris SQL", error)


def check_meterless(live: bool) -> None:
    base = os.getenv("METERLESS_BASE_URL", "http://127.0.0.1:8088/v1").rstrip("/")
    token = os.getenv("METERLESS_RUNTIME_TOKEN", "").strip()
    if not token:
        report("BLOCKED", "Nightshift authentication", "copy Runtime URL and token from Nightshift Console into .env.local")
        return
    if token == "rt-local" or token.startswith("<"):
        report("FAIL", "Nightshift authentication", "a real Runtime token is required")
        return
    headers = {"Authorization": f"Bearer {token}", "meterless-app": "hackathon-setup", "meterless-scope": "user", "Content-Type": "application/json"}
    try:
        _, reply = http(base + "/models", headers=headers)
        models = [m.get("id", "") for m in reply.get("data", []) if isinstance(m, dict)]
        routes = [m for m in models if m.startswith("meterless/")]
        if not routes:
            report("FAIL", "Nightshift discovery", "endpoint returned no meterless/* routes")
            return
        report("PASS", "Nightshift discovery", f"{len(routes)} meterless/* routes available")
        wrong = dict(headers, Authorization="Bearer invalid-hackathon-setup-token")
        try:
            http(base + "/models", headers=wrong)
            report("FAIL", "Nightshift rejects wrong token", "request was accepted")
        except urllib.error.HTTPError as error:
            report("PASS" if error.code in (401, 403) else "FAIL", "Nightshift rejects wrong token", f"HTTP {error.code}")
        if not live:
            report("SKIP", "Nightshift model request", "add --live after configuring an active model lane")
            return
        model = os.getenv("METERLESS_MODEL", "meterless/auto")
        if model not in models:
            report("FAIL", "Nightshift model request", "configured route is absent from model discovery")
            return
        _, reply = http(base + "/chat/completions", headers=headers, payload={"model": model, "messages": [{"role": "user", "content": "Reply with the single word ready."}], "max_tokens": 128, "stream": False, "reasoning_effort": "none"}, timeout=180)
        choices = reply.get("choices", [])
        content = choices[0].get("message", {}).get("content") if choices else None
        ok = isinstance(content, str) and bool(content.strip())
        winning = reply.get("meterless", {}).get("winning_route", {})
        used_model = winning.get("model") or reply.get("model", "unknown")
        provider = winning.get("provider", "unknown")
        if model.startswith("nvidia/"):
            ok = ok and provider == "nvidia" and used_model == model
        report("PASS" if ok else "FAIL", "Nightshift model request", f"model={used_model}, provider={provider}; response verified" if ok else "expected model route or text response could not be verified")
    except Exception as error:
        safe_failure("Nightshift", error)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="send a short model request after discovery")
    parser.add_argument("--report", type=Path, help="save redacted status JSON")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env.local", override=False)
    check_build()
    check_docker()
    check_zetaris()
    check_meterless(args.live)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(RESULTS, indent=2) + "\n")
    return 1 if any(r["status"] in ("FAIL", "BLOCKED", "SKIP") for r in RESULTS) else 0


if __name__ == "__main__":
    raise SystemExit(main())
