import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DP1_PLAYLIST_SIGNING_ROLES,
  formatUnsupportedPlaylistSigningRoleError,
  isDp1PlaylistSigningRole,
  normalizeDp1PlaylistSigningRole,
  resolveDp1PlaylistSigningRole,
} = require('../src/utilities/playlist-signing-role.js') as {
  DP1_PLAYLIST_SIGNING_ROLES: readonly string[];
  formatUnsupportedPlaylistSigningRoleError: (role: string) => string;
  isDp1PlaylistSigningRole: (role: string) => boolean;
  normalizeDp1PlaylistSigningRole: (value: unknown, defaultRole?: unknown) => string;
  resolveDp1PlaylistSigningRole: (role: string, fallbackRole?: string) => string;
};

describe('DP-1 playlist signing role helpers', () => {
  test('recognizes the supported signing roles', () => {
    for (const role of DP1_PLAYLIST_SIGNING_ROLES) {
      assert.equal(isDp1PlaylistSigningRole(role), true, `${role} must be supported`);
    }

    assert.equal(isDp1PlaylistSigningRole('owner'), false);
  });

  test('resolves explicit and fallback roles after trimming whitespace', () => {
    assert.equal(resolveDp1PlaylistSigningRole('  feed  '), 'feed');
    assert.equal(resolveDp1PlaylistSigningRole('', '  curator  '), 'curator');
  });

  test('normalizes non-string fallback roles to the default agent role', () => {
    assert.equal(normalizeDp1PlaylistSigningRole(undefined, 123), 'agent');
    assert.equal(resolveDp1PlaylistSigningRole('', 123 as never), 'agent');
  });

  test('rejects invalid explicit or fallback roles with a consistent error', () => {
    assert.throws(
      () => resolveDp1PlaylistSigningRole('owner'),
      /Unsupported DP-1 playlist signing role "owner"/
    );
    assert.throws(
      () => resolveDp1PlaylistSigningRole('', 'owner'),
      /Unsupported DP-1 playlist signing role "owner"/
    );
    assert.match(
      formatUnsupportedPlaylistSigningRoleError('owner'),
      /Expected one of: agent, feed, curator, institution, licensor/
    );
  });
});
