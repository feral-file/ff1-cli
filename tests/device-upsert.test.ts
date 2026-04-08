import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { upsertDevice } from '../src/utilities/device-upsert';

describe('upsertDevice', () => {
  test('inserts a new device', () => {
    const { devices, updated } = upsertDevice([], {
      name: 'kitchen',
      host: 'http://10.0.0.1:1111',
    });
    assert.equal(updated, false);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, 'kitchen');
  });

  test('updates in-place when the same host is re-added', () => {
    const existing = [{ name: 'kitchen', host: 'http://10.0.0.1:1111' }];
    const { devices, updated } = upsertDevice(existing, {
      name: 'kitchen-renamed',
      host: 'http://10.0.0.1:1111',
    });
    assert.equal(updated, true);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, 'kitchen-renamed');
  });

  // Regression: blank name prompt during re-add used to clobber the saved label
  test('preserves stored label when blank name would be used — caller must pass existing name', () => {
    const existing = [
      { name: 'kitchen', host: 'http://10.0.0.1:1111' },
      { name: 'office', host: 'http://10.0.0.2:1111' },
    ];
    // Simulate the device add flow: existing name is used as default when user presses Enter
    const existingIndex = existing.findIndex((d) => d.host === 'http://10.0.0.1:1111');
    const existingName = existingIndex !== -1 ? existing[existingIndex].name || '' : '';
    const discoveredName = 'ff1-hh9jsnoc'; // raw mDNS label
    const defaultName = existingName || discoveredName || '';
    const nameAnswer = ''; // user pressed Enter
    const deviceName = nameAnswer || defaultName || 'ff1';

    assert.equal(deviceName, 'kitchen'); // must not become 'ff1-hh9jsnoc' or 'ff1'

    const { devices, updated } = upsertDevice(existing, {
      name: deviceName,
      host: 'http://10.0.0.1:1111',
    });
    assert.equal(updated, true);
    assert.equal(devices[existingIndex].name, 'kitchen');
  });

  // Regression: re-adding a named device with a new host used to leave a stale duplicate
  test('removes stale entry with same name when host changes', () => {
    const existing = [
      { name: 'kitchen', host: 'http://10.0.0.1:1111' },
      { name: 'office', host: 'http://10.0.0.2:1111' },
    ];
    // kitchen moved to a new IP
    const { devices, updated } = upsertDevice(existing, {
      name: 'kitchen',
      host: 'http://10.0.0.99:1111',
    });
    assert.equal(updated, false);
    assert.equal(devices.length, 2); // no duplicate; old kitchen entry was removed
    const kitchen = devices.find((d) => d.name === 'kitchen');
    assert.equal(kitchen?.host, 'http://10.0.0.99:1111');
  });
});
