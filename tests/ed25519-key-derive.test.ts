import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  deriveEd25519PublicKeyForVerify,
  normalizeVerifyPublicKeyToPem,
  parsePlaylistPrivateKeyToKeyObject,
} from '../src/utilities/ed25519-key-derive';

describe('ed25519-key-derive', () => {
  test('deriveEd25519PublicKeyForVerify matches Node public key PEM from PKCS#8 base64', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pkcs8B64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const derivedPem = deriveEd25519PublicKeyForVerify(pkcs8B64);
    const expected = createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString();
    assert.equal(derivedPem, expected);
  });

  test('deriveEd25519PublicKeyForVerify works for 32-byte raw seed hex', () => {
    const seed = randomBytes(32);
    const seedHex = seed.toString('hex');
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const publicKey = createPublicKey(privateKey);
    const expected = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    assert.equal(deriveEd25519PublicKeyForVerify(seedHex), expected);
  });

  test('parsePlaylistPrivateKeyToKeyObject rejects empty string', () => {
    assert.throws(() => parsePlaylistPrivateKeyToKeyObject(''), /empty/i);
  });

  test('normalizeVerifyPublicKeyToPem accepts PEM, hex, 0x hex, raw base64, and SPKI base64', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const expectedPem = createPublicKey(privateKey)
      .export({ format: 'pem', type: 'spki' })
      .toString();
    const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as { x?: string };
    assert.ok(jwk.x);
    const raw32 = Buffer.from(jwk.x, 'base64url');
    assert.equal(raw32.length, 32);

    assert.equal(normalizeVerifyPublicKeyToPem(expectedPem), expectedPem);
    assert.equal(normalizeVerifyPublicKeyToPem(raw32.toString('hex')), expectedPem);
    assert.equal(normalizeVerifyPublicKeyToPem(`0x${raw32.toString('hex')}`), expectedPem);
    assert.equal(normalizeVerifyPublicKeyToPem(raw32.toString('base64')), expectedPem);

    const derSpki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
    assert.equal(normalizeVerifyPublicKeyToPem(derSpki.toString('base64')), expectedPem);
  });

  test('normalizeVerifyPublicKeyToPem rejects invalid lengths', () => {
    assert.throws(() => normalizeVerifyPublicKeyToPem('abcd'), /Unrecognized/i);
  });

  test('parsePlaylistPrivateKeyToKeyObject accepts PKCS#8 from setup-style base64', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pkcs8B64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const ko = parsePlaylistPrivateKeyToKeyObject(pkcs8B64);
    assert.equal(ko.asymmetricKeyType, 'ed25519');
    const roundTripPub = createPublicKey(ko).export({ format: 'pem', type: 'spki' }).toString();
    assert.equal(roundTripPub, deriveEd25519PublicKeyForVerify(pkcs8B64));
  });
});
