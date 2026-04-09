/**
 * Regression tests for parseAvahiBrowseOutput.
 *
 * The Linux mDNS path must preserve original case and handle multi-word service
 * names. resolveConfiguredDevice() does exact-match lookups, so any case
 * mutation or truncation makes a discovered device impossible to target later.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseAvahiBrowseOutput, resolveAvahiResult } from '../src/utilities/ff1-discovery';

const makeAvahiRecord = ({
  serviceName,
  hostname,
  port = 1111,
  txtName,
}: {
  serviceName: string;
  hostname: string;
  port?: number;
  txtName?: string;
}): string => {
  const txtLine = txtName ? `   txt = ["name=${txtName}"]` : '   txt = []';
  return [
    `=  wlan0 IPv4 ${serviceName} _ff1._tcp local`,
    `   hostname = [${hostname}]`,
    `   address = [192.168.1.10]`,
    `   port = [${port}]`,
    txtLine,
  ].join('\n');
};

describe('parseAvahiBrowseOutput', () => {
  // Regression: service names were lowercased, breaking exact-match routing
  test('preserves mixed-case service name when no TXT name is present', () => {
    const output = makeAvahiRecord({
      serviceName: 'FF1-Office',
      hostname: 'ff1-office.local.',
    });
    const devices = parseAvahiBrowseOutput(output);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, 'FF1-Office');
  });

  // Regression: multi-word names were truncated to the first word
  test('preserves multi-word service name', () => {
    const output = makeAvahiRecord({
      serviceName: 'Living Room Display',
      hostname: 'ff1-abc123.local.',
    });
    const devices = parseAvahiBrowseOutput(output);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, 'Living Room Display');
  });

  test('TXT name overrides the header service name', () => {
    const output = makeAvahiRecord({
      serviceName: 'FF1-HH9JSNOC',
      hostname: 'ff1-hh9jsnoc.local.',
      txtName: 'kitchen',
    });
    const devices = parseAvahiBrowseOutput(output);
    assert.equal(devices[0].name, 'kitchen');
  });

  test('parses two records from one avahi-browse session', () => {
    const block1 = makeAvahiRecord({ serviceName: 'FF1-AAA', hostname: 'ff1-aaa.local.' });
    const block2 = makeAvahiRecord({ serviceName: 'FF1-BBB', hostname: 'ff1-bbb.local.' });
    const devices = parseAvahiBrowseOutput(`${block1}\n${block2}`);
    assert.equal(devices.length, 2);
    const names = devices.map((d) => d.name).sort();
    assert.deepEqual(names, ['FF1-AAA', 'FF1-BBB']);
  });

  test('returns empty array for empty output', () => {
    assert.deepEqual(parseAvahiBrowseOutput(''), []);
  });

  test('returns empty array for output with no resolved records', () => {
    const output = '+  wlan0 IPv4 FF1-AAA _ff1._tcp local\n';
    assert.deepEqual(parseAvahiBrowseOutput(output), []);
  });

  test('recovers the complete record before a truncated second record', () => {
    const complete = makeAvahiRecord({ serviceName: 'FF1-AAA', hostname: 'ff1-aaa.local.' });
    // Truncated second record — only the header line, no hostname/port/txt
    const truncated = '=  wlan0 IPv4 FF1-BBB _ff1._tcp local';
    const devices = parseAvahiBrowseOutput(`${complete}\n${truncated}`);
    // The complete record is still returned; the truncated one is silently dropped
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, 'FF1-AAA');
  });
});

// ---------------------------------------------------------------------------
// resolveAvahiResult — tests for the execFile error branch
// ---------------------------------------------------------------------------
describe('resolveAvahiResult', () => {
  const usableStdout = makeAvahiRecord({
    serviceName: 'FF1-Office',
    hostname: 'ff1-office.local.',
  });
  const unusableStdout = '+  wlan0 IPv4 FF1-Office _ff1._tcp local\n';

  test('clean exit returns parsed devices', () => {
    const result = resolveAvahiResult(null, usableStdout);
    assert(result !== null);
    assert.equal(result.devices.length, 1);
  });

  test('clean exit with empty stdout returns empty device list (not null)', () => {
    const result = resolveAvahiResult(null, '');
    assert(result !== null);
    assert.deepEqual(result.devices, []);
  });

  // Regression: non-zero + usable devices must NOT fall through to Bonjour
  test('non-zero exit with usable stdout returns the parsed devices', () => {
    const result = resolveAvahiResult(new Error('avahi exit 1'), usableStdout);
    assert(result !== null, 'must return devices, not null');
    assert.equal(result.devices.length, 1);
    assert.equal(result.devices[0].name, 'FF1-Office');
  });

  // Non-zero + no usable output → Bonjour fallback
  test('non-zero exit with no stdout returns null', () => {
    assert.equal(resolveAvahiResult(new Error('ENOENT'), ''), null);
  });

  test('non-zero exit with announcement-only stdout returns null', () => {
    assert.equal(resolveAvahiResult(new Error('exit 1'), unusableStdout), null);
  });

  test('non-zero exit with unparseable stdout returns null', () => {
    assert.equal(resolveAvahiResult(new Error('exit 2'), 'garbage\x00data'), null);
  });
});
