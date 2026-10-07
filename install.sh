#!/bin/sh
# Per-user install, no root needed: ~/.local/share/dockdesk + launcher + menu entry.
set -e
D="$HOME/.local/share/dockdesk"
mkdir -p "$D" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons"
cp -r "$(dirname "$0")/server.js" "$(dirname "$0")/pty-shell.py" "$(dirname "$0")/dockdesk-polkit.rules" "$(dirname "$0")/public" "$D/"
printf '#!/bin/sh\nexec node "%s/server.js" "$@"\n' "$D" > "$HOME/.local/bin/dockdesk" && chmod +x "$HOME/.local/bin/dockdesk"
cp "$D/public/icon.png" "$HOME/.local/share/icons/dockdesk.png"
sed "s|^Icon=.*|Icon=$HOME/.local/share/icons/dockdesk.png|; s|^Exec=.*|Exec=$HOME/.local/bin/dockdesk|" "$(dirname "$0")/packaging/dockdesk.desktop" > "$HOME/.local/share/applications/dockdesk.desktop"
echo "Installed. Launch 'DockDesk' from the menu or run: dockdesk"
