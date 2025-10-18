/**
 * NFT Indexer Client
 * This module provides functions to interact with NFT indexing services
 * to retrieve comprehensive token information.
 */

const GRAPHQL_ENDPOINT = 'https://indexer.autonomy.io/v2/graphql';
const INDEXING_ENDPOINT = 'https://indexer.autonomy.io/v2/nft/index_one';
const logger = require('../logger');

/**
 * Check if a string looks like a wallet address
 * @param {string} str - String to check
 * @returns {boolean}
 */
function isWalletAddress(str) {
  return /^0x[a-fA-F0-9]{40}$/.test(str);
}

/**
 * Resolve artist name using various strategies
 * @param {Object} tokenData - Token data
 * @returns {Object}
 */
function resolveArtistName(tokenData) {
  const latest = tokenData.asset?.metadata?.project?.latest;
  if (!latest) {
    return tokenData;
  }

  const artistName = latest.artistName;
  const artistID = latest.artistID;

  // If artist name looks like a wallet address, try to resolve it
  if (artistName && isWalletAddress(artistName)) {
    // Strategy 1: If artistID is different and not a wallet address, use it
    if (artistID && !isWalletAddress(artistID) && artistID !== artistName) {
      latest.artistName = artistID;
      return tokenData;
    }

    // Strategy 2: Fallback to truncated wallet address for readability
    latest.artistName = `${artistName.slice(0, 6)}...${artistName.slice(-4)}`;
  }

  return tokenData;
}

/**
 * Build full token ID in indexer format
 * @param {string} chain - Blockchain network
 * @param {string} contractAddress - Contract address
 * @param {string} tokenId - Token ID
 * @returns {string}
 */
function buildIndexerTokenId(chain, contractAddress, tokenId) {
  // Map chain names to indexer chain codes
  const chainMap = {
    ethereum: 'eth',
    tezos: 'tez',
    fa2: 'tez',
    bitmark: 'bmk',
    polygon: 'polygon',
    arbitrum: 'arbitrum',
    optimism: 'optimism',
    base: 'base',
    zora: 'zora',
  };

  const chainCode = chainMap[chain.toLowerCase()] || chain.toLowerCase();
  return `${chainCode}-${contractAddress}-${tokenId}`;
}

/**
 * Unified GraphQL query for tokens from indexer
 *
 * Supports querying by IDs, owners, or both. Returns tokens with full metadata.
 *
 * @param {Object} params - Query parameters
 * @param {Array<string>} [params.ids] - Array of token IDs to query
 * @param {Array<string>} [params.owners] - Array of owner addresses to query
 * @param {number} [params.size] - Maximum number of tokens to return
 * @param {number} [params.offset] - Offset for pagination
 * @param {boolean} [params.burnedIncluded] - Include burned tokens
 * @returns {Promise<Array<Object>>} Array of token data
 * @throws {Error} When query fails
 * @example
 * // Query by token ID
 * const tokens = await queryTokens({ ids: ['eth-0xabc-123'] });
 *
 * // Query by owner address
 * const tokens = await queryTokens({ owners: ['0x1234...'], size: 100 });
 *
 * // Query specific tokens for a specific owner
 * const tokens = await queryTokens({ ids: ['eth-0xabc-123'], owners: ['0x1234...'] });
 */
