/**
 * FF1 Device Communication Module
 * Handles sending DP1 playlists to FF1 devices via the Relayer API
 */

import { getFF1DeviceConfig } from '../config';
import * as logger from '../logger';
import type { Playlist } from '../types';

interface SendPlaylistParams {
  playlist: Playlist;
  deviceName?: string;
  intent?: 'now_display' | 'display_at_boot';
}

interface SendPlaylistResult {
  success: boolean;
  device?: string;
  deviceName?: string;
  response?: Record<string, unknown>;
  message?: string;
  error?: string;
  details?: string;
}

/**
 * Send a DP1 playlist to an FF1 device using the cast API
 *
 * This function sends the entire DP1 JSON payload to a configured FF1 device.
 * If a device name is provided, it searches for a device with that exact name.
 * If no device name is provided, it uses the first configured device.
 * The API-KEY header is only included if the device has an apiKey configured.
 *
 * @param {Object} params - Function parameters
 * @param {Object} params.playlist - Complete DP1 v1.0.0 playlist object to send
 * @param {string} [params.deviceName] - Name of the device to send to (exact match required)
 * @param {string} [params.intent] - Intent action: 'now_display' (default) or 'display_at_boot'
 * @returns {Promise<Object>} Result object
 * @returns {boolean} returns.success - Whether the cast was successful
 * @returns {string} [returns.device] - Device host that received the playlist
 * @returns {string} [returns.deviceName] - Name of the device used
 * @returns {Object} [returns.response] - Response from the device
 * @returns {string} [returns.error] - Error message if failed
 * @throws {Error} When device configuration is invalid or missing
 * @example
 * // Send to first device (immediate display)
 * const result = await sendPlaylistToDevice({
 *   playlist: { version: '1.0.0', title: 'My Collection', items: [...] }
 * });
 *
 * @example
 * // Send to specific device by name
 * const result = await sendPlaylistToDevice({
 *   playlist: { version: '1.0.0', title: 'My Collection', items: [...] },
 *   deviceName: 'Living Room Display'
 * });
 *
 * @example
 * // Set playlist to display on device boot
 * const result = await sendPlaylistToDevice({
 *   playlist: { version: '1.0.0', title: 'Boot Playlist', items: [...] },
 *   deviceName: 'Living Room Display',
 *   intent: 'display_at_boot'
 * });
 */
export async function sendPlaylistToDevice({
  playlist,
  deviceName,
  intent = 'now_display',
}: SendPlaylistParams): Promise<SendPlaylistResult> {
  try {
    // Validate input
    if (!playlist || typeof playlist !== 'object') {
      return {
        success: false,
        error: 'Invalid playlist: must provide a valid DP1 playlist object',
      };
    }

    // Get device configuration
    const deviceConfig = getFF1DeviceConfig();

    if (!deviceConfig.devices || deviceConfig.devices.length === 0) {
      return {
        success: false,
        error: 'No FF1 devices configured. Please add devices to config.json under "ff1Devices"',
      };
    }

    // Find device by name if provided, otherwise use first device
    let device;
    if (deviceName) {
      device = deviceConfig.devices.find((d) => d.name === deviceName);
      if (!device) {
        const availableNames = deviceConfig.devices
          .map((d) => d.name)
          .filter(Boolean)
          .join(', ');
        return {
          success: false,
          error: `Device "${deviceName}" not found. Available devices: ${availableNames || 'none with names'}`,
        };
      }
      logger.info(`Found device by name: ${deviceName}`);
    } else {
      device = deviceConfig.devices[0];
      logger.info('Using first configured device');
    }

    if (!device.host) {
      return {
        success: false,
        error: 'Invalid device configuration: must include host',
      };
    }

    logger.info(`Sending playlist to FF1 device: ${device.host}`);

    // Construct API URL with optional topicID
    let apiUrl = `${device.host}/api/cast`;
    if (device.topicID && device.topicID.trim() !== '') {
      apiUrl += `?topicID=${encodeURIComponent(device.topicID)}`;
      logger.debug(`Using topicID: ${device.topicID}`);
    }

    // Wrap playlist in required structure
    const requestBody = {
      command: 'displayPlaylist',
      request: {
        dp1_call: playlist,
        intent: { action: intent },
      },
    };

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add API-KEY header only if apiKey is provided
    if (device.apiKey) {
      headers['API-KEY'] = device.apiKey;
    }

    // Make the API request
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    // Check response status
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Failed to cast to device: ${response.status} ${response.statusText}`);
      logger.debug(`Error details: ${errorText}`);

      return {
        success: false,
        error: `Device returned error ${response.status}: ${response.statusText}`,
        details: errorText,
      };
    }

    // Parse response
    const responseData = (await response.json()) as Record<string, unknown>;
    logger.info('Successfully sent playlist to FF1 device');
    logger.debug(`Device response: ${JSON.stringify(responseData)}`);

    return {
      success: true,
      device: device.host,
      deviceName: device.name || device.host,
      response: responseData,
      message: 'Playlist successfully sent to FF1 device',
    };
  } catch (error) {
    logger.error(`Error sending playlist to device: ${(error as Error).message}`);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

interface SetDeviceSettingsParams {
  playlist: Playlist;
  setting: 'display_at_boot';
  deviceName?: string;
}

/**
 * Set device settings by sending a playlist with a specific intent
 *
 * This function is a convenience wrapper around sendPlaylistToDevice for setting
 * device-specific configurations. Currently supports setting the 'display_at_boot'
 * playlist, which determines what playlist the FF1 displays when it boots.
 *
 * @param {Object} params - Function parameters
 * @param {Object} params.playlist - Complete DP1 v1.0.0 playlist object
 * @param {string} params.setting - Setting to configure: 'display_at_boot'
 * @param {string} [params.deviceName] - Name of the device to configure (exact match required)
 * @returns {Promise<Object>} Result object
 * @returns {boolean} returns.success - Whether the setting was applied
 * @returns {string} [returns.device] - Device host that received the setting
 * @returns {string} [returns.deviceName] - Name of the device configured
 * @returns {Object} [returns.response] - Response from the device
 * @returns {string} [returns.error] - Error message if failed
 * @example
 * // Set boot playlist for first configured device
 * const result = await setDeviceSettings({
 *   playlist: { version: '1.0.0', title: 'Boot Display', items: [...] },
 *   setting: 'display_at_boot'
 * });
 *
 * @example
 * // Set boot playlist for specific device
 * const result = await setDeviceSettings({
 *   playlist: { version: '1.0.0', title: 'Boot Display', items: [...] },
 *   setting: 'display_at_boot',
 *   deviceName: 'Living Room Display'
 * });
 */
export async function setDeviceSettings({
  playlist,
  setting,
  deviceName,
}: SetDeviceSettingsParams): Promise<SendPlaylistResult> {
  if (setting === 'display_at_boot') {
    logger.info('Setting display_at_boot playlist for FF1 device');
    return await sendPlaylistToDevice({
      playlist,
      deviceName,
      intent: 'display_at_boot',
    });
  }

  return {
    success: false,
    error: `Unsupported setting: ${setting}`,
  };
}
