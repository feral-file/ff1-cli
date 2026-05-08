import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { signPlaylist } from '../src/utilities/playlist-signer';
import { verifyPlaylist } from '../src/utilities/playlist-verifier';

/**
 * Runs verification with an isolated config directory so PLAYLIST_PRIVATE_KEY and
 * user config paths do not leak key material into these tests (dp1-js ignores the
 * optional key for `signatures[]` anyway).
 */
async function withNoPlaylistSigningEnv<T>(fn: () => Promise<T>): Promise<T> {
  const cwd = process.cwd();
  const tempDir = mkdtempSync(`${tmpdir()}/ff1-verify-isolated-`);
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const prevPk = process.env.PLAYLIST_PRIVATE_KEY;
  try {
    process.chdir(tempDir);
    process.env.XDG_CONFIG_HOME = tempDir;
    delete process.env.PLAYLIST_PRIVATE_KEY;
    return await fn();
  } finally {
    process.chdir(cwd);
    if (prevXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = prevXdg;
    }
    if (prevPk === undefined) {
      delete process.env.PLAYLIST_PRIVATE_KEY;
    } else {
      process.env.PLAYLIST_PRIVATE_KEY = prevPk;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('DP-1 v1.1.0 signing', () => {
  test('signPlaylist returns a v1.1.0 multi-signature object', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const privateKeyBase64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const playlist = {
      dpVersion: '1.1.0',
      title: 'Test',
      items: [{ source: 'https://example.com/art.mp4', duration: 10, license: 'token' }],
    };

    const cwd = process.cwd();
    const tempDir = mkdtempSync(`${tmpdir()}/ff1-role-default-`);
    const previousRole = process.env.PLAYLIST_ROLE;
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.chdir(tempDir);
      delete process.env.PLAYLIST_ROLE;
      process.env.XDG_CONFIG_HOME = tempDir;
      const signature = await signPlaylist(playlist, privateKeyBase64);

      assert.equal(typeof signature, 'object');
      assert.ok(signature);
      assert.equal(signature.alg, 'ed25519');
      assert.equal(signature.role, 'agent');
      assert.match(signature.kid, /^did:key:/);
      assert.equal(typeof signature.payload_hash, 'string');
      assert.equal(typeof signature.sig, 'string');
    } finally {
      if (previousRole === undefined) {
        delete process.env.PLAYLIST_ROLE;
      } else {
        process.env.PLAYLIST_ROLE = previousRole;
      }
      if (previousXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = previousXdg;
      }
      process.chdir(cwd);
    }
  });

  test('signPlaylist uses the configured role override', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const privateKeyBase64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const playlist = {
      dpVersion: '1.1.0',
      title: 'Test',
      items: [{ source: 'https://example.com/art.mp4', duration: 10, license: 'token' }],
    };

    const signature = await signPlaylist(playlist, privateKeyBase64, 'feed');

    assert.equal(signature.role, 'feed');
  });

  test('verifyPlaylist accepts v1.1.0 multi-sig envelopes without a public key', async () => {
    const playlist = {
      dpVersion: '1.1.0',
      id: 'd2d4f9b0-7f01-4c26-9c10-1c4d7477f5de',
      slug: 'test-playlist',
      created: '2026-02-06T00:00:00.000Z',
      title: 'Multi',
      items: [
        {
          id: 'ad5de50a-6a0d-4b61-8ef9-7b0f0d1d5e9b',
          source: 'https://example.com/art.mp4',
          duration: 10,
          license: 'token',
          created: '2026-02-06T00:00:00.000Z',
        },
      ],
    };

    await withNoPlaylistSigningEnv(async () => {
      const signature = await signPlaylist(playlist, makePrivateKey());
      const multiSigPlaylist = {
        ...playlist,
        signatures: [signature],
      };

      const multiResult = await verifyPlaylist(multiSigPlaylist);

      assert.equal(multiResult.valid, true);
    });
  });

  test('verifyPlaylist does not accept legacy signature-only playlists without a public key', async () => {
    const legacyPlaylist = {
      dpVersion: '1.1.0',
      id: 'd2d4f9b0-7f01-4c26-9c10-1c4d7477f5de',
      slug: 'test-playlist',
      created: '2026-02-06T00:00:00.000Z',
      title: 'Legacy',
      items: [
        {
          id: 'ad5de50a-6a0d-4b61-8ef9-7b0f0d1d5e9b',
          source: 'https://example.com/art.mp4',
          duration: 10,
          license: 'token',
          created: '2026-02-06T00:00:00.000Z',
        },
      ],
      signature: 'ed25519:' + 'a'.repeat(128),
    };

    await withNoPlaylistSigningEnv(async () => {
      const legacyResult = await verifyPlaylist(legacyPlaylist);

      assert.equal(legacyResult.valid, false);
    });
  });

  test('verifyPlaylist rejects unsigned playlists', async () => {
    const unsignedPlaylist = {
      dpVersion: '1.1.0',
      id: 'd2d4f9b0-7f01-4c26-9c10-1c4d7477f5de',
      slug: 'test-playlist',
      created: '2026-02-06T00:00:00.000Z',
      title: 'Unsigned',
      items: [
        {
          id: 'ad5de50a-6a0d-4b61-8ef9-7b0f0d1d5e9b',
          source: 'https://example.com/art.mp4',
          duration: 10,
          license: 'token',
          created: '2026-02-06T00:00:00.000Z',
        },
      ],
    };

    await withNoPlaylistSigningEnv(async () => {
      const unsignedResult = await verifyPlaylist(unsignedPlaylist);

      assert.equal(unsignedResult.valid, false);
    });
  });

  test('verifyPlaylist ignores broken signing config for v1.1.0 signatures[] envelopes', async () => {
    const playlist = {
      dpVersion: '1.1.0',
      id: 'd2d4f9b0-7f01-4c26-9c10-1c4d7477f5de',
      slug: 'signed-envelope',
      created: '2026-02-06T00:00:00.000Z',
      title: 'Envelope',
      items: [
        {
          id: 'ad5de50a-6a0d-4b61-8ef9-7b0f0d1d5e9b',
          source: 'https://example.com/art.mp4',
          duration: 10,
          license: 'token',
          created: '2026-02-06T00:00:00.000Z',
        },
      ],
    };

    await withNoPlaylistSigningEnv(async () => {
      const signature = await signPlaylist(playlist, makePrivateKey());
      const multiSigPlaylist = {
        ...playlist,
        signatures: [signature],
      };

      const previousPrivateKey = process.env.PLAYLIST_PRIVATE_KEY;
      process.env.PLAYLIST_PRIVATE_KEY = 'not-a-valid-ed25519-key';
      try {
        const result = await verifyPlaylist(multiSigPlaylist);
        assert.equal(result.valid, true);
      } finally {
        if (previousPrivateKey === undefined) {
          delete process.env.PLAYLIST_PRIVATE_KEY;
        } else {
          process.env.PLAYLIST_PRIVATE_KEY = previousPrivateKey;
        }
      }
    });
  });
});

function makePrivateKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}
