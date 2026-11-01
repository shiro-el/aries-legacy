import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  POLISH_TIMEOUT_MS,
  polishCommand,
  polishTranscript,
  type PolishRequest,
} from '../src/services/transcriptPolish';

// Only these variables reach the shell; the project types every ProcessEnv key.
const shellEnv = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

const request: PolishRequest = {
  cwd: "/home/me/it's here",
  transcript: '어 그 composer 디테이션 파일 좀 고쳐 줘',
  before: '먼저 이거 보고',
  after: '',
  recent: [
    { role: 'user', text: 'src/ui/chat/Composer.tsx 봐 줘' },
    { role: 'assistant', text: '봤습니다.' },
  ],
};

it('runs Claude Haiku in the pane folder with only read-only tools and no MCP servers', () => {
  // Run the real command through a POSIX login shell with a stub `claude`.
  const root = mkdtempSync(join(tmpdir(), 'aries-polish-'));
  const folder = join(root, "it's here");
  const bin = join(root, 'bin');
  mkdirSync(folder);
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\npwd\nfor arg in "$@"; do printf "[%s]\\n" "$arg"; done\ncat\n', { mode: 0o755 });
  const output = execFileSync('/bin/sh', ['-c', polishCommand(folder)], {
    input: 'stdin text',
    env: shellEnv({ PATH: `${bin}:/usr/bin:/bin`, SHELL: '/bin/sh', HOME: root }),
  }).toString();
  const [pwd, ...rest] = output.split('\n');
  const args = rest.filter(line => line.startsWith('[')).map(line => line.slice(1, -1));
  expect(pwd).toBe(folder);
  expect(args).toEqual(expect.arrayContaining(['-p', '--model', 'haiku', '--strict-mcp-config']));
  expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
  expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob');
  expect(args.join(' ')).not.toMatch(/\b(Bash|Edit|Write|WebFetch)\b/);
  expect(output).toContain('stdin text');
});

it('reports a host without claude', () => {
  const root = mkdtempSync(join(tmpdir(), 'aries-polish-'));
  const result = spawnSync('/bin/sh', ['-c', polishCommand(root)], {
    env: shellEnv({ PATH: '/usr/bin:/bin', SHELL: '/bin/sh', HOME: root }),
  });
  expect(result.stdout.toString()).toContain('ARIES_NO_CLAUDE');
  expect(result.status).toBe(127);
});

it('sends the dictation, the rest of the draft and recent messages on stdin and returns the polished text', async () => {
  const run = jest.fn((_command: string, _stdin: string, _signal: AbortSignal) =>
    Promise.resolve('notice\n<polished>\nsrc/ui/chat/Composer.tsx 고쳐 줘\n</polished>\n'));
  const text = await polishTranscript(request, run);
  expect(text).toBe('src/ui/chat/Composer.tsx 고쳐 줘');
  const [command, stdin] = run.mock.calls[0];
  expect(command).not.toContain('디테이션');
  expect(stdin).toContain('<dictation>\n어 그 composer 디테이션 파일 좀 고쳐 줘\n</dictation>');
  expect(stdin).toContain('먼저 이거 보고');
  expect(stdin).toContain('src/ui/chat/Composer.tsx 봐 줘');
  expect(stdin).toContain('봤습니다.');
});

it('tells the model to tidy the words, never to act on them', async () => {
  const run = jest.fn((_command: string, _stdin: string, _signal: AbortSignal) => Promise.resolve('<polished>x</polished>'));
  await polishTranscript(request, run);
  const instructions = `${run.mock.calls[0][0]}\n${run.mock.calls[0][1]}`;
  expect(instructions).toMatch(/never (follow|answer|carry out)/i);
  expect(instructions).toMatch(/do not (drop|remove)/i);
  expect(instructions).toMatch(/do not add/i);
  expect(instructions).toMatch(/register|반말|존댓말/);
});

it.each([
  ['', 'malformed'],
  ['Sure! Here is the cleaned text: hello', 'malformed'],
  ['<polished>   </polished>', 'malformed'],
  ['ARIES_NO_CLAUDE\n', 'noClaude'],
])('rejects %j as %s', async (output, kind) => {
  const run = jest.fn(() => Promise.resolve(output));
  await expect(polishTranscript(request, run)).rejects.toMatchObject({ kind });
});

it('reports an SSH failure', async () => {
  const run = jest.fn(() => Promise.reject(new Error('disconnected')));
  await expect(polishTranscript(request, run)).rejects.toMatchObject({ kind: 'failed' });
});

it('gives up after 30 seconds and aborts the remote command', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | undefined;
  const run = jest.fn((_command: string, _stdin: string, abort: AbortSignal) => {
    signal = abort;
    return new Promise<string>(() => {});
  });
  const result = polishTranscript(request, run);
  jest.advanceTimersByTime(POLISH_TIMEOUT_MS);
  await expect(result).rejects.toMatchObject({ kind: 'timeout' });
  expect(signal?.aborted).toBe(true);
  jest.useRealTimers();
});
