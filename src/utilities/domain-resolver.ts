/**
 * Domain Resolution Utilities
 * Resolves blockchain domain names (ENS, TNS) to their corresponding addresses
 */

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import axios from 'axios';
import chalk from 'chalk';
import * as logger from '../logger';

/**
 * Domain resolution result
 */
export interface DomainResolution {
  domain: string;
  address: string | null;
  resolved: boolean;
  error?: string;
}

/**
 * Batch domain resolution result
 */
export interface BatchResolutionResult {
  success: boolean;
  resolutions: DomainResolution[];
  domainMap: Record<string, string>;
  errors: string[];
}

/**
 * ENS resolver using viem
 */
class ENSResolver {
  private client;

  constructor() {
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(),
    });
  }

  /**
   * Resolve an ENS domain to its Ethereum address
   *
   * @param {string} domain - ENS domain (e.g., 'vitalik.eth')
   * @returns {Promise<string|null>} Resolved address or null
   */
  async resolve(domain: string): Promise<string | null> {
    try {
      const address = await this.client.getEnsAddress({
        name: normalize(domain),
      });
      return address;
    } catch (error) {
      logger.debug(`ENS resolution failed for ${domain}: ${error}`);
      return null;
    }
  }
}

/**
 * TNS (Tezos Name Service) resolver using Tezos Domains GraphQL API
 *
 * Uses the official Tezos Domains API for reliable resolution
 * API: https://api.tezos.domains/graphql
 */
class TNSResolver {
  private apiUrl: string;

  constructor() {
    this.apiUrl = 'https://api.tezos.domains/graphql';
  }

  /**
   * Resolve a TNS domain to its Tezos address using GraphQL API
   *
   * @param {string} domain - TNS domain (e.g., 'alice.tez', 'einstein-rosen.tez')
   * @returns {Promise<string|null>} Resolved address or null
   */
  async resolve(domain: string): Promise<string | null> {
    try {
      // GraphQL query to resolve domain (using GET request)
      // Note: API only supports 'address' field, not 'expiry'
      const query = `{ domain(name: "${domain}") { address } }`;

      const response = await axios.get(this.apiUrl, {
        params: { query },
        timeout: 10000,
      });

      if (response.data?.errors) {
        logger.debug(
          `TNS API returned errors for ${domain}: ${JSON.stringify(response.data.errors)}`
        );
        return null;
      }

      const domainData = response.data?.data?.domain;

      if (!domainData || !domainData.address) {
        logger.debug(`TNS domain ${domain} not found - domainData: ${JSON.stringify(domainData)}`);
        return null;
      }

      logger.debug(`TNS resolved ${domain} → ${domainData.address}`);
      return domainData.address;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug(`TNS resolution failed for ${domain}: ${errorMessage}`);
      return null;
    }
  }
}

/**
 * Determine domain type based on TLD
 *
 * @param {string} domain - Domain name
 * @returns {string|null} Domain type ('ens', 'tns') or null
 */
function getDomainType(domain: string): string | null {
  const normalizedDomain = domain.toLowerCase();

  if (normalizedDomain.endsWith('.eth')) {
    return 'ens';
  } else if (normalizedDomain.endsWith('.tez')) {
    return 'tns';
  }

  return null;
}

/**
 * Validate domain name format
 *
 * @param {string} domain - Domain to validate
 * @returns {boolean} Whether domain is valid
 */
function isValidDomain(domain: string): boolean {
  if (!domain || typeof domain !== 'string') {
    return false;
  }

  const trimmedDomain = domain.trim();
  if (trimmedDomain.length === 0) {
    return false;
  }

  const domainType = getDomainType(trimmedDomain);
  return domainType !== null;
}

/**
 * Resolve a single domain to its blockchain address
 *
 * @param {string} domain - Domain name to resolve (e.g., 'vitalik.eth', 'alice.tez')
 * @returns {Promise<DomainResolution>} Resolution result
 * @example
 * const result = await resolveDomain('vitalik.eth');
 * if (result.resolved) {
 *   console.log(`${result.domain} -> ${result.address}`);
 * }
 */
