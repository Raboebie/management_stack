import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DockerMonitorPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // --- Monitored Containers page ---
        const containersPage = new Adw.PreferencesPage({
            title: _('Containers'),
            icon_name: 'application-x-executable-symbolic',
        });
        window.add(containersPage);

        const containersGroup = new Adw.PreferencesGroup({
            title: _('Monitored Containers'),
            description: _('Containers shown in the panel indicator'),
        });
        containersPage.add(containersGroup);

        // Container list box
        this._listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        containersGroup.add(this._listBox);

        this._settings = settings;
        this._rebuildContainerList();

        // Add container row
        const addGroup = new Adw.PreferencesGroup();
        containersPage.add(addGroup);

        const addRow = new Adw.ActionRow({
            title: _('Add Container'),
        });

        const entry = new Gtk.Entry({
            placeholder_text: _('Container name'),
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        addButton.connect('clicked', () => {
            const name = entry.text.trim();
            if (name.length === 0)
                return;

            const containers = settings.get_strv('monitored-containers');
            if (!containers.includes(name)) {
                containers.push(name);
                settings.set_strv('monitored-containers', containers);
                this._rebuildContainerList();
            }
            entry.text = '';
        });

        entry.connect('activate', () => addButton.emit('clicked'));

        addRow.add_suffix(entry);
        addRow.add_suffix(addButton);
        addGroup.add(addRow);

        // Import from Docker button
        const importButton = new Gtk.Button({
            label: _('Import from Docker'),
            css_classes: ['suggested-action'],
            halign: Gtk.Align.CENTER,
            margin_top: 12,
        });
        importButton.connect('clicked', () => {
            this._importFromDocker();
        });
        addGroup.add(importButton);

        // --- Settings page ---
        const settingsPage = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(settingsPage);

        const settingsGroup = new Adw.PreferencesGroup({
            title: _('General'),
        });
        settingsPage.add(settingsGroup);

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh Interval'),
            subtitle: _('How often to check container status (seconds)'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 300,
                step_increment: 5,
                page_increment: 10,
                value: settings.get_int('refresh-interval'),
            }),
        });
        settings.bind('refresh-interval', intervalRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settingsGroup.add(intervalRow);
    }

    _rebuildContainerList() {
        // Remove all children
        let child = this._listBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._listBox.remove(child);
            child = next;
        }

        const containers = this._settings.get_strv('monitored-containers');

        for (const name of containers) {
            const row = new Adw.ActionRow({title: name});

            const removeButton = new Gtk.Button({
                icon_name: 'edit-delete-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'destructive-action'],
            });
            removeButton.connect('clicked', () => {
                const current = this._settings.get_strv('monitored-containers');
                const updated = current.filter(c => c !== name);
                this._settings.set_strv('monitored-containers', updated);
                this._rebuildContainerList();
            });

            row.add_suffix(removeButton);
            this._listBox.append(row);
        }
    }

    _importFromDocker() {
        try {
            const proc = Gio.Subprocess.new(
                ['docker', 'ps', '--all', '--format', '{{.Names}}'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, stdout] = proc.communicate_utf8_finish(res);
                    if (!proc.get_successful())
                        return;

                    const names = stdout.trim().split('\n').filter(n => n.length > 0);
                    const current = this._settings.get_strv('monitored-containers');
                    const merged = [...new Set([...current, ...names])];
                    this._settings.set_strv('monitored-containers', merged);
                    this._rebuildContainerList();
                } catch (e) {
                    console.error(`docker-monitor: import failed: ${e.message}`);
                }
            });
        } catch (e) {
            console.error(`docker-monitor: import failed: ${e.message}`);
        }
    }
}
