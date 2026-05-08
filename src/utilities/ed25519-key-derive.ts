import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

/**
 * RFC 8410 PKCS#8 prefix for Ed25519: nested OCTET STRING holds the 32-byte seed.
 * Used so 32-byte hex seeds work on Node versions that reject `type: 'raw'` imports.
 */
const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function ed25519SeedBytesToPkcs8(seed32: Buffer): Buffer {
  if (seed32.length !== 32) {
    throw new Error('Ed25519 seed must be 32 bytes');
  }
  return Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed32]);
}

/**
 * parsePlaylistPrivateKeyToKeyObject interprets playlist signing material the same way
 * operators configure it: PKCS#8 DER as base64 (setup default), optional 32-byte raw
 * seed as hex, PKCS#8 as hex, or PEM.
 *
 * @param material - Trimmed private key string from config or env
 * @returns Node.js KeyObject for the Ed25519 private key
 * @throws Error if the material cannot be parsed or is not Ed25519
 */
export function parsePlaylistPrivateKeyToKeyObject(material: string): KeyObject {
  const trimmed = material.trim();
  if (!trimmed) {
    throw new Error('Private key material is empty');
  }

  if (trimmed.includes('BEGIN')) {
    const key = createPrivateKey({ key: trimmed, format: 'pem' });
    assertEd25519(key);
    return key;
  }

  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  const hexRegex = /^(0x)?[0-9a-fA-F]+$/;

  if (base64Regex.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 0) {
      throw new Error('Invalid base64 private key');
    }
    try {
      const key = createPrivateKey({ key: buf, format: 'der', type: 'pkcs8' });
      assertEd25519(key);
      return key;
    } catch {
      // Continue to other strategies (e.g. hex path may apply for unusual configs)
    }
  }

  if (hexRegex.test(trimmed)) {
    const raw = Buffer.from(trimmed.replace(/^0x/i, ''), 'hex');
    if (raw.length === 32) {
      try {
        const der = ed25519SeedBytesToPkcs8(raw);
        const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
        assertEd25519(key);
        return key;
      } catch {
        // fall through to full PKCS#8-in-hex
      }
    }
    try {
      const key = createPrivateKey({ key: raw, format: 'der', type: 'pkcs8' });
      assertEd25519(key);
      return key;
    } catch {
      // fall through
    }
  }

  throw new Error(
    'Unrecognized Ed25519 private key format (expected PKCS#8 base64, 32-byte hex seed, PKCS#8 hex, or PEM)'
  );
}

/**
 * deriveEd25519PublicKeyForVerify exports the public half in SPKI DER base64, which
 * dp1-js accepts for legacy signature verification alongside hex and PEM forms.
 *
 * @param privateKeyMaterial - Same encoding rules as `playlist.privateKey` / `PLAYLIST_PRIVATE_KEY`
 * @returns Base64-encoded SPKI DER public key
 */
export function deriveEd25519PublicKeyForVerify(privateKeyMaterial: string): string {
  const privateKey = parsePlaylistPrivateKeyToKeyObject(privateKeyMaterial);
  const publicKey = createPublicKey(privateKey);
  assertEd25519(publicKey);
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

function assertEd25519(key: KeyObject): void {
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Configured private key must be an Ed25519 key');
  }
}
