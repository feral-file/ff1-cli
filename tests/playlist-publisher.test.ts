import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { publishPlaylist } from '../src/utilities/playlist-publisher';
import { signPlaylist } from '../src/utilities/playlist-signer';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ff1-publish-'));
}

describe('publishPlaylist validation contract', () => {
  test('rejects a structurally invalid playlist before upload', async () => {
    const dir = makeTempDir();
    try {
      const path = join(dir, 'invalid.json');
      writeFileSync(path, JSON.stringify({ dpVersion: '1.1.0', title: 'bad' }, null, 2), 'utf-8');

      const result = await publishPlaylist(path, 'http://127.0.0.1:0');

      assert.equal(result.success, false);
      assert.match(result.error ?? '', /validation failed/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts a parse-valid playlist even when signatures are bad', async () => {
    const dir = makeTempDir();
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'playlist-123' }));
        assert.match(body, /"signatures"/);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address == null || typeof address === 'string') {
      server.close();
      rmSync(dir, { recursive: true, force: true });
      throw new Error('Failed to start test server');
    }

    try {
      const port = address.port;
      const { privateKey } = generateKeyPairSync('ed25519');
      const privateKeyBase64 = privateKey
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64');
      const basePlaylist = {
        dpVersion: '1.1.0',
        title: 'publish-me',
        items: [
          {
            id: 'item-1',
            source: 'https://example.com/a.mp4',
            duration: 5,
            license: 'open',
          },
        ],
      };
      const signature = await signPlaylist(basePlaylist, privateKeyBase64);
      const playlist = { ...basePlaylist, signatures: [{ ...signature, sig: 'AAAA' }] };
      const path = join(dir, 'tampered.json');
      writeFileSync(path, JSON.stringify(playlist, null, 2), 'utf-8');

      const result = await publishPlaylist(path, `http://127.0.0.1:${port}`);

      assert.equal(result.success, true);
      assert.equal(result.playlistId, 'playlist-123');
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