async function queryTokens(params = {}) {
  const { ids = [], owners = [], size = 50, offset = 0, burnedIncluded = false } = params;

  // Build GraphQL query with proper variables
  const query = `
    query getTokens($owners: [String!]!, $ids: [String!]!, $size: Int64!, $offset: Int64!, $burnedIncluded: Boolean!) {
      tokens(owners: $owners, ids: $ids, size: $size, offset: $offset, burnedIncluded: $burnedIncluded) {
        id
        blockchain
        fungible
        contractType
        contractAddress
        edition
        editionName
        mintedAt
        balance
        owner
        indexID
        source
        swapped
        burned
        lastActivityTime
        lastRefreshedTime
        asset {
          indexID
          thumbnailID
          lastRefreshedTime
          metadata {
            project {
              origin {
                artistID
                artistName
                artistURL
                assetID
                title
                description
                mimeType
                medium
                maxEdition
                baseCurrency
                basePrice
                source
                sourceURL
                previewURL
                thumbnailURL
                galleryThumbnailURL
                assetData
                assetURL
              }
              latest {
                artistID
                artistName
                artistURL
                assetID
                title
                description
                mimeType
                medium
                maxEdition
                baseCurrency
                basePrice
                source
                sourceURL
                previewURL
                thumbnailURL
                galleryThumbnailURL
                assetData
                assetURL
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    owners,
    ids,
    size,
    offset,
    burnedIncluded,
  };

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`);
    }

    const tokens = result.data?.tokens || [];

    // Resolve artist names for all tokens
    const processedTokens = tokens.map((token) => resolveArtistName(token));

    return processedTokens;
  } catch (error) {
    logger.error('[NFT Indexer] Failed to query tokens:', error.message);
    throw error;
  }
}

/**
 * Query single token data from indexer by ID
 *
 * Convenience wrapper around queryTokens for single token queries.
 *
 * @param {string} indexerTokenId - Full token ID in indexer format
 * @returns {Promise<Object|null>} Token data or null if not found
 */
async function queryTokenDataFromIndexer(indexerTokenId) {
  try {
    const tokens = await queryTokens({ ids: [indexerTokenId], burnedIncluded: true });
    return tokens[0] || null;
  } catch (error) {
    logger.error('[NFT Indexer] Failed to query token data:', error.message);
    return null;
  }
}

/**
 * Map DryRun response to standard indexer format
 * DryRun response has a different structure with projectMetadata at top level
 * @param {Object} dryRunData - Data from dryrun API
 * @returns {Object} Normalized indexer data
 */
function normalizeDryRunData(dryRunData) {
  if (!dryRunData || !dryRunData.projectMetadata) {
    return null;
  }

  // Convert DryRun structure to match GraphQL structure
  return {
    id: dryRunData.id,
    indexID: dryRunData.tokens?.[0]?.indexID,
    contractAddress: dryRunData.tokens?.[0]?.contractAddress,
    mintedAt: dryRunData.tokens?.[0]?.mintedAt,
    owner: dryRunData.tokens?.[0]?.owner,
    asset: {
      lastRefreshedTime: dryRunData.tokens?.[0]?.lastRefreshedTime,
      metadata: {
        project: {
          latest: dryRunData.projectMetadata,
        },
      },
    },
  };
}

/**
 * Map indexer token data to standard format
 * @param {Object} indexerData - Data from indexer (GraphQL or normalized DryRun)
 * @param {string} chain - Blockchain network
 * @returns {Object}
 */
function mapIndexerDataToStandardFormat(indexerData, chain) {
  if (!indexerData) {
    return {
      success: false,
      error: 'Token not found in indexer',
    };
  }

  const latest = indexerData.asset?.metadata?.project?.latest || {};

  // Determine the best source URL with priority order based on actual API fields:
  // 1. previewURL (Art Blocks generator URL - interactive/live content)
  // 2. assetURL (primary asset link, e.g., OpenSea)
  // 3. thumbnailURL (fallback static image)
  const sourceUrl = latest.previewURL || latest.assetURL || latest.thumbnailURL || '';

  // For thumbnail, use dedicated thumbnail or gallery thumbnail
  const thumbnailUrl = latest.thumbnailURL || latest.galleryThumbnailURL || '';

  return {
    success: true,
    token: {
      chain,
      contractAddress: indexerData.contractAddress,
      tokenId: indexerData.id,
      name: latest.title || `Token #${indexerData.id}`,
      description: latest.description || '',
      image: {
        url: sourceUrl,
        mimeType: 'image/png', // Default, would need to detect from URL
        thumbnail: thumbnailUrl,
      },
      animation_url: latest.medium === 'video' ? latest.previewURL : undefined,
      metadata: {
        attributes: [],
        medium: latest.medium,
        artistName: latest.artistName,
        artistID: latest.artistID,
        artistURL: latest.artistURL,
      },
      owner: indexerData.owner,
      collection: {
        name: latest.title ? latest.title.split('#')[0].trim() : 'Unknown Collection',
        description: latest.description || '',
      },
      mintedAt: indexerData.mintedAt,
      lastTransferredAt: indexerData.asset?.lastRefreshedTime,
    },
  };
}

