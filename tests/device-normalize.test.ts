/**
 * Tests for normalizeDeviceHost and normalizeDeviceIdToHost.
 *
 * These functions handle user-pasted or auto-detected input, so they must be
 * robust to variations in case, trailing dots, missing schemes, and bare IPv6.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeDeviceHost, normalizeDeviceIdToHost } from '../src/utilities/device-normalize';

describe('normalizeDeviceHost', () => {
  test('lowercase http:// URL is returned unchanged (port already present)', () => {
    assert.equal(normalizeDeviceHost('http://192.168.1.10:1111'), 'http://192.168.1.10:1111');
  });

  test('adds default port 1111 when port is absent', () => {
    assert.equal(normalizeDeviceHost('http://192.168.1.10'), 'http://192.168.1.10:1111');
  });

  test('prepends http:// when scheme is missing', () => {
    assert.equal(normalizeDeviceHost('192.168.1.10:1111'), 'http://192.168.1.10:1111');
  });

  // Regression: uppercase scheme (HTTP://) must not be double-prefixed with http://
  test('uppercase HTTP:// scheme is normalised without double-prefix', () => {
    assert.equal(normalizeDeviceHost('HTTP://192.168.1.10:1111'), 'http://192.168.1.10:1111');
  });

  test('uppercase HTTPS:// scheme is normalised correctly', () => {
    assert.equal(normalizeDeviceHost('HTTPS://192.168.1.10:1111'), 'https://192.168.1.10:1111');
  });

  test('bare IPv6 address is bracketed and gets default port', () => {
    assert.equal(normalizeDeviceHost('fe80::1'), 'http://[fe80::1]:1111');
  });

  test('bare IPv6 address with port is handled via bracket wrapping', () => {
    // After bracketing: '[fe80::1]' → prepend http:// → 'http://[fe80::1]' → port 1111
    assert.equal(normalizeDeviceHost('fe80::1'), 'http://[fe80::1]:1111');
  });

  test('.local hostname gets default port when missing', () => {
    assert.equal(normalizeDeviceHost('ff1-hh9jsnoc.local'), 'http://ff1-hh9jsnoc.local:1111');
  });

  test('trailing dot is stripped before normalisation', () => {
    assert.equal(normalizeDeviceHost('ff1-hh9jsnoc.local.'), 'http://ff1-hh9jsnoc.local:1111');
  });
});

describe('normalizeDeviceIdToHost', () => {
  test('bare device suffix is prefixed with ff1- and gets .local', () => {
    assert.equal(normalizeDeviceIdToHost('hh9jsnoc'), 'http://ff1-hh9jsnoc.local:1111');
  });

  test('ff1- prefixed id is kept and gets .local', () => {
    assert.equal(normalizeDeviceIdToHost('ff1-hh9jsnoc'), 'http://ff1-hh9jsnoc.local:1111');
  });

  // Regression: uppercase pasted id like FF1-HH9JSNOC must not produce ff1-FF1-HH9JSNOC
  test('uppercase FF1-HH9JSNOC is normalised to lowercase ff1-hh9jsnoc.local', () => {
    assert.equal(normalizeDeviceIdToHost('FF1-HH9JSNOC'), 'http://ff1-hh9jsnoc.local:1111');
  });

  // Regression: uppercase HH9JSNOC (no prefix) must produce ff1-hh9jsnoc, not ff1-HH9JSNOC
  test('uppercase suffix HH9JSNOC is lowercased before adding ff1- prefix', () => {
    assert.equal(normalizeDeviceIdToHost('HH9JSNOC'), 'http://ff1-hh9jsnoc.local:1111');
  });

  test('IP address is treated as a host, not a device id', () => {
    assert.equal(normalizeDeviceIdToHost('192.168.1.10'), 'http://192.168.1.10:1111');
    assert.equal(normalizeDeviceIdToHost('192.168.1.10:1111'), 'http://192.168.1.10:1111');
  });

  // Regression: uppercase HTTP:// must not be double-prefixed
  test('uppercase HTTP:// URL input is normalised correctly', () => {
    assert.equal(normalizeDeviceIdToHost('HTTP://192.168.1.10:1111'), 'http://192.168.1.10:1111');
  });

  test('.local hostname input is treated as a host, not a device id', () => {
    assert.equal(normalizeDeviceIdToHost('ff1-hh9jsnoc.local'), 'http://ff1-hh9jsnoc.local:1111');
  });
});
