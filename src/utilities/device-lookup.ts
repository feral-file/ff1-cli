/**
 * Find an existing configured device that corresponds to a newly discovered host.
 *
 * Tries, in order:
 *  1. Exact URL match (the normal case).
 *  2. mDNS hostname match — covers the scenario where the stored entry used an IP
 *     address but the device is now discovered via its .local mDNS name, or vice
 *     versa. Both URLs are parsed; only the hostname component is compared so that
 *     port differences do not prevent a match.
 *  3. TXT-name match — if the device advertises a name (e.g. "kitchen") and a
 *     stored entry has that same friendly name, treat them as the same device.
 *     Handles the case where the host representation changed and the operator has
 *     not manually renamed the device in config.
 *
 * Returns the matched entry so callers can preserve the stored friendly name as
 * the default when prompting, rather than falling back to the raw mDNS label.
 */
export function findExistingDeviceEntry(
  existingDevices: Array<{ host?: string; name?: string }>,
  newHost: string,
  discoveredName: string
): { host?: string; name?: string } | undefined {
  // 1. Exact URL match
  const byHost = existingDevices.find((d) => d.host === newHost);
  if (byHost) {
    return byHost;
  }

  // 2. mDNS hostname match (ignores port and protocol differences)
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

  // 3. TXT-name match
  if (discoveredName) {
    return existingDevices.find((d) => d.name === discoveredName);
  }

  return undefined;
}