/**
 * Convert token data to DP1 item format
 *
 * Extracts source URL from indexer data with proper priority:
 * animation_url > image.url, ensuring the best quality media is used.
 *
 * @param {Object} tokenData - Token data in standard format
 * @param {number} duration - Display duration in seconds
 * @returns {Object} DP1 item with source URL from indexer
 */
function convertToDP1Item(tokenData, duration = 10) {
  const { token } = tokenData;

  if (!token) {
    return {
      success: false,
      error: tokenData.error || 'Invalid token data',
    };
  }

  // Generate deterministic ID for this item based on contract + tokenId
  // Use a simple hash to create a consistent ID
  const crypto = require('crypto');
  const idSource = `${token.contractAddress}-${token.tokenId}`;
  const hash = crypto.createHash('sha256').update(idSource).digest('hex');
  // Format as UUID-like string for consistency
  const itemId = `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20, 12)}`;

  // Get source URL from indexer data (priority: animation_url > image.url)
  // The source has already been prioritized in mapIndexerDataToStandardFormat
  const sourceUrl =
    token.animation_url || token.animationUrl || token.image?.url || token.image || '';

  if (!sourceUrl) {
    logger.warn('[NFT Indexer] No source URL found for token:', {
      contractAddress: token.contractAddress,
      tokenId: token.tokenId,
    });
  }

  // Map chain name to DP1 format (according to DP1 spec)
  // NOTE: This is for DP1 provenance output, NOT for indexer queries
  // The indexer uses 'eth'/'tez'/'bmk', but DP1 spec uses 'evm'/'tezos'/'bitmark'
  const chainMap = {
    ethereum: 'evm',
    polygon: 'evm',
    arbitrum: 'evm',
    optimism: 'evm',
    base: 'evm',
    zora: 'evm',
    tezos: 'tezos', // DP1 spec uses 'tezos', not 'tez'
    bitmark: 'bitmark', // DP1 spec uses 'bitmark', not 'bmk'
  };

  // Build DP1 item structure (strict DP1 v1.0.0 compliance)
  const dp1Item = {
    id: itemId,
    source: sourceUrl,
    duration: duration,
    license: 'open',
    created: new Date().toISOString(),
    provenance: {
      type: 'onChain',
      contract: {
        chain: chainMap[token.chain.toLowerCase()] || 'other',
        standard: 'other',
        address: token.contractAddress,
        tokenId: String(token.tokenId),
      },
    },
  };

  // Add title if available (valid DP1 field)
  if (token.name) {
    dp1Item.title = token.name;
  }

  logger.debug('[NFT Indexer] ✓ Converted to DP1:', {
    title: token.name,
    source: sourceUrl.substring(0, 60) + '...',
  });

  return {
    success: true,
    item: dp1Item,
  };
}

/**
 * Get NFT token information from indexer and return as DP1 item (supports single or batch)
 * @param {Object|Array} params - Token parameters (single object or array)
 * @param {number} duration - Display duration in seconds (default: 10)
 * @returns {Promise<Object>} DP1 item(s)
 */
async function getNFTTokenInfo(params) {
  const duration = params.duration || 10;

  // Handle array input for batch processing
  if (Array.isArray(params.tokens)) {
    return await getNFTTokenInfoBatch(params.tokens, duration);
  }

  // Handle single token
  const { chain, contractAddress, tokenId } = params;
  const result = await getNFTTokenInfoSingle({ chain, contractAddress, tokenId }, duration);
  return result;
}

