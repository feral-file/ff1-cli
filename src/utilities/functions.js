/**
 * Function Calling Layer
 * These are the actual implementations called by AI orchestrator via function calling
 */

const chalk = require('chalk');
const playlistBuilder = require('./playlist-builder');
const ff1Device = require('./ff1-device');
const domainResolver = require('./domain-resolver');

/**
 * Build DP1 v1.0.0 compliant playlist
 *
 * This is the actual implementation called by AI orchestrator's function calling.
 * Uses core playlist-builder utilities.
 *
 * @param {Object} params - Build parameters
 * @param {Array<Object>} params.items - Playlist items
 * @param {string} [params.title] - Playlist title (auto-generated if not provided)
 * @param {string} [params.slug] - Playlist slug (auto-generated if not provided)
 * @returns {Promise<Object>} DP1 playlist
 * @example
 * const playlist = await buildDP1Playlist({ items, title: 'My Playlist' });
 */
async function buildDP1Playlist(params) {
  const { items, title, slug } = params;
  return await playlistBuilder.buildDP1Playlist({ items, title, slug });
}

/**
 * Send playlist to FF1 device
 *
 * This is the actual implementation called by AI orchestrator's function calling.
 *
 * @param {Object} params - Send parameters
 * @param {Object} params.playlist - DP1 playlist
 * @param {string} [params.deviceName] - Device name (null for first device)
 * @returns {Promise<Object>} Result
 * @returns {boolean} returns.success - Whether send succeeded
 * @returns {string} [returns.deviceHost] - Device host address
 * @returns {string} [returns.deviceName] - Device name
 * @returns {string} [returns.error] - Error message if failed
 * @example
 * const result = await sendPlaylistToDevice({ playlist, deviceName: 'MyDevice' });
 */
async function sendPlaylistToDevice(params) {
  const { playlist, deviceName } = params;

  const result = await ff1Device.sendPlaylistToDevice({
    playlist,
    deviceName,
  });

  if (result.success) {
    console.log(chalk.green('\n✓ Sent to device'));
    if (result.deviceName) {
      console.log(chalk.gray(`  ${result.deviceName}`));
    }
  } else {
    console.error(chalk.red('\n✗ Could not send to device'));
    if (result.error) {
      console.error(chalk.red(`  ${result.error}`));
    }
  }

  return result;
}

/**
 * Resolve blockchain domain names to addresses
 *
 * This is the actual implementation called by AI orchestrator's function calling.
 * Supports ENS (.eth) and TNS (.tez) domains with batch resolution.
 *
 * @param {Object} params - Resolution parameters
 * @param {Array<string>} params.domains - Array of domain names to resolve
 * @param {boolean} [params.displayResults] - Whether to display results (default: true)
 * @returns {Promise<Object>} Resolution result
 * @returns {boolean} returns.success - Whether at least one domain was resolved
 * @returns {Object} returns.domainMap - Map of domain to resolved address
 * @returns {Array<Object>} returns.resolutions - Detailed resolution results
 * @returns {Array<string>} returns.errors - Array of error messages
 * @example
 * const result = await resolveDomains({ domains: ['vitalik.eth', 'alice.tez'] });
 * console.log(result.domainMap); // { 'vitalik.eth': '0x...', 'alice.tez': 'tz...' }
 */
async function resolveDomains(params) {
  const { domains, displayResults = true } = params;

  if (!domains || !Array.isArray(domains) || domains.length === 0) {
    const error = 'No domains provided for resolution';
    console.error(chalk.red(`\n✗ ${error}`));
    return {
      success: false,
      domainMap: {},
      resolutions: [],
      errors: [error],
    };
  }

  const result = await domainResolver.resolveDomainsBatch(domains);

  if (displayResults) {
    domainResolver.displayResolutionResults(result);
  }

  return result;
}

/**
 * Verify a playlist against DP-1 specification
 *
 * This is the actual implementation called by AI orchestrator's function calling.
 * Uses dp1-js library for standards-compliant validation. Must be called before
 * sending a playlist to a device.
 *
 * @param {Object} params - Verification parameters
 * @param {Object} params.playlist - Playlist object to verify
 * @returns {Promise<Object>} Verification result
 * @returns {boolean} returns.valid - Whether playlist is valid
 * @returns {string} [returns.error] - Error message if invalid
 * @returns {Array<Object>} [returns.details] - Detailed validation errors
 * @example
 * const result = await verifyPlaylist({ playlist });
 * if (result.valid) {
 *   console.log('Playlist is valid');
 * } else {
 *   console.error('Invalid:', result.error);
 * }
 */
