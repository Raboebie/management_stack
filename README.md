# Monitoring Stack

Ansible-deployed Docker Compose stack for full host monitoring on Fedora 43 with AMD GPU support.

## Architecture

```
Host (Fedora 43)
+-- Telegraf (privileged, host PID/network)
|   CPU, Memory, Disk, DiskIO, Network, System, Processes
|   AMD GPU via rocm-smi (nsenter into host namespace)
|   writes to --> InfluxDB 2.x
|
+-- Icinga2
|   Service checks (ping, load, procs, HTTP for Grafana/IcingaWeb2/InfluxDB)
|   Targets Docker host via bridge gateway (172.17.0.1)
|   InfluxDB2Writer --> InfluxDB 2.x
|   IcingaDB feature --> Redis
|
+-- IcingaDB + Redis (Icinga2 state backend)
+-- IcingaWeb2 (Icinga UI)
+-- PostgreSQL (IcingaWeb2 + IcingaDB backend)
+-- InfluxDB 2.x (metrics storage)
+-- Grafana (dashboards, auto-provisioned)
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Grafana | 3000 | Dashboards with pre-built System Monitoring dashboard |
| InfluxDB 2.x | 8086 | Metrics storage (Flux query language) |
| IcingaWeb2 | 8081 | Icinga web UI for alerts and service status |
| Icinga2 API | 5665 | Icinga2 API endpoint |
| PostgreSQL | internal | Database for IcingaWeb2 + IcingaDB |
| Redis | internal | IcingaDB state backend |
| IcingaDB | internal | Syncs Icinga2 state to PostgreSQL via Redis |
| Telegraf | host network | System + GPU metric collection |

## Prerequisites

- Fedora 43 (or compatible)
- Ansible (`dnf install ansible`)
- Passwordless sudo (or use `--ask-become-pass`)

Docker (moby-engine), docker-compose, and rocm-smi are installed automatically by the playbook.

## DNS

The playbook registers `.home` DNS records in Pi-hole v6 so services are reachable by name:

| Hostname | Service | URL |
|----------|---------|-----|
| `grafana.home` | Grafana | `http://grafana.home:3000` |
| `influxdb.home` | InfluxDB | `http://influxdb.home:8086` |
| `icinga.home` | IcingaWeb2 | `http://icinga.home:8081` |
| `icinga-api.home` | Icinga2 API | `https://icinga-api.home:5665` |
| `pihole.home` | Pi-hole | `http://pihole.home:8181` |

All records point to the host IP (`192.168.88.100`). DNS only maps hostname to IP; ports are still required in URLs.

Records are managed declaratively via the Pi-hole v6 REST API — the `pihole_dns` role owns all local DNS entries and will overwrite manual changes on next run.

## Quick Start

```bash
cd ~/monitoring-stack

# 1. Edit vault passwords (optional, defaults are pre-generated)
ansible-vault edit group_vars/all.yml

# 2. Deploy
ansible-playbook playbook.yml

# 3. Access
#    Grafana:    http://grafana.home:3000
#    IcingaWeb2: http://icinga.home:8081
#    InfluxDB:   http://influxdb.home:8086
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

## Project Structure

```
monitoring-stack/
+-- ansible.cfg                    # Local connection, vault config
+-- inventory/hosts.yml            # localhost target
+-- playbook.yml                   # Main entrypoint
+-- group_vars/all.yml             # Encrypted variables (vault)
+-- .vault                         # Vault password (gitignored)
+-- roles/
    +-- prerequisites/
    |   +-- tasks/main.yml         # Docker, rocm-smi installation
    +-- pihole_dns/
    |   +-- tasks/main.yml         # Register .home DNS records in Pi-hole v6
    +-- monitoring_stack/
        +-- tasks/main.yml         # Deploy configs, start stack, configure Icinga2
        +-- handlers/main.yml      # Restart handlers
        +-- templates/
        |   +-- docker-compose.yml.j2
        |   +-- telegraf.conf.j2
        |   +-- rocm-smi-telegraf.sh.j2
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
        |       +-- datasources/influxdb.yml.j2
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
