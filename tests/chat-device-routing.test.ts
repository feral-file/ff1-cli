/**
 * Regression tests for --device flag routing in buildPlaylist.
 *
 * Critical path: when the intent parser returns action:'send_playlist' without
 * a deviceName, the CLI --device flag (options.deviceName) must be used as the
 * fallback. The resolution logic is isolated in resolveEffectiveDeviceName so it
 * can be tested without mocking the full intent-parser/utilities stack.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveEffectiveDeviceName } from '../src/main';

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
