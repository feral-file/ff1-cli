import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { preparePlaylistForDelivery, verifyPlaylist } from '../src/utilities/playlist-verifier';
import { signPlaylist } from '../src/utilities/playlist-signer';

const fixturePath = join(__dirname, 'fixtures/playlists/valid-unsigned-open-v11.json');

function makePrivateKeyBase64(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}

describe('preparePlaylistForDelivery', () => {
  test('verifies a signed playlist before delivery without changing it', async () => {
    const playlist = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;
    const signed = await signPlaylist(playlist, makePrivateKeyBase64());

    const result = await preparePlaylistForDelivery({ ...playlist, signatures: [signed] });

    assert.equal(result.valid, true);
    assert.equal(result.signed, false);
    assert.deepEqual(result.playlist, { ...playlist, signatures: [signed] });

    const verification = await verifyPlaylist(result.playlist);
    assert.equal(verification.valid, true);
  });

  test('leaves an already signed playlist unchanged', async () => {
    const playlist = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;

    const signed = await signPlaylist(playlist, makePrivateKeyBase64());
    const result = await preparePlaylistForDelivery({ ...playlist, signatures: [signed] });

    assert.equal(result.valid, true);
    assert.equal(result.signed, false);
    assert.deepEqual(result.playlist, { ...playlist, signatures: [signed] });
  });

  test('rejects structurally invalid playlists', async () => {
    const result = await preparePlaylistForDelivery(
      {
        dpVersion: '1.1.0',
        title: 'missing items',
      },
      true,
      makePrivateKeyBase64()
    );

    assert.equal(result.valid, false);
    assert.match(result.error ?? '', /dp1:/i);
  });
});
