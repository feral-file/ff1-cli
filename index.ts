#!/usr/bin/env node

// Suppress punycode deprecation warnings from dependencies
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return; // Ignore punycode deprecation warnings from dependencies
  }
  console.warn(warning.name + ': ' + warning.message);
});

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import * as readline from 'readline';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import {
  getConfig,
  validateConfig,
  createSampleConfig,
  listAvailableModels,
  getConfigPaths,
} from './src/config';
import { buildPlaylist, buildPlaylistDirect } from './src/main';
import type { Config, Playlist } from './src/types';
import { discoverFF1Devices } from './src/utilities/ff1-discovery';
import { isPlaylistSourceUrl, loadPlaylistSource } from './src/utilities/playlist-source';
import { upsertDevice } from './src/utilities/device-upsert';
import { findExistingDeviceEntry } from './src/utilities/device-lookup';
import { normalizeDeviceHost, normalizeDeviceIdToHost } from './src/utilities/device-normalize';
import { promoteDeviceToDefault } from './src/utilities/device-default';

// Load version from package.json
// Try built location first (dist/index.js -> ../package.json)
// Fall back to dev location (index.ts -> ./package.json)
let packageJsonPath = resolve(dirname(__filename), '..', 'package.json');
try {
  readFileSync(packageJsonPath, 'utf8');
} catch {
  // Dev mode: tsx runs from project root
  packageJsonPath = resolve(dirname(__filename), 'package.json');
}
const { version: packageVersion } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const program = new Command();
const placeholderPattern = /YOUR_|your_/;

/**
 * Display playlist creation summary with next steps.
 *
 * @param {Playlist} playlist - The created playlist object
 * @param {string} outputPath - Path where the playlist was saved
 */
function displayPlaylistSummary(playlist: Playlist, outputPath: string) {
  console.log(chalk.green('\nPlaylist saved'));
  console.log(chalk.dim(`  Output: ./${outputPath}`));
  console.log(chalk.dim('  Next: play last | publish playlist'));
  console.log();
}

function isMissingConfigValue(value?: string | null): boolean {
  if (!value) {
    return true;
  }
  return placeholderPattern.test(value);
}

async function readConfigFile(configPath: string): Promise<Config> {
  const file = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(file) as Config;
}

async function resolveExistingConfigPath(): Promise<string | null> {
  const { localPath, userPath } = getConfigPaths();
  try {
    await fs.access(localPath);
    return localPath;
  } catch (_error) {
    try {
      await fs.access(userPath);
      return userPath;
    } catch (_innerError) {
      return null;
    }
  }
}

async function ensureConfigFile(): Promise<{ path: string; created: boolean }> {
  const { userPath } = getConfigPaths();
  const existingPath = await resolveExistingConfigPath();
  if (existingPath) {
    return { path: existingPath, created: false };
  }
  const createdPath = await createSampleConfig(userPath);
  return { path: createdPath, created: true };
}

/**
 * Parse TTL duration string into seconds.
 *
 * @param {string} ttl - Duration string (e.g. "900", "15m", "2h")
 * @returns {number} TTL in seconds
 * @throws {Error} When ttl format is invalid
 */
function parseTtlSeconds(ttl: string): number {
  const trimmed = ttl.trim();
  const match = trimmed.match(/^(\d+)([smh]?)$/i);
  if (!match) {
    throw new Error('TTL must be a number of seconds or a duration like 15m or 2h');
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (Number.isNaN(value)) {
    throw new Error('TTL value is not a number');
  }
  if (unit === 'm') {
    return value * 60;
  }
  if (unit === 'h') {
    return value * 60 * 60;
  }
  return value;
}

/**
 * Read an SSH public key from a file.
 *
 * @param {string} keyPath - Path to public key file
 * @returns {Promise<string>} Public key contents
 * @throws {Error} When the file is empty or unreadable
 */
async function readPublicKeyFile(keyPath: string): Promise<string> {
  const content = await fs.readFile(keyPath, 'utf-8');
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Public key file is empty');
  }
  return trimmed;
}

interface DeviceDiscoverySelection {
  hostValue: string;
  discoveredName: string;
  /** mDNS device ID (e.g. 'ff1-hh9jsnoc'). Used to match a device when its host URL changes. */
  discoveredId?: string;
  /** Resolved IP addresses from mDNS. Used to match pre-id configs stored with an IP host. */
  discoveredAddresses?: string[];
  skipped: boolean;
}

