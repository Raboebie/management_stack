# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ansible-deployed Docker Compose monitoring stack for Fedora 43 with AMD GPU support. Thirteen containers: Traefik, Telegraf, InfluxDB 2.x, Grafana, Loki, Promtail, Icinga2, IcingaDB, IcingaWeb2, PostgreSQL, Redis, Portainer, Semaphore. Includes a GNOME Shell extension (`gnome-extension/`) for top bar container status monitoring.

## Commands

```bash
# Deploy the full stack
ansible-playbook playbook.yml

# Deploy with sudo password prompt
ansible-playbook playbook.yml --ask-become-pass

# View encrypted secrets
ansible-vault view group_vars/all.yml

# Edit encrypted secrets
ansible-vault edit group_vars/all.yml

# Check container status
docker compose -f ~/monitoring-stack/stack/docker-compose.yml ps

# Full redeploy
ansible-playbook playbook.yml
```

The vault password file is `.vault` (mode 600, gitignored). Ansible auto-reads it via `ansible.cfg`.

## Architecture

**Data flow:**
- Telegraf (host metrics + AMD GPU via rocm-smi) → InfluxDB 2.x
- Promtail (Docker + journal logs) → Loki
- Icinga2 (service checks) → InfluxDB 2.x (via InfluxDB2Writer) + Redis → IcingaDB → PostgreSQL
- Grafana reads from InfluxDB + Loki; IcingaWeb2 reads from PostgreSQL
- Traefik reverse-proxies all web UIs with HTTPS (mkcert `*.home` wildcard cert)

**Exposed ports:** Traefik HTTP (80), HTTPS (443), Grafana (3000), InfluxDB (8086), IcingaWeb2 (8081), Icinga2 API (5665), Portainer (9000), Semaphore (3001), Pi-hole (8181)

## Playbook Structure

`playbook.yml` runs two plays on localhost:

**Play 1** (`become: true`):
1. **`roles/prerequisites/`** — Installs Docker (moby-engine), docker-compose, rocm-smi, and mkcert (local TLS CA)
2. **`roles/monitoring_stack/`** — Templates configs (including Traefik TLS, Loki, Promtail), generates mkcert wildcard cert, starts docker compose, post-deploys Icinga2 configs into the running container via `docker cp`

**Play 2** (`become: false`):
3. **`roles/pihole_dns/`** — Registers `.home` DNS records in Pi-hole v6 via its REST API (e.g., `grafana.home`, `icinga.home`). Manages records declaratively — computes a diff and only adds/removes what changed.

## Key Design Decisions

