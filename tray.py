#!/usr/bin/env python3
"""System tray icon for DockDesk (GTK3 + AppIndicator).

Spawned by server.js with the icon folder as its only argument. It never touches Docker or the network:
  stdin  <- one JSON object per line from the server: {"engine": true, "running": 3, "total": 5}
  stdout -> one action word per line: show, engine-start, engine-stop, stop-all, quit
When the server goes away (stdin closes) the icon disappears with it."""
import json, os, signal, sys, threading

import gi
gi.require_version('Gtk', '3.0')
try:
    gi.require_version('AyatanaAppIndicator3', '0.1')
    from gi.repository import AyatanaAppIndicator3 as AppIndicator
except ValueError:
    gi.require_version('AppIndicator3', '0.1')
    from gi.repository import AppIndicator3 as AppIndicator
from gi.repository import GLib, Gtk

icon_dir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ''
state = {'engine': None, 'running': 0, 'total': 0}


def say(word):
    sys.stdout.write(word + '\n')
    sys.stdout.flush()


ind = AppIndicator.Indicator.new_with_path('dockdesk', 'icon', AppIndicator.IndicatorCategory.APPLICATION_STATUS, icon_dir)
ind.set_status(AppIndicator.IndicatorStatus.ACTIVE)
ind.set_title('DockDesk')

menu = Gtk.Menu()
status = Gtk.MenuItem(label='Docker: checking…')
status.set_sensitive(False)
openi = Gtk.MenuItem(label='Open DockDesk')
openi.connect('activate', lambda _: say('show'))
engine = Gtk.MenuItem(label='Start Docker')
engine.connect('activate', lambda _: say('engine-stop' if state['engine'] else 'engine-start'))
stopall = Gtk.MenuItem(label='Stop all containers')
stopall.connect('activate', lambda _: say('stop-all'))
quit_ = Gtk.MenuItem(label='Quit DockDesk')
quit_.connect('activate', lambda _: say('quit'))
for item in (status, Gtk.SeparatorMenuItem(), openi, Gtk.SeparatorMenuItem(), engine, stopall, Gtk.SeparatorMenuItem(), quit_):
    menu.append(item)
menu.show_all()
ind.set_menu(menu)
ind.set_secondary_activate_target(openi)  # middle click opens the window


def refresh():
    up = state['engine']
    if up is None:
        status.set_label('Docker: checking…')
    elif up:
        status.set_label('Docker running · %d of %d containers up' % (state['running'], state['total']))
    else:
        status.set_label('Docker is stopped')
    engine.set_label('Stop Docker' if up else 'Start Docker')
    stopall.set_sensitive(bool(up and state['running']))
    ind.set_title('DockDesk' + (' (%d running)' % state['running'] if up else ' (Docker stopped)'))
    return False


def reader():
    for line in sys.stdin:
        try:
            m = json.loads(line)
            state.update(engine=bool(m.get('engine')), running=int(m.get('running') or 0), total=int(m.get('total') or 0))
        except (ValueError, TypeError):
            continue
        GLib.idle_add(refresh)
    GLib.idle_add(Gtk.main_quit)  # the server is gone


threading.Thread(target=reader, daemon=True).start()
signal.signal(signal.SIGTERM, lambda *_: GLib.idle_add(Gtk.main_quit))
signal.signal(signal.SIGINT, lambda *_: GLib.idle_add(Gtk.main_quit))
refresh()
Gtk.main()
