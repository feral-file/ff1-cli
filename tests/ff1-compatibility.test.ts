import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  assertFF1CommandCompatibility,
  resolveConfiguredDevice,
} from '../src/utilities/ff1-compatibility';

interface FF1DeviceForTest {
  host?: string;
  name?: string;
  apiKey?: string;
  topicID?: string;
}

interface VersionApiResponse {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}

type FetchHandler = (url: string, options?: RequestInit) => VersionApiResponse;

let fixtureDir: string;
const originalCwd = process.cwd();
const originalFetch = global.fetch;
let requests: string[] = [];

const installFetchMock = (handler: FetchHandler): void => {
  global.fetch = (async (url: RequestInfo | URL, options?: RequestInit) => {
    const requestUrl = typeof url === 'string' ? url : url.toString();
    requests.push(`${options?.method || 'GET'} ${requestUrl}`);
    return handler(requestUrl, options) as unknown as Response;
  }) as unknown as typeof global.fetch;
};

const clearFetchMock = (): void => {
  global.fetch = originalFetch;
  requests = [];
};

const writeDeviceConfig = (devices: FF1DeviceForTest[]): void => {
  writeFileSync(
    path.join(process.cwd(), 'config.json'),
    JSON.stringify({
      ff1Devices: {
        devices,
      },
    }),
    'utf8'
  );
};

describe('resolveConfiguredDevice', () => {
  beforeEach(() => {
    fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'ff1-compatibility-test-'));
    process.chdir(fixtureDir);
    requests = [];
  });

  afterEach(() => {
    clearFetchMock();
    if (fixtureDir && existsSync(fixtureDir)) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
    process.chdir(originalCwd);
  });

  test('returns the first configured device when no deviceName is provided', () => {
    writeDeviceConfig([
      { name: 'Frame 1', host: 'http://ff1-frame-1.local' },
      { name: 'Frame 2', host: 'http://ff1-frame-2.local' },
    ]);

    const result = resolveConfiguredDevice();

    assert.equal(result.success, true);
    assert.equal(result.device?.host, 'http://ff1-frame-1.local');
    assert.equal(result.device?.name, 'Frame 1');
  });

  test('finds the named device when a deviceName is provided', () => {
    writeDeviceConfig([
      { name: 'Frame 1', host: 'http://ff1-frame-1.local' },
      { name: 'Frame 2', host: 'http://ff1-frame-2.local' },
    ]);

    const result = resolveConfiguredDevice('Frame 2');

    assert.equal(result.success, true);
    assert.equal(result.device?.host, 'http://ff1-frame-2.local');
  });

  test('returns a clear error when no devices are configured', () => {
    writeDeviceConfig([]);

    const result = resolveConfiguredDevice();

    assert.equal(result.success, false);
    assert.equal(
      result.error,
      'No FF1 devices configured. Add devices to config.json under "ff1Devices"'
    );
  });

  test('returns a clear error when the requested device name does not exist', () => {
    writeDeviceConfig([{ name: 'Frame 1', host: 'http://ff1-frame-1.local' }]);

    const result = resolveConfiguredDevice('Missing');

    assert.equal(result.success, false);
    assert.equal(result.error, 'Device "Missing" not found. Available devices: Frame 1');
  });
});

describe('assertFF1CommandCompatibility', () => {
  beforeEach(() => {
    fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'ff1-compatibility-test-'));
    process.chdir(fixtureDir);
    requests = [];
  });

  afterEach(() => {
    clearFetchMock();
    if (fixtureDir && existsSync(fixtureDir)) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
    process.chdir(originalCwd);
  });

  test('returns compatible when version cannot be detected', async () => {
    installFetchMock((_url) => {
      return {
        status: 500,
        ok: false,
        text: async () => JSON.stringify({ error: 'not available' }),
      };
    });

    const result = await assertFF1CommandCompatibility(
      { host: 'http://ff1.local' },
      'displayPlaylist'
    );

    assert.equal(result.compatible, true);
    assert.equal(result.version, undefined);
    assert.equal(requests.length, 4);
    assert.equal(requests[0], 'GET http://ff1.local/api/version');
    assert.equal(requests[3], 'POST http://ff1.local/api/cast');
  });

  test('flags device versions that are below minimum', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/version')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ version: '0.9.0' }),
        };
      }

      const responseBody = 'not checked';
      return {
        status: 500,
        ok: false,
        text: async () => responseBody,
      };
    });

    const result = await assertFF1CommandCompatibility({ host: 'http://ff1.local' }, 'sshAccess');

    assert.equal(result.compatible, false);
    assert.equal(result.version, '0.9.0');
    assert.equal(result.source, '/api/version');
    assert.match(
      result.error || '',
      /Unsupported FF1 OS 0\.9\.0 for sshAccess\. FF1 OS must be 1\.0\.0 or newer\./
    );
    assert.match(result.error || '', /FF1 OS 0\.9\.0/);
  });

  test('accepts supported versions and reads nested metadata keys', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/version')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ payload: { info: { firmwareVersion: '2.1' } } }),
        };
      }

      return {
        status: 500,
        ok: false,
        text: async () => JSON.stringify({ error: 'not needed' }),
      };
    });

    const result = await assertFF1CommandCompatibility(
      { host: 'http://ff1.local' },
      'displayPlaylist'
    );

    assert.equal(result.compatible, true);
    assert.equal(result.version, '2.1.0');
    assert.equal(result.source, '/api/version');
  });

  test('falls back to /api/cast version command when needed', async () => {
    installFetchMock((url) => {
      if (
        url.endsWith('/api/version') ||
        url.endsWith('/api/info') ||
        url.endsWith('/api/status')
      ) {
        return {
          status: 404,
          ok: false,
          text: async () => 'not found',
        };
      }

      if (url.endsWith('/api/cast')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ osVersion: '1.0.1' }),
        };
      }

      return {
        status: 500,
        ok: false,
        text: async () => 'unexpected endpoint',
      };
    });

    const result = await assertFF1CommandCompatibility(
      { host: 'http://ff1.local' },
      'displayPlaylist'
    );

    assert.equal(result.compatible, true);
    assert.equal(result.version, '1.0.1');
    assert.equal(result.source, '/api/cast (command version)');
    assert.equal(requests.length, 4);
    assert.equal(requests[3], 'POST http://ff1.local/api/cast');
  });
});
