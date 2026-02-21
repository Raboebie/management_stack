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

**Exposed ports:** Grafana (3000), InfluxDB (8086), IcingaWeb2 (8081), Icinga2 API (5665)

## Playbook Structure

`playbook.yml` runs two roles in order on localhost with `become: true`:

1. **`roles/prerequisites/`** — Installs Docker (moby-engine), docker-compose, and rocm-smi
2. **`roles/monitoring_stack/`** — Templates configs, starts docker compose, post-deploys Icinga2 configs into the running container via `docker cp`

## Key Design Decisions

- **All config is templated**: Jinja2 templates in `roles/monitoring_stack/templates/` generate docker-compose.yml, telegraf.conf, Icinga2 configs, and Grafana provisioning files. The generated output goes to `stack/` (gitignored).
- **GPU metrics use nsenter**: Telegraf container can't run rocm-smi directly (no python3 inside), so `rocm-smi-telegraf.sh.j2` uses `nsenter` into the host mount namespace. Requires privileged container with host PID and `security_opt: label:disable` for SELinux.
- **Icinga2 post-deploy config**: Icinga2 configs (constants.conf, influxdb2.conf, icingadb.conf) are copied into the running container with `docker cp` and then the container is restarted, because the Icinga2 image doesn't support bind-mounting these paths cleanly.
- **All credentials live in vault-encrypted `group_vars/all.yml`**: Passwords are pre-generated, not prompted. Variable names follow the pattern `{service}_{purpose}` (e.g., `influxdb_admin_token`, `icinga2_api_password`).
- **Handlers for restarts**: Template changes trigger handlers in `roles/monitoring_stack/handlers/main.yml` to restart affected containers.

## When Modifying

- To add a new service: add to `templates/docker-compose.yml.j2`, add any needed variables to `group_vars/all.yml` (re-encrypt), add config templates, and update the task list in `roles/monitoring_stack/tasks/main.yml`.
- To change a check or add an Icinga2 monitor: the Icinga2 configuration is deployed via `docker cp` tasks in the monitoring_stack role — follow the existing pattern for constants.conf and feature configs.
- The pre-built Grafana dashboard is at `roles/monitoring_stack/files/grafana/dashboards/system-monitoring.json` (649 lines). It uses Flux queries against InfluxDB.
