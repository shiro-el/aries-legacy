# Metadata discovery stops after init, before a model turn. Claude -p may
# create an ephemeral session and run user SessionStart hooks.
# Python is optional: hosts without it simply retain the ordinary composer.
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading
import time

agent, cwd = sys.argv[1:]
os.chdir(cwd)
LIMIT = 2 * 1024 * 1024


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def query(args, codex=False):
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    messages = queue.Queue(maxsize=128)
    cancelled = threading.Event()

    def read():
        total = 0
        while not cancelled.is_set():
            line = process.stdout.readline(LIMIT + 1)
            total += len(line)
            if not line or total > LIMIT:
                try:
                    messages.put_nowait(None)
                except queue.Full:
                    pass
                return
            try:
                messages.put_nowait(line)
            except queue.Full:
                return

    reader = threading.Thread(target=read, daemon=True)
    reader.start()

    def send(message):
        process.stdin.write((json.dumps(message) + '\n').encode())
        process.stdin.flush()

    try:
        if codex:
            send({'id': 1, 'method': 'initialize', 'params': {
                'clientInfo': {'name': 'aries_catalog', 'version': '1'},
                'capabilities': {'experimentalApi': True}}})
        deadline = time.monotonic() + 15
        while True:
            line = messages.get(timeout=max(0.01, deadline - time.monotonic()))
            if line is None or time.monotonic() > deadline:
                raise RuntimeError('Catalog discovery did not complete')
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if codex and value.get('id') == 1:
                if 'error' in value:
                    raise RuntimeError('Catalog initialization failed')
                send({'method': 'initialized'})
                send({'id': 2, 'method': 'skills/list', 'params': {'cwds': [cwd]}})
            elif codex and value.get('id') == 2:
                return line.decode()
            elif not codex and value.get('type') == 'system' and value.get('subtype') == 'init':
                return line.decode()
    finally:
        cancelled.set()
        stop(process)
        reader.join(timeout=1)
        process.stdin.close()
        process.stdout.close()


files = []
remaining = 1024 * 1024


def add(path, name, skill=False, origin=None):
    global remaining
    if len(files) >= 512 or remaining <= 0:
        return
    try:
        with path.open('rb') as source:
            data = source.read(min(16384, remaining))
        remaining -= len(data)
        files.append({'name': name, 'skill': skill, 'source': origin, 'content': data.decode('utf-8', errors='replace')})
    except (OSError, ValueError):
        pass


def scan(root, skill=False, namespace="", origin=None):
    # os.walk does not follow directory symlinks, and the node budget bounds
    # discovery even in accidentally huge command/skill folders.
    visited = 0
    for directory, directories, names in os.walk(root):
        visited += 1
        if visited > 4096:
            return
        directories.sort()
        for name in sorted(names):
            visited += 1
            if visited > 4096 or len(files) >= 512:
                return
            path = Path(directory) / name
            if skill and name == 'SKILL.md':
                add(path, namespace + path.parent.name, True, origin)
            elif not skill and name.endswith('.md'):
                add(path, namespace + str(path.relative_to(root).with_suffix('')).replace(os.sep, ':'), origin=origin)


if agent == 'claude':
    output = query(['claude', '-p', '/status', '--output-format', 'stream-json',
                    '--verbose', '--no-session-persistence'])
    config = Path(os.environ.get('CLAUDE_CONFIG_DIR', str(Path.home() / '.claude')))
    roots = [config] + [p / '.claude' for p in reversed([Path(cwd), *Path(cwd).parents])]
    for root in roots:
        origin = 'user' if root == config else 'project'
        scan(root / 'commands', origin=origin)
        scan(root / 'skills', True, origin=origin)
    # Installation records give versioned plugin roots. Discovery still decides
    # availability; Rust only enriches names already returned by system/init.
    try:
        with (config / 'plugins' / 'installed_plugins.json').open('rb') as source:
            installed = json.loads(source.read(1024 * 1024))
        for name, records in list(installed.get('plugins', {}).items())[:128]:
            namespace = name.split('@')[0] + ':'
            for record in records[:8]:
                path = record.get('installPath')
                if path:
                    scan(Path(path) / 'commands', namespace=namespace, origin='plugin')
                    scan(Path(path) / 'skills', True, namespace, origin='plugin')
    except (OSError, ValueError, TypeError, AttributeError):
        pass
else:
    process = subprocess.Popen(['codex', '--version'], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        version = process.communicate(timeout=5)[0].decode().strip()
        if process.returncode != 0 or len(version) > 256:
            raise RuntimeError('Codex version unavailable')
    finally:
        stop(process)
    output = query(['codex', 'app-server', '--listen', 'stdio://'], codex=True)
    prompts = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'prompts'
    try:
        for path in sorted(prompts.glob('*.md'))[:512]:
            if path.is_file():
                add(path, 'prompts:' + path.stem)
    except OSError:
        pass
print(json.dumps({'output': output, 'files': files, 'version': version if agent == 'codex' else ''}))