/**
 * Get single NFT token information from indexer and return as DP1 item
 * @param {Object} params - Token parameters
 * @param {number} duration - Display duration in seconds
 * @returns {Promise<Object>} DP1 item
 */
async function getNFTTokenInfoSingle(params, duration = 10) {
  let chain = params.chain;
  const { contractAddress, tokenId } = params;

  // DEFENSIVE: Auto-detect and correct chain based on contract address format
  if (contractAddress.startsWith('KT') && chain !== 'tezos') {
    logger.warn(
      `[NFT Indexer] ⚠️  Chain mismatch detected! Contract ${contractAddress} starts with KT but chain="${chain}". Auto-correcting to "tezos".`
    );
    chain = 'tezos';
  } else if (contractAddress.startsWith('0x') && chain === 'tezos') {
    logger.warn(
      `[NFT Indexer] ⚠️  Chain mismatch detected! Contract ${contractAddress} starts with 0x but chain="tezos". Auto-correcting to "ethereum".`
    );
    chain = 'ethereum';
  }

  logger.info(`[NFT Indexer] Fetching token info for:`, {
    chain,
    contractAddress,
    tokenId,
  });

  try {
    // Build indexer token ID
    const indexerTokenId = buildIndexerTokenId(chain, contractAddress, tokenId);
    logger.info(`[NFT Indexer] Built indexer token ID: ${indexerTokenId}`);

    // Query the indexer
    logger.info(`[NFT Indexer] Querying indexer GraphQL for token...`);
    let indexerData = await queryTokenDataFromIndexer(indexerTokenId);

    // If token not found, use dryrun to get data immediately
    if (!indexerData) {
      logger.info(`[NFT Indexer] ❌ Token not in database, using DRYRUN to fetch immediately...`);

      // Get data immediately via dryrun
      logger.info(`[NFT Indexer] → Calling indexTokenDryRun(${contractAddress}, ${tokenId})`);
      const dryRunData = await indexTokenDryRun(contractAddress, tokenId);

      if (dryRunData) {
        logger.info(`[NFT Indexer] ✓ Got token data from DRYRUN`);
        logger.debug(`[NFT Indexer] DryRun data keys:`, Object.keys(dryRunData));

        // Normalize DryRun data to match GraphQL structure
        logger.debug(`[NFT Indexer] → Normalizing DryRun data structure...`);
        indexerData = normalizeDryRunData(dryRunData);

        if (indexerData) {
          logger.info(`[NFT Indexer] ✓ DryRun data normalized successfully`);

          // Trigger async indexing to persist (fire-and-forget)
          logger.info(`[NFT Indexer] → Starting async indexing workflow (background)...`);
          triggerIndexingAsync(contractAddress, tokenId).catch((error) => {
            logger.warn('[NFT Indexer] Async indexing failed (non-critical):', error.message);
          });
        } else {
          logger.error(`[NFT Indexer] ❌ Failed to normalize DryRun data`);
          return {
            success: false,
            error: `Failed to normalize DryRun data for ${contractAddress}/${tokenId}`,
          };
        }
      } else {
        logger.error(`[NFT Indexer] ❌ DRYRUN also failed for ${contractAddress}/${tokenId}`);
        return {
          success: false,
          error: `Token not found and dryrun indexing failed: ${contractAddress}/${tokenId}`,
        };
      }
    } else {
      logger.info(`[NFT Indexer] ✓ Token found in database`);
    }

    // Map to standard format and convert to DP1
    const tokenData = mapIndexerDataToStandardFormat(indexerData, chain);
    return convertToDP1Item(tokenData, duration);
  } catch (error) {
    logger.error(`[NFT Indexer] Error fetching token:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get NFT token information in batch and return as DP1 items (parallel processing)
 * @param {Array} tokens - Array of token parameters
 * @param {number} duration - Display duration in seconds
 * @returns {Promise<Array>} Array of DP1 items
 */
async function getNFTTokenInfoBatch(tokens, duration = 10) {
  logger.info(`[NFT Indexer] 📦 Starting batch processing for ${tokens.length} token(s)...`);
  logger.debug('[NFT Indexer] Batch tokens:', tokens);

  const results = [];

  // Process in parallel with concurrency limit
  const concurrency = 10;
  for (let i = 0; i < tokens.length; i += concurrency) {
    const batch = tokens.slice(i, i + concurrency);
    logger.info(
      `[NFT Indexer] Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(tokens.length / concurrency)} (${batch.length} tokens)`
    );

    const batchResults = await Promise.all(
      batch.map((token, idx) =>
        getNFTTokenInfoSingle(token, duration).catch((error) => {
          logger.error(`[NFT Indexer] Token ${idx + 1} in batch failed:`, error.message);
          return {
            success: false,
            error: error.message,
            token,
          };
        })
      )
    );

    // Log results
    const successful = batchResults.filter((r) => r.success).length;
    const failed = batchResults.filter((r) => !r.success).length;
    logger.info(`[NFT Indexer] Batch complete: ${successful} success, ${failed} failed`);

    results.push(...batchResults);
  }

  logger.info(`[NFT Indexer] ✓ Batch processing complete: ${results.length} total results`);
  const successCount = results.filter((r) => r.success && r.item).length;
  logger.info(
    `[NFT Indexer] Final: ${successCount} items with data, ${results.length - successCount} without`
  );

  // Return only items (not error objects)
  const items = results.filter((r) => r.success && r.item).map((r) => r.item);
  logger.info(`[NFT Indexer] Returning ${items.length} items`);

  return items;
}

/**
 * Get collection information
 * @param {Object} params - Collection parameters
 * @param {string} params.chain - Blockchain network
 * @param {string} params.contractAddress - Collection contract address
 * @returns {Promise<Object>} Collection information
 */
async function getCollectionInfo(params) {
  const { chain, contractAddress } = params;

  // TODO: Implement collection info fetching

  logger.debug(`[NFT Indexer] Fetching collection info for:`, {
    chain,
    contractAddress,
  });

  return {
    success: true,
    collection: {
      chain,
      contractAddress,
      name: 'Collection Name',
      description: 'Collection Description',
      image: 'https://example.com/collection.png',
      totalSupply: 10000,
      floorPrice: {
        value: '0.1',
        currency: 'ETH',
      },
      metadata: {},
    },
  };
}

/**
 * Index a token using dryrun mode to get data immediately
 *
 * Uses dryrun mode to synchronously index and return token data without
 * persisting to the database. This provides immediate results.
 *
 * @param {string} contractAddress - Contract address (required)
 * @param {string} tokenId - Token ID (required)
 * @param {string} [owner] - Owner address (optional)
 * @returns {Promise<Object|null>} Token data from indexer or null on error
 * @see https://raw.githubusercontent.com/feral-file/ff-indexer/refs/heads/main/services/api-gateway/index.go
 */
async function indexTokenDryRun(contractAddress, tokenId, owner = '') {
  try {
    const requestBody = {
      contract: contractAddress,
      tokenID: tokenId,
      dryrun: true,
      preview: false,
    };

    if (owner) {
      requestBody.owner = owner;
    }

    logger.info('[NFT Indexer] 🔄 Starting DryRun indexing (immediate fetch)...');
    logger.info('[NFT Indexer] → POST', INDEXING_ENDPOINT);
    logger.info('[NFT Indexer] → Request:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(INDEXING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    logger.info(`[NFT Indexer] ← Response status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const result = await response.json();
      logger.info(
        '[NFT Indexer] ← Response body:',
        JSON.stringify(result, null, 2).substring(0, 500)
      );

      // Server returns {"update": {...}} with token data in dryrun mode
      if (result.update) {
        logger.info('[NFT Indexer] ✓ DryRun successful, got token data');
        logger.debug('[NFT Indexer] Token data structure:', {
          hasAsset: !!result.update.asset,
          hasMetadata: !!result.update.asset?.metadata,
          hasProject: !!result.update.asset?.metadata?.project,
          hasLatest: !!result.update.asset?.metadata?.project?.latest,
        });
        return result.update;
      } else {
        logger.warn('[NFT Indexer] ⚠️  DryRun returned unexpected format (no "update" field)');
        logger.warn('[NFT Indexer] Response keys:', Object.keys(result));
        return null;
      }
    } else {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      logger.error('[NFT Indexer] ❌ DryRun HTTP error:', {
        contractAddress,
        tokenId,
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 200),
      });
      return null;
    }
  } catch (error) {
    logger.error('[NFT Indexer] ❌ DryRun exception:', error.message);
    logger.error('[NFT Indexer] Stack:', error.stack);
    return null;
  }
}

