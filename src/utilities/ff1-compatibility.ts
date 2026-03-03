/**
 * FF1 device compatibility helpers for command preflight checks.
 */

import { getFF1DeviceConfig } from '../config';
import type { FF1Device, FF1DeviceConfig } from '../types';
import * as logger from '../logger';

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

interface FF1CommandPolicy {
  minimumVersion: string;
}

export type FF1Command = 'displayPlaylist' | 'sshAccess';

interface FF1DeviceSelectionResult {
  success: boolean;
  device?: FF1Device;
  error?: string;
}

interface ResolveDeviceOptions {
  getFF1DeviceConfigFn?: () => FF1DeviceConfig;
}

interface CompatibilityCheckOptions {
  fetchFn?: FetchFunction;
}

interface FF1VersionProbe {
  version: string;
  source: string;
}

export interface FF1CompatibilityResult {
  compatible: boolean;
  error?: string;
  version?: string;
  source?: string;
}

const FF1_COMMAND_POLICIES: Record<FF1Command, FF1CommandPolicy> = {
  displayPlaylist: {
    minimumVersion: '1.0.0',
  },
  sshAccess: {
    minimumVersion: '1.0.0',
  },
};

const VERSION_ENDPOINTS = ['/api/version', '/api/info', '/api/status'];

const VERSION_COMMAND = 'version';

/**
 * Load and validate the configured FF1 device selected by name.
 *
 * @param {string} [deviceName] - Optional device name, exact match required
 * @param {Object} [options] - Optional dependency overrides
 * @param {Function} [options.getFF1DeviceConfigFn] - Optional config loader override
 * @returns {FF1DeviceSelectionResult} Selected device or reason for failure
 * @throws {Error} Never throws; malformed configuration is returned as an error result
 * @example
 * const result = resolveConfiguredDevice('Living Room');
 */
export function resolveConfiguredDevice(
  deviceName?: string,
  options: ResolveDeviceOptions = {}
): FF1DeviceSelectionResult {
  const getFF1DeviceConfigFn = options.getFF1DeviceConfigFn || getFF1DeviceConfig;
  const deviceConfig = getFF1DeviceConfigFn();

  if (!deviceConfig.devices || deviceConfig.devices.length === 0) {
    return {
      success: false,
      error: 'No FF1 devices configured. Add devices to config.json under "ff1Devices"',
    };
  }

  let device = deviceConfig.devices[0];

  if (deviceName) {
    device = deviceConfig.devices.find((item) => item.name === deviceName) as FF1Device | undefined;
    if (!device) {
      const availableNames = deviceConfig.devices
        .map((item) => item.name)
        .filter(Boolean)
        .join(', ');
      return {
        success: false,
        error: `Device "${deviceName}" not found. Available devices: ${availableNames || 'none with names'}`,
      };
    }
    logger.info(`Found device by name: ${deviceName}`);
  } else {
    logger.info('Using first configured device');
  }

  if (!device.host) {
    return {
      success: false,
      error: 'Invalid device configuration: must include host',
    };
  }

  return {
    success: true,
    device,
  };
}

/**
 * Ensure the target device supports the requested FF1 command.
 *
 * @param {Object} device - FF1 device configuration
 * @param {FF1Command} command - Command to execute
 * @param {Object} [options] - Optional dependency overrides
 * @param {Function} [options.fetchFn] - Optional fetch implementation
 * @returns {Promise<FF1CompatibilityResult>} Compatibility result
 * @throws {Error} Never throws; network and parsing failures produce a compatible result
 * @example
 * const result = await assertFF1CommandCompatibility(device, 'displayPlaylist');
 */
export async function assertFF1CommandCompatibility(
  device: FF1Device,
  command: FF1Command,
  options: CompatibilityCheckOptions = {}
): Promise<FF1CompatibilityResult> {
  const fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
  const policy = getCommandPolicy(command);

  const versionResult = await detectFF1VersionSafely(
    device.host,
    buildVersionHeaders(device),
    fetchFn
  );
  return resolveCompatibility(device, command, policy, versionResult);
}

