/**
 * NFT Indexer Client
 * This module provides functions to interact with NFT indexing services
 * to retrieve comprehensive token information.
 */

const GRAPHQL_ENDPOINT = 'https://indexer.autonomy.io/v2/graphql';
const logger = require('../logger');

/**
 * Detect token standard based on chain and contract address
 *
 * Determines the appropriate ERC/token standard for the given blockchain
 * and contract format.
 *
 * @param {string} chain - Blockchain network
 * @param {string} contractAddress - Contract address
 * @returns {string} Token standard (erc721, erc1155, fa2, or other)
 */
function detectTokenStandard(chain, contractAddress) {
  const lowerChain = chain.toLowerCase();

  // Tezos contracts use FA2 standard
  if (lowerChain === 'tezos' || contractAddress.startsWith('KT')) {
    return 'fa2';
  }

  // Ethereum uses ERC721
  // TODO: Enhance with on-chain detection for ERC1155 support
  if (lowerChain === 'ethereum') {
    return 'erc721';
  }

  return 'other';
}

/**
 * Build CAIP-2 token CID for indexer v2
 *
 * Constructs a token identifier in CAIP-2 format compatible with ff-indexer-v2.
 * Format: `{caip2Chain}:{standard}:{contractAddress}:{tokenNumber}`
 *
 * @param {string} chain - Blockchain network (ethereum, polygon, tezos, etc)
 * @param {string} contractAddress - Contract address
 * @param {string} tokenId - Token ID
 * @returns {string} Token CID in CAIP-2 format
 * @example
 * // Returns: eip155:1:erc721:0xabc123:456
 * const cid = buildTokenCID('ethereum', '0xabc123', '456');
 * @example
 * // Returns: tezos:mainnet:fa2:KT1abc:789
 * const cid = buildTokenCID('tezos', 'KT1abc', '789');
 */
function buildTokenCID(chain, contractAddress, tokenId) {
  // Map chain names to CAIP-2 format (supports only Ethereum and Tezos)
  const caip2Map = {
    ethereum: 'eip155:1',
    tezos: 'tezos:mainnet',
    fa2: 'tezos:mainnet', // FA2 is Tezos
  };

  const lowerChain = chain.toLowerCase();
  const caip2Chain = caip2Map[lowerChain];

  if (!caip2Chain) {
    throw new Error(`Unsupported chain: ${chain}. Only ethereum and tezos are supported.`);
  }

  const standard = detectTokenStandard(chain, contractAddress);

  return `${caip2Chain}:${standard}:${contractAddress}:${tokenId}`;
}

/**
 * Unified GraphQL query for tokens from indexer v2
 *
 * Supports querying by token CIDs and/or owners. Returns tokens with full metadata.
 *
 * @param {Object} params - Query parameters
 * @param {Array<string>} [params.token_cids] - Array of token CIDs to query
 * @param {Array<string>} [params.owners] - Array of owner addresses to query
 * @param {number} [params.limit] - Maximum number of tokens to return (default: 50)
 * @param {number} [params.offset] - Offset for pagination (default: 0)
 * @returns {Promise<Array<Object>>} Array of token data
 * @throws {Error} When query fails
 * @example
 * // Query by token CID
 * const tokens = await queryTokens({ token_cids: ['eip155:1:erc721:0xabc:123'] });
 *
 * // Query by owner address
 * const tokens = await queryTokens({ owners: ['0x1234...'], limit: 100 });
 *
 * // Query specific tokens for a specific owner
 * const tokens = await queryTokens({ token_cids: ['eip155:1:erc721:0xabc:123'], owners: ['0x1234...'] });
 */
