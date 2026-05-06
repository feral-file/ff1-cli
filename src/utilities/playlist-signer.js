/**
 * Playlist Signing Utility.
 * Uses the DP-1 v1.1.0 signing contract via dp1-js and preserves legacy helpers
 * plus multi-sig verification when the library exports them (stash contract).
 */

const { getPlaylistConfig } = require('../config');

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
 * Sign a playlist using the DP-1 signing API.
 * The signed payload excludes any pre-existing signature fields so the output
 * is stable across re-signing and matches the library's canonical digest.
 *
 * @param {Object} playlist - Playlist object without signature
 * @param {string} [privateKeyBase64] - Ed25519 private key in hex or base64 format (optional, uses config if not provided)
 * @param {string} [roleOverride] - DP-1 signing role override (optional, uses config if not provided)
 * @returns {Promise<string|Object>} Legacy signature string or multi-sig object
 * @throws {Error} If private key is invalid or signing fails
 */
async function signPlaylist(playlist, privateKeyBase64, roleOverride) {
  // Get private key from config if not provided
  let privateKey = privateKeyBase64;
  if (!privateKey) {
    const config = getPlaylistConfig();
    privateKey = config.privateKey;
  }

  if (!privateKey) {
    throw new Error('Private key is required for signing');
  }

  const config = getPlaylistConfig();
  const role = roleOverride || config.role || 'curator';

  try {
    const playlistToSign = { ...playlist };
    delete playlistToSign.signature;
    delete playlistToSign.signatures;

    const dp1 = await loadDp1();
    const raw = Buffer.from(JSON.stringify(playlistToSign));

    if (typeof dp1.SignMultiEd25519 === 'function') {
      return dp1.SignMultiEd25519(raw, privateKey, role, currentTimestamp());
    }

    throw new Error('dp1-js does not expose a compatible signing function');
  } catch (error) {
    throw new Error(`Failed to sign playlist: ${error.message}`);
  }
}

/**
 * Verify a playlist signature with the DP-1 verification API.
 * Multi-sig envelopes are verified through the playlist envelope verifier and
 * legacy playlists use the legacy Ed25519 verifier.
 *
 * @param {Object} playlist - Playlist object with signature field
 * @param {string} publicKeyHex - Ed25519 public key in hex format (with or without 0x prefix)
 * @returns {Promise<boolean>} True if signature is valid, false otherwise
 * @throws {Error} If verification process fails
 */
async function verifyPlaylist(playlist, publicKeyHex) {
  if (!publicKeyHex) {
    throw new Error('Public key is required for verification');
  }

  try {
    const dp1 = await loadDp1();
    const verifyFn = dp1.verifyPlaylist;
    if (typeof verifyFn !== 'function') {
      throw new Error('dp1-js does not expose verifyPlaylist');
    }

    const isValid = await verifyFn(playlist, publicKeyHex);
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
async function signPlaylistFile(playlistPath, privateKeyBase64, outputPath, roleOverride) {
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
    const role = roleOverride || config.role || 'curator';

    const validation = await validatePlaylistForSigning(playlist);
    if (!validation.valid) {
      throw new Error(`Playlist validation failed: ${validation.error}`);
    }

    const dp1 = await loadDp1();
    if (!privateKey) {
      throw new Error('Private key is required for signing');
    }
    const signedPlaylist = await buildSignedPlaylistEnvelope(playlist, privateKey, dp1, role);

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

async function buildSignedPlaylistEnvelope(playlist, privateKey, dp1, role) {
  const playlistToSign = { ...playlist };
  delete playlistToSign.signature;
  delete playlistToSign.signatures;

  if (typeof dp1.SignMultiEd25519 === 'function') {
    const signature = await dp1.SignMultiEd25519(
      Buffer.from(JSON.stringify(playlistToSign)),
      privateKey,
      role,
      currentTimestamp()
    );

    return {
      ...playlist,
      signature: undefined,
      signatures: [signature],
    };
  }

  throw new Error('dp1-js does not expose a compatible signing function');
}

async function loadDp1() {
  const spec = process.env.DP1_JS || 'dp1-js';
  if (spec.startsWith('file:')) {
    const repoDir = fileURLToPath(spec);
    return import(pathToFileURL(resolve(repoDir, 'dist', 'index.js')).href);
  }

  return require(resolveDp1Specifier(spec));
}

function resolveDp1Specifier(spec) {
  if (spec.startsWith('file:')) {
    return fileURLToPath(spec);
  }

  return spec;
}
const { fileURLToPath, pathToFileURL } = require('url');
const { resolve } = require('path');

function currentTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
