/**
 * Main Flow Controller
 * Handles both deterministic and AI-driven playlist creation
 */

// Suppress Ed25519 experimental warning immediately
const originalEmitWarning = process.emitWarning;
type WarningType = string | { name?: string } | undefined;
process.emitWarning = function (warning: unknown, type?: WarningType, ctor?: unknown) {
  if (
    ((typeof type === 'string' && type === 'ExperimentalWarning') ||
      (typeof type === 'object' && type?.name === 'ExperimentalWarning')) &&
    typeof warning === 'string' &&
    warning.includes('Ed25519')
  ) {
    return; // Suppress this warning
  }
  return originalEmitWarning.apply(this, [warning as never, type as never, ctor as never]);
} as unknown as typeof process.emitWarning;

import chalk from 'chalk';
import * as readline from 'readline';
import { getConfig } from './config';
import * as logger from './logger';
import type {
  Requirement,
  PlaylistSettings,
  BuildPlaylistParams,
  BuildPlaylistOptions,
  BuildPlaylistResult,
  Playlist,
} from './types';

// Lazy load utilities and orchestrator to avoid circular dependencies
// eslint-disable-next-line @typescript-eslint/no-require-imports
const getUtilities = () => require('./utilities');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const getIntentParser = () => require('./intent-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const getAIOrchestrator = () => require('./ai-orchestrator');

/**
 * Validate and apply constraints to requirements
 *
 * @param {Array<Object>} requirements - Array of requirements
 * @returns {Array<Object>} Validated requirements
 */
export function validateRequirements(requirements: Requirement[]): Requirement[] {
  if (!requirements || !Array.isArray(requirements) || requirements.length === 0) {
    throw new Error('At least one requirement is needed');
  }

  return requirements.map((req, index) => {
    // Validate based on requirement type
    if (req.type === 'fetch_feed') {
      // Feed playlist requirement - only needs playlistName and quantity
      if (!req.playlistName) {
        throw new Error(`Requirement ${index + 1}: playlistName is required for fetch_feed`);
      }
      return {
        ...req,
        quantity: Math.min(req.quantity || 5, 20),
      };
    }

    // Query address requirement
    if (req.type === 'query_address') {
      // Query all NFTs from an owner address
      if (!req.ownerAddress) {
        throw new Error(`Requirement ${index + 1}: ownerAddress is required for query_address`);
      }
      return {
        ...req,
        quantity: req.quantity ? Math.min(req.quantity, 100) : undefined,
      };
    }

    // Build playlist requirement
    if (req.type === 'build_playlist') {
      if (!req.blockchain) {
        throw new Error(`Requirement ${index + 1}: blockchain is required for build_playlist`);
      }

      if (!req.tokenIds || req.tokenIds.length === 0) {
        throw new Error(`Requirement ${index + 1}: at least one token ID is required`);
      }

      return {
        ...req,
        quantity: Math.min(req.quantity || req.tokenIds.length, 20),
        tokenIds: req.tokenIds || [],
      };
    }

    throw new Error(`Requirement ${index + 1}: invalid type "${(req as { type?: string }).type}"`);
  });
}

/**
 * Apply playlist settings defaults
 *
 * @param {Object} settings - Playlist settings
 * @returns {Object} Settings with defaults
 */
export function applyPlaylistDefaults(settings: Partial<PlaylistSettings> = {}): PlaylistSettings {
  const config = getConfig();

  return {
    title: settings.title || null,
    slug: settings.slug || null,
    durationPerItem: settings.durationPerItem || config.defaultDuration || 10,
    preserveOrder: settings.preserveOrder !== false,
    deviceName: settings.deviceName,
  };
}

/**
 * Build playlist deterministically from structured parameters
 * Path 1: Direct execution (no AI)
 *
 * @param {Object} params - Playlist parameters
 * @param {Array<Object>} params.requirements - Array of requirements
 * @param {Object} [params.playlistSettings] - Playlist settings
 * @param {Object} options - Options
 * @param {boolean} [options.verbose=false] - Verbose output
 * @param {string} [options.outputPath='playlist.json'] - Output path
 * @returns {Promise<Object>} Result with playlist
 */
export async function buildPlaylistDirect(
  params: BuildPlaylistParams,
  options: BuildPlaylistOptions = {}
): Promise<BuildPlaylistResult> {
  const requirements = validateRequirements(params.requirements);
  const playlistSettings = applyPlaylistDefaults(params.playlistSettings);

  const utilities = getUtilities();
  const config = getConfig();

  // Initialize utilities with config (indexer endpoint, API key, etc.)
  utilities.initializeUtilities(config);

  return await utilities.buildPlaylistDirect({ requirements, playlistSettings }, options);
}

/**
 * Build playlist from natural language request
 * Path 2: AI-driven execution (intent parser → AI orchestrator → utilities)
 *
 * @param {string} userRequest - Natural language request
 * @param {Object} options - Options
 * @param {boolean} [options.verbose=false] - Verbose output
 * @param {string} [options.outputPath='playlist.json'] - Output path
 * @param {string} [options.modelName] - AI model to use
 * @param {boolean} [options.interactive=true] - Interactive mode (allow clarification prompts)
 * @returns {Promise<Object>} Result with playlist
 */
export async function buildPlaylist(
  userRequest: string,
  options: BuildPlaylistOptions = {}
): Promise<BuildPlaylistResult | null> {
  const { verbose = false, outputPath = 'playlist.json', modelName, interactive = true } = options;

  // Enable verbose logging if requested
  if (verbose) {
    logger.setVerbose(true);
  }

  // Initialize utilities with config (indexer endpoint, API key, etc.)
  const utilities = getUtilities();
  const config = getConfig();
  utilities.initializeUtilities(config);

  try {
    // STEP 1: INTENT PARSER
    // Parse user intent into structured requirements
    const { processIntentParserRequest } = getIntentParser();

    let intentParserResult = await processIntentParserRequest(userRequest, {
      modelName,
    });

    // Handle interactive clarification loop
    while (intentParserResult.needsMoreInfo) {
      if (!interactive) {
        // Non-interactive mode: cannot ask for clarification
        console.error(
          chalk.red(
            '\n❌ More information needed but running in non-interactive mode. Please provide a complete request.'
          )
        );
        if (intentParserResult.question) {
          console.error(chalk.yellow('\nAI asked: ') + intentParserResult.question);
        }
        process.exit(1);
      }

      // Ask user for clarification
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Display the AI's question before asking for input
      if (intentParserResult.question) {
        console.log(chalk.cyan('\n🤖 ') + intentParserResult.question);
      }

      const userResponse = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow('Your response: '), (answer: string) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (!userResponse) {
        console.error(chalk.red('\n❌ No response provided. Exiting.'));
        process.exit(1);
      }

      console.log();

      // Continue intent parser conversation
      intentParserResult = await processIntentParserRequest(userResponse, {
        modelName,
        conversationContext: {
          messages: intentParserResult.messages,
        },
      });
    }

    if (!intentParserResult.approved) {
      console.error(chalk.red('\n❌ Request not approved by intent parser'));
      return null;
    }

    const params = intentParserResult.params;

    // Check if this is a send_playlist action
    if (params && (params as Record<string, unknown>).action === 'send_playlist') {
      // Handle playlist sending directly
      const sendParams = params as Record<string, unknown>;
      const utilities = getUtilities();

      console.log();
      console.log(chalk.cyan('Sending to device...'));

      const sendResult = await utilities.sendToDevice(
        sendParams.playlist as Playlist,
        sendParams.deviceName as string | undefined
      );

      if (sendResult.success) {
        console.log(chalk.green('\n✅ Playlist sent successfully!'));
        if (sendResult.deviceName) {
          console.log(chalk.gray(`   Device: ${sendResult.deviceName}`));
        }
        console.log();
        return {
          success: true,
          playlist: sendParams.playlist as Playlist,
          action: 'send_playlist',
        };
      } else {
        // Send failed - return error without showing the playlist summary
        console.log();
        console.error(chalk.red('❌ Failed to send playlist'));
        if (sendResult.error) {
          console.error(chalk.red(`   ${sendResult.error}`));
        }
        return {
          success: false,
          error: sendResult.error || 'Failed to send playlist',
          playlist: null,
          action: 'send_playlist',
        };
      }
    }

    // Check if this is a publish_playlist action
    if (params && (params as Record<string, unknown>).action === 'publish_playlist') {
      // Publishing was already handled by intent parser, just return the result
      const publishParams = params as Record<string, unknown>;

      if (publishParams.success) {
        return {
          success: true,
          action: 'publish_playlist',
          playlistId: publishParams.playlistId,
          feedServer: publishParams.feedServer,
        };
      } else {
        return {
          success: false,
          error: publishParams.error as string,
          action: 'publish_playlist',
        };
      }
    }

    // STEP 2: AI ORCHESTRATOR (Function Calling)
    // AI orchestrates function calls to build playlist
    const { buildPlaylistWithAI } = getAIOrchestrator();

    let result = await buildPlaylistWithAI(params, {
      modelName,
      verbose,
      outputPath,
      interactive,
    });

    // Handle confirmation loop in interactive mode
    while (result.needsConfirmation && interactive) {
      console.log(chalk.yellow('\n' + result.question));
      console.log();

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const userResponse = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan('Your response: '), (answer: string) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (!userResponse) {
        console.error(chalk.red('\n❌ No response provided. Canceling.'));
        return null;
      }

      console.log();

      // Continue orchestrator with user's response
      result = await buildPlaylistWithAI(result.params, {
        modelName,
        verbose,
        outputPath,
        interactive,
        conversationContext: {
          messages: result.messages,
          userResponse,
        },
      });
    }

    // If no playlist was built, display the AI's message
    if (!result.playlist && result.message) {
      console.log(chalk.yellow('\n⚠️  ' + result.message));
    }

    return result;
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), (error as Error).message);
    if (verbose) {
      console.error(chalk.gray((error as Error).stack));
    }
    throw error;
  }
}