async function queryTokens(params = {}) {
  const { token_cids = [], owners = [], limit = 50, offset = 0 } = params;

  // Build GraphQL query with proper variables for v2 schema
  const query = `
    query getTokens($owner: [String!], $token_cids: [String!], $limit: Uint8, $offset: Uint64) {
      tokens(owner: $owner, token_cids: $token_cids, limit: $limit, offset: $offset, expand: ["metadata", "enrichment_source", "metadata_media_assets"]) {
        token_cid
        chain
        standard
        contract_address
        token_number
        current_owner
        burned
          metadata {
          name
                description
          mime_type
          image_url
          animation_url
          artists {
            did
            name
          }
        }
        enrichment_source {
          name
                description
          image_url
          animation_url
          artists {
            did
            name
          }
        }
        metadata_media_assets {
          source_url
          mime_type
          variant_urls
        }
      }
    }
  `;

  const variables = {
    owner: owners.length > 0 ? owners : null,
    token_cids: token_cids.length > 0 ? token_cids : null,
    limit,
    offset,
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
    return tokens;
  } catch (error) {
    logger.error('[NFT Indexer] Failed to query tokens:', error.message);
    throw error;
  }
}

/**
 * Query single token data from indexer by token CID
 *
 * Convenience wrapper around queryTokens for single token queries.
 *
 * @param {string} tokenCID - Token CID in CAIP-2 format
 * @returns {Promise<Object|null>} Token data or null if not found
 */
async function queryTokenDataFromIndexer(tokenCID) {
  try {
    const tokens = await queryTokens({ token_cids: [tokenCID] });
    return tokens[0] || null;
  } catch (error) {
    logger.error('[NFT Indexer] Failed to query token data:', error.message);
    return null;
  }
}

/**
 * Extract artist name from artists array
 *
 * Converts the new artists array format to a single artist name string.
 *
 * @param {Array} artists - Array of artist objects with did and name
 * @returns {string} Artist name or empty string
 */
function extractArtistName(artists) {
  if (!Array.isArray(artists) || artists.length === 0) {
    return '';
  }
  // Use first artist's name, or join multiple if needed
  return artists[0]?.name || '';
}

/**
 * Get best media URL from metadata and enrichment source
 *
 * Prioritizes animation URLs over static images, using available fields
 * from both metadata and enrichment_source.
 *
 * @param {Object} metadata - Token metadata object
 * @param {Object} enrichmentSource - Token enrichment_source object
 * @param {Array} mediaAssets - Token media assets
 * @returns {Object} Object with url and thumbnail properties
 */
function getBestMediaUrl(metadata = {}, enrichmentSource = {}, mediaAssets = []) {
  // Priority: animation_url > metadata_media_assets > image_url
  const animationUrl = metadata.animation_url || enrichmentSource.animation_url;
  if (animationUrl) {
    return {
      url: animationUrl,
      thumbnail: metadata.image_url || enrichmentSource.image_url || '',
    };
  }

  // Check media assets for best quality
  if (Array.isArray(mediaAssets) && mediaAssets.length > 0) {
    const asset = mediaAssets[0];
    return {
      url: asset.source_url || '',
      thumbnail: metadata.image_url || enrichmentSource.image_url || '',
    };
  }

  // Fallback to image URLs
  return {
    url: metadata.image_url || enrichmentSource.image_url || '',
    thumbnail: metadata.image_url || enrichmentSource.image_url || '',
  };
}

/**
 * Map indexer v2 token data to standard format
 *
 * Converts the new GraphQL v2 schema format to internal standard format
 * for compatibility with existing code.
 *
 * @param {Object} indexerData - Data from indexer GraphQL v2 query
 * @param {string} chain - Blockchain network
 * @returns {Object} Standardized token data
 */
