export interface DeviceEntry {
  host: string;
  name?: string;
  apiKey?: string;
  topicID?: string;
}

/**
 * Insert or update a device in the configured device list.
 * Deduplicates by host (updates in-place) and by name (removes stale entry
 * with same name but different host before inserting).
 */
export function upsertDevice(
  existingDevices: DeviceEntry[],
  newDevice: { name: string; host: string; apiKey?: string; topicID?: string }
): { devices: DeviceEntry[]; updated: boolean } {
  const existingIndex = existingDevices.findIndex((d) => d.host === newDevice.host);
  let devices = [...existingDevices];
  if (existingIndex !== -1) {
    devices[existingIndex] = {
      ...devices[existingIndex],
      ...newDevice,
    };
    return { devices, updated: true };
  }
  // Remove any stale entry with the same name but a different host
  devices = devices.filter((d) => d.name !== newDevice.name);
  devices.push({ ...newDevice });
  return { devices, updated: false };
}
