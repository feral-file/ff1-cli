/**
 * Supported DP-1 playlist signing roles.
 *
 * Keep this list aligned with the published dp1-js role constants so guided
 * setup, config validation, and signing all agree on the same contract.
 */
const DP1_PLAYLIST_SIGNING_ROLES = Object.freeze([
  'agent',
  'feed',
  'curator',
  'institution',
  'licensor',
]);

function isDp1PlaylistSigningRole(role) {
  return typeof role === 'string' && DP1_PLAYLIST_SIGNING_ROLES.includes(role);
}

function formatUnsupportedPlaylistSigningRoleError(role) {
  return `Unsupported DP-1 playlist signing role "${role}". Expected one of: ${DP1_PLAYLIST_SIGNING_ROLES.join(', ')}`;
}

function normalizeDp1PlaylistSigningRole(value, defaultRole = 'agent') {
  const trimmedValue = typeof value === 'string' ? value.trim() : '';
  if (trimmedValue) {
    return trimmedValue;
  }

  const trimmedDefault = typeof defaultRole === 'string' ? defaultRole.trim() : '';
  return trimmedDefault || 'agent';
}

function resolveDp1PlaylistSigningRole(role, fallbackRole = 'agent') {
  const candidate = normalizeDp1PlaylistSigningRole(role, fallbackRole);

  if (!isDp1PlaylistSigningRole(candidate)) {
    throw new Error(formatUnsupportedPlaylistSigningRoleError(candidate));
  }

  return candidate;
}

module.exports = {
  DP1_PLAYLIST_SIGNING_ROLES,
  isDp1PlaylistSigningRole,
  formatUnsupportedPlaylistSigningRoleError,
  normalizeDp1PlaylistSigningRole,
  resolveDp1PlaylistSigningRole,
};