function mapIndexerDataToStandardFormat(indexerData, chain) {
  if (!indexerData) {
    return {
      success: false,
      error: 'Token not found in indexer',
    };
  }

  // Use metadata first, fallback to enrichment_source for missing fields
  const metadata = indexerData.metadata || {};
  const enrichmentSource = indexerData.enrichment_source || {};
  const mediaAssets = indexerData.metadata_media_assets || [];

  // Get best media URLs
  const media = getBestMediaUrl(metadata, enrichmentSource, mediaAssets);

  // Extract artist name from array format
  const artistName =
    extractArtistName(metadata.artists) || extractArtistName(enrichmentSource.artists) || '';

  // Determine best name and description
  const name = metadata.name || enrichmentSource.name || `Token #${indexerData.token_number}`;
  const description = metadata.description || enrichmentSource.description || '';

  return {
    success: true,
    token: {
      chain,
      contractAddress: indexerData.contract_address,
      tokenId: indexerData.token_number,
      name,
      description,
      image: {
        url: media.url,
        mimeType: metadata.mime_type || 'image/png',
        thumbnail: media.thumbnail,
      },
      animation_url: metadata.animation_url || enrichmentSource.animation_url,
      metadata: {
        attributes: [],
        artistName,
      },
      owner: indexerData.current_owner,
      collection: {
        name: name.split('#')[0].trim(),
        description,
      },
      burned: indexerData.burned || false,
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
 *
 * Queries the indexer for token data. If not found, triggers async indexing workflow.
 * Note: Unlike v1, there is no immediate dryrun mode - tokens not in database require
 * async indexing via triggerIndexingAsync.
 *
 * @param {Object} params - Token parameters
 * @param {string} params.chain - Blockchain network
 * @param {string} params.contractAddress - Contract address
 * @param {string} params.tokenId - Token ID
 * @param {number} duration - Display duration in seconds
 * @returns {Promise<Object>} DP1 item with success/error status
 */
async function getNFTTokenInfoSingle(params, duration = 10) {
  let chain = params.chain;
  const { contractAddress, tokenId } = params;

  // DEFENSIVE: Auto-detect and correct chain based on contract address format
  if (contractAddress.startsWith('KT') && chain !== 'tezos') {
    logger.warn(
      `[NFT Indexer] Chain mismatch detected! Contract ${contractAddress} starts with KT but chain="${chain}". Auto-correcting to "tezos".`
    );
    chain = 'tezos';
  } else if (contractAddress.startsWith('0x') && chain === 'tezos') {
    logger.warn(
      `[NFT Indexer] Chain mismatch detected! Contract ${contractAddress} starts with 0x but chain="tezos". Auto-correcting to "ethereum".`
    );
    chain = 'ethereum';
  }

  logger.info(`[NFT Indexer] Fetching token info for:`, {
    chain,
    contractAddress,
    tokenId,
  });

  try {
    // Build token CID in CAIP-2 format
    const tokenCID = buildTokenCID(chain, contractAddress, tokenId);
    logger.info(`[NFT Indexer] Built token CID: ${tokenCID}`);

    // Query the indexer
    logger.info(`[NFT Indexer] Querying indexer GraphQL for token...`);
    const indexerData = await queryTokenDataFromIndexer(tokenCID);

    // If token not found, trigger async indexing
    if (!indexerData) {
      logger.info(`[NFT Indexer] Token not in database, triggering async indexing...`);

      // Trigger background indexing workflow
      const indexResult = await triggerIndexingAsync(chain, contractAddress, tokenId);

      if (indexResult.success) {
        logger.info('[NFT Indexer] Indexing workflow triggered', {
          workflow_id: indexResult.workflow_id,
        });
        return {
          success: false,
          error: `Token not yet indexed. Indexing workflow started (${indexResult.workflow_id}). Please try again in a moment.`,
        };
      } else {
        logger.error(`[NFT Indexer] Failed to trigger indexing:`, indexResult.error);
        return {
          success: false,
          error: `Token not found and indexing failed: ${indexResult.error}`,
        };
      }
    }

    logger.info(`[NFT Indexer] ✓ Token found in database`);

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
 * Trigger async indexing workflow for a token (fire-and-forget)
 *
 * Starts an asynchronous background workflow to index and persist the token via GraphQL mutation.
 * Does not wait for completion - returns immediately.
 *
 * @param {string} chain - Blockchain network
 * @param {string} contractAddress - Contract address (required)
 * @param {string} tokenId - Token ID (required)
 * @returns {Promise<Object>} Result with workflow info
 * @returns {boolean} returns.success - Whether workflow was triggered
 * @returns {string} [returns.workflow_id] - Workflow ID if triggered
 * @returns {string} [returns.run_id] - Run ID if triggered
 * @returns {string} [returns.error] - Error message if failed
 */
async function triggerIndexingAsync(chain, contractAddress, tokenId) {
  try {
    // Build token CID
    const tokenCID = buildTokenCID(chain, contractAddress, tokenId);

    logger.debug('[NFT Indexer] Triggering async indexing workflow via GraphQL mutation:', {
      tokenCID,
    });

    const mutation = `
      mutation TriggerIndexing($token_cids: [String!]!) {
        triggerIndexing(token_cids: $token_cids) {
          workflow_id
          run_id
        }
      }
    `;

    const variables = {
      token_cids: [tokenCID],
    };

    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`);
    }

    const triggerResult = result.data?.triggerIndexing;
    if (triggerResult?.workflow_id) {
      logger.debug('[NFT Indexer] ✓ Async indexing workflow started:', triggerResult);
      return {
        success: true,
        workflow_id: triggerResult.workflow_id,
        run_id: triggerResult.run_id,
      };
    } else {
      logger.warn('[NFT Indexer] Unexpected mutation response:', result);
      return {
        success: false,
        error: 'No workflow ID returned',
      };
    }
  } catch (error) {
    logger.error('[NFT Indexer] Async indexing error:', error.message);
    return {
      success: false,
      error: error.message,
    };
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
      limit,
      offset: 0,
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
 * Calls the indexer GraphQL mutation to start indexing all tokens for a given address.
 * This is a fire-and-forget operation that starts a background workflow.
 *
 * @param {string} ownerAddress - Owner wallet address
 * @returns {Promise<Object>} Result indicating if indexing was triggered
 * @returns {boolean} returns.success - Whether indexing was triggered
 * @returns {string} [returns.message] - Success message
 * @returns {string} [returns.workflow_id] - Workflow ID if triggered
 * @returns {string} [returns.run_id] - Run ID if triggered
 * @returns {string} [returns.error] - Error message if failed
 * @example
 * const result = await triggerAddressIndexing('0x1234...');
 * if (result.success) {
 *   console.log('Indexing started in background');
 * }
 */
async function triggerAddressIndexing(ownerAddress) {
  try {
    logger.info('[NFT Indexer] Triggering address indexing workflow via GraphQL mutation...');
    logger.info('[NFT Indexer] → Owner address:', ownerAddress);

    const mutation = `
      mutation TriggerIndexing($addresses: [String!]!) {
        triggerIndexing(addresses: $addresses) {
          workflow_id
          run_id
        }
      }
    `;

    const variables = {
      addresses: [ownerAddress],
    };

    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: mutation, variables }),
    });

    logger.info(`[NFT Indexer] ← Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`);
    }

    const triggerResult = result.data?.triggerIndexing;
    if (triggerResult?.workflow_id) {
      logger.info('[NFT Indexer] ✓ Address indexing workflow started successfully');
      return {
        success: true,
        message: `Indexing workflow started for ${ownerAddress}. This may take a few moments.`,
        workflow_id: triggerResult.workflow_id,
        run_id: triggerResult.run_id,
      };
    } else {
      logger.warn('[NFT Indexer] Unexpected mutation response:', result);
      return {
        success: false,
        error: 'Unexpected response from indexing service',
      };
    }
  } catch (error) {
    logger.error('[NFT Indexer] Address indexing exception:', error.message);
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
  triggerIndexingAsync,
  buildTokenCID,
  convertToDP1Item,
  // Address-based functions
  queryTokensByOwner,
  triggerAddressIndexing,
  // Unified GraphQL query
  queryTokens,
  // Export for testing
  queryTokenDataFromIndexer,
  mapIndexerDataToStandardFormat,
  detectTokenStandard,
  extractArtistName,
  getBestMediaUrl,
};