/**
 * Return command compatibility requirements.
 *
 * @param {FF1Command} command - Command to check
 * @returns {FF1CommandPolicy} Policy metadata
 * @example
 * getCommandPolicy('sshAccess'); // { minimumVersion: '1.0.0' }
 */
function getCommandPolicy(command: FF1Command): FF1CommandPolicy {
  return FF1_COMMAND_POLICIES[command];
}

/**
 * Detect FF1 version and recover compatibility when detection fails.
 *
 * @param {string} host - Device host URL
 * @param {Object} headers - Request headers
 * @param {Function} fetchFn - Fetch implementation
 * @returns {Promise<FF1VersionProbe | null>} Detected version metadata
 */
async function detectFF1VersionSafely(
  host: string,
  headers: Record<string, string>,
  fetchFn: FetchFunction
): Promise<FF1VersionProbe | null> {
  try {
    return await detectFF1Version(host, headers, fetchFn);
  } catch (error) {
    logger.debug('FF1 version detection failed; continuing with command', (error as Error).message);
    return null;
  }
}

/**
 * Resolve final compatibility decision from detected version and policy.
 *
 * @param {FF1Device} device - Target device
 * @param {FF1Command} command - Command requested
 * @param {FF1CommandPolicy} policy - Version policy
 * @param {FF1VersionProbe | null} versionResult - Detected version probe
 * @returns {FF1CompatibilityResult} Compatibility decision
 */
function resolveCompatibility(
  device: FF1Device,
  command: FF1Command,
  policy: FF1CommandPolicy,
  versionResult: FF1VersionProbe | null
): FF1CompatibilityResult {
  if (!versionResult) {
    logger.warn(`Could not verify FF1 OS version for ${device.name || device.host}`);
    return {
      compatible: true,
      version: undefined,
      source: undefined,
    };
  }

  const normalizedVersion = normalizeVersion(versionResult.version);
  if (!normalizedVersion) {
    return {
      compatible: true,
      version: versionResult.version,
      source: versionResult.source,
    };
  }

  if (compareVersions(normalizedVersion, policy.minimumVersion) < 0) {
    return {
      compatible: false,
      version: normalizedVersion,
      source: versionResult.source,
      error: `Unsupported FF1 OS ${normalizedVersion} for ${command}. FF1 OS must be ${policy.minimumVersion} or newer.`,
    };
  }

  return {
    compatible: true,
    version: normalizedVersion,
    source: versionResult.source,
  };
}

/**
 * Detect FF1 OS version using known version metadata endpoints.
 *
 * @param {string} host - Device host URL
 * @param {Object} headers - Headers for requests
 * @returns {Promise<FF1VersionProbe | null>} Version + source or null if unavailable
 * @throws {Error} Never throws; callers ignore probe failures
 * @example
 * const probe = await detectFF1Version('http://ff1.local:1111', {});
 */
async function detectFF1Version(
  host: string,
  headers: Record<string, string>,
  fetchFn: FetchFunction
): Promise<FF1VersionProbe | null> {
  for (const endpoint of VERSION_ENDPOINTS) {
    const result = await tryProbeVersionEndpoint(host + endpoint, headers, fetchFn);
    if (result) {
      return {
        version: result,
        source: `${endpoint}`,
      };
    }
  }

  const commandResult = await tryCastVersionCommand(host + '/api/cast', headers, fetchFn);
  if (commandResult) {
    return {
      version: commandResult,
      source: '/api/cast (command version)',
    };
  }

  return null;
}

/**
 * Probe a simple GET endpoint for version metadata.
 *
 * @param {string} url - Version URL
 * @param {Record<string, string>} headers - Headers to include
 * @returns {Promise<string | null>} Version if available
 * @example
 * const v = await tryProbeVersionEndpoint('http://ff1.local/api/version', {});
 */