/**
 * Trigger async indexing workflow for a token (fire-and-forget)
 *
 * Starts an asynchronous background workflow to index and persist the token.
 * Does not wait for completion - returns immediately.
 *
 * @param {string} contractAddress - Contract address (required)
 * @param {string} tokenId - Token ID (required)
 * @param {string} [owner] - Owner address (optional)
 * @returns {Promise<boolean>} True if workflow was successfully triggered
 * @see https://raw.githubusercontent.com/feral-file/ff-indexer/refs/heads/main/services/api-gateway/index.go
 */
async function triggerIndexingAsync(contractAddress, tokenId, owner = '') {
  try {
    const requestBody = {
      contract: contractAddress,
      tokenID: tokenId,
      dryrun: false,
      preview: false,
    };

    if (owner) {
      requestBody.owner = owner;
    }

    logger.debug('[NFT Indexer] Triggering async indexing workflow:', {
      contract: contractAddress,
      tokenID: tokenId,
    });

    const response = await fetch(INDEXING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const result = await response.json();

      // Server returns {"ok": 1} when workflow starts
      if (result.ok === 1) {
        logger.debug('[NFT Indexer] ✓ Async indexing workflow started');
        return true;
      } else {
        logger.warn('[NFT Indexer] Unexpected async response:', result);
        return false;
      }
    } else {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      logger.error('[NFT Indexer] Failed to trigger async indexing:', {
        contractAddress,
        tokenId,
        status: response.status,
        error: errorText,
      });
      return false;
    }
  } catch (error) {
    logger.error('[NFT Indexer] Async indexing error:', error.message);
    return false;
  }
}

