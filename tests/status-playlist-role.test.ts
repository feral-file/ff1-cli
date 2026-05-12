import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const projectRoot = resolve(__dirname, '..');
const tsxCli = resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const cliEntry = resolve(projectRoot, 'index.ts');
const fixtureConfig = resolve(projectRoot, 'tests/fixtures/config.test.json');

function runCli(
  cwd: string,
  args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd,
    env: { ...process.env, XDG_CONFIG_HOME: join(cwd, '.xdg') },
    encoding: 'utf-8',
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('ff1 status playlist role health', () => {
  test('marks an unsupported playlist signing role as not healthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff1-status-role-'));
    try {
      copyFileSync(fixtureConfig, join(dir, 'config.json'));
      const original = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')) as {
        playlist?: { role?: string };
      };
      original.playlist = { ...(original.playlist || {}), role: 'owner' };
      writeFileSync(join(dir, 'config.json'), JSON.stringify(original, null, 2), 'utf-8');

      const result = runCli(dir, ['status']);

      assert.notEqual(result.status, null);
      assert.match(result.stdout + result.stderr, /Playlist signing role/);
      assert.match(result.stdout + result.stderr, /Not set/);
      assert.doesNotMatch(result.stdout + result.stderr, /OK Playlist signing role/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts a whitespace-padded supported playlist signing role', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff1-status-role-ok-'));
    try {
      copyFileSync(fixtureConfig, join(dir, 'config.json'));
      const original = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')) as {
        playlist?: { role?: string };
      };
      original.playlist = { ...(original.playlist || {}), role: '  feed  ' };
      writeFileSync(join(dir, 'config.json'), JSON.stringify(original, null, 2), 'utf-8');

      const result = runCli(dir, ['status']);

      assert.notEqual(result.status, null);
      assert.match(result.stdout + result.stderr, /OK Playlist signing role/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
