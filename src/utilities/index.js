/**
 * Utilities - Actual function implementations
 * Contains the real logic for querying NFTs and building playlists
 */

const chalk = require('chalk');
const nftIndexer = require('./nft-indexer');
const feedFetcher = require('./feed-fetcher');
const playlistBuilder = require('./playlist-builder');
const functions = require('./functions');
const domainResolver = require('./domain-resolver');

/**
 * Query tokens from an owner address
 *
 * Fetches all tokens owned by an address, with optional random selection.
 * If no tokens found, triggers indexing workflow.
 *
 * @param {string} ownerAddress - Owner wallet address
 * @param {number} [quantity] - Number of random tokens to select (all if not specified)
 * @param {number} duration - Duration per item in seconds
 * @returns {Promise<Array>} Array of DP1 playlist items
 */
async function queryTokensByAddress(ownerAddress, quantity, duration = 10) {
  try {
    // Query tokens by owner
    const result = await nftIndexer.queryTokensByOwner(ownerAddress, 100);

    if (!result.success) {
      console.log(chalk.yellow(`   Could not fetch tokens. Indexing this address...`));

      // Trigger indexing workflow
      const indexResult = await nftIndexer.triggerAddressIndexing(ownerAddress, false);

      if (indexResult.success) {
        console.log(chalk.yellow(`   Started indexing. Please try again in a moment.`));
      } else {
        console.log(chalk.red(`   Could not start indexing: ${indexResult.error}`));
      }

      return [];
    }

    if (result.tokens.length === 0) {
      console.log(chalk.yellow(`   No tokens found. Starting indexing...`));

      // Trigger indexing workflow
      const indexResult = await nftIndexer.triggerAddressIndexing(ownerAddress, false);

      if (indexResult.success) {
        console.log(chalk.yellow(`   Started indexing. Please try again in a moment.`));
      } else {
        console.log(chalk.red(`   Could not start indexing: ${indexResult.error}`));
      }

      return [];
    }

    let selectedTokens = result.tokens;

    // Apply quantity limit with random selection
    if (quantity && selectedTokens.length > quantity) {
      selectedTokens = shuffleArray([...selectedTokens]).slice(0, quantity);
    }

    console.log(chalk.grey(`✓ Got ${selectedTokens.length} token(s)`));

    // Convert tokens to DP1 items
    const items = [];
    for (const token of selectedTokens) {
      // Detect blockchain from contract address
      let chain = 'ethereum';
      if (token.contractAddress.startsWith('KT')) {
        chain = 'tezos';
      }

      // Map indexer token data to standard format
      const tokenData = nftIndexer.mapIndexerDataToStandardFormat(token, chain);

      if (tokenData.success) {
        const dp1Result = nftIndexer.convertToDP1Item(tokenData, duration);
        if (dp1Result.success && dp1Result.item) {
          items.push(dp1Result.item);
        }
      }
    }

    return items;
  } catch (error) {
    console.error(chalk.red(`   Error: ${error.message}\n`));
    throw error;
  }
}

/**
 * Query data for a single requirement (handles build_playlist, fetch_feed, and query_address)
 *
 * @param {Object} requirement - Requirement object
 * @param {string} requirement.type - Requirement type (build_playlist, fetch_feed, or query_address)
 * @param {string} [requirement.blockchain] - Blockchain network (for build_playlist)
 * @param {string} [requirement.contractAddress] - Contract address (for build_playlist)
 * @param {Array<string>} [requirement.tokenIds] - Token IDs (for build_playlist)
 * @param {string} [requirement.ownerAddress] - Owner address (for query_address)
 * @param {string} [requirement.playlistName] - Feed playlist name (for fetch_feed)
 * @param {number} [requirement.quantity] - Number of items
 * @param {number} duration - Duration per item in seconds
 * @returns {Promise<Array>} Array of DP1 playlist items
 */
