import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { promoteDeviceToDefault } from '../src/utilities/device-default';
import type { DeviceEntry } from '../src/utilities/device-upsert';

const sample = (): DeviceEntry[] => [
  { name: 'kitchen', host: 'http://192.168.1.10:1111', id: 'ff1-kkk' },
  { name: 'office', host: 'http://192.168.1.11:1111', id: 'ff1-ooo' },
  { name: 'studio', host: 'http://192.168.1.12:1111' },
];

describe('promoteDeviceToDefault', () => {
  test('moves the named device to index 0 and preserves the rest in order', () => {
    const { devices, promoted, alreadyDefault } = promoteDeviceToDefault(sample(), 'office');
    assert.equal(alreadyDefault, false);
    assert.equal(promoted.name, 'office');
    assert.deepEqual(
      devices.map((d) => d.name),
      ['office', 'kitchen', 'studio']
    );
  });

  test('is case-insensitive on name', () => {
    const { devices } = promoteDeviceToDefault(sample(), 'OFFICE');
    assert.equal(devices[0].name, 'office');
  });

  test('matches by host URL for unnamed/legacy entries', () => {
    const devices: DeviceEntry[] = [
      { name: 'kitchen', host: 'http://192.168.1.10:1111' },
      { host: 'http://192.168.1.99:1111' },
    ];
    const result = promoteDeviceToDefault(devices, 'http://192.168.1.99:1111');
    assert.equal(result.devices[0].host, 'http://192.168.1.99:1111');
    assert.equal(result.devices[1].name, 'kitchen');
  });

  test('reports alreadyDefault when the target is already first', () => {
    const { devices, alreadyDefault } = promoteDeviceToDefault(sample(), 'kitchen');
    assert.equal(alreadyDefault, true);
    assert.deepEqual(
      devices.map((d) => d.name),
      ['kitchen', 'office', 'studio']
    );
  });

  test('throws when identifier does not match any device', () => {
    assert.throws(() => promoteDeviceToDefault(sample(), 'bathroom'), /not found/);
  });

  test('does not mutate the input array', () => {
    const input = sample();
    const before = input.map((d) => d.name);
    promoteDeviceToDefault(input, 'office');
    assert.deepEqual(
      input.map((d) => d.name),
      before
    );
  });
});
