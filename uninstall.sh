#!/bin/sh
# Removes the per-user install made by install.sh. Your Docker data is not touched.
set -e
rm -rf "$HOME/.local/share/dockdesk" "$HOME/.cache/dockdesk"
rm -f "$HOME/.local/bin/dockdesk" "$HOME/.local/share/applications/dockdesk.desktop" "$HOME/.local/share/icons/dockdesk.png"
echo "DockDesk removed. (If you installed the optional polkit rule: sudo rm /etc/polkit-1/rules.d/50-dockdesk.rules)"