async function queryRequirement(requirement, duration = 10) {
  const { type, blockchain, contractAddress, tokenIds, ownerAddress, playlistName, quantity } =
    requirement;

  // Handle query_address type
  if (type === 'query_address') {
    // Check if ownerAddress is a domain name (.eth or .tez)
    if (ownerAddress && (ownerAddress.endsWith('.eth') || ownerAddress.endsWith('.tez'))) {
      console.log(chalk.cyan(`\nResolving domain ${ownerAddress}...`));

      const resolution = await domainResolver.resolveDomain(ownerAddress);

      if (resolution.resolved && resolution.address) {
        console.log(chalk.gray(`  ${resolution.domain} → ${resolution.address}`));
        // Use resolved address instead of domain
        return await queryTokensByAddress(resolution.address, quantity, duration);
      } else {
        console.log(
          chalk.red(
            `  Could not resolve domain ${ownerAddress}: ${resolution.error || 'Unknown error'}`
          )
        );
        return [];
      }
    } else {
      return await queryTokensByAddress(ownerAddress, quantity, duration);
    }
  }

  // Handle fetch_feed type
  if (type === 'fetch_feed') {
    console.log(chalk.cyan(`Getting items from "${playlistName}"...`));

    const result = await feedFetcher.fetchFeedPlaylistDirect(playlistName, quantity, duration);

    if (result.success && result.items) {
      return result.items;
    } else {
      console.log(
        chalk.yellow(`   Could not fetch playlist: ${result.error || 'No items found'}\n`)
      );
      return [];
    }
  }

  // Handle build_playlist type (original NFT querying logic)

  console.log(
    chalk.cyan(
      `Querying ${blockchain}${contractAddress ? ' (' + contractAddress.substring(0, 10) + '...)' : ''}...`
    )
  );

  let items = [];

  try {
    // Handle different blockchain types
    if (blockchain.toLowerCase() === 'tezos') {
      // Tezos NFTs
      if (tokenIds && tokenIds.length > 0) {
        const tokens = tokenIds.map((tokenId) => ({
          chain: 'tezos',
          contractAddress,
          tokenId,
        }));
        items = await nftIndexer.getNFTTokenInfoBatch(tokens, duration);
      } else {
        console.log(chalk.yellow('   No token IDs specified'));
      }
    } else if (blockchain.toLowerCase() === 'ethereum' || blockchain.toLowerCase() === 'eth') {
      // Ethereum NFTs (including Art Blocks, Feral File, etc.)
      if (contractAddress && tokenIds && tokenIds.length > 0) {
        const tokens = tokenIds.map((tokenId) => ({
          chain: 'ethereum',
          contractAddress,
          tokenId,
        }));
        items = await nftIndexer.getNFTTokenInfoBatch(tokens, duration);
      } else {
        console.log(chalk.yellow('   Contract address and token IDs required'));
      }
    } else {
      console.log(chalk.yellow(`   Unsupported blockchain: ${blockchain}`));
    }

    if (items.length > 0) {
      console.log(chalk.green(`✓ Got ${items.length} item(s)`));
    } else {
      console.log(chalk.yellow(`   No items found`));
    }

    // Apply quantity limit
    if (quantity && items.length > quantity) {
      items = items.slice(0, quantity);
    }
  } catch (error) {
    console.error(chalk.red(`   Error: ${error.message}\n`));
    throw error;
  }

  return items;
}

/**
 * Build DP1 playlist from items
 *
 * Uses the core playlist-builder utility to create a DP1 v1.0.0 compliant playlist.
 *
 * @param {Array<Object>} items - Array of DP1 playlist items
 * @param {string} [title] - Playlist title
 * @param {string} [slug] - Playlist slug
 * @returns {Promise<Object>} DP1 playlist
 * @example
 * const playlist = await buildDP1Playlist(items, 'My Playlist', 'my-playlist');
 */
async function buildDP1Playlist(items, title, slug) {
  return await playlistBuilder.buildDP1Playlist({ items, title, slug });
}

/**
 * Send playlist to FF1 device
 *
 * @param {Object} playlist - DP1 playlist
 * @param {string} [deviceName] - Device name
 * @returns {Promise<Object>} Result
 */
