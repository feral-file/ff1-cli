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

  // Regression: same-name/different-host replace used to drop apiKey and topicID
  test('preserves apiKey and topicID when same-name device moves to a new host', () => {
    const existing = [
      { name: 'kitchen', host: 'http://10.0.0.1:1111', apiKey: 'key-k', topicID: 'topic-k' },
    ];
    const { devices } = upsertDevice(existing, {
      name: 'kitchen',
      host: 'http://10.0.0.99:1111',
    });
    assert.equal(devices[0].host, 'http://10.0.0.99:1111');
    assert.equal(devices[0].apiKey, 'key-k');
    assert.equal(devices[0].topicID, 'topic-k');
  });

  // Regression: setup flow used discoveredName as default, clobbering stored labels
  test('setup: existing host name takes precedence over discovered name on blank response', () => {
    const existing = [{ name: 'kitchen', host: 'http://10.0.0.1:1111' }];
    const existingForHost = existing.find((d) => d.host === 'http://10.0.0.1:1111');
    const existingName = existingForHost?.name || '';
    const discoveredName = 'FF1-HH9JSNOC'; // raw mDNS label from avahi
    const defaultName = existingName || discoveredName || 'ff1';
    const nameAnswer = ''; // user pressed Enter
    const deviceName = nameAnswer || defaultName || 'ff1';

    assert.equal(deviceName, 'kitchen', 'stored label must win over raw mDNS name');
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

  // Regression: when a device moves to a new host, old IPs must be discarded so that
  // --host <old-ip> does not route to the wrong device after the move.
  test('replaces addresses when device moves to a new host (prevents stale-IP routing)', () => {
    const existing = [
      {
        name: 'kitchen',
        host: 'http://192.168.1.10:1111',
        id: 'ff1-hh9jsnoc',
        addresses: ['192.168.1.10'],
      },
    ];
    // Device moved: same id, new host (.local), new IP
    const { devices } = upsertDevice(existing, {
      name: 'kitchen',
      host: 'http://ff1-hh9jsnoc.local:1111',
      id: 'ff1-hh9jsnoc',
      addresses: ['192.168.1.20'],
    });
    assert.equal(devices.length, 1);
    assert.ok(
      !devices[0].addresses?.includes('192.168.1.10'),
      'old IP must not persist after host change'
    );
    assert.ok(devices[0].addresses?.includes('192.168.1.20'), 'new IP must be stored');
  });

  // Regression: addresses must be merged (not replaced) on update so a later discovery
  // reporting only a subset does not shrink the stored set and break the reverse IP lookup.
  test('merges addresses on update rather than replacing them', () => {
    const existing = [
      {
        name: 'kitchen',
        host: 'http://ff1-hh9jsnoc.local:1111',
        id: 'ff1-hh9jsnoc',
        addresses: ['192.168.1.10', 'fe80::1'],
      },
    ];
    // Re-add with only the IPv4 address (e.g. an IPv4-only discovery run)
    const { devices } = upsertDevice(existing, {
      name: 'kitchen',
      host: 'http://ff1-hh9jsnoc.local:1111',
      id: 'ff1-hh9jsnoc',
      addresses: ['192.168.1.10'],
    });
    assert.equal(devices.length, 1);
    assert.ok(devices[0].addresses?.includes('192.168.1.10'), 'IPv4 must be preserved');
    assert.ok(devices[0].addresses?.includes('fe80::1'), 'IPv6 must not be lost on partial update');
  });

  // Regression: device with stored id was not matched when it moved to a new host+name,
  // causing a duplicate entry to be appended.
  test('updates in-place when same id is found even if host changed', () => {
    const existing = [
      { name: 'kitchen', host: 'http://192.168.1.10:1111', id: 'ff1-hh9jsnoc' },
      { name: 'office', host: 'http://192.168.1.11:1111', id: 'ff1-aaabbbcc' },
    ];
    const { devices, updated } = upsertDevice(existing, {
      name: 'kitchen',
      host: 'http://ff1-hh9jsnoc.local:1111',
      id: 'ff1-hh9jsnoc',
    });
    assert.equal(updated, false, 'host changed so not "updated" in same-host sense');
    assert.equal(devices.length, 2, 'must not create a duplicate');
    assert.equal(devices[0].host, 'http://ff1-hh9jsnoc.local:1111', 'host must be updated');
    assert.equal(devices[0].id, 'ff1-hh9jsnoc', 'id must be preserved');
  });

  // Regression: callers pass id: undefined when discoveredId is absent; spreads with undefined
  // values used to overwrite a previously stored id with undefined.
  test('does not erase a stored id when caller passes id: undefined', () => {
    const existing = [{ name: 'kitchen', host: 'http://10.0.0.1:1111', id: 'ff1-hh9jsnoc' }];
    const { devices } = upsertDevice(existing, {
      name: 'kitchen-renamed',
      host: 'http://10.0.0.1:1111',
      id: undefined,
    });
    assert.equal(devices[0].id, 'ff1-hh9jsnoc', 'stored id must survive a no-id update');
  });
});
