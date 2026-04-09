export interface DeviceEntry {
  host: string;
  name?: string;
  /** mDNS device ID (e.g. 'ff1-hh9jsnoc'). Stored so host-change lookups can match by ID. */
  id?: string;
  apiKey?: string;
  topicID?: string;
}

/**
 * Insert or update a device in the configured device list.
 *
 * Priority:
 * 1. Same host → update in-place (preserves position and metadata).
 * 2. Same name, different host → replace in-place (preserves position so that
 *    devices[0] — the implicit default for play/send/ssh — does not silently change).
 * 3. Neither match → append.
 */
export function upsertDevice(
  existingDevices: DeviceEntry[],
  newDevice: { name: string; host: string; id?: string; apiKey?: string; topicID?: string }
): { devices: DeviceEntry[]; updated: boolean } {
  const devices = [...existingDevices];

  // Case 1: same host — update in-place
  const sameHostIndex = devices.findIndex((d) => d.host === newDevice.host);
  if (sameHostIndex !== -1) {
    devices[sameHostIndex] = { ...devices[sameHostIndex], ...newDevice };
    return { devices, updated: true };
  }

  // Case 2: same name, different host — replace in-place to preserve array order.
  // Spread existing entry first so apiKey/topicID survive a host change.
  const staleNameIndex = devices.findIndex((d) => d.name === newDevice.name);
  if (staleNameIndex !== -1) {
    devices[staleNameIndex] = { ...devices[staleNameIndex], ...newDevice };
    return { devices, updated: false };
  }

  // Case 3: new device
  devices.push({ ...newDevice });
  return { devices, updated: false };
}
