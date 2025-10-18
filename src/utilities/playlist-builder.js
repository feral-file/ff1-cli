/**
 * Playlist Builder Utilities
 * Core functions for building and validating DP1 playlists
 */

const { getPlaylistConfig } = require('../config');
const { signPlaylist } = require('./playlist-signer');

/**
 * Convert single NFT token info to DP1 playlist item
 *
 * @param {Object} tokenInfo - Token information from NFT indexer
 * @param {number} duration - Display duration in seconds
 * @returns {Object} DP1 playlist item
 * @throws {Error} When token data is missing
 * @example
 * const item = convertTokenToDP1ItemSingle(tokenInfo, 10);
 * // Returns: { title, source, duration, license, provenance, ... }
 */
function convertTokenToDP1ItemSingle(tokenInfo, duration = 10) {
  const { token } = tokenInfo;

  if (!token) {
    throw new Error('Invalid token info: missing token data');
  }

  // Determine the content source URL (prefer animation_url for dynamic content)
  const sourceUrl =
    token.animation_url || token.animationUrl || token.image?.url || token.image || '';

  // Map chain to DP1 format
  const chainMap = {
    ethereum: 'evm',
    polygon: 'evm',
    arbitrum: 'evm',
    optimism: 'evm',
    base: 'evm',
    tezos: 'tezos',
    bitmark: 'bitmark',
  };
  const chain = chainMap[token.chain?.toLowerCase()] || 'other';

  // Map token standard to DP1 format
  const standardMap = {
    erc721: 'erc721',
    erc1155: 'erc1155',
    fa2: 'fa2',
  };
  const standard = standardMap[token.standard?.toLowerCase()] || 'other';

  // Generate unique ID for the item (UUID v4 format)
  const crypto = require('crypto');
  const itemId = crypto.randomUUID();

  // Build DP1 item structure according to OpenAPI spec
  const dp1Item = {
    id: itemId,
    title: token.name || `Token #${token.tokenId}`,
    source: sourceUrl,
    duration: duration,
    license: 'token', // NFTs are token-gated by default
    created: new Date().toISOString(),
    provenance: {
      type: 'onChain',
      contract: {
        chain: chain,
        standard: standard,
        address: token.contractAddress,
        tokenId: String(token.tokenId),
      },
    },
  };

  // Add display preferences if available
  dp1Item.display = {
    scaling: 'fit',
    background: '#111',
    margin: '5%',
  };

  // Add metadata URI if available
  if (token.metadata?.uri || token.tokenURI) {
    dp1Item.provenance.contract.uri = token.metadata?.uri || token.tokenURI;
  }

  // Add reference to image if animation_url was used as source
  if ((token.animation_url || token.animationUrl) && (token.image?.url || token.image)) {
    dp1Item.ref = token.image?.url || token.image;
  }

  return dp1Item;
}

/**
 * Convert NFT token info(s) to DP1 playlist item(s)
 *
 * Handles both single token objects and maps/arrays of tokens.
 * For collections, returns a map of token key to DP1 item.
 *
 * @param {Object|Array} tokenInfo - Token information (single object or map of tokens)
 * @param {number} duration - Display duration in seconds
 * @returns {Object} Map of token key to DP1 playlist item, or single item
 * @example
 * // Single token
 * const item = convertTokenToDP1Item(tokenInfo, 10);
 *
 * // Multiple tokens
 * const items = convertTokenToDP1Item({ token1: info1, token2: info2 }, 10);
 */
function convertTokenToDP1Item(tokenInfo, duration = 10) {
  // Handle array or map of tokens
  if (typeof tokenInfo === 'object' && !tokenInfo.token) {
    const results = {};
    Object.entries(tokenInfo).forEach(([key, info]) => {
      if (info.success !== false && info.token) {
        results[key] = convertTokenToDP1ItemSingle(info, duration);
      } else {
        results[key] = {
          success: false,
          error: info.error || 'Invalid token info',
        };
      }
    });
    return results;
  }

  // Handle single token (backward compatibility)
  return convertTokenToDP1ItemSingle(tokenInfo, duration);
}

/**
 * Convert multiple tokens to DP1 playlist items
 *
 * Filters out failed tokens and converts successful ones.
 *
 * @param {Array} tokensInfo - Array of token information
 * @param {number} duration - Display duration in seconds
 * @returns {Array} Array of DP1 playlist items
 * @example
 * const items = convertTokensToDP1Items(tokensInfoArray, 10);
 */
function convertTokensToDP1Items(tokensInfo, duration = 10) {
  return tokensInfo
    .filter((info) => info.success && info.token)
    .map((info) => convertTokenToDP1Item(info, duration));
}