export async function resolveDomain(domain: string): Promise<DomainResolution> {
  const trimmedDomain = domain.trim();

  // Validate domain
  if (!isValidDomain(trimmedDomain)) {
    return {
      domain: trimmedDomain,
      address: null,
      resolved: false,
      error: `Invalid or unsupported domain: ${trimmedDomain}`,
    };
  }

  const domainType = getDomainType(trimmedDomain);

  try {
    let address: string | null = null;

    if (domainType === 'ens') {
      const ensResolver = new ENSResolver();
      address = await ensResolver.resolve(trimmedDomain);
    } else if (domainType === 'tns') {
      const tnsResolver = new TNSResolver();
      address = await tnsResolver.resolve(trimmedDomain);
    }

    if (!address) {
      return {
        domain: trimmedDomain,
        address: null,
        resolved: false,
        error: `Could not resolve ${trimmedDomain}`,
      };
    }

    return {
      domain: trimmedDomain,
      address,
      resolved: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during resolution';
    logger.debug(`Domain resolution error for ${trimmedDomain}: ${errorMessage}`);

    return {
      domain: trimmedDomain,
      address: null,
      resolved: false,
      error: errorMessage,
    };
  }
}

/**
 * Resolve multiple domains in batch (concurrent processing)
 *
 * Supports ENS (.eth) and TNS (.tez) domains.
 * Processes all domains concurrently for optimal performance.
 *
 * @param {string[]} domains - Array of domain names to resolve
 * @returns {Promise<BatchResolutionResult>} Batch resolution result with domain->address map
 * @example
 * const result = await resolveDomainsBatch(['vitalik.eth', 'alice.tez']);
 * if (result.success) {
 *   console.log(result.domainMap); // { 'vitalik.eth': '0x...', 'alice.tez': 'tz...' }
 * }
 */
export async function resolveDomainsBatch(domains: string[]): Promise<BatchResolutionResult> {
  // Validate input
  if (!Array.isArray(domains) || domains.length === 0) {
    return {
      success: false,
      resolutions: [],
      domainMap: {},
      errors: ['No domains provided for resolution'],
    };
  }

  logger.debug(`Resolving ${domains.length} domains in batch...`);

  // Resolve all domains concurrently
  const resolutionPromises = domains.map((domain) => resolveDomain(domain));
  const resolutions = await Promise.all(resolutionPromises);

  // Build domain map and collect errors
  const domainMap: Record<string, string> = {};
  const errors: string[] = [];

  for (const resolution of resolutions) {
    if (resolution.resolved && resolution.address) {
      domainMap[resolution.domain] = resolution.address;
    } else if (resolution.error) {
      errors.push(`${resolution.domain}: ${resolution.error}`);
    }
  }

  const successfulResolutions = resolutions.filter((r) => r.resolved).length;
  logger.debug(`Batch resolution complete: ${successfulResolutions}/${domains.length} successful`);

  return {
    success: successfulResolutions > 0,
    resolutions,
    domainMap,
    errors,
  };
}

/**
 * Display batch resolution results in a user-friendly format
 *
 * @param {BatchResolutionResult} result - Batch resolution result
 */
export function displayResolutionResults(result: BatchResolutionResult): void {
  if (result.resolutions.length === 0) {
    console.log(chalk.yellow('No names to resolve'));
    return;
  }

  // Display successful resolutions
  const successful = result.resolutions.filter((r) => r.resolved);
  if (successful.length > 0) {
    successful.forEach((resolution) => {
      console.log(chalk.dim(`  ${resolution.domain} → ${resolution.address}`));
    });
  }

  // Display failures (but don't make them too prominent)
  const failed = result.resolutions.filter((r) => !r.resolved);
  if (failed.length > 0) {
    failed.forEach((resolution) => {
      console.log(
        chalk.yellow(`  ${resolution.domain}: ${resolution.error || 'Could not resolve'}`)
      );
    });
  }

  console.log();
}
