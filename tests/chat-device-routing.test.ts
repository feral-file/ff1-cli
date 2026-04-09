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
import {
  resolveEffectiveDeviceName,
  resolveSendPlaylistDeviceName,
  applyPlaylistDefaults,
  SEND_SHORTCUT_PATTERN,
  resolveSendShortcutDevice,
} from '../src/main';

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

  // Regression: the direct send_playlist path in main.ts must sanitize parser-emitted
  // sentinel strings before resolving. A literal "null" from the intent parser is truthy
  // and would override the CLI --device fallback without sanitization.
  test('parser-emitted "null" string must be sanitized to undefined before resolution', () => {
    const rawDeviceName = 'null'; // parser emitted string "null"
    const sanitized = rawDeviceName === 'null' || rawDeviceName === '' ? undefined : rawDeviceName;
    assert.equal(resolveEffectiveDeviceName(sanitized, 'office'), 'office');
  });
});

// ---------------------------------------------------------------------------
// resolveSendPlaylistDeviceName — end-to-end send_playlist device routing
//
// These tests exercise the exported helper that buildPlaylist calls on the
// send_playlist action path. They verify the full sanitize→resolve pipeline
// that was previously only tested via the lower-level helper stubs.
// ---------------------------------------------------------------------------
describe('resolveSendPlaylistDeviceName (send_playlist action path)', () => {
  test('uses CLI --device when intent emits no deviceName', () => {
    assert.equal(resolveSendPlaylistDeviceName(undefined, 'kitchen'), 'kitchen');
  });

  test('uses CLI --device when intent emits null deviceName', () => {
    assert.equal(resolveSendPlaylistDeviceName(null, 'kitchen'), 'kitchen');
  });

  test('uses CLI --device when intent emits literal "null" string', () => {
    assert.equal(resolveSendPlaylistDeviceName('null', 'kitchen'), 'kitchen');
  });

  test('uses CLI --device when intent emits empty string deviceName', () => {
    assert.equal(resolveSendPlaylistDeviceName('', 'kitchen'), 'kitchen');
  });

  test('intent deviceName takes precedence over CLI --device when valid', () => {
    assert.equal(resolveSendPlaylistDeviceName('office', 'kitchen'), 'office');
  });

  test('returns undefined when both intent and CLI provide no device', () => {
    assert.equal(resolveSendPlaylistDeviceName(undefined, undefined), undefined);
  });
});

// ---------------------------------------------------------------------------
// Send-shortcut branch — drives SEND_SHORTCUT_PATTERN + resolveSendShortcutDevice
// These tests exercise the branch inside buildPlaylist that handles inline
// "send last / send to <device>" requests typed during a chat session.
// ---------------------------------------------------------------------------
describe('send shortcut branch device routing', () => {
  test('matches "send" with no target', () => {
    assert(SEND_SHORTCUT_PATTERN.test('send'));
  });

  test('matches "send last"', () => {
    assert(SEND_SHORTCUT_PATTERN.test('send last'));
  });

  test('matches "send to office" and extracts device name', () => {
    const m = SEND_SHORTCUT_PATTERN.exec('send to office');
    assert(m, 'pattern must match');
    assert.equal(resolveSendShortcutDevice(m, undefined), 'office');
  });

  test('does not match a regular chat request', () => {
    assert(!SEND_SHORTCUT_PATTERN.test('get 3 works from reas.eth'));
    assert(!SEND_SHORTCUT_PATTERN.test('send email to team'));
  });

  // Regression: CLI --device flag was not reaching the send shortcut path
  test('CLI --device is used as fallback when shortcut has no target device', () => {
    const m = SEND_SHORTCUT_PATTERN.exec('send last');
    assert(m, 'pattern must match');
    assert.equal(
      resolveSendShortcutDevice(m, 'office'),
      'office',
      '--device CLI flag must reach the send shortcut branch'
    );
  });

  test('inline device overrides CLI --device flag', () => {
    const m = SEND_SHORTCUT_PATTERN.exec('send to kitchen');
    assert(m, 'pattern must match');
    assert.equal(resolveSendShortcutDevice(m, 'office'), 'kitchen');
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
