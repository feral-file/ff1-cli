/**
 * Playlist Signing Utility
 * Uses dp1-js library for DP-1 specification-compliant playlist signing
 */

const { signDP1Playlist, verifyPlaylistSignature } = require('dp1-js');
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
 * Sign a playlist using ed25519 as per DP-1 specification
 * Uses dp1-js library for standards-compliant signing
 *
 * @param {Object} playlist - Playlist object without signature
 * @param {string} [privateKeyBase64] - Ed25519 private key in base64 format (optional, uses config if not provided)
 * @returns {Promise<string>} Signature in format "ed25519:0x{hex}"
 * @throws {Error} If private key is invalid or signing fails
 * @example
 * const signature = await signPlaylist(playlist, privateKeyBase64);
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

    // dp1-js accepts both hex string or Uint8Array
    // Try as hex first, then base64
    let keyInput;
    if (privateKey.startsWith('0x')) {
      keyInput = privateKey;
    } else {
      // Convert base64 to hex format (dp1-js prefers hex)
      const keyBytes = base64ToUint8Array(privateKey);
      keyInput = '0x' + Buffer.from(keyBytes).toString('hex');
    }

    // Sign using dp1-js library
    const signature = await signDP1Playlist(playlistToSign, keyInput);

    return signature;
  } catch (error) {
    throw new Error(`Failed to sign playlist: ${error.message}`);
  }
}

/**
 * Verify a playlist's ed25519 signature
 *
 * @param {Object} playlist - Playlist object with signature field
 * @param {string} publicKeyHex - Ed25519 public key in hex format (with or without 0x prefix)
 * @returns {Promise<boolean>} True if signature is valid, false otherwise
 * @throws {Error} If verification process fails
 * @example
 * const isValid = await verifyPlaylist(signedPlaylist, publicKeyHex);
 * if (isValid) {
 *   console.log('Signature is valid');
 * }
 */
async function verifyPlaylist(playlist, publicKeyHex) {
  if (!playlist.signature) {
    throw new Error('Playlist does not have a signature');
  }

  if (!publicKeyHex) {
    throw new Error('Public key is required for verification');
  }

  try {
    // Convert hex public key to Uint8Array
    const publicKeyBytes = hexToUint8Array(publicKeyHex);

    // Verify using dp1-js library
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
 * @param {string} [privateKeyBase64] - Ed25519 private key in base64 format (optional, uses config if not provided)
 * @param {string} [outputPath] - Output path (optional, overwrites input if not provided)
 * @returns {Promise<Object>} Result with signed playlist
 * @returns {boolean} returns.success - Whether signing succeeded
 * @returns {Object} [returns.playlist] - Signed playlist object
 * @returns {string} [returns.error] - Error message if failed
 * @example
 * const result = await signPlaylistFile('playlist.json');
 * if (result.success) {
 *   console.log('Playlist signed:', result.playlist);
 * }
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

    // Sign playlist
    const signature = await signPlaylist(playlist, privateKeyBase64);

    // Add signature to playlist
    const signedPlaylist = {
      ...playlist,
      signature,
    };

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
