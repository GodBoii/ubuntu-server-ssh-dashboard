# Ubuntu Control

A local console for the remote `arun-H110` Ubuntu server. The browser talks only to a controller running on this Windows laptop. That controller reuses the existing `ssh ubuntu-server` profile, which reaches Ubuntu through Cloudflare Access and a Cloudflare Tunnel.

```text
browser on 127.0.0.1:3000
  -> local Node controller
  -> Windows OpenSSH + cloudflared ProxyCommand
  -> Cloudflare Access and Tunnel
  -> Ubuntu as arun
```

Nothing here opens an inbound port on Ubuntu. The HTTP server binds to `127.0.0.1` only, so other devices on the laptop's Wi-Fi cannot reach it.

## Sections

| # | Section | What it does |
|---|---------|--------------|
| 01 | Machine | Processor, memory and disk vitals, compose stacks, busiest processes |
| 02 | Containers | Filterable table of every Docker workload, with a detail inspector |
| 03 | Logs | Live `docker logs` stream with filter, level marks, pause and download |
| 04 | Terminal | Interactive shell with GPU rendering, find, and automatic reattach |
| 05 | Files | Browse and edit text files under `/home/arun/apps` |
| 06 | Services | Read-only systemd state for ssh, cloudflared, docker, containerd |
| 07 | Activity | Local ledger of every action this controller performed |

## Design

The interface is one continuous plane divided by hairlines. There are no cards, no panel radius and no shadows outside floating overlays. Hierarchy comes from type: mono for every piece of machine data, sans for prose and labels. Teal marks anything you can act on and nothing else; machine state is told by three lamps (moss, brass, rust) always paired with a word, so colour is never the only signal.

The header doubles as the instrument. A stepped CPU trace bleeds to the right edge of it, which is why no screen needs a row of metric tiles.

Tokens live in `src/styles/tokens.css`. The rest of the stylesheet is split by layer: `base`, `shell`, `parts`, `apps`, `overlays`.

## Run

```powershell
cd C:\Users\prajw\Downloads\Ubuntu-Control
npm run build
npm start
```

Open `http://127.0.0.1:3000`. `start-control.cmd` does the same after a build.

For development with reload:

```powershell
npm run dev
```

## How the controller talks to Ubuntu

The controller installs a helper at `/home/arun/.ubuntu-control/ops.py` and speaks JSON to it. The helper is not a daemon and never listens on a socket.

It runs in two modes:

- **Persistent.** `python3 ops.py --serve` reads newline-delimited JSON requests on stdin. The controller keeps two of these channels open over SSH, one for dashboard reads and one for state changes, so the Cloudflare Access handshake is not paid on every request. Mutations get their own channel because a 3 minute stack restart must not block a 1 second read.
- **One-shot.** `python3 ops.py` answers a single request. The controller falls back to this automatically if a channel dies, so a dropped tunnel degrades to the slower path instead of failing.

Reads are batched on the Ubuntu side: one `docker inspect` for every container rather than one per container, and one `systemctl show` for every unit rather than two calls each.

The controller caches the overview for 1.5s and collapses concurrent callers onto a single request, so several tabs and a manual refresh still cost one round trip.

## Security boundaries

- The controller never stores the Ubuntu sudo password.
- Terminal sessions run as `arun`.
- File access is limited to `/home/arun/apps`, text files, 2 MB maximum. Saves go through a temp file and keep the original permissions.
- Container and stack actions use validated names and a fixed action set.
- State-changing requests need a random in-memory session token and an approved local origin. WebSocket upgrades need the same token.
- Destructive actions require confirmation that lists the concrete effects.
- Actions are appended to `data/audit/actions.jsonl` with their duration and outcome.
- systemd stays read-only. Privileged work goes through the Terminal and Ubuntu's own sudo prompt.

Membership in the `docker` group is effectively administrative access. Keep this application local and do not change the bind address to `0.0.0.0`.

## Requirement

This must work without a password prompt:

```powershell
ssh -o BatchMode=yes ubuntu-server "whoami"
```

If it stops working the console says so and keeps retrying with a backoff. It does not crash and it does not hide the failure.
