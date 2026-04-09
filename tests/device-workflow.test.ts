/**
 * End-to-end workflow tests: avahi-browse parsing → device selection → lookup → upsert.
 *
 * These tests exercise the full Linux discovery path (parseAvahiBrowseOutput) wired
 * into the selection-to-upsert pipeline so that regressions in any single step
 * surface as a broken workflow rather than a missing unit test.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseAvahiBrowseOutput } from '../src/utilities/ff1-discovery';
import { findExistingDeviceEntry } from '../src/utilities/device-lookup';
import { upsertDevice } from '../src/utilities/device-upsert';

/** Simulate the selection step: map a discovered device to the host URL used by the CLI. */
function toHostValue(device: { host: string; port: number }): string {
  return `http://${device.host}:${device.port}`;
}

describe('device add / setup workflow (avahi → lookup → upsert)', () => {
  // Regression: re-running setup after a device is already configured must update
  // in-place and must not append a duplicate entry.
  test('avahi re-discovery does not duplicate a fully configured entry', () => {
    const avahiOutput = [
      '=  wlan0 IPv4 FF1-HH9JSNOC _ff1._tcp local',
      '   hostname = [ff1-hh9jsnoc.local.]',
      '   address = [192.168.1.10]',
      '   port = [1111]',
      '   txt = ["name=kitchen" "id=ff1-hh9jsnoc"]',
    ].join('\n');

    const discovered = parseAvahiBrowseOutput(avahiOutput);
    assert.equal(discovered.length, 1);
    const device = discovered[0];
    const newHost = toHostValue(device);

    const stored = [
      { name: 'kitchen', host: newHost, id: 'ff1-hh9jsnoc', addresses: ['192.168.1.10'] },
      { name: 'office', host: 'http://192.168.1.11:1111', id: 'ff1-aaabbbcc' },
    ];

    const existingEntry = findExistingDeviceEntry(
      stored,
      newHost,
      device.name,
      device.id,
      device.addresses
    );
    assert.equal(existingEntry?.name, 'kitchen', 'lookup must find the existing entry');

    const { devices } = upsertDevice(stored, {
      name: existingEntry?.name ?? device.name,
      host: newHost,
      id: device.id,
      addresses: device.addresses,
    });

    assert.equal(devices.length, 2, 'no duplicate must be created');
    assert.equal(devices[0].name, 'kitchen');
    assert.equal(devices[0].host, newHost);
  });

  // Regression: IP ↔ .local migration — device was stored with an IP host (pre-id
  // config); avahi now reports it via its .local hostname and includes the resolved IP
  // in the address field. The workflow must recognise the match and update in-place.
  test('IP→.local migration: avahi address bridges the gap for a pre-id stored entry', () => {
    const avahiOutput = [
      '=  wlan0 IPv4 FF1-HH9JSNOC _ff1._tcp local',
      '   hostname = [ff1-hh9jsnoc.local.]',
      '   address = [192.168.1.10]', // same IP as stored entry
      '   port = [1111]',
      '   txt = ["name=kitchen" "id=ff1-hh9jsnoc"]',
    ].join('\n');

    const discovered = parseAvahiBrowseOutput(avahiOutput);
    const device = discovered[0];
    const newHost = toHostValue(device);

    // Pre-id stored entry: IP host, no id, curated name that matches TXT name
    const stored = [{ name: 'kitchen', host: 'http://192.168.1.10:1111' }];

    const existingEntry = findExistingDeviceEntry(
      stored,
      newHost,
      device.name,
      device.id,
      device.addresses
    );
    assert.equal(existingEntry?.name, 'kitchen', 'lookup must find entry via avahi address');

    const { devices } = upsertDevice(stored, {
      name: existingEntry?.name ?? device.name,
      host: newHost,
      id: device.id,
      addresses: device.addresses,
    });

    assert.equal(devices.length, 1, 'no duplicate must be created');
    assert.equal(devices[0].host, newHost, 'host must be migrated to .local');
    assert.equal(devices[0].id, 'ff1-hh9jsnoc', 'id must be persisted for future lookups');
  });

  // Regression: dual-stack device emits IPv4 + IPv6 resolved records; the merged
  // entry must carry both addresses and still produce a single config row.
  test('dual-stack avahi output produces one entry with both IP addresses', () => {
    const avahiOutput = [
      '=  wlan0 IPv6 FF1-HH9JSNOC _ff1._tcp local',
      '   hostname = [ff1-hh9jsnoc.local.]',
      '   address = [fe80::1]',
      '   port = [1111]',
      '   txt = ["name=kitchen" "id=ff1-hh9jsnoc"]',
      '=  wlan0 IPv4 FF1-HH9JSNOC _ff1._tcp local',
      '   hostname = [ff1-hh9jsnoc.local.]',
      '   address = [192.168.1.10]',
      '   port = [1111]',
      '   txt = ["name=kitchen" "id=ff1-hh9jsnoc"]',
    ].join('\n');

    const discovered = parseAvahiBrowseOutput(avahiOutput);
    assert.equal(discovered.length, 1, 'dual-stack records must merge into one entry');
    const device = discovered[0];

    assert.ok(device.addresses?.includes('192.168.1.10'), 'IPv4 address must be present');
    assert.ok(device.addresses?.includes('fe80::1'), 'IPv6 address must be present');

    const stored = [{ name: 'kitchen', host: 'http://192.168.1.10:1111' }];
    const newHost = toHostValue(device);
    const existingEntry = findExistingDeviceEntry(
      stored,
      newHost,
      device.name,
      device.id,
      device.addresses
    );
    assert.equal(existingEntry?.name, 'kitchen');

    const { devices } = upsertDevice(stored, {
      name: existingEntry?.name ?? device.name,
      host: newHost,
      id: device.id,
      addresses: device.addresses,
    });

    assert.equal(devices.length, 1, 'no duplicate must be created');
    assert.ok(devices[0].addresses?.includes('192.168.1.10'));
    assert.ok(devices[0].addresses?.includes('fe80::1'));
  });
});
