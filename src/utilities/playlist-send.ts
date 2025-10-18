import chalk from 'chalk';
import { promises as fs } from 'fs';

interface PlaylistSendConfirmation {
  success: boolean;
  filePath: string;
  fileExists: boolean;
  playlistValid: boolean;
  playlist?: Record<string, unknown>;
  deviceName?: string;
  error?: string;
  message?: string;
  needsDeviceSelection?: boolean;
  availableDevices?: Array<{ name: string; host: string }>;
}

/**
 * Get available FF1 devices from config
 *
 * @returns {Promise<Array>} Array of device objects
 */
async function getAvailableDevices(): Promise<Array<{ name: string; host: string }>> {
  try {
    const { getFF1DeviceConfig } = await import('../config');
    const deviceConfig = getFF1DeviceConfig();

    if (deviceConfig.devices && Array.isArray(deviceConfig.devices)) {
      return deviceConfig.devices
        .filter((d) => d && d.host)
        .map((d) => ({
          name: d.name || d.host,
          host: d.host,
        }));
    }
  } catch (error) {
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[DEBUG] Error loading devices: ${(error as Error).message}`));
    }
    // Silently fail if config can't be loaded
  }

  return [];
}

/**
 * Confirm playlist file path and validate the playlist
 *
 * Reads the playlist file, validates it against DP-1 spec,
 * and returns confirmation result for user review.
 *
 * @param {string} filePath - Path to playlist file
 * @param {string} [deviceName] - Device name (optional)
 * @returns {Promise<PlaylistSendConfirmation>} Validation result
 */
export async function confirmPlaylistForSending(
  filePath: string,
  deviceName?: string
): Promise<PlaylistSendConfirmation> {
  const defaultPath = './playlist.json';
  const resolvedPath = filePath || defaultPath;

  // Convert string "null" to undefined (in case model passes it literally)
  const actualDeviceName = deviceName === 'null' || deviceName === '' ? undefined : deviceName;

  if (process.env.DEBUG) {
    console.error(
      chalk.gray(
        `[DEBUG] confirmPlaylistForSending called with: filePath="${filePath}", deviceName="${deviceName}" -> "${actualDeviceName}"`
      )
    );
  }

  try {
    // Check if file exists
    console.log(chalk.cyan(`Checking playlist file: ${resolvedPath}...`));

    let _fileExists = false;
    let playlist: Record<string, unknown> | undefined;

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      playlist = JSON.parse(content);
      _fileExists = true;
      console.log(chalk.green('✓ File found'));
    } catch (error) {
      const errorMsg = (error as Error).message;
      if (errorMsg.includes('ENOENT') || errorMsg.includes('no such file')) {
        console.log(chalk.red(`✗ File not found: ${resolvedPath}`));
        return {
          success: false,
          filePath: resolvedPath,
          fileExists: false,
          playlistValid: false,
          error: `Playlist file not found at ${resolvedPath}`,
          message: `Could not find playlist file. Try:\n  • Run a playlist build first\n  • Check the file path is correct\n  • Use "send ./path/to/playlist.json"`,
        };
      }
      throw error;
    }

    if (!playlist) {
      return {
        success: false,
        filePath: resolvedPath,
        fileExists: true,
        playlistValid: false,
        error: 'Playlist file is empty',
      };
    }

    // Validate playlist structure
    console.log(chalk.cyan('Validating playlist...'));

    // Dynamic import to avoid circular dependency
    const { verifyPlaylist } = await import('./playlist-verifier');
    const verifyResult = verifyPlaylist(playlist);

    if (!verifyResult.valid) {
      console.log(chalk.red('✗ Playlist validation failed'));
      return {
        success: false,
        filePath: resolvedPath,
        fileExists: true,
        playlistValid: false,
        playlist,
        deviceName: actualDeviceName,
        error: `Playlist is invalid: ${verifyResult.error}`,
        message: `This playlist doesn't match DP-1 specification.\n\nErrors:\n${verifyResult.details?.map((d) => `  • ${d.path}: ${d.message}`).join('\n') || verifyResult.error}`,
      };
    }

    console.log(chalk.green('✓ Playlist is valid'));

    // Display confirmation details
    const itemCount = (playlist.items as unknown[])?.length || 0;
    const title = (playlist.title as string) || 'Untitled';

    // Handle device selection
    let selectedDevice = actualDeviceName;
    let needsDeviceSelection = false;
    let availableDevices: Array<{ name: string; host: string }> = [];

    if (!selectedDevice) {
      // Get available devices
      availableDevices = await getAvailableDevices();

      if (process.env.DEBUG) {
        console.error(chalk.gray(`[DEBUG] selectedDevice is null/undefined`));
        console.error(chalk.gray(`[DEBUG] Available devices found: ${availableDevices.length}`));
        availableDevices.forEach((d) => {
          console.error(chalk.gray(`[DEBUG] Device: ${d.name} (${d.host})`));
        });
      }

      if (availableDevices.length === 0) {
        return {
          success: false,
          filePath: resolvedPath,
          fileExists: true,
          playlistValid: true,
          playlist,
          error: 'No FF1 devices configured',
          message: `No FF1 devices found in your configuration.\n\nPlease add devices to your config.json:\n{\n  "devices": [{\n    "name": "Living Room",\n    "host": "192.168.1.100"\n  }]\n}`,
        };
      } else if (availableDevices.length === 1) {
        // Auto-select single device
        selectedDevice = availableDevices[0].name || availableDevices[0].host;
        console.log(chalk.cyan(`Auto-selecting device: ${selectedDevice}`));
      } else {
        // Multiple devices - need user to choose
        needsDeviceSelection = true;
      }
    }

    console.log();
    console.log(chalk.bold('Playlist Summary:'));
    console.log(chalk.gray(`  Title: ${title}`));
    console.log(chalk.gray(`  Items: ${itemCount}`));
    if (selectedDevice) {
      console.log(chalk.gray(`  Device: ${selectedDevice}`));
    } else if (availableDevices.length > 1) {
      console.log(chalk.gray(`  Device: (to be selected)`));
    }
    console.log();

    // If multiple devices, return needsDeviceSelection flag
    if (needsDeviceSelection) {
      return {
        success: false,
        filePath: resolvedPath,
        fileExists: true,
        playlistValid: true,
        playlist,
        needsDeviceSelection: true,
        availableDevices,
        error: 'Multiple devices available - please choose one',
        message: `Which device would you like to display on?\n\nAvailable devices:\n${availableDevices.map((d, i) => `  ${i + 1}. ${d.name || d.host}`).join('\n')}\n\nSay: "send to [device name]" or "send to device 1"`,
      };
    }

    return {
      success: true,
      filePath: resolvedPath,
      fileExists: true,
      playlistValid: true,
      playlist,
      deviceName: selectedDevice,
      message: `Ready to send "${title}" (${itemCount} items) to ${selectedDevice}!`,
    };
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.log(chalk.red(`✗ Error: ${errorMsg}`));

    return {
      success: false,
      filePath: resolvedPath,
      fileExists: false,
      playlistValid: false,
      error: errorMsg,
    };
  }
}
