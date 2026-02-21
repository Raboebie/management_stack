# Monitoring Stack

Ansible-deployed Docker Compose stack for full host monitoring on Fedora 43 with AMD GPU support. Includes Traefik reverse proxy with local TLS, centralized logging via Loki, Docker management via Portainer, Ansible web UI via Semaphore, and local LLM serving via Ollama with Open WebUI chat and Tabby code completion.

## Architecture

```
Host (Fedora 43)
+-- Traefik (reverse proxy, HTTPS via mkcert *.home wildcard cert)
|   Routes: grafana.home, icinga.home, influxdb.home, portainer.home,
|           semaphore.home, traefik.home, ollama.home, chat.home, tabby.home
|   HTTP -> HTTPS redirect
|
+-- Telegraf (privileged, host PID/network)
|   CPU, Memory, Disk, DiskIO, Network, System, Processes
|   AMD GPU via rocm-smi (nsenter into host namespace)
|   Ollama metrics (loaded models, VRAM usage)
|   writes to --> InfluxDB 2.x
|
+-- Promtail (log collector)
|   Docker container logs (via socket) + host systemd journal
|   writes to --> Loki
|
+-- Icinga2
|   Service checks (ping, load, procs, HTTP for all web UIs)
|   Targets Docker host via bridge gateway (172.17.0.1)
|   InfluxDB2Writer --> InfluxDB 2.x
|   IcingaDB feature --> Redis
|
+-- Loki (log aggregation, 30-day retention)
+-- IcingaDB + Redis (Icinga2 state backend)
+-- IcingaWeb2 (Icinga UI)
+-- PostgreSQL (IcingaWeb2 + IcingaDB backend)
+-- InfluxDB 2.x (metrics storage)
+-- Grafana (dashboards + log exploration via Loki)
+-- Portainer (Docker management UI)
+-- Semaphore (Ansible web UI)
+-- Ollama (LLM serving, ROCm GPU, qwen2.5-coder:14b)
+-- Open WebUI (LLM chat interface)
+-- Tabby (code completion, proxies through Ollama)
```

## Services

| Service | Port | HTTPS URL | Description |
|---------|------|-----------|-------------|
| Traefik | 80/443 | `https://traefik.home` | Reverse proxy + TLS termination |
| Grafana | 3000 | `https://grafana.home` | Dashboards + log exploration |
| InfluxDB 2.x | 8086 | `https://influxdb.home` | Metrics storage (Flux query language) |
| IcingaWeb2 | 8081 | `https://icinga.home` | Icinga web UI for alerts and service status |
| Portainer | 9000 | `https://portainer.home` | Docker management UI |
| Semaphore | 3001 | `https://semaphore.home` | Ansible web UI |
| Icinga2 API | 5665 | — | Icinga2 API endpoint |
| Loki | internal | — | Log aggregation (30-day retention) |
| Promtail | internal | — | Log collector (Docker + journal) |
| PostgreSQL | internal | — | Database for IcingaWeb2 + IcingaDB |
| Redis | internal | — | IcingaDB state backend |
| IcingaDB | internal | — | Syncs Icinga2 state to PostgreSQL via Redis |
| Ollama | 11434 | `https://ollama.home` | LLM serving with AMD GPU (ROCm) |
| Open WebUI | 8082 | `https://chat.home` | LLM chat interface |
| Tabby | 8083 | `https://tabby.home` | Code completion server |
| Telegraf | host network | — | System + GPU + Ollama metric collection |

## Prerequisites

- Fedora 43 (or compatible)
- Ansible (`dnf install ansible`)
- Passwordless sudo (or use `--ask-become-pass`)

Docker (moby-engine), docker-compose, rocm-smi, and mkcert are installed automatically by the playbook.

## DNS

The playbook registers `.home` DNS records in Pi-hole v6 so services are reachable by name. Traefik reverse-proxies all web UIs with HTTPS, so no port numbers are needed:

| Hostname | Service | URL |
|----------|---------|-----|
| `grafana.home` | Grafana | `https://grafana.home` |
| `influxdb.home` | InfluxDB | `https://influxdb.home` |
| `icinga.home` | IcingaWeb2 | `https://icinga.home` |
| `traefik.home` | Traefik | `https://traefik.home` |
| `portainer.home` | Portainer | `https://portainer.home` |
| `semaphore.home` | Semaphore | `https://semaphore.home` |
| `icinga-api.home` | Icinga2 API | `https://icinga-api.home:5665` |
| `ollama.home` | Ollama | `https://ollama.home` |
| `chat.home` | Open WebUI | `https://chat.home` |
| `tabby.home` | Tabby | `https://tabby.home` |
| `pihole.home` | Pi-hole | `http://pihole.home:8181` |

