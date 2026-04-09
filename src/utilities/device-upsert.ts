export interface DeviceEntry {
  host: string;
  name?: string;
  /** mDNS device ID (e.g. 'ff1-hh9jsnoc'). Stored so host-change lookups can match by ID. */
  id?: string;
  apiKey?: string;
  topicID?: string;
  /** Resolved IP addresses last observed for this device. Stored so --host <ip> can match
   *  an existing .local entry without requiring a new mDNS scan. */
  addresses?: string[];
}

/**
 * Strip undefined values from an object so spreads do not overwrite existing
 * keys with undefined (e.g. when a caller passes id: undefined because the
 * device was discovered without an ID).
 */
function withoutUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Insert or update a device in the configured device list.
 *
 * Priority:
 * 1. Same mDNS device ID → update in-place (preserves position, handles host change).
 * 2. Same host → update in-place (preserves position and metadata).
 * 3. Same name, different host → replace in-place (preserves position so that
 *    devices[0] — the implicit default for play/send/ssh — does not silently change).
 * 4. Neither match → append.
 */
export function upsertDevice(
  existingDevices: DeviceEntry[],
  newDevice: {
    name: string;
    host: string;
    id?: string;
    apiKey?: string;
    topicID?: string;
    addresses?: string[];
  }
): { devices: DeviceEntry[]; updated: boolean } {
  const devices = [...existingDevices];
  const patch = withoutUndefined(newDevice);

  // Case 1: same mDNS device ID — update in-place even when host changed.
  if (newDevice.id) {
    const sameIdIndex = devices.findIndex((d) => d.id === newDevice.id);
    if (sameIdIndex !== -1) {
      const isSameHost = devices[sameIdIndex].host === newDevice.host;
      devices[sameIdIndex] = { ...devices[sameIdIndex], ...patch };
      return { devices, updated: isSameHost };
    }
  }

  // Case 2: same host — update in-place
  const sameHostIndex = devices.findIndex((d) => d.host === newDevice.host);
  if (sameHostIndex !== -1) {
    devices[sameHostIndex] = { ...devices[sameHostIndex], ...patch };
    return { devices, updated: true };
  }

  // Case 3: same name, different host — replace in-place to preserve array order.
  // Spread existing entry first so apiKey/topicID survive a host change.
  const staleNameIndex = devices.findIndex((d) => d.name === newDevice.name);
  if (staleNameIndex !== -1) {
    devices[staleNameIndex] = { ...devices[staleNameIndex], ...patch };
    return { devices, updated: false };
  }

  // Case 4: new device
  devices.push({ ...patch } as DeviceEntry);
  return { devices, updated: false };
}
