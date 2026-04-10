/**
 * Normalize a raw host string into a canonical `http://<host>:<port>` URL.
 *
 * Handles:
 *  - Trailing dot removal (mDNS labels sometimes end with '.')
 *  - Case-insensitive scheme detection (HTTP://, HTTPS://, http://, https://)
 *  - Bare IPv6 addresses (e.g. fe80::1 → [fe80::1]) so new URL() can parse them
 *  - Missing scheme → http://
 *  - Missing port → 1111
 */
export function normalizeDeviceHost(host: string): string {
  let normalized = host.trim().replace(/\.$/, '');
  if (!normalized) {
    return normalized;
  }
  const lower = normalized.toLowerCase();
  // Bare IPv6 address (e.g. fe80::1) — must be bracketed before adding http://
  // so that new URL() doesn't misparse the colons as port separators.
  // Only applies when there is no existing scheme, no existing brackets, and the
  // string consists solely of hex digits and colons (the IPv6 character set).
  if (
    !lower.startsWith('http://') &&
    !lower.startsWith('https://') &&
    !normalized.startsWith('[') &&
    /^[0-9a-fA-F:]+$/.test(normalized) &&
    normalized.includes(':')
  ) {
    normalized = `[${normalized}]`;
  }
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    normalized = `http://${normalized}`;
  }
  try {
    const url = new URL(normalized);
    const port = url.port || '1111';
    return `${url.protocol}//${url.hostname}:${port}`;
  } catch (_error) {
    return normalized;
  }
}

/**
 * Resolve a raw device identifier or host string into a canonical host URL.
 *
 * Accepts:
 *  - Full URLs (http://..., HTTPS://...) — forwarded to normalizeDeviceHost
 *  - IP addresses (contain dots or colons)
 *  - .local hostnames (contain dots)
 *  - Raw device IDs (e.g. 'hh9jsnoc', 'FF1-HH9JSNOC', 'ff1-hh9jsnoc') →
 *    normalized to lowercase and prefixed with 'ff1-' if missing, then '.local' appended
 */
export function normalizeDeviceIdToHost(rawId: string): string {
  const lower = rawId.trim().toLowerCase();
  const looksLikeHost = lower.includes('.') || lower.includes(':') || lower.startsWith('http');
  if (looksLikeHost) {
    return normalizeDeviceHost(rawId);
  }
  const deviceId = lower.startsWith('ff1-') ? lower : `ff1-${lower}`;
  return normalizeDeviceHost(`${deviceId}.local`);
}