/**
 * Generate a descriptive playlist title from items
 *
 * Analyzes items to determine if it's an NFT playlist and generates
 * an appropriate title based on the collection structure.
 *
 * @param {Array} items - Array of DP1 items
 * @returns {string} Generated title
 * @example
 * const title = generatePlaylistTitle(items);
 * // Returns: "NFT Collection Playlist" or "Multi-Collection NFT Playlist"
 */
function generatePlaylistTitle(items) {
  if (!items || items.length === 0) {
    return 'DP1 Playlist';
  }

  // Check if all items have provenance (likely NFT playlist)
  const hasProvenance = items.some((item) => item.provenance?.type === 'onChain');

  if (hasProvenance) {
    // Count unique contracts for NFT playlists
    const contracts = new Set();
    items.forEach((item) => {
      if (item.provenance?.contract?.address) {
        contracts.add(item.provenance.contract.address);
      }
    });

    if (contracts.size === 1) {
      return `NFT Collection Playlist`;
    } else if (contracts.size > 1) {
      return `Multi-Collection NFT Playlist`;
    }
  }

  // Fallback: use item count
  return `DP1 Playlist (${items.length} ${items.length === 1 ? 'item' : 'items'})`;
}

/**
 * Build complete DP1 v1.0.0 compliant playlist
 *
 * Creates a complete playlist structure with metadata, defaults, and optional signature.
 * Supports both object parameter and legacy separate parameters for backward compatibility.
 *
 * @param {Object|Array} paramsOrItems - Playlist parameters object or items array (legacy)
 * @param {Array} [paramsOrItems.items] - Array of DP1 items
 * @param {string} [paramsOrItems.title] - Playlist title (auto-generated if not provided)
 * @param {string} [paramsOrItems.slug] - Playlist slug
 * @param {boolean} [paramsOrItems.deterministicMode] - Enable deterministic mode for testing
 * @param {string} [paramsOrItems.fixedTimestamp] - Fixed timestamp for deterministic mode
 * @param {string} [paramsOrItems.fixedId] - Fixed ID for deterministic mode
 * @param {Object} options - Additional options (legacy parameter)
 * @param {string} [options.title] - Playlist title (legacy)
 * @param {string} [options.slug] - Playlist slug (legacy)
 * @param {boolean} [options.deterministicMode] - Enable deterministic mode for testing
 * @param {string} [options.fixedTimestamp] - Fixed timestamp for deterministic mode
 * @param {string} [options.fixedId] - Fixed ID for deterministic mode
 * @returns {Promise<Object>} Complete DP1 playlist with signature
 * @throws {Error} When items array is empty or invalid
 * @example
 * // New style
 * const playlist = await buildDP1Playlist({ items, title: 'My Playlist', slug: 'my-playlist' });
 *
 * // Legacy style
 * const playlist = await buildDP1Playlist(items, { title: 'My Playlist' });
 *
 * // Deterministic mode for testing
 * const playlist = await buildDP1Playlist(items, {
 *   title: 'Test',
 *   deterministicMode: true,
 *   fixedTimestamp: '2024-01-01T00:00:00.000Z',
 *   fixedId: 'playlist_test_123'
 * });
 */
async function buildDP1Playlist(paramsOrItems, options = {}) {
  // Handle both object parameter and legacy separate parameters
  let items, title, slug, deterministicMode, fixedTimestamp, fixedId;

  if (
    paramsOrItems &&
    typeof paramsOrItems === 'object' &&
    !Array.isArray(paramsOrItems) &&
    paramsOrItems.items
  ) {
    // New style: single object parameter
    ({ items, title, slug, deterministicMode, fixedTimestamp, fixedId } = paramsOrItems);
  } else {
    // Legacy style: separate parameters
    items = paramsOrItems;
    ({ title, slug, deterministicMode, fixedTimestamp, fixedId } = options);
  }

  // Validate items
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Playlist must contain at least one item');
  }

  // Workaround: Parse items if they are JSON strings (some AI models return escaped strings)
  items = items.map((item) => {
    if (typeof item === 'string') {
      try {
        return JSON.parse(item);
      } catch (_e) {
        return item; // If parsing fails, return as-is
      }
    }
    return item;
  });

  // Auto-generate title if not provided
  if (!title) {
    title = generatePlaylistTitle(items);
  }

  // Build DP1 playlist structure (DP1 v1.0.0 + OpenAPI spec compliance)
  // Support deterministic mode for testing (freeze timestamp and ID)
  const timestamp = deterministicMode && fixedTimestamp ? fixedTimestamp : new Date().toISOString();
  const crypto = require('crypto');
  const playlistId = deterministicMode && fixedId ? fixedId : crypto.randomUUID();

  const playlist = {
    dpVersion: '1.0.0',
    id: playlistId,
    title,
    created: timestamp,
    items,
    defaults: {
      display: {
        scaling: 'fit',
        background: '#111',
        margin: '5%',
      },
      license: 'token',
      duration: 10,
    },
  };

  // Add optional slug if provided (valid DP1 field)
  if (slug) {
    playlist.slug = slug;
  }

  // Sign the playlist if private key is configured
  try {
    const playlistConfig = getPlaylistConfig();
    if (playlistConfig.privateKey) {
      playlist.signature = await signPlaylist(playlist, playlistConfig.privateKey);
    }
  } catch (error) {
    // If signing fails, log warning but continue (signature is optional)
    console.warn(`Warning: Failed to sign playlist: ${error.message}`);
  }

  return playlist;
}