async function discoverAndSelectDevice(
  ask: (question: string) => Promise<string>,
  existingDevices: Array<{ host: string; name?: string; id?: string }>,
  options?: { allowSkip?: boolean }
): Promise<DeviceDiscoverySelection> {
  const allowSkip = options?.allowSkip && existingDevices.length > 0;

  const discoveryResult = await discoverFF1Devices();
  const discoveredDevices = discoveryResult.devices;

  if (discoveryResult.error && discoveredDevices.length === 0) {
    const errorMessage = discoveryResult.error.endsWith('.')
      ? discoveryResult.error
      : `${discoveryResult.error}.`;
    console.log(chalk.dim(`mDNS discovery failed: ${errorMessage} Continuing with manual entry.`));
  } else if (discoveryResult.error) {
    console.log(chalk.dim(`mDNS discovery warning: ${discoveryResult.error}`));
  }

  if (discoveredDevices.length > 0) {
    console.log(chalk.green('\nFF1 devices on your network:'));
    discoveredDevices.forEach((device, index) => {
      const displayId = device.id || device.name || device.host;
      const normalizedHost = normalizeDeviceHost(`${device.host}:${device.port}`);
      const alreadyConfigured = !!findExistingDeviceEntry(
        existingDevices,
        normalizedHost,
        device.name || device.id || '',
        device.id,
        device.addresses
      );
      const suffix = alreadyConfigured ? chalk.dim(' (already configured)') : '';
      console.log(chalk.dim(`  ${index + 1}) ${displayId}${suffix}`));
    });

    const skipHint = allowSkip ? ', press Enter to skip' : '';
    const prompt = `Select device [1-${discoveredDevices.length}], enter ID/host${skipHint}, or type m for manual entry: `;

    while (true) {
      const selectionAnswer = (await ask(prompt)).trim();

      if (!selectionAnswer) {
        if (allowSkip) {
          console.log(chalk.dim('Keeping existing devices.'));
          return { hostValue: '', discoveredName: '', skipped: true };
        }
        break;
      }

      const normalizedSelection = selectionAnswer.toLowerCase();
      if (normalizedSelection === 'm') {
        break;
      }

      const parsedIndex = Number.parseInt(selectionAnswer, 10);
      if (
        !Number.isNaN(parsedIndex) &&
        `${parsedIndex}` === selectionAnswer &&
        parsedIndex >= 1 &&
        parsedIndex <= discoveredDevices.length
      ) {
        const selected = discoveredDevices[parsedIndex - 1];
        return {
          hostValue: normalizeDeviceHost(`${selected.host}:${selected.port}`),
          discoveredName: selected.name || selected.id || '',
          discoveredId: selected.id,
          discoveredAddresses: selected.addresses,
          skipped: false,
        };
      }

      const normalizedWithPrefix = normalizedSelection.startsWith('ff1-')
        ? normalizedSelection
        : `ff1-${normalizedSelection}`;
      // Also normalize the answer as a URL-form host so pasted URLs like
      // "http://ff1-hh9jsnoc.local:1111" match the device's normalized host.
      let normalizedSelectionAsHost = '';
      try {
        normalizedSelectionAsHost = normalizeDeviceHost(selectionAnswer).toLowerCase();
      } catch {
        // not a valid URL — skip URL-form matching
      }
      const matched = discoveredDevices.find((device) => {
        const deviceNormalizedHost = normalizeDeviceHost(
          `${device.host}:${device.port}`
        ).toLowerCase();
        const candidates = [device.id, device.name, device.host, `${device.host}:${device.port}`]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase());
        return (
          candidates.includes(normalizedSelection) ||
          candidates.includes(normalizedWithPrefix) ||
          (normalizedSelectionAsHost !== '' && normalizedSelectionAsHost === deviceNormalizedHost)
        );
      });

      if (matched) {
        return {
          hostValue: normalizeDeviceHost(`${matched.host}:${matched.port}`),
          discoveredName: matched.name || matched.id || '',
          discoveredId: matched.id,
          discoveredAddresses: matched.addresses,
          skipped: false,
        };
      }

      console.log(
        chalk.red('Invalid selection. Enter a number, m, or a discovered device ID/host.')
      );
    }
  } else if (!discoveryResult.error) {
    console.log(chalk.dim('No FF1 devices found via mDNS. Continuing with manual entry.'));
  }

  // Manual entry fallback
  const idAnswer = await ask('Device ID or host (e.g. ff1-ABCD1234): ');
  if (!idAnswer) {
    return { hostValue: '', discoveredName: '', skipped: false };
  }
  return { hostValue: normalizeDeviceIdToHost(idAnswer), discoveredName: '', skipped: false };
}

interface PlaylistVerificationResult {
  valid: boolean;
  error?: string;
  details?: Array<{ path: string; message: string }>;
  playlist?: Playlist;
}

/**
 * Print a focused failure for playlist source loading problems.
 *
 * @param {string} source - Playlist source value
 * @param {Error} error - Load or parse error
 */
function printPlaylistSourceLoadFailure(source: string, error: Error): void {
  const isUrl = isPlaylistSourceUrl(source);

  if (isUrl) {
    console.error(chalk.red('\nCould not load hosted playlist URL'));
    console.error(chalk.red(`  Source: ${source}`));
    console.error(chalk.red(`  Error: ${error.message}`));
    console.log(chalk.yellow('\n  Hint:'));
    console.log(chalk.yellow('    • Check the URL is reachable'));
    console.log(chalk.yellow('    • Confirm the response is JSON'));
    console.log(chalk.yellow('    • Use a local file path if network access is unavailable'));
    return;
  }

  console.error(chalk.red(`\nCould not load playlist file`));
  console.error(chalk.red(`  Source: ${source}`));
  console.error(chalk.red(`  Error: ${error.message}`));
}

/**
 * Print playlist verification failure details consistently.
 *
 * @param {Object} verifyResult - DP-1 verification result
 * @param {string} [source] - Optional source label
 */
function printPlaylistVerificationFailure(
  verifyResult: PlaylistVerificationResult,
  source?: string
): void {
  console.error(
    chalk.red(`\nPlaylist verification failed:${source ? ` (${source})` : ''}`),
    verifyResult.error
  );

  if (verifyResult.details && verifyResult.details.length > 0) {
    console.log(chalk.yellow('\n   Validation errors:'));
    verifyResult.details.forEach((detail: { path: string; message: string }) => {
      console.log(chalk.yellow(`     • ${detail.path}: ${detail.message}`));
    });
  }

  console.log(chalk.yellow('\n   Use --skip-verify to play anyway (not recommended)\n'));
}

/**
 * Load and verify a DP-1 playlist from local file or hosted URL.
 *
 * @param {string} source - Playlist source value
 * @returns {Promise<Object>} Verification result with parsed playlist when valid
 */
async function verifyPlaylistSource(source: string): Promise<PlaylistVerificationResult> {
  const loaded = await loadPlaylistSource(source);

  const verifier = await import('./src/utilities/playlist-verifier');
  const { verifyPlaylist } = verifier;
  const verifyResult = verifyPlaylist(loaded.playlist);

  return {
    ...verifyResult,
    playlist: verifyResult.valid ? loaded.playlist : undefined,
  };
}

/**
 * Run a shared verify/validate command flow.
 *
 * @param {string} source - Playlist source path or URL
 */
async function runVerifyCommand(source: string): Promise<void> {
  try {
    console.log(chalk.blue('\nVerify playlist\n'));

    const verifier = await import('./src/utilities/playlist-verifier');
    const { printVerificationResult } = verifier;

    const result = await verifyPlaylistSource(source);

    printVerificationResult(result, source);

    if (!result.valid) {
      process.exit(1);
    }
  } catch (error) {
    printPlaylistSourceLoadFailure(source, error as Error);
    process.exit(1);
  }
}

async function promptYesNo(
  ask: (question: string) => Promise<string>,
  question: string,
  defaultYes = true
): Promise<boolean> {
  const suffix = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} [${suffix}] `)).trim().toLowerCase();
  if (!answer) {
    return defaultYes;
  }
  return answer === 'y' || answer === 'yes';
}

program
  .name('ff1')
  .description(
    'CLI to fetch NFT information and build DP1 playlists using AI (Grok, ChatGPT, Gemini)'
  )
  .version(packageVersion)
  .addHelpText(
    'after',
    `\nQuick start:\n  1) ff1 setup\n  2) ff1 chat\n\nDocs: https://github.com/feralfile/ff1-cli\n`
  );

