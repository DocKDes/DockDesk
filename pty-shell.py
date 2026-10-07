#!/usr/bin/env python3
"""Runs the user's login shell on a real pty and relays stdin/stdout.
Terminal resizes arrive in-band as the xterm sequence ESC[8;<rows>;<cols>t."""
import fcntl, os, pty, re, select, signal, struct, sys, termios

RESIZE = re.compile(rb'\x1b\[8;(\d+);(\d+)t')

def set_size(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

shell = os.environ.get('SHELL') or '/bin/bash'
pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.chdir(os.path.expanduser('~'))
    os.execvp(shell, [shell])

set_size(fd, 24, 80)
stdin, stdout = sys.stdin.fileno(), sys.stdout.fileno()
try:
    while True:
        ready, _, _ = select.select([stdin, fd], [], [])
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:  # child exited
                break
            if not data:
                break
            os.write(stdout, data)
        if stdin in ready:
            data = os.read(stdin, 65536)
            if not data:  # browser tab closed
                break
            for m in RESIZE.finditer(data):
                set_size(fd, int(m.group(1)), int(m.group(2)))
            data = RESIZE.sub(b'', data)
            if data:
                os.write(fd, data)
finally:
    try:
        os.kill(pid, signal.SIGHUP)
        os.waitpid(pid, 0)
    except OSError:
        pass
