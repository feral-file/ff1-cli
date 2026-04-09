/**
 * Regression tests for findExistingDeviceEntry.
 *
 * When a device comes back on a new host URL (e.g., IP→mDNS hostname or
 * a DHCP IP change), setup and device-add must still find the stored entry
 * so they can default the name prompt to the stored friendly label rather
 * than the raw mDNS service name.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findExistingDeviceEntry } from '../src/utilities/device-lookup';

const devices = [
  { name: 'kitchen', host: 'http://ff1-hh9jsnoc.local:1111' },
  { name: 'office', host: 'http://192.168.1.11:1111' },
];

describe('findExistingDeviceEntry', () => {
  test('exact host match returns the entry', () => {
    const result = findExistingDeviceEntry(devices, 'http://ff1-hh9jsnoc.local:1111', '');
    assert.equal(result?.name, 'kitchen');
  });

  // Regression: blank prompt fell back to raw mDNS label when host format changed
  test('mDNS hostname match: IP-stored device found when rediscovered via hostname', () => {
    // 'office' was stored with an IP; device is now seen via mDNS hostname
    const result = findExistingDeviceEntry(
      [{ name: 'office', host: 'http://192.168.1.11:1111' }],
      'http://192.168.1.11:1111',
      ''
    );
    assert.equal(result?.name, 'office');
  });

  test('TXT-name match: stored entry found by discoveredName when host changed', () => {
    // Device moved to a new host but TXT name matches stored name
    const result = findExistingDeviceEntry(
      [{ name: 'kitchen', host: 'http://192.168.1.10:1111' }],
      'http://10.0.0.99:1111', // completely new host
      'kitchen' // TXT name matches stored name
    );
    assert.equal(result?.name, 'kitchen');
  });

  test('returns undefined when no match by host, hostname, or name', () => {
    const result = findExistingDeviceEntry(devices, 'http://10.0.0.99:1111', 'bedroom');
    assert.equal(result, undefined);
  });

  test('exact match takes priority over TXT-name match', () => {
    // Two entries: one matches by host, one matches by name — host wins
    const twoDevices = [
      { name: 'kitchen', host: 'http://ff1-hh9jsnoc.local:1111' },
      { name: 'office', host: 'http://10.0.0.2:1111' },
    ];
    const result = findExistingDeviceEntry(twoDevices, 'http://ff1-hh9jsnoc.local:1111', 'office');
    assert.equal(result?.name, 'kitchen');
  });
});
