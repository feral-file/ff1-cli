import axios, { AxiosError } from 'axios';
import fs from 'fs';
import type { Playlist } from '../types';

interface PublishResult {
  success: boolean;
  playlistId?: string;
  message?: string;
  error?: string;
  feedServer?: string;
}

/**
 * Publish a validated playlist to a DP-1 feed server
 *
 * Flow:
 * 1. Read and parse playlist file
 * 2. Validate playlist against DP-1 spec using verifyPlaylist
 * 3. If valid, send the original playlist to feed server
 * 4. Return result with playlist ID or error
 *
 * @param {string} filePath - Path to playlist JSON file
 * @param {string} feedServerUrl - Feed server base URL
 * @param {string} [apiKey] - Optional API key for authentication
 * @returns {Promise<Object>} Result with success status, playlistId, or error
 * @example
 * const result = await publishPlaylist('playlist.json', 'http://localhost:8787/api/v1', 'api-key');
 * if (result.success) {
 *   console.log(`Published with ID: ${result.playlistId}`);
 * } else {
 *   console.error(`Failed: ${result.error}`);
 * }
 */
export async function publishPlaylist(
  filePath: string,
  feedServerUrl: string,
  apiKey?: string
): Promise<PublishResult> {
  try {
    // Step 1: Read and parse playlist file
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `Playlist file not found: ${filePath}`,
      };
    }

    let playlist: Playlist;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      playlist = JSON.parse(content);
    } catch (_parseError) {
      return {
        success: false,
        error: `Invalid JSON in playlist file: ${filePath}`,
      };
    }

    // Step 2: Validate playlist
    const { verifyPlaylist } = await import('./playlist-verifier');
    const validationResult = verifyPlaylist(playlist);

    if (!validationResult.valid) {
      return {
        success: false,
        error: `Playlist validation failed: ${validationResult.error}`,
        message: validationResult.details?.map((d) => `  • ${d.path}: ${d.message}`).join('\n'),
      };
    }

    // Step 3: Send validated playlist to feed server
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Use provided apiKey, fallback to environment variable, or use empty string as last resort
    const authKey = apiKey !== undefined ? apiKey : process.env.FEED_API_KEY || '';
    if (authKey) {
      headers['Authorization'] = `Bearer ${authKey}`;
    }

    const response = await axios.post(`${feedServerUrl}/playlists`, playlist, {
      headers,
      timeout: 30000,
    });

    const playlistId = response.data?.id || response.data?.uuid;

    if (response.status === 201 || response.status === 202) {
      return {
        success: true,
        playlistId,
        message: `Published to feed server (${response.status === 202 ? 'queued' : 'created'})`,
        feedServer: feedServerUrl,
      };
    }

    return {
      success: false,
      error: `Unexpected response status: ${response.status}`,
      feedServer: feedServerUrl,
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    const errorMessage = axiosError.response?.data
      ? JSON.stringify(axiosError.response.data)
      : axiosError.message;

    return {
      success: false,
      error: `Failed to publish: ${errorMessage}`,
    };
  }
}
