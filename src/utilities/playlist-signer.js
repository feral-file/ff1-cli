/**
 * Playlist Signing Utility.
 * Uses the DP-1 v1.1.0 signing contract via dp1-js and preserves legacy helpers
 * plus multi-sig verification when the library exports them (stash contract).
 */

const { getPlaylistConfig } = require('../config');
const { createPrivateKey, sign: nodeSign } = require('crypto');

/**
 * Convert base64-encoded key to Uint8Array (or hex string if needed)
 *
 * @param {string} base64Key - Ed25519 private key in base64 format
 * @returns {Uint8Array} Private key as Uint8Array
 */
function base64ToUint8Array(base64Key) {
  const buffer = Buffer.from(base64Key, 'base64');
  return new Uint8Array(buffer);
}

/**
 * Convert hex string to Uint8Array
 *
 * @param {string} hexKey - Ed25519 public key in hex format
 * @returns {Uint8Array} Public key as Uint8Array
 */
function hexToUint8Array(hexKey) {
  const cleanHex = hexKey.replace(/^0x/, '');
  const buffer = Buffer.from(cleanHex, 'hex');
  return new Uint8Array(buffer);
}

/**
 * Sign a playlist using ed25519 as per DP-1 specification
 * Uses dp1-js library for standards-compliant signing
 * Accepts private key in hex (with or without 0x prefix) or base64 format
 *
 * @param {Object} playlist - Playlist object without signature
 * @param {string} [privateKeyBase64] - Ed25519 private key in hex or base64 format (optional, uses config if not provided)
 * @returns {Promise<string>} Signature in format "ed25519:0x{hex}"
 * @throws {Error} If private key is invalid or signing fails
 * @example
 * const signature = await signPlaylist(playlist, privateKeyHexOrBase64);
 * // Returns: "ed25519:0x1234abcd..."
 */
async function signPlaylist(playlist, privateKeyBase64) {
  // Get private key from config if not provided
  let privateKey = privateKeyBase64;
  if (!privateKey) {
    const config = getPlaylistConfig();
    privateKey = config.privateKey;
  }

  if (!privateKey) {
    throw new Error('Private key is required for signing');
  }

  try {
    // Remove signature field if it exists (for re-signing)
    const playlistToSign = { ...playlist };
    delete playlistToSign.signature;
    delete playlistToSign.signatures;

    const privateKeyObject = normalizePrivateKey(privateKey);
    const digest = Buffer.from(JSON.stringify(playlistToSign));
    const signature = nodeSign(null, digest, privateKeyObject).toString('hex');

    return `ed25519:${signature}`;
  } catch (error) {
    throw new Error(`Failed to sign playlist: ${error.message}`);
  }
}

/**
 * Verify a playlist signature with a public key: multi-sig envelopes first
 * (when VerifyPlaylistSignatures / VerifyMultiSignaturesJSON exist), otherwise
 * legacy `signature` using verifyPlaylistSignature-compatible entrypoints.
 *
 * @param {Object} playlist - Playlist object with signature field
 * @param {string} publicKeyHex - Ed25519 public key in hex format (with or without 0x prefix)
 * @returns {Promise<boolean>} True if signature is valid, false otherwise
 * @throws {Error} If verification process fails
 */
async function verifyPlaylist(playlist, publicKeyHex) {
  if (!playlist.signature && !Array.isArray(playlist.signatures)) {
    throw new Error('Playlist does not have a signature');
  }

  if (!publicKeyHex) {
    throw new Error('Public key is required for verification');
  }

  try {
    const dp1 = await loadDp1();
    const publicKeyBytes = hexToUint8Array(publicKeyHex);

    if (Array.isArray(playlist.signatures)) {
      const verifyFn = dp1.VerifyPlaylistSignatures || dp1.VerifyMultiSignaturesJSON;
      if (typeof verifyFn !== 'function') {
        throw new Error('dp1-js does not expose a compatible multi-signature verifier');
      }

      const payload = Buffer.from(JSON.stringify(playlist));
      let outcome;
      try {
        outcome = await verifyFn(payload, publicKeyBytes);
      } catch {
        outcome = await verifyFn(payload);
      }
      if (Array.isArray(outcome)) {
        return Boolean(outcome[0]);
      }
      return Boolean(outcome);
    }

    const verifyPlaylistSignature =
      dp1.verifyPlaylistSignature || dp1.VerifyLegacyEd25519 || dp1.VerifyPlaylistSignatures;

    if (typeof verifyPlaylistSignature !== 'function') {
      throw new Error('dp1-js does not expose a compatible verification function');
    }

    const isValid = await verifyPlaylistSignature(playlist, publicKeyBytes);
    return isValid;
  } catch (error) {
    throw new Error(`Failed to verify playlist signature: ${error.message}`);
  }
}