async function verifyPlaylist(params) {
  const { playlist } = params;

  if (!playlist) {
    return {
      valid: false,
      error: 'No playlist provided for verification',
    };
  }

  console.log(chalk.cyan('\nValidating playlist...'));

  // Dynamic import to avoid circular dependency
  const playlistVerifier = await import('./playlist-verifier');
  const verify =
    playlistVerifier.verifyPlaylist ||
    (playlistVerifier.default && playlistVerifier.default.verifyPlaylist) ||
    playlistVerifier.default;

  if (typeof verify !== 'function') {
    return {
      valid: false,
      error: 'Playlist verifier is not available',
    };
  }

  const result = verify(playlist);

  if (result.valid) {
    console.log(chalk.green('✓ Playlist looks good'));
    if (playlist.title) {
      console.log(chalk.gray(`  Title: ${playlist.title}`));
    }
    if (playlist.items) {
      console.log(chalk.gray(`  Items: ${playlist.items.length}`));
    }
    console.log();
  } else {
    console.error(chalk.red('✗ Playlist has issues'));
    console.error(chalk.red(`  ${result.error}`));
    if (result.details && result.details.length > 0) {
      console.log(chalk.yellow('\n  Missing or invalid fields:'));
      result.details.forEach((detail) => {
        console.log(chalk.yellow(`    • ${detail.path}: ${detail.message}`));
      });
    }
    console.log();
  }

  return result;
}

/**
 * Verify and validate Ethereum and Tezos addresses
 *
 * This function is called by the intent parser to validate addresses entered by users.
 * It provides detailed feedback on address validity and format issues.
 *
 * @param {Object} params - Verification parameters
 * @param {Array<string>} params.addresses - Array of addresses to verify
 * @returns {Promise<Object>} Verification result
 * @returns {boolean} returns.valid - Whether all addresses are valid
 * @returns {Array<Object>} returns.results - Detailed validation for each address
 * @returns {Array<string>} returns.errors - List of validation errors
 * @example
 * const result = await verifyAddresses({
 *   addresses: ['0x1234567890123456789012345678901234567890', 'tz1VSUr8wwNhLAzempoch5d6hLKEUNvD14']
 * });
 * if (!result.valid) {
 *   result.errors.forEach(err => console.error(err));
 * }
 */
async function verifyAddresses(params) {
  const { addresses } = params;

  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
    return {
      valid: false,
      results: [],
      errors: ['No addresses provided for verification'],
    };
  }

  // Dynamic import to avoid circular dependency
  const addressValidator = await import('./address-validator');
  const validateAddresses =
    addressValidator.validateAddresses ||
    (addressValidator.default && addressValidator.default.validateAddresses) ||
    addressValidator.default;

  if (typeof validateAddresses !== 'function') {
    return {
      valid: false,
      results: [],
      errors: ['Address validator is not available'],
    };
  }

  const result = validateAddresses(addresses);

  // Display results
  if (result.valid) {
    console.log(chalk.green('\n✓ All addresses are valid'));
    result.results.forEach((r) => {
      const typeLabel =
        r.type === 'ethereum'
          ? 'Ethereum'
          : r.type === 'ens'
            ? 'ENS Domain'
            : r.type === 'tezos-domain'
              ? 'Tezos Domain'
              : r.type === 'contract'
                ? 'Tezos Contract'
                : 'Tezos User';
      console.log(chalk.gray(`  • ${r.address} (${typeLabel})`));
      if (r.normalized) {
        console.log(chalk.gray(`    Checksummed: ${r.normalized}`));
      }
    });
    console.log();
  } else {
    console.error(chalk.red('\n✗ Address validation failed'));
    result.errors.forEach((err) => {
      console.error(chalk.red(`  • ${err}`));
    });
    console.log();
  }

  return result;
}

/**
 * Get list of configured FF1 devices
 *
 * This function retrieves the list of all configured FF1 devices from config.
 * Called by intent parser to resolve generic device references like "FF1", "my device".
 *
 * @returns {Promise<Object>} Device list result
 * @returns {boolean} returns.success - Whether devices were retrieved
 * @returns {Array<Object>} returns.devices - Array of device configurations
 * @returns {string} returns.devices[].name - Device name
 * @returns {string} returns.devices[].host - Device host URL
 * @returns {string} [returns.devices[].topicID] - Optional topic ID
 * @returns {string} [returns.error] - Error message if no devices configured
 * @example
 * const result = await getConfiguredDevices();
 * if (result.success && result.devices.length > 0) {
 *   const firstDevice = result.devices[0].name;
 * }
 */
async function getConfiguredDevices() {
  const { getFF1DeviceConfig } = await import('../config');
  const deviceConfig = getFF1DeviceConfig();

  if (!deviceConfig.devices || deviceConfig.devices.length === 0) {
    return {
      success: false,
      devices: [],
      error: 'No FF1 devices configured',
    };
  }

  // Return sanitized device list (without API keys)
  const devices = deviceConfig.devices.map((d) => ({
    name: d.name || d.host,
    host: d.host,
    topicID: d.topicID,
  }));

  return {
    success: true,
    devices,
  };
}

module.exports = {
  buildDP1Playlist,
  sendPlaylistToDevice,
  resolveDomains,
  verifyPlaylist,
  getConfiguredDevices,
  verifyAddresses,
};
