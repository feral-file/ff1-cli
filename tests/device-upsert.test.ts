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

  // Regression: re-adding a named device with a new host used to append to the end,
  // silently changing devices[0] (the implicit default for play/send/ssh).
  test('preserves array position when same-name device moves to a new host', () => {
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
    assert.equal(devices.length, 2);
    // kitchen must still be at index 0 — it was the implicit default
    assert.equal(devices[0].name, 'kitchen');
    assert.equal(devices[0].host, 'http://10.0.0.99:1111');
    // office must still be at index 1
    assert.equal(devices[1].name, 'office');
  });
});