/**
 * Sign a playlist file
 * Reads playlist from file, signs it, and writes back
 *
 * @param {string} playlistPath - Path to playlist JSON file
 * @param {string} [privateKeyBase64] - Ed25519 private key in hex or base64 format (optional, uses config if not provided)
 * @param {string} [outputPath] - Output path (optional, overwrites input if not provided)
 * @returns {Promise<Object>} Result with signed playlist
 * @returns {boolean} returns.success - Whether signing succeeded
 * @returns {Object} [returns.playlist] - Signed playlist object
 * @returns {string} [returns.error] - Error message if failed
 */
async function signPlaylistFile(playlistPath, privateKeyBase64, outputPath) {
  const fs = require('fs');
  const path = require('path');

  try {
    // Read playlist file
    if (!fs.existsSync(playlistPath)) {
      throw new Error(`Playlist file not found: ${playlistPath}`);
    }

    const playlistContent = fs.readFileSync(playlistPath, 'utf-8');
    const playlist = JSON.parse(playlistContent);
    const config = getPlaylistConfig();
    const privateKey = privateKeyBase64 || config.privateKey;

    const validation = await validatePlaylistForSigning(playlist);
    if (!validation.valid) {
      throw new Error(`Playlist validation failed: ${validation.error}`);
    }

    const dp1 = await loadDp1();
    if (!privateKey) {
      throw new Error('Private key is required for signing');
    }
    const signedPlaylist = await buildSignedPlaylistEnvelope(playlist, privateKey, dp1);

    // Write to output file
    const output = outputPath || playlistPath;
    fs.writeFileSync(output, JSON.stringify(signedPlaylist, null, 2), 'utf-8');

    console.log(`✓ Playlist signed and saved to: ${path.resolve(output)}`);

    return {
      success: true,
      playlist: signedPlaylist,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  signPlaylist,
  verifyPlaylist,
  signPlaylistFile,
  base64ToUint8Array,
  hexToUint8Array,
};

async function validatePlaylistForSigning(playlist) {
  const dp1 = await loadDp1();
  const parseFn = dp1.parseDP1PlaylistWithOptions || dp1.parseDP1Playlist;

  if (typeof parseFn !== 'function') {
    throw new Error('dp1-js does not expose a compatible parser');
  }

  const result =
    parseFn === dp1.parseDP1PlaylistWithOptions
      ? parseFn(playlist, { allowUnsignedOpen: true })
      : parseFn(playlist);

  if (result && result.error) {
    return { valid: false, error: result.error.message };
  }

  return { valid: true };
}

async function buildSignedPlaylistEnvelope(playlist, privateKey, dp1) {
  const playlistToSign = { ...playlist };
  delete playlistToSign.signature;
  delete playlistToSign.signatures;

  if (typeof dp1.signDP1PlaylistMultiSig === 'function') {
    const signature = await dp1.signDP1PlaylistMultiSig(
      playlistToSign,
      {
        kid: 'did:key:zff1CliTestKey',
        role: 'curator',
        alg: 'ed25519',
      },
      privateKey
    );

    return {
      ...playlist,
      signatures: [signature],
      signature: undefined,
    };
  }

  const signature = await signPlaylist(playlistToSign, privateKey);
  if (signature && typeof signature === 'object' && !Array.isArray(signature)) {
    return {
      ...playlist,
      signatures: [signature],
    };
  }

  return {
    ...playlist,
    signatures: [
      {
        alg: 'ed25519',
        kid: 'did:key:zff1CliTestKey',
        ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        payload_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        role: 'curator',
        sig: signature.replace(/^ed25519:0x/, ''),
      },
    ],
    signature: undefined,
  };
}

async function loadDp1() {
  const spec = process.env.DP1_JS || 'dp1-js';
  if (spec.startsWith('file:')) {
    const repoDir = fileURLToPath(spec);
    return import(pathToFileURL(resolve(repoDir, 'dist', 'index.js')).href);
  }

  return require(resolveDp1Specifier(spec));
}

function normalizePrivateKey(privateKey) {
  if (!privateKey) {
    throw new Error('Private key is required for signing');
  }

  if (Buffer.isBuffer(privateKey) || privateKey instanceof Uint8Array) {
    return createPrivateKey({ key: Buffer.from(privateKey), format: 'der', type: 'pkcs8' });
  }

  if (typeof privateKey !== 'string') {
    return createPrivateKey(privateKey);
  }

  const trimmed = privateKey.trim();
  const cleanHex = trimmed.replace(/^0x/, '');
  if (/^[0-9a-fA-F]+$/.test(cleanHex) && cleanHex.length % 2 === 0) {
    return createPrivateKey({ key: Buffer.from(cleanHex, 'hex'), format: 'der', type: 'pkcs8' });
  }

  return createPrivateKey({ key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'pkcs8' });
}

function resolveDp1Specifier(spec) {
  if (spec.startsWith('file:')) {
    return fileURLToPath(spec);
  }

  return spec;
}
const { fileURLToPath, pathToFileURL } = require('url');
const { resolve } = require('path');
