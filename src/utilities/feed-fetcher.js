/**
 * DP1 Feed Fetcher
 * Utilities to fetch playlists from DP1 Feed API
 * API: https://github.com/display-protocol/dp1-feed
 */

const chalk = require('chalk');
const fuzzysort = require('fuzzysort');
const { getFeedConfig } = require('../config');

/**
 * Get feed API base URLs from configuration
 *
 * @returns {string[]} Array of feed API base URLs
 */
function getFeedApiUrls() {
  const feedConfig = getFeedConfig();
  return feedConfig.baseURLs;
}

/**
 * Fetch playlists from a single feed URL with pagination
 *
 * @param {string} feedUrl - Feed API base URL
 * @param {number} limit - Items per page (default: 50)
 * @returns {Promise<Array>} Array of playlists
 */
async function fetchPlaylistsFromFeed(feedUrl, limit = 500) {
  try {
    const response = await fetch(`${feedUrl}/playlists?limit=${limit}&sort=-created`);

    if (!response.ok) {
      console.log(chalk.yellow(`   ⚠️  Feed ${feedUrl} returned ${response.status}`));
      return [];
    }

    const data = await response.json();
    const playlists = data.items || [];

    // Add feedUrl to each playlist for tracking
    return playlists.map((p) => ({
      ...p,
      feedUrl,
    }));
  } catch (error) {
    console.log(chalk.yellow(`   ⚠️  Failed to fetch from ${feedUrl}: ${error.message}`));
    return [];
  }
}

/**
 * Fetch playlists with pagination and fuzzy filtering to save memory
 *
 * @param {string} feedUrl - Feed API base URL
 * @param {string} searchTerm - Search term for fuzzy filtering
 * @param {number} pageSize - Items per page (default: 50)
 * @param {number} topN - Keep top N matches per page (default: 10)
 * @param {number} maxItems - Maximum total items to fetch (default: 500)
 * @returns {Promise<Array>} Array of best matching playlists
 */
async function fetchPlaylistsWithPagination(
  feedUrl,
  searchTerm,
  pageSize = 50,
  topN = 10,
  maxItems = 500
) {
  const allMatches = [];
  let offset = 0;
  let hasMore = true;
  let totalFetched = 0;

  while (hasMore && totalFetched < maxItems) {
    // Calculate limit for this page (might be less than pageSize on last page)
    const remainingItems = maxItems - totalFetched;
    const currentLimit = Math.min(pageSize, remainingItems);

    try {
      const response = await fetch(
        `${feedUrl}/playlists?limit=${currentLimit}&offset=${offset}&sort=-created`
      );

      if (!response.ok) {
        if (response.status === 404 || response.status === 400) {
          // No more pages or offset not supported
          hasMore = false;
          break;
        }
        break;
      }

      const data = await response.json();
      const playlists = data.items || [];

      if (playlists.length === 0) {
        hasMore = false;
        break;
      }

      totalFetched += playlists.length;

      // Extract titles for fuzzy matching
      const titles = playlists.map((p) => p.title);

      // Fuzzy match on this page
      const results = fuzzysort.go(searchTerm, titles, {
        threshold: -5000, // More lenient threshold
        limit: topN, // Keep only top N per page
      });

      // Map results back to playlist objects
      results.forEach((result) => {
        const playlist = playlists.find((p) => p.title === result.target);
        if (playlist) {
          allMatches.push({
            title: playlist.title,
            id: playlist.id,
            feedUrl,
            score: result.score,
          });
        }
      });

      // Check if we've reached the end
      if (playlists.length < currentLimit) {
        hasMore = false;
      } else {
        offset += playlists.length;
      }
    } catch (_error) {
      hasMore = false;
    }
  }

  return allMatches;
}

/**
 * Fetch all playlists from all configured feeds
 *
 * @returns {Promise<Array>} Array of all playlists from all feeds
 */
