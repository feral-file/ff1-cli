/**
 * Find an existing configured device that corresponds to a newly discovered host.
 *
 * Priority (most reliable to least):
 *  1. mDNS device ID match — the device's stable hardware identity. Checked first
 *     so a stale row that happens to share the same IP cannot shadow the correct
 *     entry. Requires the stored entry to have been written with an id field.
 *  2. Exact URL match — normal case after ID (same host format, no migration).
 *  3. mDNS hostname component match — both URLs are parsed and only the hostname
 *     part is compared (same .local name, different underlying IP or port).
 *  4. IP address match — the discovered device reports a resolved IP address that
 *     matches the IP in a stored entry. Bridges IP ↔ .local migration for configs
 *     written before the id field existed (no stored id, curated friendly name).
 *  5. TXT-name match — if the device advertises a name that matches a stored
 *     friendly name, treat them as the same device (last-resort fallback for
 *     configs written before the id field existed).
 *
 * Returns the matched entry so callers can preserve the stored friendly name as
 * the default when prompting, rather than falling back to the raw mDNS label.
 */
export function findExistingDeviceEntry(
  existingDevices: Array<{ host?: string; name?: string; id?: string }>,
  newHost: string,
  discoveredName: string,
  discoveredId?: string,
  discoveredAddresses?: string[]
): { host?: string; name?: string; id?: string } | undefined {
  // 1. mDNS device ID — stable hardware identity, checked before URL so stale
  //    host entries for other devices at the same IP do not shadow the result.
  if (discoveredId) {
    const byId = existingDevices.find((d) => d.id === discoveredId);
    if (byId) {
      return byId;
    }
  }

  // 2. Exact URL match
  const byHost = existingDevices.find((d) => d.host === newHost);
  if (byHost) {
    return byHost;
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

  // 4. IP address match — handles IP ↔ .local migration for pre-id configs.
  //    If the discovered device reports one or more resolved IP addresses and
  //    a stored entry's host URL contains one of those IPs, treat them as the
  //    same device. Only matches entries without a stored id so that a device
  //    that has already been correlated by identity cannot be shadowed here.
  if (discoveredAddresses && discoveredAddresses.length > 0) {
    const byAddress = existingDevices.find((d) => {
      if (d.id) {
        return false; // already handled by the id check above
      }
      try {
        const storedIp = new URL(d.host || '').hostname;
        return discoveredAddresses.includes(storedIp);
      } catch {
        return false;
      }
    });
    if (byAddress) {
      return byAddress;
    }
  }

  // 5. TXT-name match (fallback for entries without a stored id)
  if (discoveredName) {
    return existingDevices.find((d) => d.name === discoveredName);
  }

  return undefined;
}
