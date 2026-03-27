import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientDeviceNetworkError } from '../src/utilities/ff1-device';

describe('isTransientDeviceNetworkError', () => {
  it('returns true for undici fetch failed resolver errors', () => {
    const error = new Error('fetch failed', {
      cause: { code: 'ENOTFOUND' },
    });

    assert.equal(isTransientDeviceNetworkError(error), true);
  });

  it('returns true for no-route message', () => {
    const error = new Error('connect EHOSTUNREACH: No route to host');

    assert.equal(isTransientDeviceNetworkError(error), true);
  });

  it('returns false for non-network errors', () => {
    const error = new Error('Unexpected token < in JSON at position 0');

    assert.equal(isTransientDeviceNetworkError(error), false);
  });
});
