import { normalizeDeviceHost } from './device-normalize';
import type { DeviceEntry } from './device-upsert';

export interface PromoteDefaultResult {
  devices: DeviceEntry[];
  promoted: DeviceEntry;
  /** True when the target was already at index 0; callers can skip persisting. */
  alreadyDefault: boolean;
}

/**
 * Move the named device to index 0 so it becomes the implicit default.
 *
 * Matches by name (case-insensitive) or by host URL, mirroring `device remove`
 * so unnamed legacy entries can still be targeted.
 *
 * @throws {Error} When no device matches the identifier
 */
export function promoteDeviceToDefault(
  devices: DeviceEntry[],
  identifier: string
): PromoteDefaultResult {
  const normalizedArg = identifier.toLowerCase();
  let normalizedArgHost = '';
  try {
    normalizedArgHost = normalizeDeviceHost(identifier).toLowerCase();
  } catch {
    // not a valid URL — host matching will not apply
  }

  const index = devices.findIndex(
    (d) =>
      (d.name && d.name.toLowerCase() === normalizedArg) ||
      (d.host && d.host.toLowerCase() === normalizedArg) ||
      (normalizedArgHost &&
        d.host &&
        normalizeDeviceHost(d.host).toLowerCase() === normalizedArgHost)
  );

  if (index === -1) {
    throw new Error(`Device "${identifier}" not found`);
  }

  const promoted = devices[index];
  if (index === 0) {
    return { devices: [...devices], promoted, alreadyDefault: true };
  }

  const reordered = [promoted, ...devices.slice(0, index), ...devices.slice(index + 1)];
  return { devices: reordered, promoted, alreadyDefault: false };
}
