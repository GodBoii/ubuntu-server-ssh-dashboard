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

## Phone access from outside home

Live URL: https://control.tradecognition.online. Choose **Cloudflare** on the login page and sign in as `prajwalghadge2005@gmail.com`. The dedicated `Ubuntu Control` Access application protects all paths. The `ubuntu-ssh` tunnel routes this hostname to `http://127.0.0.1:3000` and retains its existing SSH route.

Run the full controller on Ubuntu. Vercel hosting for the frontend alone does not provide the controller's host commands or persistent terminal processes.

```text
phone browser -> Cloudflare Access -> Ubuntu tunnel -> 127.0.0.1:3000
                                                    -> Python helper / Bash as arun
```

The Ubuntu deployment lives at `/home/arun/ubuntu-control` and uses the `ubuntu-control` systemd user service. It runs directly as `arun`, with the same Docker and filesystem permissions. The Windows default remains SSH mode. The laptop can be off when the Ubuntu deployment is in use.

Configure `/home/arun/.config/ubuntu-control/environment` with mode `0600`:

```ini
UBUNTU_CONTROL_PUBLIC_ORIGIN=https://control.tradecognition.online
UBUNTU_CONTROL_ACCESS_TEAM=summer-art-306d
UBUNTU_CONTROL_ACCESS_AUD=<the new dashboard Access application's audience>
```

The service file in `deploy/ubuntu-control.service` sets `UBUNTU_CONTROL_MODE=local`. Copy it to `~/.config/systemd/user/ubuntu-control.service`, then use `systemctl --user daemon-reload` and `systemctl --user enable --now ubuntu-control`. User lingering must be enabled for startup at boot without a login.

Create a dedicated Cloudflare Access self-hosted application covering the whole dashboard hostname, including all API and WebSocket paths. Allow only the owner's email. Add a published HTTP route to `127.0.0.1:3000` on the existing Ubuntu tunnel after Access protection is in place. Keep the existing SSH route unchanged. No Vercel project or additional tunnel process is needed.

Public mode requires the Access issuer and audience. The controller verifies JWT signatures, issuer, audience, and expiration for every HTTP request and WebSocket upgrade. Missing or invalid authentication returns 403, including direct-origin requests. Origin and session-token checks still protect mutations and terminal upgrades. Never use a public route with the public-mode environment variables omitted.

Service commands on Ubuntu:

```sh
systemctl --user status ubuntu-control
systemctl --user restart ubuntu-control
journalctl --user -u ubuntu-control -n 50
```

Open the dashboard hostname on your phone and sign in with the allowed email. Use Containers to restart a workload, or Terminal for `git pull` and builds. Commands run as `arun`. Ubuntu must stay powered and connected. Use a persistent shell such as tmux for long jobs if installed, because closing the terminal connection can terminate its shell.

The deployment uses a private copy of Node at `runtime/node`. Its Linux native dependencies were built using the official `node:22-bullseye` image with a 2 GB memory limit and two CPUs. That temporary build container does not run the dashboard. Rebuild after dependency changes using a compatible Linux environment, then restart only `ubuntu-control`.

To disable phone access, remove only the dashboard's published route and disable its service with `systemctl --user disable --now ubuntu-control`. Keep Access protection until its route is removed. This leaves the existing SSH route and application containers in place.

## Requirement

This must work without a password prompt:

```powershell
ssh -o BatchMode=yes ubuntu-server "whoami"
```

If it stops working the console says so and keeps retrying with a backoff. It does not crash and it does not hide the failure.