program
  .command('setup')
  .description('Guided setup for config, signing key, and device')
  .action(async () => {
    let rl: readline.Interface | null = null;
    try {
      const { path: configPath, created } = await ensureConfigFile();
      if (created) {
        console.log(chalk.green(`Created ${configPath}`));
      }

      const config = await readConfigFile(configPath);
      const modelNames = Object.keys(config.models || {});

      if (modelNames.length === 0) {
        console.error(chalk.red('No models found in config.json'));
        process.exit(1);
      }

      console.log(chalk.blue('\nFF1 Setup\n'));

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const ask = async (question: string): Promise<string> =>
        new Promise((resolve) => {
          rl.question(chalk.yellow(question), (answer: string) => {
            resolve(answer.trim());
          });
        });

      const currentModel =
        config.defaultModel && modelNames.includes(config.defaultModel)
          ? config.defaultModel
          : modelNames[0];

      let selectedModel = currentModel;
      while (true) {
        const modelAnswer = await ask(
          `Default model (${modelNames.join(', ')}) [${currentModel}]: `
        );
        if (!modelAnswer) {
          selectedModel = currentModel;
          break;
        }
        if (modelNames.includes(modelAnswer)) {
          selectedModel = modelAnswer;
          break;
        }
        console.log(chalk.red(`Unknown model: ${modelAnswer}`));
      }

      config.defaultModel = selectedModel;
      const selectedModelConfig = config.models[selectedModel] || {
        apiKey: '',
        baseURL: '',
        model: '',
        timeout: 0,
        maxRetries: 0,
        temperature: 0,
        maxTokens: 0,
        supportsFunctionCalling: true,
      };

      const hasApiKeyForModel = !isMissingConfigValue(selectedModelConfig.apiKey);
      const keyHelpUrls: Record<string, string> = {
        grok: 'https://console.x.ai/',
        gpt: 'https://platform.openai.com/api-keys',
        gemini: 'https://aistudio.google.com/app/apikey',
      };
      if (!hasApiKeyForModel) {
        const helpUrl = keyHelpUrls[selectedModel];
        if (helpUrl) {
          console.log(chalk.dim(helpUrl));
        }
      }

      const apiKeyPrompt = hasApiKeyForModel
        ? `API key for ${selectedModel} (leave blank to keep current): `
        : `API key for ${selectedModel}: `;
      const apiKeyAnswer = await ask(apiKeyPrompt);
      if (apiKeyAnswer) {
        selectedModelConfig.apiKey = apiKeyAnswer;
      }
      config.models[selectedModel] = selectedModelConfig;

      const currentKey = config.playlist?.privateKey || '';
      let signingKey = currentKey;

      if (isMissingConfigValue(currentKey)) {
        const keyPair = crypto.generateKeyPairSync('ed25519');
        signingKey = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
      } else {
        const keepKey = await promptYesNo(ask, 'Keep existing signing key?', true);
        if (!keepKey) {
          const keyAnswer = await ask(
            'Paste signing key (base64 or hex), or leave blank to regenerate: '
          );
          if (keyAnswer) {
            signingKey = keyAnswer;
          } else {
            const keyPair = crypto.generateKeyPairSync('ed25519');
            signingKey = keyPair.privateKey
              .export({ format: 'der', type: 'pkcs8' })
              .toString('base64');
          }
        }
      }

      if (signingKey) {
        config.playlist = {
          ...(config.playlist || {}),
          privateKey: signingKey,
        };
      }

      const existingDevices = config.ff1Devices?.devices || [];

      if (existingDevices.length > 0) {
        console.log(
          chalk.dim(
            `\nConfigured devices: ${existingDevices.map((d) => d.name || d.host).join(', ')}`
          )
        );
      }

      const selection = await discoverAndSelectDevice(ask, existingDevices, { allowSkip: true });

      if (selection.hostValue) {
        // Prefer the already-stored label so re-running setup (or re-adding a device
        // that returned on a new IP) doesn't clobber the friendly name.
        const existingEntry = findExistingDeviceEntry(
          existingDevices,
          selection.hostValue,
          selection.discoveredName,
          selection.discoveredId,
          selection.discoveredAddresses
        );
        const existingIndex = existingEntry
          ? existingDevices.findIndex((d) => d === existingEntry)
          : -1;
        const existingName = existingEntry?.name || '';
        const defaultName = existingName || selection.discoveredName || 'ff1';
        const namePrompt =
          defaultName !== 'ff1'
            ? `Device name (kitchen, office, etc.) [${defaultName}]: `
            : 'Device name (kitchen, office, etc.): ';
        const nameAnswer = await ask(namePrompt);
        let deviceName = nameAnswer || defaultName || 'ff1';

        // Same name-collision guard as device add: reject names that would clobber
        // a different device entry. Only fires when existingIndex !== -1 (we know the row);
        // when existingIndex === -1, a same-name entry is the case-3 migration path.
        const setupNameConflict =
          existingIndex !== -1
            ? existingDevices.find((d, i) => d.name === deviceName && i !== existingIndex)
            : undefined;
        if (setupNameConflict) {
          console.log(
            chalk.yellow(
              `"${deviceName}" is already used by another device. Please choose a different name.`
            )
          );
          const retryAnswer = await ask('Device name: ');
          deviceName = retryAnswer || 'ff1';
          const retryConflict =
            existingIndex !== -1
              ? existingDevices.find((d, i) => d.name === deviceName && i !== existingIndex)
              : undefined;
          if (retryConflict) {
            console.log(chalk.yellow(`"${deviceName}" is also taken. Skipping device.`));
            config.ff1Devices = { devices: existingDevices };
            await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
            return;
          }
        }

        const result = upsertDevice(
          existingDevices,
          {
            name: deviceName,
            host: selection.hostValue,
            id: selection.discoveredId,
            addresses: selection.discoveredAddresses,
          },
          existingIndex !== -1 ? existingIndex : undefined
        );
        console.log(chalk.dim(`${result.updated ? 'Updated' : 'Added'} device: ${deviceName}`));
        config.ff1Devices = { devices: result.devices };
      } else if (existingDevices.length > 0) {
        config.ff1Devices = { devices: existingDevices };
      }

      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
      rl.close();
      rl = null;

      console.log(chalk.green('\nSetup complete'));
      console.log(chalk.dim(`   Config: ${configPath}`));

      const hasApiKey = !isMissingConfigValue(config.models[selectedModel]?.apiKey);
      const hasSigningKey = !isMissingConfigValue(config.playlist?.privateKey || '');
      const hasDevice = Boolean(config.ff1Devices?.devices?.[0]?.host);

      if (!hasApiKey || !hasSigningKey || !hasDevice) {
        console.log(chalk.yellow('\nNext steps:'));
        if (!hasApiKey) {
          console.log(chalk.yellow(`  • Add API key for ${selectedModel}`));
        }
        if (!hasSigningKey) {
          console.log(chalk.yellow('  • Add a playlist signing key'));
        }
        if (!hasDevice) {
          console.log(chalk.yellow('  • Add an FF1 device host'));
        }
      }

      console.log(chalk.dim('\nRun: ff1 chat'));
    } catch (error) {
      console.error(chalk.red('\nSetup failed:'), (error as Error).message);
      process.exit(1);
    } finally {
      if (rl) {
        rl.close();
      }
    }
  });

