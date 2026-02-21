# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ansible-deployed Docker Compose monitoring stack for Fedora 43 with AMD GPU support. Eight containers: Telegraf, InfluxDB 2.x, Grafana, Icinga2, IcingaDB, IcingaWeb2, PostgreSQL, Redis.

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
- Icinga2 (service checks) → InfluxDB 2.x (via InfluxDB2Writer) + Redis → IcingaDB → PostgreSQL
- Grafana reads from InfluxDB; IcingaWeb2 reads from PostgreSQL

**Exposed ports:** Grafana (3000), InfluxDB (8086), IcingaWeb2 (8081), Icinga2 API (5665), Pi-hole (8181)

## Playbook Structure

`playbook.yml` runs two plays on localhost:

**Play 1** (`become: true`):
1. **`roles/prerequisites/`** — Installs Docker (moby-engine), docker-compose, and rocm-smi
2. **`roles/monitoring_stack/`** — Templates configs, starts docker compose, post-deploys Icinga2 configs into the running container via `docker cp`

**Play 2** (`become: false`):
3. **`roles/pihole_dns/`** — Registers `.home` DNS records in Pi-hole v6 via its REST API (e.g., `grafana.home`, `icinga.home`). Manages records declaratively — computes a diff and only adds/removes what changed.

## Key Design Decisions

- **All config is templated**: Jinja2 templates in `roles/monitoring_stack/templates/` generate docker-compose.yml, telegraf.conf, Icinga2 configs, and Grafana provisioning files. The generated output goes to `stack/` (gitignored).
- **GPU metrics use nsenter**: Telegraf container can't run rocm-smi directly (no python3 inside), so `rocm-smi-telegraf.sh.j2` uses `nsenter` into the host mount namespace. Requires privileged container with host PID and `security_opt: label:disable` for SELinux.
- **Icinga2 post-deploy config**: Icinga2 configs (constants.conf, hosts.conf, services.conf, api-users.conf, influxdb2.conf, icingadb.conf) are copied into the running container with `docker cp` and then the container is restarted, because the Icinga2 image doesn't support bind-mounting these paths cleanly.
- **Icinga2 checks target Docker host**: The host address uses the Docker bridge gateway IPv4 (`172.17.0.1` by default, overridable via `icinga2_host_address`). The icinga2 container has `extra_hosts: host.docker.internal:host-gateway`. Custom `hosts.conf` defines HTTP checks for Grafana, IcingaWeb2, and InfluxDB. Custom `services.conf` removes the default SSH and disk checks (not meaningful inside a container).
- **All credentials live in vault-encrypted `group_vars/all.yml`**: Passwords are pre-generated, not prompted. Variable names follow the pattern `{service}_{purpose}` (e.g., `influxdb_admin_token`, `icinga2_api_password`).
- **Handlers for restarts**: Template changes trigger handlers in `roles/monitoring_stack/handlers/main.yml` to restart affected containers.
- **Pi-hole DNS via REST API**: The `pihole_dns` role uses Pi-hole v6's REST API (`/api/config/dns/hosts/{entry}`) to manage local DNS records. It authenticates with a session SID, diffs current vs desired records, and issues individual PUT/DELETE calls per entry. The role owns all Pi-hole local DNS records — manual UI changes will be overwritten on next run.

## When Modifying

- To add a new service: add to `templates/docker-compose.yml.j2`, add any needed variables to `group_vars/all.yml` (re-encrypt), add config templates, and update the task list in `roles/monitoring_stack/tasks/main.yml`.
- To change a check or add an Icinga2 monitor: edit the templates in `templates/icinga2/conf.d/` (hosts.conf.j2, services.conf.j2, api-users.conf.j2) or `templates/icinga2/features/`. These are deployed via `docker cp` tasks — follow the existing pattern.
- To add a DNS record: add an entry to `pihole_dns_records` in `group_vars/all.yml`. Each entry has a `hostname` key; the role appends `.{dns_domain}` and maps it to `host_ip`.
- The pre-built Grafana dashboard is at `roles/monitoring_stack/files/grafana/dashboards/system-monitoring.json` (649 lines). It uses Flux queries against InfluxDB.
