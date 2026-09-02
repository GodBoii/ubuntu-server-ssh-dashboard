"""Structured operations helper for Ubuntu Control.

The controller on the Windows laptop invokes this over SSH in one of two modes:

one-shot   `python3 ops.py`            reads a single JSON request on stdin,
                                        writes a single JSON response on stdout.
persistent `python3 ops.py --serve`     reads newline-delimited JSON requests on
                                        stdin, writes one newline-delimited JSON
                                        response per request.

The persistent mode exists so the controller can reuse a single SSH channel
instead of paying the Cloudflare Access handshake on every request. It is not a
daemon: it lives and dies with the SSH channel and never opens a socket.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

PROTOCOL_VERSION = 2
APPS_ROOT = Path("/home/arun/apps").resolve()
STACKS: dict[str, tuple[Path, list[str], str]] = {
    "ai-os": (APPS_ROOT / "ai-os", ["-f", "docker-compose.yml", "-f", "docker-compose.server.yml"], "AI-OS"),
    "delta-exchange": (APPS_ROOT / "delta-exchange", ["-f", "docker-compose.yml", "-f", "docker-compose.tunnel.yml"], "Delta Exchange"),
    "trader": (APPS_ROOT / "trader", [], "Trader"),
}
SERVICES = ("ssh", "cloudflared", "docker", "containerd")
CONTAINER_ACTIONS = frozenset({"start", "stop", "restart"})
STACK_ACTIONS = frozenset({"start", "stop", "restart"})
EDITOR_BYTE_LIMIT = 2_000_000

# Unit separator. Compose project names, service names, restart policies and
# health strings cannot contain it, so one inspect line stays parseable.
FIELD_SEPARATOR = "\x1f"
INSPECT_FORMAT = FIELD_SEPARATOR.join((
    "{{.Name}}",
    "{{.HostConfig.RestartPolicy.Name}}",
    "{{if .State.Health}}{{.State.Health.Status}}{{end}}",
    '{{index .Config.Labels "com.docker.compose.project"}}',
    '{{index .Config.Labels "com.docker.compose.service"}}',
    "{{.State.StartedAt}}",
))
SERVICE_PROPERTIES = (
    "Id",
    "LoadState",
    "UnitFileState",
    "ActiveState",
    "SubState",
    "ActiveEnterTimestampMonotonic",
)


class RemoteError(Exception):
    """A failure the operator can act on. The message reaches the browser."""


def run(args: list[str], cwd: Path | None = None, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            cwd=cwd,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as error:
        raise RemoteError(f"{args[0]} is not installed on the Ubuntu host") from error
    except subprocess.TimeoutExpired as error:
        raise RemoteError(f"{args[0]} did not finish within {timeout}s") from error


def failure_text(result: subprocess.CompletedProcess[str], fallback: str) -> str:
    return result.stderr.strip() or result.stdout.strip() or fallback


def clean(value: str) -> str:
    """Go templates print `<no value>` for absent map keys."""
    trimmed = value.strip()
    return "" if trimmed == "<no value>" else trimmed


def resolve_safe(raw: str) -> Path:
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = APPS_ROOT / candidate
    resolved = candidate.resolve()
    if resolved != APPS_ROOT and APPS_ROOT not in resolved.parents:
        raise RemoteError("Path is outside /home/arun/apps")
    return resolved


# ---------------------------------------------------------------- docker reads


def container_names() -> set[str]:
    result = run(["docker", "ps", "-a", "--format", "{{.Names}}"], timeout=20)
    if result.returncode != 0:
        raise RemoteError(failure_text(result, "Docker is not responding"))
    names: set[str] = set()
    for line in result.stdout.splitlines():
        for name in line.split(","):
            if name.strip():
                names.add(name.strip())
    return names


def inspect_many(names: list[str]) -> dict[str, dict[str, Any]]:
    """One `docker inspect` call for every container instead of one each."""
    if not names:
        return {}
    result = run(["docker", "inspect", "--format", INSPECT_FORMAT, *names], timeout=30)
    details: dict[str, dict[str, Any]] = {}
    for line in result.stdout.splitlines():
        parts = line.split(FIELD_SEPARATOR)
        if len(parts) < 6:
            continue
        name = clean(parts[0]).lstrip("/")
        if not name:
            continue
        details[name] = {
            "restartPolicy": clean(parts[1]),
            "health": clean(parts[2]) or None,
            "project": clean(parts[3]) or None,
            "service": clean(parts[4]) or None,
            "startedAt": clean(parts[5]) or None,
        }
    return details


def docker_rows() -> list[dict[str, Any]]:
    listing = run(["docker", "ps", "-a", "--no-trunc", "--format", "{{json .}}"], timeout=25)
    if listing.returncode != 0:
        raise RemoteError(failure_text(listing, "Docker is not responding"))

    summaries: list[dict[str, Any]] = []
    for line in listing.stdout.splitlines():
        if not line.strip():
            continue
        try:
            summaries.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    names = [str(item.get("Names", "")).split(",")[0].strip() for item in summaries]
    details = inspect_many([name for name in names if name])

    rows: list[dict[str, Any]] = []
    for item, name in zip(summaries, names):
        detail = details.get(name, {})
        rows.append({
            "id": str(item.get("ID", "")) or name,
            "name": name,
            "image": str(item.get("Image", "")),
            "state": str(item.get("State", "unknown")).lower(),
            "status": str(item.get("Status", "")),
            "health": detail.get("health"),
            "ports": str(item.get("Ports", "")),
            "project": detail.get("project"),
            "service": detail.get("service"),
            "restartPolicy": detail.get("restartPolicy", ""),
            "startedAt": detail.get("startedAt"),
        })
    rows.sort(key=lambda row: (row["state"] != "running", str(row["name"]).lower()))
    return rows


# ------------------------------------------------------------------ host reads


def read_meminfo() -> dict[str, int]:
    values: dict[str, int] = {}
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            key, _, rest = line.partition(":")
            fields = rest.strip().split()
            if fields and fields[0].isdigit():
                values[key] = int(fields[0]) * 1024
    return values


def read_cpu_sample() -> dict[str, int]:
    """Raw jiffies. The controller turns two samples into a real CPU percentage."""
    with open("/proc/stat", encoding="utf-8") as handle:
        for line in handle:
            if not line.startswith("cpu "):
                continue
            fields = [int(value) for value in line.split()[1:] if value.isdigit()]
            if len(fields) < 4:
                break
            idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
            return {"total": sum(fields), "idle": idle}
    return {"total": 0, "idle": 0}


def read_network_sample() -> dict[str, int]:
    received = 0
    transmitted = 0
    with open("/proc/net/dev", encoding="utf-8") as handle:
        for line in handle:
            interface, _, rest = line.partition(":")
            name = interface.strip()
            if not rest or name == "lo" or name.startswith(("docker", "br-", "veth")):
                continue
            fields = rest.split()
            if len(fields) < 9:
                continue
            received += int(fields[0])
            transmitted += int(fields[8])
    return {"receivedBytes": received, "transmittedBytes": transmitted}


def read_temperature() -> float | None:
    readings: list[float] = []
    for path in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
        try:
            value = int(path.read_text(encoding="utf-8").strip()) / 1000
        except (ValueError, OSError):
            continue
        if 0 < value < 150:
            readings.append(value)
    return max(readings) if readings else None


def read_top_processes(limit: int = 6) -> list[dict[str, Any]]:
    result = run(["ps", "-eo", "pid,pcpu,pmem,comm", "--sort=-pcpu", "--no-headers"], timeout=15)
    if result.returncode != 0:
        return []
    processes: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        fields = line.split(None, 3)
        if len(fields) < 4:
            continue
        try:
            processes.append({
                "pid": int(fields[0]),
                "cpu": float(fields[1]),
                "memory": float(fields[2]),
                "command": fields[3].strip(),
            })
        except ValueError:
            continue
        if len(processes) >= limit:
            break
    return processes


def read_services(uptime_seconds: float) -> list[dict[str, Any]]:
    """One `systemctl show` call for every unit instead of two calls each."""
    units = [f"{name}.service" for name in SERVICES]
    properties = [f"--property={name}" for name in SERVICE_PROPERTIES]
    result = run(["systemctl", "show", *properties, *units], timeout=20)
    blocks = [block for block in result.stdout.split("\n\n") if block.strip()]

    services: list[dict[str, Any]] = []
    for index, name in enumerate(SERVICES):
        fields: dict[str, str] = {}
        if index < len(blocks):
            for line in blocks[index].splitlines():
                key, separator, value = line.partition("=")
                if separator:
                    fields[key.strip()] = value.strip()
        active_state = fields.get("ActiveState", "unknown")
        monotonic = fields.get("ActiveEnterTimestampMonotonic", "0")
        active_since = None
        if active_state == "active" and monotonic.isdigit() and int(monotonic) > 0:
            age = uptime_seconds - int(monotonic) / 1_000_000
            active_since = max(0, int(age))
        services.append({
            "name": name,
            "enabled": fields.get("UnitFileState") == "enabled",
            "active": active_state == "active",
            "state": active_state,
            "subState": fields.get("SubState", ""),
            "loaded": fields.get("LoadState", "unknown") == "loaded",
            "activeSeconds": active_since,
        })
    return services


def build_stacks(containers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stacks: list[dict[str, Any]] = []
    for stack_id, (path, _compose_args, label) in STACKS.items():
        related = [row for row in containers if row.get("project") == stack_id]
        running = sum(1 for row in related if row.get("state") == "running")
        if not related:
            status = "stopped"
        elif running == len(related):
            status = "healthy"
        elif running:
            status = "degraded"
        else:
            status = "stopped"
        stacks.append({
            "id": stack_id,
            "name": label,
            "path": str(path),
            "running": running,
            "total": len(related),
            "status": status,
            "containers": [str(row["name"]) for row in related],
        })
    return stacks


def system_overview() -> dict[str, Any]:
    memory = read_meminfo()
    disk = shutil.disk_usage("/")
    uptime_seconds = float(Path("/proc/uptime").read_text(encoding="utf-8").split()[0])
    containers = docker_rows()
    total_memory = memory.get("MemTotal", 0)
    available_memory = memory.get("MemAvailable", 0)
    swap_total = memory.get("SwapTotal", 0)
    swap_free = memory.get("SwapFree", 0)
    return {
        "protocol": PROTOCOL_VERSION,
        "host": os.uname().nodename,
        "kernel": os.uname().release,
        "uptimeSeconds": int(uptime_seconds),
        "load": list(os.getloadavg()),
        "cpuCount": os.cpu_count() or 1,
        "cpuSample": read_cpu_sample(),
        "memory": {
            "total": total_memory,
            "available": available_memory,
            "used": max(0, total_memory - available_memory),
            "swapTotal": swap_total,
            "swapUsed": max(0, swap_total - swap_free),
        },
        "disk": {"total": disk.total, "used": disk.used, "available": disk.free},
        "network": read_network_sample(),
        "temperature": read_temperature(),
        "containers": containers,
        "stacks": build_stacks(containers),
        "services": read_services(uptime_seconds),
        "processes": read_top_processes(),
        "timestamp": int(time.time() * 1000),
    }


# ------------------------------------------------------------------- mutations


def container_action(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", ""))
    action = str(payload.get("action", ""))
    if action not in CONTAINER_ACTIONS:
        raise RemoteError("Unsupported container action")
    if name not in container_names():
        raise RemoteError(f"No container named {name}")
    result = run(["docker", action, name], timeout=90)
    if result.returncode != 0:
        raise RemoteError(failure_text(result, "Docker action failed"))
    return {"ok": True, "message": f"{name} {action} completed"}


def stack_action(payload: dict[str, Any]) -> dict[str, Any]:
    stack_id = str(payload.get("id", ""))
    action = str(payload.get("action", ""))
    if stack_id not in STACKS or action not in STACK_ACTIONS:
        raise RemoteError("Unsupported stack action")
    path, compose_args, label = STACKS[stack_id]
    if not path.is_dir():
        raise RemoteError(f"{path} does not exist on the Ubuntu host")
    if action == "start":
        command = ["docker", "compose", *compose_args, "up", "-d", "--no-build"]
    else:
        command = ["docker", "compose", *compose_args, action]
    result = run(command, cwd=path, timeout=180)
    if result.returncode != 0:
        raise RemoteError(failure_text(result, "Stack action failed"))
    return {"ok": True, "message": f"{label} {action} completed"}


def list_files(payload: dict[str, Any]) -> dict[str, Any]:
    path = resolve_safe(str(payload.get("path", APPS_ROOT)))
    if not path.is_dir():
        raise RemoteError("Directory does not exist")
    entries: list[dict[str, Any]] = []
    try:
        children = sorted(path.iterdir(), key=lambda entry: (not entry.is_dir(), entry.name.lower()))
    except PermissionError as error:
        raise RemoteError("Permission denied reading this directory") from error
    for item in children:
        try:
            stat = item.stat()
        except OSError:
            continue
        entries.append({
            "name": item.name,
            "path": str(item),
            "kind": "directory" if item.is_dir() else "file",
            "size": stat.st_size,
            "modified": int(stat.st_mtime * 1000),
        })
    return {
        "path": str(path),
        "parent": str(path.parent) if path != APPS_ROOT else None,
        "entries": entries,
    }


def read_file(payload: dict[str, Any]) -> dict[str, Any]:
    path = resolve_safe(str(payload.get("path", "")))
    if not path.is_file():
        raise RemoteError("File does not exist")
    stat = path.stat()
    if stat.st_size > EDITOR_BYTE_LIMIT:
        raise RemoteError("File is larger than the 2 MB editor limit")
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except PermissionError as error:
        raise RemoteError("Permission denied reading this file") from error
    return {
        "path": str(path),
        "content": content,
        "modified": int(stat.st_mtime * 1000),
        "size": stat.st_size,
    }


def write_file(payload: dict[str, Any]) -> dict[str, Any]:
    path = resolve_safe(str(payload.get("path", "")))
    content = payload.get("content")
    if not isinstance(content, str):
        raise RemoteError("Content must be text")
    if len(content.encode("utf-8")) > EDITOR_BYTE_LIMIT:
        raise RemoteError("File is larger than the 2 MB editor limit")
    if path.is_dir():
        raise RemoteError("Target is a directory")
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
        temporary = Path(handle.name)
    os.chmod(temporary, mode)
    temporary.replace(path)
    stat = path.stat()
    return {
        "ok": True,
        "message": f"Saved {path.name}",
        "modified": int(stat.st_mtime * 1000),
        "size": stat.st_size,
    }


def create_directory(payload: dict[str, Any]) -> dict[str, Any]:
    path = resolve_safe(str(payload.get("path", "")))
    if path.exists():
        raise RemoteError(f"{path.name} already exists")
    try:
        path.mkdir(parents=False, exist_ok=False)
    except FileNotFoundError as error:
        raise RemoteError("Parent directory does not exist") from error
    except PermissionError as error:
        raise RemoteError("Permission denied creating this directory") from error
    return {"ok": True, "message": f"Created {path.name}"}


def logs(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", ""))
    raw_tail = payload.get("tail", 200)
    tail = max(20, min(int(raw_tail) if str(raw_tail).isdigit() else 200, 2000))
    if name not in container_names():
        raise RemoteError(f"No container named {name}")
    result = run(["docker", "logs", "--tail", str(tail), "--timestamps", name], timeout=45)
    return {"name": name, "lines": (result.stdout + result.stderr).splitlines()}


def ping(_payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_VERSION,
        "host": os.uname().nodename,
        "timestamp": int(time.time() * 1000),
    }


ACTIONS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "ping": ping,
    "overview": lambda _payload: system_overview(),
    "container_action": container_action,
    "stack_action": stack_action,
    "list_files": list_files,
    "read_file": read_file,
    "write_file": write_file,
    "create_directory": create_directory,
    "logs": logs,
}


# -------------------------------------------------------------------- protocol


def dispatch(request: object) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise RemoteError("Request must be a JSON object")
    action = request.get("action")
    payload = request.get("payload", {})
    if not isinstance(action, str) or action not in ACTIONS:
        raise RemoteError(f"Unsupported action: {action!r}")
    if not isinstance(payload, dict):
        raise RemoteError("Payload must be a JSON object")
    return ACTIONS[action](payload)


def describe(error: BaseException) -> str:
    message = str(error).strip()
    return message or error.__class__.__name__


def encode(document: dict[str, Any]) -> str:
    # json.dumps escapes control characters, so a response never spans two lines
    # and newline framing in --serve mode stays intact.
    return json.dumps(document, separators=(",", ":"))


def serve() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id: object = None
        try:
            request = json.loads(line)
            if isinstance(request, dict):
                request_id = request.get("id")
            response = {"id": request_id, "ok": True, "data": dispatch(request)}
        except json.JSONDecodeError as error:
            response = {"id": request_id, "ok": False, "error": f"Malformed request: {error}"}
        except Exception as error:  # reported to the controller, never swallowed
            response = {"id": request_id, "ok": False, "error": describe(error)}
        sys.stdout.write(encode(response) + "\n")
        sys.stdout.flush()


def once() -> int:
    try:
        response = {"ok": True, "data": dispatch(json.load(sys.stdin))}
    except json.JSONDecodeError as error:
        response = {"ok": False, "error": f"Malformed request: {error}"}
    except Exception as error:
        response = {"ok": False, "error": describe(error)}
    sys.stdout.write(encode(response) + "\n")
    sys.stdout.flush()
    return 0 if response["ok"] else 1


if __name__ == "__main__":
    if "--serve" in sys.argv[1:]:
        serve()
    else:
        raise SystemExit(once())