program
  .command('status')
  .description('Show configuration status')
  .action(async () => {
    try {
      const configPath = await resolveExistingConfigPath();
      if (!configPath) {
        console.log(chalk.red('config.json not found'));
        console.log(chalk.dim('Run: ff1 setup'));
        process.exit(1);
      }

      const config = await readConfigFile(configPath);
      const modelNames = Object.keys(config.models || {});
      const defaultModel =
        config.defaultModel && modelNames.includes(config.defaultModel)
          ? config.defaultModel
          : modelNames[0];
      const defaultModelLabel = defaultModel || 'unknown';
      const defaultModelConfig = defaultModel ? config.models?.[defaultModel] : undefined;

      const statuses = [
        {
          label: 'Config file',
          ok: true,
          detail: configPath,
        },
        {
          label: `Default model (${defaultModelLabel}) API key`,
          ok: defaultModel ? !isMissingConfigValue(defaultModelConfig?.apiKey) : false,
        },
        {
          label: 'Playlist signing key',
          ok: !isMissingConfigValue(config.playlist?.privateKey || ''),
        },
        {
          label: `FF1 devices (${config.ff1Devices?.devices?.length || 0})`,
          ok:
            (config.ff1Devices?.devices?.length || 0) > 0 &&
            (config.ff1Devices?.devices || []).every((d) => !isMissingConfigValue(d.host)),
          detail:
            (config.ff1Devices?.devices || [])
              .map((d) => `${d.name || 'unnamed'} → ${d.host}`)
              .join(', ') || undefined,
        },
      ];

      console.log(chalk.blue('\n🔎 FF1 Status\n'));
      statuses.forEach((status) => {
        const label = status.ok ? chalk.green('OK') : chalk.red('Missing');
        const detail = status.detail ? chalk.dim(` (${status.detail})`) : '';
        console.log(`${label} ${status.label}${detail}`);
      });

      const hasMissing = statuses.some((status) => !status.ok);
      if (hasMissing) {
        console.log(chalk.dim('\nRun: ff1 setup'));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nStatus check failed:'), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('chat')
  .description('Start an interactive chat to build playlists using natural language')
  .argument('[content]', 'Optional: Direct chat content (non-interactive mode)')
  .option('-o, --output <filename>', 'Output filename for the playlist', 'playlist.json')
  .option('-m, --model <name>', 'AI model to use (grok, gpt, gemini) - defaults to config setting')
  .option('-d, --device <name>', 'Target FF1 device name (defaults to first configured device)')
  .option('-v, --verbose', 'Show detailed technical output of function calls', false)
  .action(
    async (
      content: string | undefined,
      options: { output: string; model?: string; device?: string; verbose: boolean }
    ) => {
      try {
        // Load and validate configuration
        const config = getConfig();
        const availableModels = listAvailableModels();

        // Validate model selection
        if (options.model && !availableModels.includes(options.model)) {
          console.error(chalk.red(`Invalid model: "${options.model}"`));
          console.log(chalk.yellow(`Available models: ${availableModels.join(', ')}`));
          process.exit(1);
        }

        const modelName = options.model || config.defaultModel;

        const validation = validateConfig(modelName);
        if (!validation.valid) {
          console.error(chalk.red('Configuration error:'));
          validation.errors.forEach((error) => {
            console.error(chalk.red(`  • ${error}`));
          });
          console.log(chalk.yellow('\nRun: ff1 setup\n'));
          process.exit(1);
        }

        // NON-INTERACTIVE MODE: If content is provided as argument
        if (content) {
          console.log(chalk.blue('\nFF1 Chat (non-interactive)\n'));
          console.log(chalk.dim(`Model: ${modelName}\n`));
          console.log(chalk.yellow('Request:'), content);
          console.log(); // Blank line

          try {
            const result = await buildPlaylist(content, {
              verbose: options.verbose,
              outputPath: options.output,
              modelName: modelName,
              interactive: false, // Non-interactive mode
              deviceName: options.device,
            });

            // Print final summary
            if (result && result.playlist) {
              console.log(chalk.green('\nPlaylist saved'));
              console.log(chalk.dim(`  Title: ${result.playlist.title}`));
              console.log(chalk.dim(`  Items: ${result.playlist.items?.length || 0}`));
              console.log(chalk.dim(`  Output: ${options.output}\n`));
            }

            process.exit(0);
          } catch (error) {
            console.error(chalk.red('\nError:'), (error as Error).message);
            if (options.verbose) {
              console.error(chalk.dim((error as Error).stack));
            }
            process.exit(1);
          }
        }

        // INTERACTIVE MODE: Start conversation loop
        console.log(chalk.blue('\nFF1 Chat\n'));
        console.log(chalk.dim('Describe the playlist you want. Ctrl+C to exit.'));
        console.log(chalk.dim(`Model: ${modelName}\n`));
        console.log(chalk.dim('Examples:'));
        console.log(chalk.dim('  • Get 3 works from reas.eth'));
        console.log(chalk.dim('  • Get 3 works from einstein-rosen.tez'));
        console.log(
          chalk.dim(
            '  • Get tokens 52932,52457 from Ethereum contract 0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0'
          )
        );
        console.log(chalk.dim('  • Get 3 from Unsupervised'));
        console.log(chalk.dim('  Tip: add -v to see tool calls'));
        console.log();

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          historySize: 100,
        });
        let closed = false;

        rl.on('close', () => {
          closed = true;
        });

        rl.on('SIGINT', () => {
          rl.close();
        });

        const ask = async (): Promise<string> =>
          new Promise((resolve) => {
            if (closed) {
              resolve('');
              return;
            }
            rl.question(chalk.yellow('You: '), (answer: string) => {
              resolve(answer.trim());
            });
          });

        // Continuous conversation loop
        while (!closed) {
          const userInput = await ask();

          if (closed) {
            break;
          }

          if (!userInput) {
            continue; // Skip empty input
          }

          console.log(); // Blank line before AI response

          try {
            const result = await buildPlaylist(userInput, {
              verbose: options.verbose,
              outputPath: options.output,
              modelName: modelName,
              deviceName: options.device,
            });

            // Print summary after each response
            // Only show playlist summary for build operations, not send operations
            // Skip summary if playlist was already sent to device
            if (options.verbose) {
              console.log(chalk.dim(`\n[DEBUG] result.sentToDevice: ${result?.sentToDevice}`));
              console.log(chalk.dim(`[DEBUG] result.action: ${result?.action}`));
            }
            if (
              result &&
              result.playlist &&
              result.action !== 'send_playlist' &&
              !result.sentToDevice
            ) {
              displayPlaylistSummary(result.playlist, options.output);
            }
          } catch (error) {
            console.error(chalk.red('Error:'), (error as Error).message);
            if (options.verbose) {
              console.error(chalk.dim((error as Error).stack));
            }
            console.log(); // Blank line after error
          }
        }

        if (closed) {
          throw new Error('readline was closed');
        }
      } catch (error) {
        if ((error as Error).message !== 'readline was closed') {
          console.error(chalk.red('\nError:'), (error as Error).message);
          if (process.env.DEBUG) {
            console.error(chalk.dim((error as Error).stack));
          }
        }
        console.log(chalk.blue('\nGoodbye\n'));
        process.exit(0);
      }
    }
  );

program
  .command('verify')
  .description('Verify a DP1 playlist file against DP-1 specification')
  .argument('<file>', 'Path to the playlist file or hosted playlist URL')
  .action(async (file: string) => {
    await runVerifyCommand(file);
  });

program
  .command('validate')
  .description('Validate a DP1 playlist file (alias for verify)')
  .argument('<file>', 'Path to the playlist file or hosted playlist URL')
  .action(async (file: string) => {
    await runVerifyCommand(file);
  });

program
  .command('sign')
  .description('Sign a DP1 playlist file with Ed25519 signature')
  .argument('<file>', 'Path to the playlist file to sign')
  .option('-k, --key <privateKey>', 'Ed25519 private key in base64 format (overrides config)')
  .option('-o, --output <file>', 'Output file path (defaults to overwriting input file)')
  .action(async (file: string, options: { key?: string; output?: string }) => {
    try {
      console.log(chalk.blue('\nSign playlist\n'));

      // Import the signing utility
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { signPlaylistFile } = require('./src/utilities/playlist-signer');

      // Sign the playlist
      const result = await signPlaylistFile(file, options.key, options.output);

      if (result.success) {
        console.log(chalk.green('\nPlaylist signed'));
        if (result.playlist?.signature) {
          console.log(chalk.dim(`  Signature: ${result.playlist.signature.substring(0, 30)}...`));
        }
        console.log();
      } else {
        console.error(chalk.red('\nSign failed:'), result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('play')
  .description('Play a playlist or media URL on an FF1 device')
  .argument('<source>', 'Playlist file, playlist URL, or media URL')
  .option('-d, --device <name>', 'Device name (uses first device if not specified)')
  .option('--skip-verify', 'Skip playlist verification before playing')
  .action(async (source: string, options: { device?: string; skipVerify?: boolean }) => {
    try {
      let playlist: Playlist;
      let sourceLabel = source;

      const isUrl = isPlaylistSourceUrl(source);
      const isFile = !isUrl;

      if (isFile) {
        console.log(chalk.blue('\nPlay on FF1\n'));
        const playlistResult = await loadPlaylistSource(source);
        playlist = playlistResult.playlist;
        sourceLabel = `${playlistResult.sourceType}: ${playlistResult.source}`;
      } else {
        let loadedAsPlaylist = false;
        try {
          const playlistResult = await loadPlaylistSource(source);
          playlist = playlistResult.playlist;
          sourceLabel = `${playlistResult.sourceType}: ${playlistResult.source}`;
          loadedAsPlaylist = true;
        } catch {
          const config = getConfig();
          const duration = config.defaultDuration || 10;

          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { buildUrlItem, buildDP1Playlist } = require('./src/utilities/playlist-builder');

          const item = buildUrlItem(source, duration);
          playlist = await buildDP1Playlist({ items: [item], title: item.title });
        }

        console.log(chalk.blue('\nPlay on FF1\n'));

        if (!loadedAsPlaylist) {
          sourceLabel = source;
        }
      }

      if (!options.skipVerify) {
        if (isFile) {
          console.log(chalk.cyan(`Verify playlist (${sourceLabel})`));
        }

        const verifier = await import('./src/utilities/playlist-verifier');
        const { verifyPlaylist } = verifier;
        const verifyResult = verifyPlaylist(playlist);

        if (!verifyResult.valid) {
          printPlaylistVerificationFailure(verifyResult, isFile ? `source: ${sourceLabel}` : undefined);
          process.exit(1);
        }

        if (isFile) {
          console.log(chalk.green('✓ Verified\n'));
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sendPlaylistToDevice } = require('./src/utilities/ff1-device');

      const result = await sendPlaylistToDevice({
        playlist,
        deviceName: options.device,
      });

      if (result.success) {
        console.log(chalk.green('✓ Playing'));
        if (result.deviceName) {
          console.log(chalk.dim(`  Device: ${result.deviceName}`));
        }
        if (result.device) {
          console.log(chalk.dim(`  Host: ${result.device}`));
        }
        console.log();
      } else {
        console.error(chalk.red('\nPlay failed:'), result.error);
        if (result.details) {
          console.error(chalk.dim(`  Details: ${result.details}`));
        }
        process.exit(1);
      }
    } catch (error) {
      if (isPlaylistSourceUrl(source)) {
        printPlaylistSourceLoadFailure(source, error as Error);
      } else {
        console.error(chalk.red('\nError:'), (error as Error).message);
      }
      process.exit(1);
    }
  });

program
  .command('publish')
  .description('Publish a playlist to a feed server')
  .argument('<file>', 'Path to the playlist file')
  .option('-s, --server <index>', 'Feed server index (use this if multiple servers configured)')
  .action(async (file: string, options: { server?: string }) => {
    try {
      console.log(chalk.blue('\nPublish playlist\n'));

      const { getFeedConfig } = await import('./src/config');
      const { publishPlaylist } = await import('./src/utilities/playlist-publisher');

      const feedConfig = getFeedConfig();

      if (!feedConfig.baseURLs || feedConfig.baseURLs.length === 0) {
        console.error(chalk.red('\nNo feed servers configured'));
        console.log(chalk.yellow('  Add feed server URLs to config.json: feed.baseURLs\n'));
        process.exit(1);
      }

      // If multiple servers and no index specified, show options
      let serverUrl = feedConfig.baseURLs[0];
      let serverApiKey = feedConfig.apiKey; // Default to legacy apiKey

      if (feedConfig.baseURLs.length > 1) {
        if (!options.server) {
          console.log(chalk.yellow('Multiple feed servers found. Select one:'));
          console.log();
          feedConfig.baseURLs.forEach((url, index) => {
            console.log(chalk.cyan(`  ${index}: ${url}`));
          });
          console.log();

          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const selection = await new Promise<string>((resolve) => {
            rl.question(chalk.yellow('Select server (0-based index): '), (answer: string) => {
              rl.close();
              resolve(answer.trim());
            });
          });

          console.log();

          options.server = selection;
        }

        const serverIndex = parseInt(options.server || '0', 10);
        if (isNaN(serverIndex) || serverIndex < 0 || serverIndex >= feedConfig.baseURLs.length) {
          console.error(chalk.red('\nInvalid server index'));
          process.exit(1);
        }

        serverUrl = feedConfig.baseURLs[serverIndex];

        // Use individual server API key if available (new feedServers format)
        if (feedConfig.servers && feedConfig.servers[serverIndex]) {
          serverApiKey = feedConfig.servers[serverIndex].apiKey;
        }
      } else if (feedConfig.servers && feedConfig.servers[0]) {
        // Single server with new feedServers format
        serverApiKey = feedConfig.servers[0].apiKey;
      }

      const result = await publishPlaylist(file, serverUrl, serverApiKey);

      if (result.success) {
        console.log(chalk.green('Published'));
        if (result.playlistId) {
          console.log(chalk.dim(`  Playlist ID: ${result.playlistId}`));
        }
        console.log(chalk.dim(`  Server: ${result.feedServer}`));
        if (result.message) {
          console.log(chalk.dim(`  Status: ${result.message}`));
        }
        console.log();
      } else {
        console.error(chalk.red('\nPublish failed'));
        if (result.error) {
          console.error(chalk.red(`  ${result.error}`));
        }
        if (result.message) {
          console.log(chalk.yellow(`\n${result.message}`));
        }
        console.log();
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('build')
  .description('Build playlist from structured parameters (JSON file or stdin)')
  .argument('[params-file]', 'Path to JSON parameters file (or use stdin)')
  .option('-o, --output <filename>', 'Output filename for the playlist', 'playlist.json')
  .option('-v, --verbose', 'Show detailed output', false)
  .action(async (paramsFile: string | undefined, options: { output: string; verbose: boolean }) => {
    try {
      let params;

      if (paramsFile) {
        // Read from file
        const content = await fs.readFile(paramsFile, 'utf-8');
        params = JSON.parse(content);
      } else {
        // Read from stdin
        const stdin = await new Promise<string>((resolve, reject) => {
          let data = '';
          process.stdin.setEncoding('utf8');
          process.stdin.on('data', (chunk) => {
            data += chunk;
          });
          process.stdin.on('end', () => {
            resolve(data);
          });
          process.stdin.on('error', reject);
        });

        if (!stdin.trim()) {
          console.error(chalk.red('No parameters provided'));
          console.log(chalk.yellow('\nUsage:'));
          console.log('  ff1 build params.json');
          console.log('  cat params.json | ff1 build');
          console.log('  echo \'{"requirements":[...]}\' | ff1 build');
          process.exit(1);
        }

        params = JSON.parse(stdin);
      }

      if (options.verbose) {
        console.log(chalk.blue('\nParameters:'));
        console.log(chalk.dim(JSON.stringify(params, null, 2)));
        console.log();
      }

      console.log(chalk.blue('\nBuild playlist from parameters\n'));

      const result = await buildPlaylistDirect(params, {
        verbose: options.verbose,
        outputPath: options.output,
      });

      if (result && result.playlist) {
        console.log(chalk.green('\nPlaylist saved'));
        console.log(chalk.dim(`  Title: ${result.playlist.title}`));
        console.log(chalk.dim(`  Items: ${result.playlist.items?.length || 0}`));
        console.log(chalk.dim(`  Output: ${options.output}\n`));
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      if (options.verbose) {
        console.error(chalk.dim((error as Error).stack));
      }
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Manage configuration')
  .argument('<action>', 'Action: init, show, or validate')
  .action(async (action: string) => {
    try {
      if (action === 'init') {
        console.log(chalk.blue('\nCreate config.json\n'));
        const { userPath } = getConfigPaths();
        const configPath = await createSampleConfig(userPath);
        console.log(chalk.green(`Created ${configPath}`));
        console.log(chalk.yellow('\nNext: ff1 setup\n'));
      } else if (action === 'show') {
        const config = getConfig();
        console.log(chalk.blue('\nCurrent configuration\n'));
        console.log(chalk.bold('Default model:'), chalk.white(config.defaultModel));
        console.log(chalk.bold('Default duration:'), chalk.white(config.defaultDuration + 's'));
        console.log(chalk.bold('\nAvailable models:\n'));

        const models = listAvailableModels();
        models.forEach((modelName) => {
          const modelConfig = config.models[modelName];
          const isCurrent = modelName === config.defaultModel;
          console.log(`  ${isCurrent ? chalk.green('→') : ' '} ${chalk.bold(modelName)}`);
          console.log(
            `    API key: ${modelConfig.apiKey && modelConfig.apiKey !== 'your_api_key_here' ? chalk.green('Set') : chalk.red('Missing')}`
          );
          console.log(`    Base URL: ${chalk.dim(modelConfig.baseURL)}`);
          console.log(`    Model: ${chalk.dim(modelConfig.model)}`);
          console.log(
            `    Function calling: ${modelConfig.supportsFunctionCalling ? chalk.green('Supported') : chalk.red('Not supported')}`
          );
          console.log();
        });
      } else if (action === 'validate') {
        const validation = validateConfig();

        console.log(chalk.blue('\nValidate configuration\n'));

        if (validation.valid) {
          console.log(chalk.green('Configuration is valid\n'));
        } else {
          console.log(chalk.red('Configuration has errors:\n'));
          validation.errors.forEach((error) => {
            console.log(chalk.red(`  • ${error}`));
          });
          console.log();
          process.exit(1);
        }
      } else {
        console.error(chalk.red(`\nUnknown action: ${action}`));
        console.log(chalk.yellow('Available actions: init, show, validate\n'));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('ssh')
  .description('Enable or disable SSH access on an FF1 device')
  .argument('<action>', 'Action: enable or disable')
  .option('-d, --device <name>', 'Device name (uses first device if not specified)')
  .option('--pubkey <path>', 'SSH public key file (required for enable)')
  .option('--ttl <duration>', 'Auto-disable after duration (e.g. 30m, 2h, 900s)')
  .action(async (action: string, options: { device?: string; pubkey?: string; ttl?: string }) => {
    try {
      const normalizedAction = action.trim().toLowerCase();
      if (normalizedAction !== 'enable' && normalizedAction !== 'disable') {
        console.error(chalk.red('\nUnknown action:'), action);
        console.log(chalk.yellow('Available actions: enable, disable\n'));
        process.exit(1);
      }

      const isEnable = normalizedAction === 'enable';
      let publicKey: string | undefined;
      if (isEnable) {
        if (!options.pubkey) {
          console.error(chalk.red('\nPublic key is required to enable SSH'));
          console.log(chalk.yellow('Use: ff1 ssh enable --pubkey ~/.ssh/id_ed25519.pub\n'));
          process.exit(1);
        }
        publicKey = await readPublicKeyFile(options.pubkey);
      }

      let ttlSeconds: number | undefined;
      if (options.ttl) {
        ttlSeconds = parseTtlSeconds(options.ttl);
      }

      const { sendSshAccessCommand } = await import('./src/utilities/ssh-access');

      const result = await sendSshAccessCommand({
        enabled: isEnable,
        deviceName: options.device,
        publicKey,
        ttlSeconds,
      });

      if (result.success) {
        console.log(chalk.green(`SSH ${isEnable ? 'enabled' : 'disabled'}`));
        if (result.deviceName) {
          console.log(chalk.dim(`  Device: ${result.deviceName}`));
        }
        if (result.device) {
          console.log(chalk.dim(`  Host: ${result.device}`));
        }
        if (result.response && typeof result.response === 'object') {
          const expiresAt = result.response.expiresAt as string | undefined;
          if (expiresAt) {
            console.log(chalk.dim(`  Expires: ${expiresAt}`));
          }
        }
        console.log();
        return;
      }

      console.error(chalk.red('\nSSH request failed:'), result.error);
      if (result.details) {
        console.error(chalk.dim(`  Details: ${result.details}`));
      }
      process.exit(1);
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

const deviceCommand = program.command('device').description('Manage configured FF1 devices');

deviceCommand
  .command('list')
  .description('List all configured FF1 devices')
  .action(async () => {
    try {
      const configPath = await resolveExistingConfigPath();
      if (!configPath) {
        console.log(chalk.red('config.json not found'));
        console.log(chalk.dim('Run: ff1 setup'));
        process.exit(1);
      }

      const config = await readConfigFile(configPath);
      const devices = config.ff1Devices?.devices || [];

      if (devices.length === 0) {
        console.log(chalk.yellow('\nNo devices configured'));
        console.log(chalk.dim('Run: ff1 device add'));
        console.log();
        return;
      }

      console.log(chalk.blue(`\nFF1 Devices (${devices.length})\n`));
      devices.forEach((device, index) => {
        const isFirst = index === 0;
        const marker = isFirst ? chalk.green('→') : ' ';
        const nameLabel = device.name || 'unnamed';
        console.log(`${marker} ${chalk.bold(nameLabel)}`);
        console.log(`    Host: ${chalk.dim(device.host)}`);
        if (device.apiKey) {
          console.log(`    API key: ${chalk.green('Set')}`);
        }
        if (device.topicID) {
          console.log(`    Topic: ${chalk.dim(device.topicID)}`);
        }
        if (isFirst) {
          console.log(`    ${chalk.dim('(default)')}`);
        }
        console.log();
      });
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

deviceCommand
  .command('add')
  .description('Add a new FF1 device (with mDNS discovery)')
  .option('--host <host>', 'Device host (skip discovery)')
  .option('--name <name>', 'Device name')
  .action(async (options: { host?: string; name?: string }) => {
    let rl: readline.Interface | null = null;
    // Create readline lazily so non-interactive paths (--host + --name) never block on stdin
    const ask = async (question: string): Promise<string> => {
      if (!rl) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      }
      return new Promise((resolve) => {
        rl!.question(chalk.yellow(question), (answer: string) => {
          resolve(answer.trim());
        });
      });
    };
    try {
      const configPath = await resolveExistingConfigPath();
      if (!configPath) {
        console.log(chalk.red('config.json not found'));
        console.log(chalk.dim('Run: ff1 setup'));
        process.exit(1);
      }

      const config = await readConfigFile(configPath);
      const existingDevices = config.ff1Devices?.devices || [];

      let hostValue = '';
      let discoveredName = '';
      let discoveredId: string | undefined;
      let discoveredAddresses: string[] | undefined;

      if (options.host) {
        hostValue = normalizeDeviceHost(options.host);
      } else {
        console.log(chalk.blue('\nDiscover FF1 devices...\n'));
        const selection = await discoverAndSelectDevice(ask, existingDevices);
        hostValue = selection.hostValue;
        discoveredName = selection.discoveredName;
        discoveredId = selection.discoveredId;
        discoveredAddresses = selection.discoveredAddresses;

        if (!hostValue) {
          console.log(chalk.dim('\nNo device added.'));
          if (rl) {
            rl.close();
          }
          return;
        }
      }

      // Find any existing entry that represents this device, including cases
      // where the host URL changed (IP ↔ .local) since the device was last added.
      const existingEntry = findExistingDeviceEntry(
        existingDevices,
        hostValue,
        discoveredName,
        discoveredId,
        discoveredAddresses
      );
      const existingIndex = existingEntry
        ? existingDevices.findIndex((d) => d === existingEntry)
        : -1;

      if (existingIndex !== -1) {
        if (options.host && options.name) {
          // Non-interactive: auto-overwrite when both flags are supplied
          console.log(
            chalk.yellow(
              `\nUpdating existing device: ${existingDevices[existingIndex].name || existingDevices[existingIndex].host}`
            )
          );
        } else {
          console.log(
            chalk.yellow(
              `\nDevice already configured: ${existingDevices[existingIndex].name || existingDevices[existingIndex].host}`
            )
          );
          const overwrite = await promptYesNo(ask, 'Update this device?', false);
          if (!overwrite) {
            console.log(chalk.dim('No changes made.'));
            if (rl) {
              rl.close();
            }
            return;
          }
        }
      }

      // Preserve the stored friendly name as the default so a blank prompt never
      // clobbers a curated label (even after a host-URL change).
      const existingName = existingEntry?.name || '';
      let deviceName: string;
      if (options.name) {
        deviceName = options.name;
      } else {
        const defaultName = existingName || discoveredName || '';
        const namePrompt = defaultName
          ? `Device name (kitchen, office, etc.) [${defaultName}]: `
          : 'Device name (kitchen, office, etc.): ';
        const nameAnswer = await ask(namePrompt);
        deviceName = nameAnswer || defaultName || 'ff1';
      }

      // Reject a name that is already used by a DIFFERENT device (not the one being updated).
      // Only applies when existingIndex !== -1: we know exactly which row to update, so a
      // same-name entry at a different index is provably a different device.
      // When existingIndex === -1 (no confirmed match, e.g. manual IP → .local migration),
      // a same-name entry is the upsertDevice case-3 migration path — blocking it would
      // prevent the user from retaining their existing device name during host migration.
      const nameConflict =
        existingIndex !== -1
          ? existingDevices.find((d, i) => d.name === deviceName && i !== existingIndex)
          : undefined;
      if (nameConflict) {
        if (options.name) {
          // Non-interactive flag path: hard error so scripts don't silently clobber.
          console.error(
            chalk.red(
              `\nError: device name "${deviceName}" is already used by another device (${nameConflict.host}).`
            )
          );
          console.error(chalk.dim('Use a different name or run "ff1 device remove" first.'));
          if (rl) {
            rl.close();
          }
          process.exit(1);
        }
        // Interactive path: re-prompt until the user picks a unique name.
        console.log(
          chalk.yellow(
            `"${deviceName}" is already used by another device. Please choose a different name.`
          )
        );
        const retryAnswer = await ask('Device name: ');
        deviceName = retryAnswer || 'ff1';
        const retryConflict =
          existingIndex !== -1
            ? existingDevices.find((d, i) => d.name === deviceName && i !== existingIndex)
            : undefined;
        if (retryConflict) {
          console.error(chalk.red(`\nName "${deviceName}" is also taken. No changes made.`));
          if (rl) {
            rl.close();
          }
          return;
        }
      }

      const result = upsertDevice(
        existingDevices,
        { name: deviceName, host: hostValue, id: discoveredId, addresses: discoveredAddresses },
        existingIndex !== -1 ? existingIndex : undefined
      );
      console.log(chalk.green(`\n${result.updated ? 'Updated' : 'Added'} device: ${deviceName}`));

      config.ff1Devices = { devices: result.devices };
      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
      console.log(chalk.dim(`Total devices: ${result.devices.length}\n`));

      if (rl) {
        rl.close();
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      if (rl) {
        rl.close();
      }
      process.exit(1);
    }
  });

deviceCommand
  .command('remove')
  .description('Remove a configured FF1 device')
  .argument('<name>', 'Device name to remove')
  .action(async (name: string) => {
    try {
      const configPath = await resolveExistingConfigPath();
      if (!configPath) {
        console.log(chalk.red('config.json not found'));
        process.exit(1);
      }

      const config = await readConfigFile(configPath);
      const existingDevices = config.ff1Devices?.devices || [];

      // Match by name (case-insensitive) or by host URL so that unnamed legacy/manual
      // entries (stored without a name field) can still be targeted and removed.
      const normalizedArg = name.toLowerCase();
      let normalizedArgHost = '';
      try {
        normalizedArgHost = normalizeDeviceHost(name).toLowerCase();
      } catch {
        // not a valid URL — host matching will not apply
      }
      const deviceIndex = existingDevices.findIndex(
        (d) =>
          (d.name && d.name.toLowerCase() === normalizedArg) ||
          (d.host && d.host.toLowerCase() === normalizedArg) ||
          (normalizedArgHost &&
            d.host &&
            normalizeDeviceHost(d.host).toLowerCase() === normalizedArgHost)
      );

      if (deviceIndex === -1) {
        console.error(chalk.red(`\nDevice "${name}" not found`));
        if (existingDevices.length > 0) {
          const names = existingDevices.map((d) => d.name || d.host).join(', ');
          console.log(chalk.dim(`Available devices: ${names}`));
        }
        process.exit(1);
      }

      const removed = existingDevices[deviceIndex];
      const updatedDevices = existingDevices.filter((_, i) => i !== deviceIndex);
      config.ff1Devices = { devices: updatedDevices };

      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
      console.log(chalk.green(`\nRemoved device: ${removed.name || removed.host}`));
      console.log(chalk.dim(`Remaining devices: ${updatedDevices.length}\n`));
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

deviceCommand
  .command('default')
  .description('Set the default FF1 device (reorders so this device is used when -d is omitted)')
  .argument('<name>', 'Device name or host to promote to default')
  .action(async (name: string) => {
    try {
      const configPath = await resolveExistingConfigPath();
      if (!configPath) {
        console.log(chalk.red('config.json not found'));
        console.log(chalk.dim('Run: ff1 setup'));
        process.exit(1);
      }

      const config = await readConfigFile(configPath);
      const existingDevices = config.ff1Devices?.devices || [];

      if (existingDevices.length === 0) {
        console.log(chalk.yellow('\nNo devices configured'));
        console.log(chalk.dim('Run: ff1 device add\n'));
        process.exit(1);
      }

      let result;
      try {
        result = promoteDeviceToDefault(existingDevices, name);
      } catch (error) {
        console.error(chalk.red(`\n${(error as Error).message}`));
        const names = existingDevices.map((d) => d.name || d.host).join(', ');
        console.log(chalk.dim(`Available devices: ${names}\n`));
        process.exit(1);
      }

      const label = result.promoted.name || result.promoted.host;

      if (result.alreadyDefault) {
        console.log(chalk.dim(`\n"${label}" is already the default.\n`));
        return;
      }

      config.ff1Devices = { devices: result.devices };
      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

      console.log(chalk.green(`\nDefault device: ${label}`));
      console.log(chalk.dim('Other commands now target this device when -d is omitted.\n'));
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