/**
 * Search for NFTs by query
 * @param {Object} params - Search parameters
 * @param {string} params.query - Search query
 * @param {string} params.chain - Optional chain filter
 * @param {number} params.limit - Results limit
 * @returns {Promise<Object>} Search results
 */
async function searchNFTs(params) {
  const { query, chain, limit = 10 } = params;

  // TODO: Implement NFT search if indexer supports it

  logger.debug(`[NFT Indexer] Searching NFTs:`, { query, chain, limit });

  return {
    success: true,
    results: [],
    total: 0,
  };
}

/**
 * Query tokens owned by an address
 *
 * Fetches all tokens owned by a given address from the indexer.
 * Returns token data in a format suitable for conversion to DP1 items.
 *
 * @param {string} ownerAddress - Owner wallet address
 * @param {number} [limit=100] - Maximum number of tokens to fetch
 * @returns {Promise<Object>} Result with tokens array
 * @returns {boolean} returns.success - Whether query succeeded
 * @returns {Array} [returns.tokens] - Array of token data
 * @returns {string} [returns.error] - Error message if failed
 * @example
 * const result = await queryTokensByOwner('0x1234...', 50);
 * if (result.success) {
 *   console.log(`Found ${result.tokens.length} tokens`);
 * }
 */
/**
 * Query tokens owned by an address
 *
 * Convenience wrapper around queryTokens for owner-based queries.
 * Fetches all tokens owned by a given address from the indexer.
 *
 * @param {string} ownerAddress - Owner wallet address
 * @param {number} [limit=100] - Maximum number of tokens to fetch
 * @returns {Promise<Object>} Result with tokens array
 * @returns {boolean} returns.success - Whether query succeeded
 * @returns {Array} [returns.tokens] - Array of token data
 * @returns {number} [returns.count] - Number of tokens found
 * @returns {string} [returns.error] - Error message if failed
 * @example
 * const result = await queryTokensByOwner('0x1234...', 50);
 * if (result.success) {
 *   console.log(`Found ${result.tokens.length} tokens`);
 * }
 */
