import { Bonjour } from 'bonjour-service';
import { execFile } from 'child_process';

export interface FF1DiscoveredDevice {
  name: string;
  host: string;
  port: number;
  id?: string;
  fqdn?: string;
  txt?: Record<string, string>;
}

export interface FF1DiscoveryResult {
  devices: FF1DiscoveredDevice[];
  error?: string;
}

interface DiscoveryOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Normalize mDNS TXT records to string values.
 *
 * @param {Record<string, unknown> | undefined} record - Raw TXT record object from mDNS
 * @returns {Record<string, string>} Normalized TXT records
 * @example
 * normalizeTxtRecords({ id: 'ff1-1234', name: 'Studio FF1' });
 */
function normalizeTxtRecords(record?: Record<string, unknown>): Record<string, string> {
  if (!record) {
    return {};
  }
  return Object.entries(record).reduce<Record<string, string>>((accumulator, [key, value]) => {
    if (typeof value === 'string') {
      accumulator[key] = value;
      return accumulator;
    }
    if (Buffer.isBuffer(value)) {
      accumulator[key] = value.toString('utf8');
      return accumulator;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      accumulator[key] = String(value);
    }
    return accumulator;
  }, {});
}

/**
 * Normalize mDNS hostnames by trimming a trailing dot.
 *
 * @param {string} host - Raw host from mDNS results
 * @returns {string} Normalized host
 * @example
 * normalizeMdnsHost('ff1-1234.local.');
 */
