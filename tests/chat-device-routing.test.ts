/**
 * Regression tests for --device flag routing in buildPlaylist.
 *
 * Critical path 1: when the intent parser returns action:'send_playlist' without
 * a deviceName, the CLI --device flag (options.deviceName) must be used as the
 * fallback. The resolution logic is isolated in resolveEffectiveDeviceName so it
 * can be tested without mocking the full intent-parser/utilities stack.
 *
 * Critical path 2: a build-only chat intent with --device must NOT implicitly
 * send to hardware. buildPlaylistDirect (src/utilities/index.js:526) sends
 * whenever playlistSettings.deviceName is defined, so the CLI flag must NOT be
 * merged into playlistSettings before the intent is resolved.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveEffectiveDeviceName, applyPlaylistDefaults } from '../src/main';

describe('resolveEffectiveDeviceName', () => {
  // Regression: before fix, CLI --device was ignored on the send_playlist path
  test('uses CLI flag when intent has no deviceName', () => {
    assert.equal(resolveEffectiveDeviceName(undefined, 'office'), 'office');
  });

  test('intent deviceName takes precedence over CLI flag', () => {
    assert.equal(resolveEffectiveDeviceName('kitchen', 'office'), 'kitchen');
  });

  test('returns undefined when neither intent nor CLI provides a device', () => {
    assert.equal(resolveEffectiveDeviceName(undefined, undefined), undefined);
  });

  test('intent deviceName used when CLI flag is absent', () => {
    assert.equal(resolveEffectiveDeviceName('kitchen', undefined), 'kitchen');
  });
});

describe('build-only chat with --device does not implicitly send', () => {
  // Regression: the CLI --device flag was previously merged into
  // playlistSettings.deviceName before the intent was resolved, causing
  // buildPlaylistDirect to dispatch to hardware for every build-only intent.
  // The merge was removed; playlistSettings.deviceName must stay undefined
  // when the intent parser did not set it.
  test('applyPlaylistDefaults leaves deviceName undefined when intent omits it', () => {
    const settings = applyPlaylistDefaults({});
    assert.equal(
      settings.deviceName,
      undefined,
      'deviceName must be undefined so buildPlaylistDirect does not dispatch to hardware'
    );
  });

  test('applyPlaylistDefaults preserves intent deviceName when set', () => {
    const settings = applyPlaylistDefaults({ deviceName: 'kitchen' });
    assert.equal(settings.deviceName, 'kitchen');
  });
});
