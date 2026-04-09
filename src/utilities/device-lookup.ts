/**
 * Find an existing configured device that corresponds to a newly discovered host.
 *
 * Tries, in order:
 *  1. Exact URL match (the normal case).
 *  2. mDNS device ID match — if a stored entry has an `id` field (e.g. 'ff1-hh9jsnoc')
 *     that matches the discovered device's ID, they are the same physical device even
 *     when the host URL changed (IP ↔ .local hostname, DHCP lease change, etc.).
 *     This is the only reliable way to reconcile IP↔.local without a network lookup.
 *  3. mDNS hostname component match — both URLs are parsed and only the hostname
 *     part is compared (same .local name, different underlying IP or port).
 *  4. TXT-name match — if the device advertises a name (e.g. "kitchen") and a
 *     stored entry has that same friendly name, treat them as the same device.
 *
 * Returns the matched entry so callers can preserve the stored friendly name as
 * the default when prompting, rather than falling back to the raw mDNS label.
 */
export function findExistingDeviceEntry(
  existingDevices: Array<{ host?: string; name?: string; id?: string }>,
  newHost: string,
  discoveredName: string,
  discoveredId?: string
): { host?: string; name?: string; id?: string } | undefined {
  // 1. Exact URL match
  const byHost = existingDevices.find((d) => d.host === newHost);
  if (byHost) {
    return byHost;
  }

  // 2. mDNS device ID match (reconciles IP ↔ .local changes)
  if (discoveredId) {
    const byId = existingDevices.find((d) => d.id === discoveredId);
    if (byId) {
      return byId;
    }
  }

  // 3. mDNS hostname component match (ignores port and protocol differences)
  let newHostname = '';
  try {
    newHostname = new URL(newHost).hostname;
  } catch {
    // not a valid URL — skip hostname matching
  }

  if (newHostname) {
    const byHostname = existingDevices.find((d) => {
      try {
        return new URL(d.host || '').hostname === newHostname;
      } catch {
        return false;
      }
    });
    if (byHostname) {
      return byHostname;
    }
  }

  // 4. TXT-name match
  if (discoveredName) {
    return existingDevices.find((d) => d.name === discoveredName);
  }

  return undefined;
}
