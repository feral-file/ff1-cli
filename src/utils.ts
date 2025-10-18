import { promises as fs } from 'fs';
import path from 'path';
import type { Playlist } from './types';

/**
 * Save playlist to a JSON file
 * @param {Object} playlist - The playlist object
 * @param {string} filename - Output filename
 * @returns {Promise<string>} Path to the saved file
 */
export async function savePlaylist(playlist: Playlist, filename: string): Promise<string> {
  const outputPath = path.resolve(process.cwd(), filename);

  // Ensure the playlist is properly formatted
  const formattedPlaylist = JSON.stringify(playlist, null, 2);

  await fs.writeFile(outputPath, formattedPlaylist, 'utf-8');

  return outputPath;
}

/**
 * Load playlist from a JSON file
 * @param {string} filename - Input filename
 * @returns {Promise<Object>} The playlist object
 */
export async function loadPlaylist(filename: string): Promise<Playlist> {
  const filePath = path.resolve(process.cwd(), filename);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as Playlist;
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}
