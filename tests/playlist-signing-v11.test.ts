import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { signPlaylist } from '../src/utilities/playlist-signer';
import { verifyPlaylist } from '../src/utilities/playlist-verifier';

const localDp1Js = `file:${resolve(__dirname, '../../dp1-js-private')}`;

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
    const previousDp1Js = process.env.DP1_JS;
    process.env.DP1_JS = localDp1Js;
    try {
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

      const signature = await signPlaylist(playlist, makePrivateKey());
      const multiSigPlaylist = {
        ...playlist,
        signatures: [signature],
      };

      const multiResult = await verifyPlaylist(multiSigPlaylist);

      assert.equal(multiResult.valid, true);
    } finally {
      process.env.DP1_JS = previousDp1Js;
    }
  });

  test('verifyPlaylist does not accept legacy signature-only playlists without a public key', async () => {
    const previousDp1Js = process.env.DP1_JS;
    process.env.DP1_JS = localDp1Js;
    try {
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

      const legacyResult = await verifyPlaylist(legacyPlaylist);

      assert.equal(legacyResult.valid, false);
    } finally {
      process.env.DP1_JS = previousDp1Js;
    }
  });
});

function makePrivateKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}
