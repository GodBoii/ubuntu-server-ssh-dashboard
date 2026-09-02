# Ubuntu Control

Ubuntu Control is a local management desktop for the remote `arun-H110` Ubuntu server. The browser connects only to a controller on this Windows laptop. The controller uses the existing `ssh ubuntu-server` profile, which reaches Ubuntu through Cloudflare Access and Cloudflare Tunnel.

## Architecture

```text
Browser on 127.0.0.1:3000
  -> local Node.js controller
  -> Windows OpenSSH and cloudflared ProxyCommand
  -> Cloudflare Access and Tunnel
  -> Ubuntu as arun
```

Nothing in this project opens an inbound port on the Ubuntu server. The local HTTP server binds only to `127.0.0.1`, so other devices cannot access it over the laptop's Wi-Fi.

## Applications

- Overview: live CPU load, memory, disk, temperature, uptime and stack health.
- Containers: inspect, filter, start, stop and restart Docker workloads.
- Logs: follow live logs from any container.
- Terminal: interactive SSH terminal powered by the existing Windows SSH configuration.
- Files: browse and edit text files under `/home/arun/apps`.
- Services: inspect SSH, Docker, containerd and cloudflared boot state.
- Activity: local audit history for management actions.

## Run

Production-style local run:

```powershell
cd C:\Users\prajw\Downloads\Ubuntu-Control
npm run build
npm start
```

Open `http://127.0.0.1:3000`.

For development with automatic reload:

```powershell
cd C:\Users\prajw\Downloads\Ubuntu-Control
npm run dev
```

You can also double-click `start-control.cmd` after a production build.

## Security boundaries

- The controller never stores the Ubuntu sudo password.
- Terminal sessions run as `arun`.
- Files are restricted to `/home/arun/apps` and text files up to 2 MB.
- Container and stack actions use validated names and fixed action sets.
- State-changing HTTP requests require a random in-memory session token and an approved local origin.
- Destructive UI actions require confirmation.
- Actions are appended to `data/audit/actions.jsonl`.
- Systemd changes remain read-only. Use Terminal and Ubuntu's normal sudo prompt for privileged work.

Membership in Docker's group is effectively administrative access. Keep this application local and do not change its bind address to `0.0.0.0`.

## Existing SSH dependency

The controller expects this command to work without a password:

```powershell
ssh -o BatchMode=yes ubuntu-server "whoami"
```

It also installs the structured operations helper at:

```text
/home/arun/.ubuntu-control/ops.py
```

The helper accepts JSON over SSH stdin. It is not a daemon and does not listen on a network port.