function normalizeMdnsHost(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

/**
 * Extract a hostname-based ID from an mDNS host when possible.
 *
 * @param {string} host - Normalized mDNS host
 * @returns {string} Hostname-based ID when available
 * @example
 * getHostnameId('ff1-03vdu3x1.local');
 */
function getHostnameId(host: string): string {
  if (!host) {
    return '';
  }
  if (host.includes(':')) {
    return '';
  }
  if (/^[0-9.]+$/.test(host)) {
    return '';
  }
  if (host.endsWith('.local')) {
    return host.split('.')[0] || '';
  }
  if (!host.includes('.')) {
    return host;
  }
  return '';
}

/**
 * Parse avahi-browse -t -r output into FF1DiscoveredDevice list.
 * Handles resolved records (lines starting with '=') with hostname/address/port/txt fields.
 * Exported for testing.
 */
export function parseAvahiBrowseOutput(output: string): FF1DiscoveredDevice[] {
  const devices = new Map<string, FF1DiscoveredDevice>();
  const lines = output.split('\n');
  let current: (Partial<FF1DiscoveredDevice> & { rawHost?: string }) | null = null;

  for (const line of lines) {
    // Resolved record header: "=  wlan0 IPv4 FF1-HH9JSNOC   _ff1._tcp   local"
    if (/^=\s/.test(line)) {
      if (current?.rawHost) {
        const host = normalizeMdnsHost(current.rawHost).toLowerCase();
        const key = `${host}:${current.port ?? 1111}`;
        const id = getHostnameId(host) || current.id;
        devices.set(key, {
          name: current.name || id || host,
          host,
          port: current.port ?? 1111,
          id,
          txt: current.txt,
        });
      }
      const parts = line.trim().split(/\s+/);
      // parts: ['=', 'wlan0', 'IPv4', 'My Device Name', '_ff1._tcp', 'local']
      // Service name may be multi-word; find the type token to bound the slice.
      // Preserve original case — resolveConfiguredDevice does exact-match lookups.
      const typeIndex = parts.indexOf('_ff1._tcp');
      const serviceName = typeIndex > 3 ? parts.slice(3, typeIndex).join(' ') : parts[3] || '';
      current = { name: serviceName };
      continue;
    }

    if (!current) {
      continue;
    }

    const hostnameMatch = line.match(/^\s+hostname\s*=\s*\[(.+)\]/);
    if (hostnameMatch) {
      current.rawHost = hostnameMatch[1];
      continue;
    }

    const portMatch = line.match(/^\s+port\s*=\s*\[(\d+)\]/);
    if (portMatch) {
      current.port = parseInt(portMatch[1], 10);
      continue;
    }

    const txtMatch = line.match(/^\s+txt\s*=\s*\[(.+)\]/);
    if (txtMatch) {
      const txt: Record<string, string> = {};
      const pairs = txtMatch[1].matchAll(/"([^=]+)=([^"]*)"/g);
      for (const [, k, v] of pairs) {
        txt[k] = v;
      }
      current.txt = txt;
      if (txt.name) {
        current.name = txt.name;
      }
      if (txt.id) {
        current.id = txt.id;
      }
      continue;
    }
  }

  // Flush last record
  if (current?.rawHost) {
    const host = normalizeMdnsHost(current.rawHost).toLowerCase();
    const key = `${host}:${current.port ?? 1111}`;
    const id = getHostnameId(host) || current.id;
    devices.set(key, {
      name: current.name || id || host,
      host,
      port: current.port ?? 1111,
      id,
      txt: current.txt,
    });
  }

  return Array.from(devices.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover FF1 devices using avahi-browse (Linux).
 * Returns null if avahi-browse is not available.
 */
function discoverViaAvahi(options: DiscoveryOptions): Promise<FF1DiscoveryResult | null> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    execFile(
      'avahi-browse',
      ['-t', '-r', '_ff1._tcp'],
      { timeout: timeoutMs },
      (error, stdout, _stderr) => {
        if (error && !stdout) {
          // avahi-browse not available or failed with no output
          resolve(null);
          return;
        }
        try {
          const devices = parseAvahiBrowseOutput(stdout);
          resolve({ devices });
        } catch (_parseError) {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Discover FF1 devices via mDNS using the `_ff1._tcp` service.
 * On Linux, uses avahi-browse for reliable multi-device discovery.
 * Falls back to bonjour-service on other platforms or if avahi is unavailable.
 *
 * @param {Object} [options] - Discovery options
 * @param {number} [options.timeoutMs] - How long to browse before returning results (bonjour fallback only)
 * @returns {Promise<FF1DiscoveryResult>} Discovered FF1 devices and optional error
 * @throws {Error} Never throws; returns empty list on errors
 * @example
 * const result = await discoverFF1Devices();
 */
export async function discoverFF1Devices(
  options: DiscoveryOptions = {}
): Promise<FF1DiscoveryResult> {
  if (process.platform === 'linux') {
    const avahiResult = await discoverViaAvahi(options);
    if (avahiResult !== null) {
      return avahiResult;
    }
  }

  return discoverViaBonjour(options);
}

function discoverViaBonjour(options: DiscoveryOptions): Promise<FF1DiscoveryResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: FF1DiscoveredDevice[], error?: string) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve({ devices: result, error });
    };

    try {
      const bonjour = new Bonjour();
      const devices = new Map<string, FF1DiscoveredDevice>();
      const browser = bonjour.find({ type: 'ff1', protocol: 'tcp' });

      const finalize = (error?: string) => {
        try {
          browser.stop();
          bonjour.destroy();
        } catch (_error) {
          finish([], error || 'mDNS discovery failed while stopping the browser');
          return;
        }
        const result = Array.from(devices.values()).sort((left, right) =>
          left.name.localeCompare(right.name)
        );
        finish(result, error);
      };

      const timeoutHandle = setTimeout(() => finalize(), timeoutMs);

      browser.on('up', (service) => {
        const host = normalizeMdnsHost(service.host || service.fqdn || '');
        if (!host) {
          return;
        }
        const port = service.port || 1111;
        const txt = normalizeTxtRecords(service.txt as Record<string, unknown> | undefined);
        const name = txt.name || service.name || txt.id || host;
        const hostId = getHostnameId(host);
        const id = hostId || txt.id || undefined;
        const key = `${host}:${port}`;

        devices.set(key, {
          name,
          host,
          port,
          id,
          fqdn: service.fqdn,
          txt,
        });
      });

      browser.on('error', (error) => {
        clearTimeout(timeoutHandle);
        const message = error instanceof Error ? error.message : String(error);
        try {
          browser.stop();
          bonjour.destroy();
        } catch (_error) {
          finish([], `mDNS discovery failed: ${message || 'failed to stop browser after error'}`);
          return;
        }
        finalize(`mDNS discovery failed: ${message || 'discovery error'}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finish([], `mDNS discovery failed: ${message || 'discovery error'}`);
    }
  });
}
