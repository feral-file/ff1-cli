import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { validateConfig } from '../src/config';

function withIsolatedConfig<T>(fn: () => T): T {
  const cwd = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), 'ff1-config-validate-'));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  try {
    process.chdir(tempDir);
    process.env.XDG_CONFIG_HOME = tempDir;
    return fn();
  } finally {
    process.chdir(cwd);
    if (previousXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdg;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeValidBaseConfig(tempDir: string, playlist?: Record<string, unknown>): void {
  writeFileSync(
    join(tempDir, 'config.json'),
    JSON.stringify(
      {
        defaultModel: 'grok',
        models: {
          grok: {
            apiKey: 'test-key',
            baseURL: 'https://api.x.ai/v1',
            model: 'grok-beta',
            supportsFunctionCalling: true,
          },
        },
        playlist,
      },
      null,
      2
    ),
    'utf-8'
  );
}

describe('config validation playlist role contract', () => {
  test('validateConfig uses PLAYLIST_ROLE when it is the effective runtime role', () => {
    withIsolatedConfig(() => {
      const tempDir = process.cwd();
      const previousRole = process.env.PLAYLIST_ROLE;
      try {
        writeValidBaseConfig(tempDir);
        process.env.PLAYLIST_ROLE = 'owner';

        const result = validateConfig();

        assert.equal(result.valid, false);
        assert.match(result.errors.join('\n'), /playlist\.role must be one of:/);
      } finally {
        if (previousRole === undefined) {
          delete process.env.PLAYLIST_ROLE;
        } else {
          process.env.PLAYLIST_ROLE = previousRole;
        }
      }
    });
  });

  test('validateConfig accepts whitespace-padded playlist.role values after trimming', () => {
    withIsolatedConfig(() => {
      const tempDir = process.cwd();
      writeValidBaseConfig(tempDir, { role: '  feed  ' });

      const result = validateConfig();

      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });
  });
});
