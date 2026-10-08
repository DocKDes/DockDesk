#!/bin/sh
# Builds dist/dockdesk_<ver>_all.deb (~170 kB). Needs only dpkg-deb.
set -e
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
R=dist/pkg
rm -rf "$R" && mkdir -p "$R/usr/share/doc/dockdesk" "$R/DEBIAN" "$R/opt/dockdesk" "$R/usr/bin" "$R/usr/share/applications" "$R/usr/share/icons/hicolor/256x256/apps"
cp -r server.js pty-shell.py tray.py package.json dockdesk-polkit.rules public "$R/opt/dockdesk/"
cp public/icon.png "$R/usr/share/icons/hicolor/256x256/apps/dockdesk.png"
cp README.md LICENSE THIRD_PARTY_NOTICES.md SECURITY.md "$R/usr/share/doc/dockdesk/"
gzip -9n -c CHANGELOG.md > "$R/usr/share/doc/dockdesk/changelog.gz"
cat > "$R/usr/share/doc/dockdesk/copyright" <<'CP'
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: DockDesk
Upstream-Contact: Panem Yaswanth Reddy <panemyaswanthreddy@gmail.com>

Files: *
Copyright: 2026 Panem Yaswanth Reddy
License: MIT

Files: opt/dockdesk/public/vendor/*
Copyright: The xterm.js authors; Christopher Jeffrey
License: MIT

License: MIT
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:
 .
 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.
 .
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
CP
cp packaging/dockdesk.desktop "$R/usr/share/applications/"
printf '#!/bin/sh\nexec node /opt/dockdesk/server.js "$@"\n' > "$R/usr/bin/dockdesk" && chmod 755 "$R/usr/bin/dockdesk"
cat > "$R/DEBIAN/control" <<C
Package: dockdesk
Version: $VER
Architecture: all
Maintainer: Panem Yaswanth Reddy <panemyaswanthreddy@gmail.com>
Depends: nodejs (>= 18.17), chromium | google-chrome-stable | chromium-browser
Recommends: docker.io | docker-ce, docker-compose-v2 | docker-compose-plugin | docker-compose (>= 2), docker-buildx | docker-buildx-plugin, polkitd | policykit-1
Suggests: python3-gi, gir1.2-ayatanaappindicator3-0.1
Section: devel
Priority: optional
Description: Lightweight Docker Desktop alternative
 Manage containers, images, volumes, networks and compose projects in a small
 app window, with logs, a file browser, terminals, a compose editor and a command
 palette. It controls the Docker engine already installed on the machine; it does
 not bundle one.
C
dpkg-deb --root-owner-group -Zxz --build "$R" "dist/dockdesk_${VER}_all.deb"
