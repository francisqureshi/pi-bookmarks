"""Optional POSIX real-Pi test; no model calls or personal settings changes.

uv run --with pyte python test/pty-smoke.py
uv run --with pyte python test/pty-smoke.py --vim
uv run --with pyte python test/pty-smoke.py --vim-first

Requires Pi 1.3 on PATH (or PI_BIN). Vim scenarios use the development pi-vim
package, or PI_VIM_EXTENSION to select another entry point.
"""
import argparse
import codecs
import fcntl
import json
import os
import pathlib
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time
import pyte

parser = argparse.ArgumentParser()
parser.add_argument('--vim', action='store_true')
parser.add_argument('--vim-first', action='store_true')
args = parser.parse_args()
with_vim = args.vim or args.vim_first
root = pathlib.Path(__file__).resolve().parents[1]
pi_binary = os.environ.get('PI_BIN') or shutil.which('pi')
if not pi_binary:
    raise SystemExit('Pi must be available on PATH, or set PI_BIN.')
vim_path = pathlib.Path(os.environ.get('PI_VIM_EXTENSION', root / 'node_modules/pi-vim/index.ts'))
if with_vim and not vim_path.is_file():
    raise SystemExit('Run npm install first, or set PI_VIM_EXTENSION.')

with tempfile.TemporaryDirectory(prefix='pi-bookmarks-smoke-') as temporary:
    tmp = pathlib.Path(temporary)
    fixture = tmp / 'fixture.jsonl'
    now = '2026-10-18T00:00:00.000Z'
    entries = [{'type': 'session', 'version': 3, 'id': 'bookmark-smoke', 'timestamp': now, 'cwd': str(tmp)}]
    parent = None
    usage = dict(input=0, output=0, cacheRead=0, cacheWrite=0, totalTokens=0,
                 cost=dict(input=0, output=0, cacheRead=0, cacheWrite=0, total=0))
    for i in range(100):
        entry_id = f'{i:08x}'
        text = (f'Message {i:04d}: this is stable distinctive transcript content for a real terminal bookmark smoke test.\n\n'
                f'More completed text for message {i:04d}, with enough words for unambiguous surrounding context.')
        entries.append(dict(type='message', id=entry_id, parentId=parent, timestamp=now,
            message=dict(role='assistant', content=[dict(type='text', text=text)],
                api='openai-completions', provider='openai', model='gpt-4o', usage=usage,
                stopReason='stop', timestamp=1792281600000+i)))
        parent = entry_id
    fixture.write_text(''.join(json.dumps(entry)+'\n' for entry in entries))
    agent_dir = tmp / 'agent'
    agent_dir.mkdir()
    (agent_dir / 'settings.json').write_text(json.dumps({'quietStartup': True, 'collapseChangelog': True}))
    (agent_dir / 'keybindings.json').write_text(json.dumps({'tui.altScreen.lineDown': 'ctrl+alt+down'}))
    env = {**os.environ, 'TERM': 'xterm-256color', 'PI_CODING_AGENT_DIR': str(agent_dir),
           'PI_OFFLINE': '1', 'PI_SKIP_VERSION_CHECK': '1', 'PI_TELEMETRY': '0', 'PI_IMAGE_PROTOCOL': 'none'}
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 35, 100, 0, 0))
    screen = pyte.Screen(100, 35)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder('utf-8')('replace')
    extensions = [str(root / 'src/index.ts')]
    if with_vim:
        extensions.insert(0 if args.vim_first else 1, str(vim_path))
    cmd = [pi_binary, '--offline', '--no-extensions', '--no-mcp', '--no-skills',
           '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-approve', '--no-tools',
           '--tui-mode', 'fullscreen', '--provider', 'openai', '--model', 'gpt-4o', '--api-key', 'smoke-test-not-a-real-key',
           '--session', str(fixture)]
    for extension in extensions:
        cmd.extend(['-e', extension])
    proc = subprocess.Popen(cmd, cwd=tmp, env=env, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
    os.close(slave)

    def display():
        return '\n'.join(screen.display)

    def stored():
        return [json.loads(line) for line in fixture.read_text().splitlines()]

    def snapshots():
        return [entry['data'] for entry in stored() if entry.get('customType') == 'pi-bookmarks']

    def send(data):
        os.write(master, data)

    def top_text():
        return screen.display[0][:-1].rstrip()

    def wait_for(predicate, label, timeout=15):
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            if proc.poll() is not None:
                raise AssertionError(f'Pi exited {proc.returncode} during {label}:\n{display()}')
            ready, _, _ = select.select([master], [], [], min(.2, max(0, deadline-time.monotonic())))
            if ready:
                stream.feed(decoder.decode(os.read(master, 1024*256)))
        raise AssertionError(f'Timeout during {label}:\n{display()}')

    def align_message():
        for _ in range(8):
            if re.search(r'Message \d{4}:', top_text()):
                return
            previous = top_text()
            send(b'\x1b[1;7B')
            wait_for(lambda: top_text() != previous, 'align top visible message')
        raise AssertionError('Could not align a stable message line')

    def ensure_normal():
        if with_vim and 'NORMAL' not in display():
            send(b'\x1b[27u')
            wait_for(lambda: 'NORMAL' in display(), 'enter Vim normal mode')

    try:
        wait_for(lambda: 'Message 0099' in display() and 'gpt-4o' in display(), 'startup')
        if with_vim:
            # Normal-mode integration must not turn these INSERT characters into marks.
            send(b"literal mq'q")
            wait_for(lambda: "literal mq'q" in display(), 'literal insert-mode typing')
            assert not snapshots()
            ensure_normal()
        send(b'\x1b[5~\x1b[5~\x1b[5~')
        wait_for(lambda: 'Message 0099' not in display(), 'scrolling')
        align_message()
        expected_top = top_text()
        message_id = re.search(r'Message (\d{4}):', expected_top).group(1)
        send(b'mq' if with_vim else b'\x1b[98;7u')
        wait_for(lambda: len(snapshots()) == 1, 'silent bookmark save')
        if with_vim:
            send(b'\x1b[5~')
            wait_for(lambda: top_text() != expected_top, 'scroll to second mark')
            align_message()
            second_top = top_text()
            send(b'ma')
            wait_for(lambda: len(snapshots()) == 2, 'save independent named mark')
            send(b"'q")
            wait_for(lambda: top_text() == expected_top, 'jump between named marks')
            send(b"'a")
            wait_for(lambda: top_text() == second_top, 'jump to second named mark')
        send(b'\x1b[1;5F')
        wait_for(lambda: 'Message 0099' in display(), 'return to live output')
        send(b"'q" if with_vim else b'\x1b[106;7u')
        wait_for(lambda: top_text() == expected_top, 'silent jump')
        assert not any(label in display() for label in ['🔖', 'Saved:', 'Returned:', 'Ready:'])
        screen.resize(lines=35, columns=61)
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 35, 61, 0, 0))
        os.kill(proc.pid, signal.SIGWINCH)
        send(b'\x1b[1;5F')
        wait_for(lambda: 'Message 0099' in display(), 'resized live output')
        send(b"'q" if with_vim else b'\x1b[106;7u')
        wait_for(lambda: f'Message {message_id}' in top_text(), 'jump after resize')
        send(b'\x1b[1;5F')
        wait_for(lambda: 'Message 0099' in display(), 'live output before reload')
        send(b':reload\r' if with_vim else b'/reload\r')
        wait_for(lambda: 'Reloaded keybindings' in display(), 'real extension reload')
        ensure_normal()
        send(b"'q" if with_vim else b'\x1b[106;7u')
        wait_for(lambda: f'Message {message_id}' in top_text(), 'jump after reload')
        saved = snapshots()
        assert len(saved) == (2 if with_vim else 1)
        assert saved[-1]['version'] == 2
        assert set(saved[-1]['marks']) == ({'q', 'a'} if with_vim else {'default'})
        assert sum(entry.get('type') == 'message' for entry in stored()) == 100
        print(json.dumps({'realPi': True, 'vimMarks': with_vim, 'vimFirst': args.vim_first,
                          'silentSuccess': True, 'restoredTopLine': expected_top,
                          'persistedSnapshots': len(saved), 'survivedResize': True,
                          'survivedReload': True, 'modelRequests': 0}, indent=2))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        os.close(master)
