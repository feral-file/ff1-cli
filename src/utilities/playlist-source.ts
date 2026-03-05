import { promises as fs } from 'fs';
import type { Playlist } from '../types';

/**
 * Parsed playlist source metadata.
 */
export interface LoadedPlaylist {
  playlist: Playlist;
  source: string;
  sourceType: 'file' | 'url';
}

/**
 * Determine whether a playlist source is an HTTP(S) URL.
 *
 * @param {string} source - Playlist source value
 * @returns {boolean} Whether the value parses as http:// or https:// URL
 */
export function isPlaylistSourceUrl(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Load a DP-1 playlist from a local file or hosted URL.
 *
 * @param {string} source - Playlist file path or URL
 * @returns {Promise<LoadedPlaylist>} Loaded playlist payload with source metadata
 * @throws {Error} When source is empty, cannot be loaded, or JSON is invalid
 */
export async function loadPlaylistSource(source: string): Promise<LoadedPlaylist> {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    throw new Error('Playlist source is required');
  }

  if (isPlaylistSourceUrl(trimmedSource)) {
    const response = await fetch(trimmedSource);
    if (!response.ok) {
      throw new Error(`Failed to fetch playlist URL: ${response.status} ${response.statusText}`);
    }

    let playlistText: string;
    try {
      playlistText = await response.text();
    } catch (error) {
      throw new Error(
        `Failed to read playlist response from ${trimmedSource}: ${(error as Error).message}`
      );
    }

    try {
      return {
        playlist: JSON.parse(playlistText) as Playlist,
        source: trimmedSource,
        sourceType: 'url',
      };
    } catch (error) {
      throw new Error(
        `Invalid JSON from playlist URL ${trimmedSource}: ${(error as Error).message}`
      );
    }
  }

  let fileText: string;
  try {
    fileText = await fs.readFile(trimmedSource, 'utf-8');
  } catch (_error) {
    throw new Error(`Playlist file not found at ${trimmedSource}`);
  }

  try {
    return {
      playlist: JSON.parse(fileText) as Playlist,
      source: trimmedSource,
      sourceType: 'file',
    };
  } catch (error) {
    throw new Error(`Invalid JSON in ${trimmedSource}: ${(error as Error).message}`);
  }
}
