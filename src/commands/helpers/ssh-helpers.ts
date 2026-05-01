import { promises as fs } from 'fs';

/**
 * Parse a TTL duration string into seconds.
 *
 * Accepts a bare number ("900"), or a number with an `s`/`m`/`h` unit
 * suffix ("15m", "2h"). Used by `ff1 ssh enable --ttl <ttl>`.
 *
 * @throws Error When the input does not match the supported format
 */
export function parseTtlSeconds(ttl: string): number {
  const trimmed = ttl.trim();
  const match = trimmed.match(/^(\d+)([smh]?)$/i);
  if (!match) {
    throw new Error('TTL must be a number of seconds or a duration like 15m or 2h');
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (Number.isNaN(value)) {
    throw new Error('TTL value is not a number');
  }
  if (unit === 'm') {
    return value * 60;
  }
  if (unit === 'h') {
    return value * 60 * 60;
  }
  return value;
}

/**
 * Read an SSH public key from a file. The contents are trimmed and
 * required to be non-empty so callers can fail fast on truncated files.
 */
export async function readPublicKeyFile(keyPath: string): Promise<string> {
  const content = await fs.readFile(keyPath, 'utf-8');
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Public key file is empty');
  }
  return trimmed;
}
