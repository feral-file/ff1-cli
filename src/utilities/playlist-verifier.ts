/**
 * Playlist Verification Utility.
 * Delegates signature-shape handling to dp1-js and keeps the CLI as a thin
 * orchestration layer.
 */

import type { Playlist } from '../types';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { join } from 'path';

/**
 * Verify playlist structure and integrity
 *
 * Validates playlist against DP-1 specification using dp1-js parser.
 * Returns detailed validation errors if playlist is invalid.
 *
 * @param {Object} playlist - Playlist object to verify
 * @returns {Object} Verification result
 * @returns {boolean} returns.valid - Whether playlist is valid
 * @returns {string} [returns.error] - Error message if invalid
 * @returns {Array<Object>} [returns.details] - Detailed validation errors
 * @example
 * const result = verifyPlaylist(playlist);
 * if (result.valid) {
 *   console.log('Playlist is valid');
 * } else {
 *   console.error('Invalid:', result.error);
 * }
 */
export async function verifyPlaylist(
  playlist: unknown,
  publicKey?: string
): Promise<{
  valid: boolean;
  error?: string;
  details?: Array<{ path: string; message: string }>;
}> {
  try {
    const result = await parseDp1Playlist(playlist);

    if (result && 'error' in result && result.error) {
      return {
        valid: false,
        error: result.error.message,
        details: result.error.details || [],
      };
    }

    const dp1 = await loadDp1();
    const verifyFn = dp1.verifyPlaylist;

    if (typeof verifyFn !== 'function') {
      throw new Error('dp1-js does not expose verifyPlaylist');
    }

    if (!hasSignatureFields(playlist)) {
      return { valid: true };
    }

    const ok = await verifyFn(playlist, publicKey);
    return ok ? { valid: true } : { valid: false, error: 'Playlist signature verification failed' };
  } catch (error) {
    return {
      valid: false,
      error: `Verification failed: ${(error as Error).message}`,
    };
  }
}

function hasSignatureFields(playlist: unknown): boolean {
  if (!playlist || typeof playlist !== 'object') {
    return false;
  }

  const value = playlist as { signature?: unknown; signatures?: unknown };
  return (
    Boolean(value.signature) || (Array.isArray(value.signatures) && value.signatures.length > 0)
  );
}

async function parseDp1Playlist(playlist: unknown): Promise<{
  error?: { message: string; details?: Array<{ path: string; message: string }> };
}> {
  const module = (await loadDp1()) as {
    parseDP1Playlist?: (input: unknown) => {
      error?: { message: string; details?: Array<{ path: string; message: string }> };
    };
    default?: {
      parseDP1Playlist?: (input: unknown) => {
        error?: { message: string; details?: Array<{ path: string; message: string }> };
      };
    };
  };

  const parseFn = module.parseDP1Playlist;
  if (typeof parseFn !== 'function') {
    throw new Error('dp1-js does not expose parseDP1Playlist');
  }

  return parseFn(playlist);
}

async function loadDp1(): Promise<Record<string, unknown>> {
  const spec = process.env.DP1_JS || 'dp1-js';
  if (spec.startsWith('file:')) {
    const repoDir = fileURLToPath(spec);
    const entry = join(repoDir, 'dist', 'index.js');
    return import(pathToFileURL(entry).href);
  }

  // `DP1_JS` may point at a local checkout (`file:`) or a published package.
  const require = createRequire(__filename);
  return require(spec);
}

/**
 * Verify playlist file
 *
 * Reads playlist from file and validates structure.
 *
 * @param {string} playlistPath - Path to playlist JSON file
 * @returns {Promise<Object>} Verification result
 * @returns {boolean} returns.valid - Whether playlist is valid
 * @returns {Object} [returns.playlist] - Validated playlist object
 * @returns {string} [returns.error] - Error message if invalid
 * @returns {Array<Object>} [returns.details] - Detailed validation errors
 * @example
 * const result = await verifyPlaylistFile('playlist.json');
 * if (result.valid) {
 *   console.log('Playlist is valid');
 * }
 */
export async function verifyPlaylistFile(playlistPath: string): Promise<{
  valid: boolean;
  playlist?: Playlist;
  error?: string;
  details?: Array<{ path: string; message: string }>;
}> {
  try {
    // Check if file exists
    try {
      await fs.access(playlistPath);
    } catch {
      return {
        valid: false,
        error: `Playlist file not found: ${playlistPath}`,
      };
    }

    // Read and parse playlist file
    const playlistContent = await fs.readFile(playlistPath, 'utf-8');
    let playlistData: unknown;

    try {
      playlistData = JSON.parse(playlistContent);
    } catch (parseError) {
      return {
        valid: false,
        error: `Invalid JSON: ${(parseError as Error).message}`,
      };
    }

    // Verify using dp1-js
    const result = await verifyPlaylist(playlistData);

    if (result.valid) {
      return {
        valid: true,
        playlist: playlistData as Playlist,
      };
    }

    return {
      valid: false,
      error: result.error,
      details: result.details,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to verify playlist file: ${(error as Error).message}`,
    };
  }
}

/**
 * Print verification results to console
 *
 * @param {Object} result - Verification result
 * @param {string} [filename] - Optional filename to include in output
 */
export function printVerificationResult(
  result: {
    valid: boolean;
    playlist?: Playlist;
    error?: string;
    details?: Array<{ path: string; message: string }>;
  },
  filename?: string
): void {
  if (result.valid) {
    console.log(chalk.green('\nPlaylist is valid'));
    if (filename) {
      console.log(chalk.dim(`  File: ${filename}`));
    }
    if (result.playlist) {
      console.log(chalk.dim(`  Title: ${result.playlist.title}`));
      console.log(chalk.dim(`  Items: ${result.playlist.items?.length || 0}`));
      console.log(chalk.dim(`  DP Version: ${result.playlist.dpVersion}`));
      if (Array.isArray(result.playlist.signatures)) {
        console.log(chalk.dim(`  Signatures: ${result.playlist.signatures.length}`));
      } else if (result.playlist.signature && typeof result.playlist.signature === 'string') {
        console.log(chalk.dim(`  Signature: ${result.playlist.signature.substring(0, 30)}...`));
      }
    }
    console.log();
  } else {
    console.log(chalk.red('\nPlaylist validation failed'));
    if (filename) {
      console.log(chalk.dim(`  File: ${filename}`));
    }
    console.log(chalk.red(`  Error: ${result.error}`));

    if (result.details && result.details.length > 0) {
      console.log(chalk.yellow('\n  Validation errors:'));
      result.details.forEach((detail) => {
        console.log(chalk.yellow(`    • ${detail.path}: ${detail.message}`));
      });
    }
    console.log();
  }
}
