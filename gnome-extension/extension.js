import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CONTAINER_URLS = {
    'traefik': 'https://traefik.home',
    'grafana': 'https://grafana.home',
    'influxdb': 'https://influxdb.home',
    'icingaweb2': 'https://icinga.home',
    'portainer': 'https://portainer.home',
    'semaphore': 'https://semaphore.home',
    'loki': 'https://loki.home',
    'ollama': 'https://ollama.home',
    'open-webui': 'https://chat.home',
    'tabby': 'https://tabby.home',
};

class DockerMonitorIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(ext) {
        super(0.0, 'Docker Monitor');

        this._ext = ext;
        this._settings = ext.getSettings();
        this._timerId = null;
        this._containerItems = new Map();

        // Panel icon
        this._icon = new St.Icon({
            icon_name: 'emblem-default-symbolic',
            style_class: 'system-status-icon status-ok',
        });
        this.add_child(this._icon);

        this._buildMenu();
        this._startPolling();
    }

    _buildMenu() {
        // Header
        const header = new PopupMenu.PopupMenuItem(_('Docker Containers'), {
            reactive: false,
            style_class: 'docker-monitor-header',
        });
        this.menu.addMenuItem(header);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Container section (populated by _refresh)
        this._containerSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._containerSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh button
        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh'));
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        // Settings button
        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => this._ext.openPreferences());
        this.menu.addMenuItem(settingsItem);
    }

    _startPolling() {
        // Initial refresh
        this._refresh();

        // Set up recurring timer
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );

        // Restart timer when interval changes
        this._settings.connectObject(
            'changed::refresh-interval',
            () => this._restartTimer(),
            this
        );

        // Rebuild when monitored containers change
        this._settings.connectObject(
            'changed::monitored-containers',
            () => this._refresh(),
            this
        );
    }

    _restartTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _refresh() {
        try {
            const proc = Gio.Subprocess.new(
                ['docker', 'ps', '--all', '--format', '{{.Names}}\t{{.State}}'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if (proc.get_successful()) {
                        this._updateFromOutput(stdout);
                    } else {
                        this._setError(_('docker command failed'));
                    }
                } catch (e) {
                    this._setError(e.message);
                }
            });
        } catch (e) {
            this._setError(e.message);
        }
    }

    _updateFromOutput(stdout) {
        const monitored = this._settings.get_strv('monitored-containers');

        // Parse docker output into a map
        const dockerState = new Map();
        const lines = stdout.trim().split('\n').filter(l => l.length > 0);
        for (const line of lines) {
            const [name, state] = line.split('\t');
            if (name)
                dockerState.set(name.trim(), (state || '').trim());
        }

        // Clear old menu items
        this._containerSection.removeAll();
        this._containerItems.clear();

        let allRunning = true;

        for (const name of monitored) {
            const state = dockerState.get(name);
            const isRunning = state === 'running';

            if (!isRunning)
                allRunning = false;

            const statusText = state || 'not found';
            const styleClass = isRunning ? 'container-running' : 'container-stopped';
            const iconName = isRunning
                ? 'emblem-ok-symbolic'
                : 'dialog-error-symbolic';

            const item = new PopupMenu.PopupImageMenuItem(
                `${name}  —  ${statusText}`,
                iconName
            );
            item.label.style_class = styleClass;

            // Click to open URL if available
            const url = CONTAINER_URLS[name];
            if (url) {
                item.connect('activate', () => {
                    Gio.AppInfo.launch_default_for_uri(url, null);
                });
            }

            this._containerSection.addMenuItem(item);
            this._containerItems.set(name, item);
        }

        // Update panel icon
        if (allRunning) {
            this._icon.icon_name = 'emblem-default-symbolic';
            this._icon.style_class = 'system-status-icon status-ok';
        } else {
            this._icon.icon_name = 'dialog-error-symbolic';
            this._icon.style_class = 'system-status-icon status-error';
        }
    }

    _setError(message) {
        this._containerSection.removeAll();

        const item = new PopupMenu.PopupMenuItem(
            _('Error: %s').format(message),
            {reactive: false}
        );
        this._containerSection.addMenuItem(item);

        this._icon.icon_name = 'dialog-error-symbolic';
        this._icon.style_class = 'system-status-icon status-error';
    }

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        this._settings.disconnectObject(this);
        super.destroy();
    }
}

export default class DockerMonitorExtension extends Extension {
    enable() {
        this._indicator = new DockerMonitorIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