async function fetchAllPlaylists() {
  const feedUrls = getFeedApiUrls();

  // Fetch playlists from all feeds in parallel
  const allPlaylistsArrays = await Promise.all(feedUrls.map((url) => fetchPlaylistsFromFeed(url)));

  // Flatten and combine results from all feeds
  return allPlaylistsArrays.flat();
}

/**
 * Search for exact playlist match by name across multiple feeds
 *
 * @param {string} playlistName - Exact playlist name to search for
 * @returns {Promise<Object>} Search result with playlist or error
 */
async function searchExactPlaylist(playlistName) {
  try {
    const playlists = await fetchAllPlaylists();

    if (playlists.length === 0) {
      return {
        success: false,
        error: 'No playlists found in any feed',
      };
    }

    // Find exact match (case-insensitive)
    const normalizedSearchName = playlistName.toLowerCase().trim();
    const exactMatch = playlists.find((p) => p.title.toLowerCase().trim() === normalizedSearchName);

    if (exactMatch) {
      // Fetch full playlist details
      const playlist = await getPlaylistById(exactMatch.id, exactMatch.feedUrl);
      return {
        success: true,
        playlist,
      };
    } else {
      return {
        success: false,
        error: `No exact match found for playlist "${playlistName}"`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Find the best matching playlist using fuzzy string matching with pagination
 *
 * @param {string} searchTerm - Search term to match against
 * @returns {Promise<Object>} Result with best matching playlist name and map
 */
async function findBestMatchingPlaylist(searchTerm) {
  try {
    const feedUrls = getFeedApiUrls();

    // Fetch from all feeds in parallel with pagination and filtering
    const allMatchesArrays = await Promise.all(
      feedUrls.map((url) => fetchPlaylistsWithPagination(url, searchTerm, 50, 10))
    );

    // Flatten and combine results from all feeds
    const allMatches = allMatchesArrays.flat();

    if (allMatches.length === 0) {
      return {
        success: false,
        error: `No matching playlists found for "${searchTerm}"`,
      };
    }

    // Sort by score (highest first) and get best match
    allMatches.sort((a, b) => b.score - a.score);

    // Build playlistMap for ID lookup
    const playlistMap = {};
    allMatches.forEach((match) => {
      playlistMap[match.title] = {
        id: match.id,
        feedUrl: match.feedUrl,
      };
    });

    const bestMatch = allMatches[0].title;

    // Simplified output: only show the best match, not all alternatives
    console.log(chalk.green(`✓ Found: "${bestMatch}"`));

    return {
      success: true,
      bestMatch,
      playlistMap,
      allMatches: allMatches.map((m) => m.title),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get playlist by ID or slug from a specific feed or try all feeds
 *
 * @param {string} idOrSlug - Playlist ID (UUID) or slug
 * @param {string} [feedUrl] - Optional specific feed URL to use
 * @returns {Promise<Object>} Playlist object
 */
async function getPlaylistById(idOrSlug, feedUrl = null) {
  try {
    const feedUrls = feedUrl ? [feedUrl] : getFeedApiUrls();

    // Try each feed URL until we find the playlist
    for (const url of feedUrls) {
      try {
        const response = await fetch(`${url}/playlists/${idOrSlug}`);

        if (response.ok) {
          const playlist = await response.json();
          return playlist;
        }
      } catch (_error) {
        // Continue to next feed
        continue;
      }
    }

    throw new Error(`Playlist "${idOrSlug}" not found in any feed`);
  } catch (error) {
    throw new Error(`Failed to fetch playlist: ${error.message}`);
  }
}

/**
 * Shuffle array using Fisher-Yates algorithm
 *
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get playlist items from a playlist
 *
 * @param {Object} playlist - DP1 playlist object
 * @param {number} quantity - Number of items to extract
 * @param {number} duration - Duration per item in seconds
 * @param {boolean} shuffle - Whether to shuffle and randomly select items
 * @returns {Array<Object>} Array of DP1 playlist items
 */
function extractPlaylistItems(playlist, quantity, duration, shuffle = true) {
  if (!playlist.items || playlist.items.length === 0) {
    return [];
  }

  let items = playlist.items;

  // Shuffle and randomly select if requested
  if (shuffle && items.length > quantity) {
    items = shuffleArray(items);
  }

  // Take requested quantity
  items = items.slice(0, quantity);

  // Override duration and ensure created field exists
  items = items.map((item) => ({
    ...item,
    duration: duration || item.duration,
    created: item.created || new Date().toISOString(), // Ensure created field exists
  }));

  return items;
}

/**
 * Fetch feed playlist (deterministic - exact match only)
 *
 * @param {string} playlistName - Exact playlist name
 * @param {number} quantity - Number of items to fetch
 * @param {number} duration - Duration per item
 * @returns {Promise<Object>} Result with items
 */
async function fetchFeedPlaylistDirect(playlistName, quantity = 5, duration = 10) {
  const feedUrls = getFeedApiUrls();
  console.log(
    chalk.cyan(`Searching for playlist "${playlistName}" in ${feedUrls.length} source(s)...`)
  );

  const result = await searchExactPlaylist(playlistName);

  if (!result.success) {
    console.log(chalk.yellow(`   Playlist not found: ${result.error}`));
    return {
      success: false,
      error: result.error,
      items: [],
    };
  }

  const items = extractPlaylistItems(result.playlist, quantity, duration);

  console.log(chalk.green(`✓ Got ${items.length} item(s)\n`));

  return {
    success: true,
    playlist: result.playlist,
    items,
  };
}

/**
 * Search for playlists using fuzzy matching
 *
 * @param {string} playlistName - Playlist name (can be fuzzy)
 * @param {number} quantity - Number of items to fetch
 * @param {number} duration - Duration per item
 * @returns {Promise<Object>} Result with best match and map for lookup
 */
async function searchFeedPlaylists(playlistName, quantity = 5, duration = 10) {
  const feedUrls = getFeedApiUrls();
  console.log(
    chalk.cyan(`Searching for playlist "${playlistName}" in ${feedUrls.length} source(s)...`)
  );

  const result = await findBestMatchingPlaylist(playlistName);

  if (!result.success) {
    console.log(chalk.yellow(`   Playlist not found: ${result.error}\n`));
    return {
      success: false,
      error: result.error,
    };
  }

  return {
    success: true,
    bestMatch: result.bestMatch,
    playlistMap: result.playlistMap,
    searchTerm: playlistName,
    quantity,
    duration,
  };
}

/**
 * Fetch specific playlist by ID or name and extract items
 *
 * @param {string} playlistIdOrName - Playlist ID, slug, or exact name
 * @param {number} quantity - Number of items to fetch
 * @param {number} duration - Duration per item
 * @param {Object} playlistMap - Optional map of names to IDs for lookup
 * @param {boolean} shuffle - Whether to shuffle and randomly select items
 * @returns {Promise<Object>} Result with items
 */
async function fetchPlaylistItems(
  playlistIdOrName,
  quantity = 5,
  duration = 10,
  playlistMap = null,
  shuffle = true
) {
  try {
    let playlistId = playlistIdOrName;
    let feedUrl = null;

    // If playlistMap provided, look up the ID from the name
    if (playlistMap && playlistMap[playlistIdOrName]) {
      playlistId = playlistMap[playlistIdOrName].id;
      feedUrl = playlistMap[playlistIdOrName].feedUrl;
    }

    const playlist = await getPlaylistById(playlistId, feedUrl);
    const items = extractPlaylistItems(playlist, quantity, duration, shuffle);

    console.log(
      chalk.green(`✓ Got ${items.length} item(s) from "${playlist.title || playlistId}"\n`)
    );

    return {
      success: true,
      playlist,
      items,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      items: [],
    };
  }
}

module.exports = {
  searchExactPlaylist,
  findBestMatchingPlaylist,
  getPlaylistById,
  extractPlaylistItems,
  fetchFeedPlaylistDirect,
  searchFeedPlaylists,
  fetchPlaylistItems,
};
