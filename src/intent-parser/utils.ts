/**
 * Intent Parser Utilities
 * Validation and constraint enforcement for parsed requirements
 */

import chalk from 'chalk';
import type { Config, Requirement, PlaylistSettings } from '../types';

interface RequirementParams {
  requirements: Requirement[];
  playlistSettings?: Partial<PlaylistSettings>;
}

/**
 * Apply constraints to parsed requirements
 *
 * @param {Object} params - Parsed parameters
 * @param {Array<Object>} params.requirements - Array of requirements
 * @param {Object} [params.playlistSettings] - Playlist settings
 * @param {Object} config - Application config
 * @returns {Object} Validated parameters
 */
export function applyConstraints(params: RequirementParams, config: Config): RequirementParams {
  // Validate requirements array
  if (!params.requirements || !Array.isArray(params.requirements)) {
    throw new Error('Requirements must be an array');
  }

  if (params.requirements.length === 0) {
    throw new Error('At least one requirement is needed');
  }

  // Validate each requirement
  params.requirements = params.requirements.map((req, index) => {
    const r = req as unknown as Record<string, unknown>;
    if (!r.type) {
      throw new Error(`Requirement ${index + 1}: type is required`);
    }

    // Validate based on type
    if (r.type === 'build_playlist') {
      if (!r.blockchain) {
        throw new Error(`Requirement ${index + 1}: blockchain is required for build_playlist`);
      }
      if (!r.contractAddress) {
        throw new Error(`Requirement ${index + 1}: contractAddress is required for build_playlist`);
      }
      if (!r.tokenIds || (r.tokenIds as unknown[]).length === 0) {
        throw new Error(`Requirement ${index + 1}: tokenIds are required for build_playlist`);
      }
    } else if (r.type === 'query_address') {
      if (!r.ownerAddress) {
        throw new Error(`Requirement ${index + 1}: ownerAddress is required for query_address`);
      }
    } else if (r.type === 'fetch_feed') {
      if (!r.playlistName) {
        throw new Error(`Requirement ${index + 1}: playlistName is required for fetch_feed`);
      }
    } else {
      throw new Error(`Requirement ${index + 1}: invalid type "${r.type}"`);
    }

    // Set default quantity if not provided
    const quantity = (r.quantity as number) || 5;

    return {
      ...r,
      quantity: Math.min(quantity, 20), // Cap at 20 items per requirement
      tokenIds: (r.tokenIds as string[]) || [],
    } as Requirement;
  });

  // Apply total cap if all requirements exceed 20 items total
  const totalRequested = params.requirements.reduce((sum, r) => sum + (r.quantity || 0), 0);
  if (totalRequested > 20) {
    console.log(
      chalk.yellow(
        `\n⚠️  Total requested items (${totalRequested}) exceeds maximum (20). Reducing proportionally...\n`
      )
    );

    const scale = 20 / totalRequested;
    let allocated = 0;

    params.requirements = params.requirements.map((req, index) => {
      if (index === params.requirements.length - 1) {
        // Last requirement gets remainder
        return {
          ...req,
          quantity: 20 - allocated,
        };
      } else {
        const newQuantity = Math.max(1, Math.floor((req.quantity || 0) * scale));
        allocated += newQuantity;
        return {
          ...req,
          quantity: newQuantity,
        };
      }
    });

    console.log(chalk.yellow('   Adjusted quantities:'));
    params.requirements.forEach((r) => {
      if (r.type === 'fetch_feed') {
        console.log(chalk.yellow(`   - Feed "${r.playlistName}": ${r.quantity} items`));
      } else if (r.type === 'query_address') {
        console.log(chalk.yellow(`   - Address ${r.ownerAddress}: ${r.quantity} items`));
      } else if (r.type === 'build_playlist') {
        const contractAddr = r.contractAddress;
        console.log(
          chalk.yellow(
            `   - ${r.blockchain}${contractAddr ? ' ' + contractAddr.substring(0, 10) + '...' : ''}: ${r.quantity} items`
          )
        );
      }
    });
    console.log();
  }

  // Set playlist defaults
  if (!params.playlistSettings) {
    params.playlistSettings = {};
  }

  // Only set durationPerItem if not already specified
  if (params.playlistSettings.durationPerItem === undefined) {
    params.playlistSettings.durationPerItem = config.defaultDuration || 10;
  }

  // Only set preserveOrder if not already specified
  if (params.playlistSettings.preserveOrder === undefined) {
    params.playlistSettings.preserveOrder = true;
  }

  return params;
}