async function tryProbeVersionEndpoint(
  url: string,
  headers: Record<string, string>,
  fetchFn: FetchFunction
): Promise<string | null> {
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    return extractVersion(text);
  } catch (_error) {
    return null;
  }
}

/**
 * Probe /api/cast with a version command payload.
 *
 * @param {string} url - Cast endpoint URL
 * @param {Record<string, string>} headers - Headers to include
 * @returns {Promise<string | null>} Version if returned
 * @example
 * const v = await tryCastVersionCommand('http://ff1.local/api/cast', {});
 */
async function tryCastVersionCommand(
  url: string,
  headers: Record<string, string>,
  fetchFn: FetchFunction
): Promise<string | null> {
  try {
    const commandHeaders = {
      ...headers,
      'Content-Type': 'application/json',
    };

    const response = await fetchFn(url, {
      method: 'POST',
      headers: commandHeaders,
      body: JSON.stringify({
        command: VERSION_COMMAND,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    return extractVersion(text);
  } catch (_error) {
    return null;
  }
}

/**
 * Build headers shared by cast requests.
 *
 * @param {FF1Device} device - Target device
 * @returns {Record<string, string>} Headers map
 * @example
 * const headers = buildVersionHeaders(device);
 */
function buildVersionHeaders(device: FF1Device): Record<string, string> {
  const headers: Record<string, string> = {};
  if (device.apiKey) {
    headers['API-KEY'] = device.apiKey;
  }
  return headers;
}

/**
 * Parse and normalize a version string to x.y.z format.
 *
 * @param {string} version - Raw version string
 * @returns {string | null} Normalized semver-like version
 * @example
 * normalizeVersion('v1.2') // '1.2.0'
 */
function normalizeVersion(version: string): string | null {
  const raw = version.trim();
  const match = raw.match(/(?:v)?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  const major = match[1];
  const minor = match[2];
  const patch = match[3] || '0';
  return `${major}.${minor}.${patch}`;
}

/**
 * Compare two semantic versions in x.y.z format.
 *
 * @param {string} left - First version
 * @param {string} right - Second version
 * @returns {number} 1 if left > right, -1 if left < right, 0 if equal
 * @example
 * compareVersions('1.2.1', '1.2.0'); // 1
 */
function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((value) => Number.parseInt(value, 10));
  const rightParts = right.split('.').map((value) => Number.parseInt(value, 10));

  for (let i = 0; i < 3; i++) {
    const leftPart = leftParts[i] || 0;
    const rightPart = rightParts[i] || 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

/**
 * Parse version from response text using permissive extraction.
 *
 * @param {string} text - Raw response body
 * @returns {string | null} Version string if found
 * @example
 * extractVersion('{"version":"1.2.3"}') // '1.2.3'
 */
function extractVersion(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    parsed = text;
  }

  return extractVersionFromValue(parsed);
}

/**
 * Extract a version from unknown payload shapes.
 *
 * @param {unknown} value - Payload value
 * @param {number} [depth=0] - Recursion guard depth
 * @returns {string | null} Version if detected
 * @example
 * extractVersionFromValue({ info: { version: '1.2.3' } }) // '1.2.3'
 */
function extractVersionFromValue(value: unknown, depth = 0): string | null {
  if (depth > 4) {
    return null;
  }

  if (typeof value === 'string') {
    return normalizeVersion(value);
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const obj = value as Record<string, unknown>;

  const prioritizedKeys = [
    'osVersion',
    'ff1Version',
    'ff1VersionNumber',
    'version',
    'firmware',
    'firmwareVersion',
    'fwVersion',
    'buildVersion',
    'systemVersion',
    'softwareVersion',
  ];

  for (const key of prioritizedKeys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const extracted = extractVersionFromValue(obj[key], depth + 1);
      if (extracted) {
        return extracted;
      }
    }
  }

  for (const nestedValue of Object.values(obj)) {
    const extracted = extractVersionFromValue(nestedValue, depth + 1);
    if (extracted) {
      return extracted;
    }
  }

  return null;
}