- **All config is templated**: Jinja2 templates in `roles/monitoring_stack/templates/` generate docker-compose.yml, telegraf.conf, Icinga2 configs, Grafana provisioning files, Loki config, Promtail config, and Traefik TLS config. The generated output goes to `stack/` (gitignored).
- **Traefik reverse proxy + TLS**: Traefik v3 provides HTTPS for all web UIs via mkcert cert with explicit SANs for each `.home` hostname (wildcard-only certs don't work for single-label TLDs). HTTP automatically redirects to HTTPS. Existing port mappings are kept for backward compat and Icinga2 health checks. Traefik discovers services via Docker labels (`traefik.enable=true`). Both Traefik and Promtail need `security_opt: label:disable` for Docker socket access on SELinux/Fedora.
- **mkcert CA trust**: The prerequisites role installs the mkcert CA into three locations: system trust store (`mkcert -install`), OS trust anchors (`/etc/pki/ca-trust/source/anchors/` + `update-ca-trust`), and the invoking user's browser trust stores (Firefox/Chrome NSS DB).
- **Loki + Promtail for logs**: Promtail collects Docker container logs (via Docker socket) and host systemd journal logs, pushes to Loki. Grafana has a provisioned Loki datasource. Loki retains 30 days of logs.
- **GPU metrics use nsenter**: Telegraf container can't run rocm-smi directly (no python3 inside), so `rocm-smi-telegraf.sh.j2` uses `nsenter` into the host mount namespace. Requires privileged container with host PID and `security_opt: label:disable` for SELinux.
- **Icinga2 post-deploy config**: Icinga2 configs (constants.conf, hosts.conf, services.conf, api-users.conf, influxdb2.conf, icingadb.conf) are copied into the running container with `docker cp` and then the container is restarted, because the Icinga2 image doesn't support bind-mounting these paths cleanly.
- **Icinga2 checks target Docker host**: The host address uses the Docker bridge gateway IPv4 (`172.17.0.1` by default, overridable via `icinga2_host_address`). The icinga2 container has `extra_hosts: host.docker.internal:host-gateway`. Custom `hosts.conf` defines HTTP checks for Grafana, IcingaWeb2, InfluxDB, Portainer, and Semaphore. Custom `services.conf` removes the default SSH and disk checks (not meaningful inside a container).
- **All credentials live in vault-encrypted `group_vars/all.yml`**: Passwords are pre-generated, not prompted. Variable names follow the pattern `{service}_{purpose}` (e.g., `influxdb_admin_token`, `icinga2_api_password`).
- **Handlers for restarts**: Template changes trigger handlers in `roles/monitoring_stack/handlers/main.yml` to restart affected containers.
- **Pi-hole DNS via REST API**: The `pihole_dns` role uses Pi-hole v6's REST API (`/api/config/dns/hosts/{entry}`) to manage local DNS records. It authenticates with a session SID, diffs current vs desired records, and issues individual PUT/DELETE calls per entry. The role owns all Pi-hole local DNS records — manual UI changes will be overwritten on next run.

## GNOME Shell Extension

The `gnome-extension/` directory contains a GNOME Shell 49 extension (`docker-monitor@dihan`) that adds a top bar indicator for Docker container status. It uses ESModules (`import`/`export`), `Gio.Subprocess` for async `docker ps` polling, `PanelMenu.Button` for the panel indicator, and `Adw` widgets for the preferences window. The GSettings schema stores the monitored container list and refresh interval. Install location: `~/.local/share/gnome-shell/extensions/docker-monitor@dihan/`.

## When Modifying

- To add a new service: add to `templates/docker-compose.yml.j2` (with Traefik labels for HTTPS routing), add any needed variables to `group_vars/all.yml` (re-encrypt), add config templates, update the task list in `roles/monitoring_stack/tasks/main.yml`, add a DNS record to `pihole_dns_records`, and add to `bookmarks.html`. Note: adding a DNS record also adds it as a SAN to the TLS cert (delete the existing cert to regenerate).
- To regenerate the TLS cert (e.g., after adding a new hostname): delete `stack/certs/_wildcard.home.pem` and re-run the playbook. The cert generation task uses `creates:` for idempotency.
- To change a check or add an Icinga2 monitor: edit the templates in `templates/icinga2/conf.d/` (hosts.conf.j2, services.conf.j2, api-users.conf.j2) or `templates/icinga2/features/`. These are deployed via `docker cp` tasks — follow the existing pattern.
- To add a DNS record: add an entry to `pihole_dns_records` in `group_vars/all.yml`. Each entry has a `hostname` key; the role appends `.{dns_domain}` and maps it to `host_ip`.
- The pre-built Grafana dashboard is at `roles/monitoring_stack/files/grafana/dashboards/system-monitoring.json` (649 lines). It uses Flux queries against InfluxDB. Loki logs are available via the Explore view in Grafana.
- To modify the GNOME Shell extension: edit files in `gnome-extension/`, then copy to `~/.local/share/gnome-shell/extensions/docker-monitor@dihan/` and run `glib-compile-schemas schemas/`. If adding a new service with a web URL, add it to the `CONTAINER_URLS` map in `extension.js` and to the default `monitored-containers` list in the GSettings schema.
