/**
 * Address Validator
 * Validates Ethereum and Tezos wallet addresses
 */

import { isAddress as viemIsAddress, getAddress } from 'viem';

/**
 * Validate Ethereum address format
 * Uses viem library for EIP-55 checksum validation
 *
 * @param {string} address - Address to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether address is valid Ethereum format
 * @returns {string} [returns.error] - Error message if invalid
 * @returns {string} [returns.normalized] - Checksummed address if valid
 * @example
 * const result = validateEthereumAddress('0x1234567890123456789012345678901234567890');
 * if (result.valid) console.log(result.normalized);
 */
export function validateEthereumAddress(address: string): {
  valid: boolean;
  error?: string;
  normalized?: string;
} {
  if (!address || typeof address !== 'string') {
    return {
      valid: false,
      error: 'Address must be a non-empty string',
    };
  }

  try {
    // viem's isAddress checks format and returns true/false
    if (!viemIsAddress(address)) {
      return {
        valid: false,
        error: 'Invalid Ethereum address format. Must be 0x followed by 40 hex characters',
      };
    }

    // getAddress returns the checksummed address
    const normalized = getAddress(address);
    return {
      valid: true,
      normalized,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Address validation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Validate Tezos address format
 * Checks tz1, tz2, tz3, and KT1 address prefixes
 *
 * @param {string} address - Address to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether address is valid Tezos format
 * @returns {string} [returns.error] - Error message if invalid
 * @returns {string} [returns.type] - Address type (user, contract)
 * @example
 * const result = validateTezosAddress('tz1VSUr8wwNhLAzempoch5d6hLKEUNvD14');
 * if (result.valid) console.log(result.type);
 */
export function validateTezosAddress(address: string): {
  valid: boolean;
  error?: string;
  type?: string;
} {
  if (!address || typeof address !== 'string') {
    return {
      valid: false,
      error: 'Address must be a non-empty string',
    };
  }

  // Tezos addresses use base58 encoding with specific prefixes
  // tz1, tz2, tz3: user/implicit accounts (34 chars total, or longer with suffix)
  // KT1: contracts (34 chars total, or longer with suffix)
  // Base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
  const userAddressRegex =
    /^tz[1-3][123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{30,}$/;
  const contractAddressRegex =
    /^KT1[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{30,}$/;

  if (userAddressRegex.test(address)) {
    return {
      valid: true,
      type: 'user',
    };
  }

  if (contractAddressRegex.test(address)) {
    return {
      valid: true,
      type: 'contract',
    };
  }

  return {
    valid: false,
    error: 'Invalid Tezos address format. Must start with tz1/tz2/tz3 (user) or KT1 (contract)',
  };
}

/**
 * Validate mixed Ethereum and Tezos addresses
 * Detects address type and applies appropriate validation
 *
 * @param {Array<string>} addresses - Array of addresses to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether all addresses are valid
 * @returns {Array<Object>} returns.results - Validation result for each address
 * @returns {Array<string>} returns.errors - List of error messages
 * @example
 * const result = validateAddresses(['0x...', 'tz1...']);
 * if (!result.valid) console.log(result.errors);
 */
export function validateAddresses(addresses: unknown[]): {
  valid: boolean;
  results: Array<{
    address: string;
    valid: boolean;
    type: string;
    normalized?: string;
    error?: string;
  }>;
  errors: string[];
} {
  const results = [];
  const errors: string[] = [];

  if (!Array.isArray(addresses)) {
    errors.push('Input must be an array of addresses');
    return { valid: false, results, errors };
  }

  if (addresses.length === 0) {
    errors.push('At least one address is required for validation');
    return { valid: false, results, errors };
  }

  for (const address of addresses) {
    if (typeof address !== 'string') {
      errors.push(`Invalid input: ${JSON.stringify(address)} is not a string`);
      results.push({
        address: String(address),
        valid: false,
        type: 'unknown',
        error: 'Address must be a string',
      });
      continue;
    }

    const trimmed = address.trim();

    // Try Ethereum first (starts with 0x)
    if (trimmed.startsWith('0x')) {
      const ethResult = validateEthereumAddress(trimmed);
      if (ethResult.valid) {
        results.push({
          address: trimmed,
          valid: true,
          type: 'ethereum',
          normalized: ethResult.normalized,
        });
      } else {
        const errorMsg = `Invalid Ethereum address "${trimmed}": ${ethResult.error}`;
        errors.push(errorMsg);
        results.push({
          address: trimmed,
          valid: false,
          type: 'ethereum',
          error: ethResult.error,
        });
      }
    } else if (trimmed.startsWith('tz') || trimmed.startsWith('KT1')) {
      // Try Tezos
      const tezResult = validateTezosAddress(trimmed);
      if (tezResult.valid) {
        results.push({
          address: trimmed,
          valid: true,
          type: tezResult.type || 'tezos',
        });
      } else {
        const errorMsg = `Invalid Tezos address "${trimmed}": ${tezResult.error}`;
        errors.push(errorMsg);
        results.push({
          address: trimmed,
          valid: false,
          type: 'tezos',
          error: tezResult.error,
        });
      }
    } else {
      const errorMsg = `Unknown address format "${trimmed}". Must start with 0x (Ethereum) or tz/KT1 (Tezos)`;
      errors.push(errorMsg);
      results.push({
        address: trimmed,
        valid: false,
        type: 'unknown',
        error: 'Must be Ethereum (0x...) or Tezos (tz1/tz2/tz3/KT1)',
      });
    }
  }

  const allValid = results.every((r) => r.valid);
  return {
    valid: allValid,
    results,
    errors,
  };
}
