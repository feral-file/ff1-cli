/**
 * In-Memory Registry for Playlists and Items
 * Reduces AI context usage by storing full objects and passing only IDs
 */

// Internal storage
const itemRegistry = new Map();
const playlistRegistry = new Map();

/**
 * Store a playlist item in the registry
 *
 * @param {string} id - Item ID
 * @param {Object} item - Full DP1 item object
 */
function storeItem(id, item) {
  if (!id) {
    throw new Error('Item ID is required');
  }
  itemRegistry.set(id, item);
}

/**
 * Retrieve a playlist item from the registry
 *
 * @param {string} id - Item ID
 * @returns {Object|undefined} DP1 item object or undefined
 */
function getItem(id) {
  return itemRegistry.get(id);
}

/**
 * Check if an item exists in the registry
 *
 * @param {string} id - Item ID
 * @returns {boolean} True if item exists
 */
function hasItem(id) {
  return itemRegistry.has(id);
}

/**
 * Store a playlist in the registry
 *
 * @param {string} id - Playlist ID
 * @param {Object} playlist - Full DP1 playlist object
 */
function storePlaylist(id, playlist) {
  if (!id) {
    throw new Error('Playlist ID is required');
  }
  playlistRegistry.set(id, playlist);
}

/**
 * Retrieve a playlist from the registry
 *
 * @param {string} id - Playlist ID
 * @returns {Object|undefined} DP1 playlist object or undefined
 */
function getPlaylist(id) {
  return playlistRegistry.get(id);
}

/**
 * Check if a playlist exists in the registry
 *
 * @param {string} id - Playlist ID
 * @returns {boolean} True if playlist exists
 */
function hasPlaylist(id) {
  return playlistRegistry.has(id);
}

/**
 * Clear all registries
 * Should be called after successful playlist build or on error
 */
function clearRegistries() {
  itemRegistry.clear();
  playlistRegistry.clear();
}

/**
 * Get registry statistics (for debugging)
 *
 * @returns {Object} Registry stats
 */
function getStats() {
  return {
    itemCount: itemRegistry.size,
    playlistCount: playlistRegistry.size,
  };
}

module.exports = {
  storeItem,
  getItem,
  hasItem,
  storePlaylist,
  getPlaylist,
  hasPlaylist,
  clearRegistries,
  getStats,
};