async function sendToDevice(playlist, deviceName) {
  const { sendPlaylistToDevice } = require('./functions');
  return await sendPlaylistToDevice({ playlist, deviceName });
}

/**
 * Shuffle array using Fisher-Yates algorithm
 *
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Build playlist directly from requirements (deterministic, no AI)
 *
 * @param {Object} params - Playlist parameters
 * @param {Array<Object>} params.requirements - Array of requirements
 * @param {Object} params.playlistSettings - Playlist settings
 * @param {Object} options - Build options
 * @param {boolean} [options.verbose] - Verbose output
 * @param {string} [options.outputPath] - Output file path
 * @returns {Promise<Object>} Result with playlist
 */
async function buildPlaylistDirect(params, options = {}) {
  const { requirements, playlistSettings } = params;
  const { verbose = false, outputPath = 'playlist.json' } = options;

  const allItems = [];
  const duration = playlistSettings.durationPerItem || 10;

  console.log(chalk.cyan('\nBuilding playlist from your requirements...\n'));

  // Process each requirement
  for (let i = 0; i < requirements.length; i++) {
    const requirement = requirements[i];
    const reqNum = i + 1;

    console.log(
      chalk.cyan(`[${reqNum}/${requirements.length}] ${requirement.blockchain || 'Source'}`)
    );

    try {
      const items = await queryRequirement(requirement, duration);
      allItems.push(...items);
    } catch (error) {
      console.error(chalk.red(`   ✗ Failed: ${error.message}`));
      if (verbose) {
        console.error(chalk.gray(error.stack));
      }
    }
  }

  if (allItems.length === 0) {
    throw new Error('No items collected from any requirement');
  }

  // Apply ordering
  let finalItems = allItems;
  if (!playlistSettings.preserveOrder) {
    console.log(chalk.cyan('Shuffling items...'));
    finalItems = shuffleArray([...allItems]);
  }

  console.log(chalk.cyan(`Creating playlist with ${finalItems.length} items...`));

  // Build DP1 playlist
  const playlist = await buildDP1Playlist(
    finalItems,
    playlistSettings.title,
    playlistSettings.slug
  );

  // Save playlist to file
  const { savePlaylist } = require('../utils');
  const savedPath = await savePlaylist(playlist, outputPath);
  console.log(chalk.green(`✓ Playlist ready: ${savedPath}`));

  // Send to device if requested
  if (playlistSettings.deviceName !== undefined) {
    console.log(chalk.cyan('\nSending to device...'));
    await sendToDevice(playlist, playlistSettings.deviceName);
  }

  // Publish to feed server if requested
  let publishResult = null;
  if (playlistSettings.feedServer) {
    console.log(chalk.cyan('\nPublishing to feed server...'));
    try {
      const { publishPlaylist } = require('./playlist-publisher');
      publishResult = await publishPlaylist(
        savedPath,
        playlistSettings.feedServer.baseUrl,
        playlistSettings.feedServer.apiKey
      );

      if (publishResult.success) {
        console.log(chalk.green(`✓ Published to feed server`));
        if (publishResult.playlistId) {
          console.log(chalk.gray(`   Playlist ID: ${publishResult.playlistId}`));
        }
        if (publishResult.feedServer) {
          console.log(chalk.gray(`   Server: ${publishResult.feedServer}`));
        }
      } else {
        console.error(chalk.red(`✗ Failed to publish: ${publishResult.error}`));
        if (publishResult.message) {
          console.error(chalk.gray(`   ${publishResult.message}`));
        }
      }
    } catch (error) {
      console.error(chalk.red(`✗ Failed to publish: ${error.message}`));
      if (verbose) {
        console.error(chalk.gray(error.stack));
      }
    }
  }

  return {
    playlist,
    published: publishResult?.success || false,
    publishResult,
  };
}

module.exports = {
  queryRequirement,
  queryTokensByAddress,
  buildDP1Playlist,
  sendToDevice,
  resolveDomains: functions.resolveDomains,
  shuffleArray,
  buildPlaylistDirect,
  feedFetcher,
  // Export core playlist builder utilities
  playlistBuilder,
};