async function queryTokensByOwner(ownerAddress, limit = 100) {
  try {
    logger.info(`[NFT Indexer] Querying tokens for owner: ${ownerAddress}`);

    const tokens = await queryTokens({
      owners: [ownerAddress],
      size: limit,
      offset: 0,
      burnedIncluded: false,
    });

    logger.info(`[NFT Indexer] Found ${tokens.length} token(s) for owner ${ownerAddress}`);

    return {
      success: true,
      tokens,
      count: tokens.length,
    };
  } catch (error) {
    logger.error('[NFT Indexer] Failed to query tokens by owner:', error.message);
    return {
      success: false,
      error: error.message,
      tokens: [],
      count: 0,
    };
  }
}

/**
 * Trigger indexing workflow for an address
 *
 * Calls the indexer API to start indexing all tokens for a given address.
 * This is a fire-and-forget operation that starts a background workflow.
 *
 * @param {string} ownerAddress - Owner wallet address
 * @param {boolean} [includeHistory=false] - Whether to include historical data
 * @returns {Promise<Object>} Result indicating if indexing was triggered
 * @returns {boolean} returns.success - Whether indexing was triggered
 * @returns {string} [returns.message] - Success message
 * @returns {string} [returns.error] - Error message if failed
 * @see https://raw.githubusercontent.com/feral-file/ff-indexer/refs/heads/main/services/api-gateway/index.go
 * @example
 * const result = await triggerAddressIndexing('0x1234...');
 * if (result.success) {
 *   console.log('Indexing started in background');
 * }
 */
async function triggerAddressIndexing(ownerAddress, includeHistory = false) {
  const INDEXING_ADDRESS_ENDPOINT = 'https://indexer.autonomy.io/v2/nft/index';

  try {
    const requestBody = {
      owner: ownerAddress,
      history: includeHistory,
    };

    logger.info('[NFT Indexer] 🔄 Triggering address indexing workflow...');
    logger.info('[NFT Indexer] → POST', INDEXING_ADDRESS_ENDPOINT);
    logger.info('[NFT Indexer] → Request:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(INDEXING_ADDRESS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    logger.info(`[NFT Indexer] ← Response status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const result = await response.json();

      // Server returns {"ok": 1} when workflow starts
      if (result.ok === 1) {
        logger.info('[NFT Indexer] ✓ Address indexing workflow started successfully');
        return {
          success: true,
          message: `Indexing workflow started for ${ownerAddress}. This may take a few moments.`,
        };
      } else {
        logger.warn('[NFT Indexer] ⚠️  Unexpected response:', result);
        return {
          success: false,
          error: 'Unexpected response from indexing service',
        };
      }
    } else {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      logger.error('[NFT Indexer] ❌ Address indexing HTTP error:', {
        ownerAddress,
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 200),
      });
      return {
        success: false,
        error: `Failed to trigger indexing: ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    logger.error('[NFT Indexer] ❌ Address indexing exception:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  // Primary functions (return DP1 items)
  getNFTTokenInfo,
  // Batch processing
  getNFTTokenInfoBatch,
  // Single token processing
  getNFTTokenInfoSingle,
  // Additional functions
  getCollectionInfo,
  searchNFTs,
  indexTokenDryRun,
  triggerIndexingAsync,
  buildIndexerTokenId,
  convertToDP1Item,
  // Address-based functions
  queryTokensByOwner,
  triggerAddressIndexing,
  // Unified GraphQL query
  queryTokens,
  // Export for testing
  queryTokenDataFromIndexer,
  normalizeDryRunData,
  mapIndexerDataToStandardFormat,
};
