import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';
import { resolve } from 'node:path';

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

    const signature = await signPlaylist(playlist, privateKeyBase64);

    assert.equal(typeof signature, 'object');
    assert.ok(signature);
    assert.equal(signature.alg, 'ed25519');
    assert.equal(signature.role, 'curator');
    assert.match(signature.kid, /^did:key:/);
    assert.equal(typeof signature.payload_hash, 'string');
    assert.equal(typeof signature.sig, 'string');
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

  test('verifyPlaylist accepts v1.1.0 multi-sig and legacy signature fields', async () => {
    const previousDp1Js = process.env.DP1_JS;
    process.env.DP1_JS = localDp1Js;
    try {
      const multiSigPlaylist = {
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
        signatures: [
          {
            alg: 'ed25519',
            kid: 'did:key:z6Mkexample',
            ts: '2026-01-01T00:00:00Z',
            payload_hash: 'sha256:' + '0'.repeat(64),
            role: 'curator',
            sig: 'abc',
          },
        ],
      };

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

      const multiResult = await verifyPlaylist(multiSigPlaylist);
      const legacyResult = await verifyPlaylist(legacyPlaylist);

      assert.equal(multiResult.valid, true);
      assert.equal(legacyResult.valid, true);
    } finally {
      process.env.DP1_JS = previousDp1Js;
    }
  });
});