All records point to the host IP (`192.168.88.100`). TLS is provided by a mkcert certificate with explicit SANs for each hostname (wildcard-only certs don't work for single-label TLDs like `.home`). The mkcert CA is trusted in the OS trust store, system trust anchors, and the invoking user's browser (Firefox/Chrome). HTTP requests are automatically redirected to HTTPS.

A `bookmarks.html` file is included in the repo root for importing into Firefox (Bookmarks → Manage Bookmarks → Import from HTML). It creates a "Monitoring Stack" folder in the bookmarks toolbar with all service URLs.

Records are managed declaratively via the Pi-hole v6 REST API — the `pihole_dns` role owns all local DNS entries and will overwrite manual changes on next run.

## Quick Start

```bash
cd ~/monitoring-stack

# 1. Edit vault passwords (optional, defaults are pre-generated)
ansible-vault edit group_vars/all.yml

# 2. Deploy
ansible-playbook playbook.yml

# 3. Access (HTTPS via Traefik)
#    Grafana:    https://grafana.home
#    IcingaWeb2: https://icinga.home
#    InfluxDB:   https://influxdb.home
#    Portainer:  https://portainer.home
#    Semaphore:  https://semaphore.home
#    Traefik:    https://traefik.home
#    Open WebUI: https://chat.home
#    Ollama API: https://ollama.home
#    Tabby:      https://tabby.home
```

## Credentials

All credentials are stored in `group_vars/all.yml`, encrypted with Ansible Vault.

```bash
# View credentials
ansible-vault view group_vars/all.yml

# Edit credentials
ansible-vault edit group_vars/all.yml
```

The vault password is in `.vault` (gitignored, mode 600). Ansible is configured to use it automatically via `ansible.cfg`.

### Default Users

| Service | Username | Password |
|---------|----------|----------|
| Grafana | admin | see vault: `grafana_admin_password` |
| IcingaWeb2 | icingaadmin | see vault: `icingaweb2_admin_password` |
| InfluxDB | admin | see vault: `influxdb_admin_password` |
| Semaphore | admin | see vault: `semaphore_admin_password` |
| Portainer | (set on first login) | — |
| Open WebUI | (set on first login) | — |

## Project Structure

```
monitoring-stack/
+-- ansible.cfg                    # Local connection, vault config
+-- inventory/hosts.yml            # localhost target
+-- playbook.yml                   # Main entrypoint
+-- group_vars/all.yml             # Encrypted variables (vault)
+-- bookmarks.html                 # Firefox bookmarks for all service URLs
+-- .vault                         # Vault password (gitignored)
+-- gnome-extension/               # GNOME Shell Docker Monitor extension
|   +-- metadata.json              # Extension metadata (GNOME Shell 49)
|   +-- extension.js               # Panel indicator + Docker polling
|   +-- prefs.js                   # Preferences window (add/remove containers)
|   +-- stylesheet.css             # Status color classes
|   +-- schemas/
|       +-- org.gnome.shell.extensions.docker-monitor.gschema.xml
+-- roles/
    +-- prerequisites/
    |   +-- tasks/main.yml         # Docker, rocm-smi, mkcert installation
    +-- pihole_dns/
    |   +-- tasks/main.yml         # Register .home DNS records in Pi-hole v6
    +-- monitoring_stack/
        +-- tasks/main.yml         # Deploy configs, start stack, configure Icinga2
        +-- handlers/main.yml      # Restart handlers
        +-- templates/
        |   +-- docker-compose.yml.j2
        |   +-- telegraf.conf.j2
        |   +-- rocm-smi-telegraf.sh.j2
        |   +-- ollama-metrics.sh.j2
        |   +-- icinga2/
        |   |   +-- constants.conf.j2
        |   |   +-- conf.d/
        |   |   |   +-- hosts.conf.j2
        |   |   |   +-- services.conf.j2
        |   |   |   +-- api-users.conf.j2
        |   |   +-- features/
        |   |       +-- influxdb2.conf.j2
        |   |       +-- icingadb.conf.j2
        |   +-- grafana/provisioning/
        |   |   +-- datasources/
        |   |       +-- influxdb.yml.j2
        |   |       +-- loki.yml.j2
        |   +-- loki/
        |   |   +-- local-config.yaml.j2
        |   +-- promtail/
        |   |   +-- config.yaml.j2
        |   +-- tabby/
        |   |   +-- config.toml.j2
        |   +-- traefik/
        |       +-- tls.yml.j2
        +-- files/
            +-- grafana/dashboards/
                +-- system-monitoring.json
```

## Configurable Variables

Edit via `ansible-vault edit group_vars/all.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `influxdb_org` | monitoring | InfluxDB organization |
| `influxdb_bucket` | telegraf | InfluxDB bucket for metrics |
| `influxdb_admin_user` | admin | InfluxDB admin username |
| `influxdb_admin_password` | (generated) | InfluxDB admin password |
| `influxdb_admin_token` | (generated) | InfluxDB API token |
| `grafana_admin_user` | admin | Grafana admin username |
| `grafana_admin_password` | (generated) | Grafana admin password |
| `postgres_user` | icinga | PostgreSQL username |
| `postgres_password` | (generated) | PostgreSQL password |
| `postgres_db` | icingadb | PostgreSQL database name |
| `icinga2_api_user` | icingaweb2 | Icinga2 API username |
| `icinga2_api_password` | (generated) | Icinga2 API password |
| `icinga2_ticket_salt` | (generated) | Icinga2 ticket salt |
| `icinga2_host_address` | 172.17.0.1 | IPv4 address Icinga2 checks target (Docker host gateway) |
| `icingaweb2_admin_password` | (generated) | IcingaWeb2 admin password |
| `semaphore_admin_user` | admin | Semaphore admin username |
| `semaphore_admin_password` | (set in vault) | Semaphore admin password |
| `semaphore_access_key` | (generated) | Semaphore access key encryption secret |
| `pihole_api_url` | http://localhost:8181 | Pi-hole API base URL |
| `pihole_admin_password` | (set in vault) | Pi-hole admin password |
| `host_ip` | 192.168.88.100 | Host IP for DNS records |
| `dns_domain` | home | Domain suffix for DNS records |
| `pihole_dns_records` | (list) | Hostnames to register (e.g., grafana, icinga) |
| `rocm_smi_path` | /usr/bin/rocm-smi | Path to rocm-smi binary |
| `stack_dir` | ~/monitoring-stack/stack | Docker Compose deploy directory |
| `grafana_port` | 3000 | Grafana port |
| `influxdb_port` | 8086 | InfluxDB port |
| `icingaweb2_port` | 8081 | IcingaWeb2 port |
| `icinga2_api_port` | 5665 | Icinga2 API port |
| `ollama_port` | 11434 | Ollama API port |
| `ollama_keep_alive` | 24h | How long to keep models loaded in VRAM |
| `ollama_num_parallel` | 4 | Max parallel requests per model |
| `hsa_override_gfx_version` | 10.3.0 | ROCm GFX version override for AMD GPU |
| `ollama_default_models` | [qwen2.5-coder:14b] | Models to pre-pull on deploy |
| `open_webui_port` | 8082 | Open WebUI port |
| `open_webui_secret_key` | (generated) | Open WebUI session secret |
| `tabby_port` | 8083 | Tabby port |
| `tabby_completion_model` | qwen2.5-coder:14b | Tabby completion model (via Ollama) |
| `tabby_chat_model` | qwen2.5-coder:14b | Tabby chat model (via Ollama) |

## Grafana Dashboard

The pre-built "System Monitoring" dashboard includes:

- **System**: Uptime (stat), Load averages (time series)
- **CPU**: Per-core + total usage (time series)
- **Memory**: Usage gauge + Used/Cached/Available over time (stacked)
- **Disk**: Usage per mountpoint (bar gauge) + over time
- **Disk IO**: Read/Write throughput + IOPS
- **Network**: Per-interface in/out traffic
- **GPU**: Temperature, Utilization (gauge + time series), VRAM usage, Power draw

## AMD GPU Metrics

GPU metrics are collected via a wrapper script that:
1. Uses `nsenter` to run `rocm-smi` in the host mount namespace (the Telegraf container lacks python3)
2. Parses the JSON output and normalizes field names
3. Outputs clean JSON for Telegraf's exec input plugin

Collected fields: `temperature_edge`, `temperature_junction`, `temperature_memory`, `gpu_use_percent`, `vram_used_percent`, `memory_activity_percent`, `power_avg`

Note: Fan speed fields (`fan_speed_percent`, `fan_rpm`) are parsed but may be absent on hardware that doesn't expose fan data.

Requirements: Telegraf container runs as root with `security_opt: label:disable` (SELinux) and host PID namespace.

## Local LLM Serving

The stack includes local LLM inference via Ollama with AMD ROCm GPU acceleration (RX 6800 XT, 16GB VRAM).

### Components

- **Ollama** (`ollama.home`) — LLM serving with ROCm GPU. Pre-pulls `qwen2.5-coder:14b` (~10GB Q4). Exposes OpenAI-compatible API at `http://localhost:11434/v1`.
- **Open WebUI** (`chat.home`) — Web chat interface. First visit requires creating an admin account.
- **Tabby** (`tabby.home`) — Code completion server. Proxies through Ollama's API (no separate GPU access).

### Editor Setup (Continue.dev + Tabby)

For VS Code, use Continue.dev for chat/edit and Tabby for autocomplete:

```yaml
# ~/.continue/config.yaml
models:
  - title: "Qwen2.5 Coder 14B (Local)"
    provider: ollama
    model: qwen2.5-coder:14b
    apiBase: http://localhost:11434
tabAutocompleteModel:
  title: "Tabby"
  provider: openai
  model: qwen2.5-coder:14b
  apiBase: https://tabby.home/v1
```

### CLI Agent Usage

Ollama's OpenAI-compatible endpoint works with aider, open-interpreter, goose, fabric, etc.:

```bash
export OPENAI_API_BASE=http://localhost:11434/v1
export OPENAI_API_KEY=ollama
aider --model ollama/qwen2.5-coder:14b
```

### Ollama Metrics

Telegraf collects Ollama metrics (loaded models, VRAM usage, available model count) via an exec script polling `/api/ps` and `/api/tags`. Data flows to InfluxDB for Grafana dashboards.

## GNOME Shell Extension — Docker Monitor

A GNOME Shell top bar indicator that shows container health at a glance. Source code is in `gnome-extension/`.

**Features:**
- Panel icon: green checkmark when all monitored containers are running, red X when any are down
- Dropdown menu listing each container with its status (running/stopped)
- Click a container name to open its `.home` URL in the browser
- Configurable container list and refresh interval via preferences window
- "Import from Docker" button auto-discovers all running containers
- Polls `docker ps` every 10 seconds (configurable 5–300s)

**Install:**

```bash
# Copy to GNOME Shell extensions directory
cp -r gnome-extension ~/.local/share/gnome-shell/extensions/docker-monitor@dihan

# Compile GSettings schema
glib-compile-schemas ~/.local/share/gnome-shell/extensions/docker-monitor@dihan/schemas/

# Log out and back in (Wayland requires restart to discover new extensions), then:
gnome-extensions enable docker-monitor@dihan
```

**Or install from the pre-built zip:**

```bash
gnome-extensions install gnome-extension/docker-monitor@dihan.shell-extension.zip --force
# Log out and back in, then:
gnome-extensions enable docker-monitor@dihan
```

**Preferences:** `gnome-extensions prefs docker-monitor@dihan`

**Troubleshooting:**

```bash
# Check extension status
gnome-extensions info docker-monitor@dihan

# Watch for errors
journalctl -f /usr/bin/gnome-shell | grep -i docker
```

**Files:**

| File | Purpose |
|------|---------|
| `extension.js` | Panel indicator, Docker polling via `Gio.Subprocess`, status menu |
| `prefs.js` | Adw preferences window (add/remove containers, refresh interval) |
| `stylesheet.css` | Green/red status color classes |
| `metadata.json` | GNOME Shell 49 extension metadata |
| `schemas/*.gschema.xml` | GSettings schema (`monitored-containers`, `refresh-interval`) |

Requires GNOME Shell 49.

## Operations

```bash
# Check container status
docker compose -f ~/monitoring-stack/stack/docker-compose.yml ps

# View logs
docker logs telegraf
docker logs icinga2
docker logs grafana

# Restart the stack
docker compose -f ~/monitoring-stack/stack/docker-compose.yml restart

# Full redeploy
cd ~/monitoring-stack && ansible-playbook playbook.yml

# Tear down (preserves volumes)
docker compose -f ~/monitoring-stack/stack/docker-compose.yml down

# Tear down + delete data
docker compose -f ~/monitoring-stack/stack/docker-compose.yml down -v
```