/**
 * Validate DP1 playlist structure according to OpenAPI spec
 *
 * Performs comprehensive validation of playlist structure, fields, and item requirements.
 * Returns detailed errors for each validation failure.
 *
 * @param {Object} playlist - DP1 playlist to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether playlist is valid
 * @returns {Array<string>} returns.errors - Array of error messages
 * @example
 * const result = validateDP1Playlist(playlist);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 */
function validateDP1Playlist(playlist) {
  const errors = [];

  // Check required playlist fields
  if (!playlist.dpVersion) {
    errors.push('Missing required field: dpVersion');
  } else if (typeof playlist.dpVersion !== 'string') {
    errors.push('Field "dpVersion" must be a string');
  }

  if (!playlist.title) {
    errors.push('Missing required field: title');
  } else if (playlist.title.length > 256) {
    errors.push('Field "title" must not exceed 256 characters');
  }

  if (!playlist.items) {
    errors.push('Missing required field: items');
  } else if (!Array.isArray(playlist.items)) {
    errors.push('Field "items" must be an array');
  } else if (playlist.items.length === 0) {
    errors.push('Playlist must contain at least one item');
  } else if (playlist.items.length > 1024) {
    errors.push('Playlist cannot contain more than 1024 items');
  } else {
    // Validate each item according to PlaylistItem schema
    playlist.items.forEach((item, index) => {
      if (!item.source) {
        errors.push(`Item ${index}: Missing required field "source"`);
      } else if (typeof item.source !== 'string') {
        errors.push(`Item ${index}: Field "source" must be a string (URI)`);
      }

      if (item.duration === undefined || item.duration === null) {
        errors.push(`Item ${index}: Missing required field "duration"`);
      } else if (typeof item.duration !== 'number' || item.duration < 1) {
        errors.push(`Item ${index}: Field "duration" must be a number >= 1`);
      }

      if (!item.license) {
        errors.push(`Item ${index}: Missing required field "license"`);
      } else if (!['open', 'token', 'subscription'].includes(item.license)) {
        errors.push(`Item ${index}: Field "license" must be one of: open, token, subscription`);
      }

      // Validate optional title length
      if (item.title && item.title.length > 256) {
        errors.push(`Item ${index}: Field "title" must not exceed 256 characters`);
      }

      // Validate optional provenance structure
      if (item.provenance) {
        if (!item.provenance.type) {
          errors.push(`Item ${index}: provenance.type is required when provenance is present`);
        } else if (!['onChain', 'seriesRegistry', 'offChainURI'].includes(item.provenance.type)) {
          errors.push(
            `Item ${index}: provenance.type must be one of: onChain, seriesRegistry, offChainURI`
          );
        }

        if (item.provenance.contract) {
          if (!item.provenance.contract.chain) {
            errors.push(`Item ${index}: provenance.contract.chain is required`);
          } else if (
            !['evm', 'tezos', 'bitmark', 'other'].includes(item.provenance.contract.chain)
          ) {
            errors.push(
              `Item ${index}: provenance.contract.chain must be one of: evm, tezos, bitmark, other`
            );
          }
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Detect MIME type from URL or file extension
 *
 * Analyzes URL to determine appropriate MIME type for media content.
 * Supports images, videos, audio, and 3D models.
 *
 * @param {string} url - Media URL
 * @returns {string} MIME type
 * @example
 * const mimeType = detectMimeType('https://example.com/image.png');
 * // Returns: 'image/png'
 */
function detectMimeType(url) {
  if (!url) {
    return 'image/png';
  }

  const extension = url.split('.').pop()?.toLowerCase().split('?')[0];

  const mimeTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
  };

  return mimeTypes[extension] || 'image/png';
}

module.exports = {
  convertTokenToDP1Item,
  convertTokenToDP1ItemSingle,
  convertTokensToDP1Items,
  generatePlaylistTitle,
  buildDP1Playlist,
  validateDP1Playlist,
  detectMimeType,
};
