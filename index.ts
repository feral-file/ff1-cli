#!/usr/bin/env node

// Suppress punycode deprecation warning from jsdom dependency
process.removeAllListeners('warning');
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
import {
  getConfig,
  validateConfig,
  createSampleConfig,
  listAvailableModels,
  getConfigPaths,
} from './src/config';
import { buildPlaylist, buildPlaylistDirect } from './src/main';
import type { Config, Playlist } from './src/types';

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
  console.log(chalk.dim('  Next: send last | publish playlist'));
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

function normalizeDeviceHost(host: string): string {
  let normalized = host.trim();
  if (!normalized) {
    return normalized;
  }
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `http://${normalized}`;
  }
  try {
    const url = new URL(normalized);
    const port = url.port || '1111';
    return `${url.protocol}//${url.hostname}:${port}`;
  } catch (_error) {
    return normalized;
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
  .version('1.0.0')
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

      const existingDevice = config.ff1Devices?.devices?.[0];
      {
        const existingHost = existingDevice?.host || '';
        let rawDefaultDeviceId = '';
        if (existingHost) {
          // If host is a .local device, extract just the device ID segment.
          // Otherwise keep the full host (IP address or multi-label domain).
          const hostWithoutScheme = existingHost.replace(/^https?:\/\//, '');
          if (hostWithoutScheme.includes('.local')) {
            rawDefaultDeviceId = hostWithoutScheme.split('.')[0] || '';
          } else {
            rawDefaultDeviceId = hostWithoutScheme;
          }
        }
        const defaultDeviceId = isMissingConfigValue(rawDefaultDeviceId) ? '' : rawDefaultDeviceId;
        const idPrompt = defaultDeviceId
          ? `Device ID (e.g. ff1-ABCD1234) [${defaultDeviceId}]: `
          : 'Device ID (e.g. ff1-ABCD1234): ';
        const idAnswer = await ask(idPrompt);
        const rawDeviceId = idAnswer || defaultDeviceId;

        let hostValue = '';
        if (rawDeviceId) {
          const looksLikeHost =
            rawDeviceId.includes('.') ||
            rawDeviceId.includes(':') ||
            rawDeviceId.startsWith('http');
          if (looksLikeHost) {
            hostValue = normalizeDeviceHost(rawDeviceId);
          } else {
            const deviceId = rawDeviceId.startsWith('ff1-') ? rawDeviceId : `ff1-${rawDeviceId}`;
            hostValue = normalizeDeviceHost(`${deviceId}.local`);
          }
        }

        const rawName = existingDevice?.name || 'ff1';
        const defaultName = isMissingConfigValue(rawName) ? '' : rawName;
        const namePrompt = defaultName
          ? `Device name (kitchen, office, etc.) [${defaultName}]: `
          : 'Device name (kitchen, office, etc.): ';
        const nameAnswer = await ask(namePrompt);
        const deviceName = nameAnswer || defaultName || 'ff1';

        if (hostValue) {
          config.ff1Devices = {
            devices: [
              {
                ...existingDevice,
                name: deviceName,
                host: hostValue,
                apiKey: existingDevice?.apiKey || '',
                topicID: existingDevice?.topicID || '',
              },
            ],
          };
        }
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
          label: 'FF1 device host',
          ok: !isMissingConfigValue(config.ff1Devices?.devices?.[0]?.host),
          detail: isMissingConfigValue(config.ff1Devices?.devices?.[0]?.host)
            ? undefined
            : config.ff1Devices?.devices?.[0]?.host,
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
  .option('-v, --verbose', 'Show detailed technical output of function calls', false)
  .action(
    async (
      content: string | undefined,
      options: { output: string; model?: string; verbose: boolean }
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
        console.log(chalk.dim('  • Get tokens 1,2,3 from Ethereum contract 0xabc'));
        console.log(chalk.dim('  • Get token 42 from Tezos contract KT1abc'));
        console.log(chalk.dim('  • Get 3 from Social Codes and 2 from 0xdef'));
        console.log(
          chalk.dim(
            '  • Build a playlist of my Tezos works from address tz1... plus 3 from Social Codes'
          )
        );
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
  .argument('<file>', 'Path to the playlist file')
  .action(async (file: string) => {
    try {
      console.log(chalk.blue('\nVerify playlist\n'));

      // Import the verification utility
      const verifier = await import('./src/utilities/playlist-verifier');
      const { verifyPlaylistFile, printVerificationResult } = verifier;

      // Verify the playlist
      const result = await verifyPlaylistFile(file);

      // Print results
      printVerificationResult(result, file);

      if (!result.valid) {
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate a DP1 playlist file (alias for verify)')
  .argument('<file>', 'Path to the playlist file')
  .action(async (file: string) => {
    try {
      console.log(chalk.blue('\nVerify playlist\n'));

      // Import the verification utility
      const verifier = await import('./src/utilities/playlist-verifier');
      const { verifyPlaylistFile, printVerificationResult } = verifier;

      // Verify the playlist
      const result = await verifyPlaylistFile(file);

      // Print results
      printVerificationResult(result, file);

      if (!result.valid) {
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
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
  .description('Play a media URL on an FF1 device')
  .argument('<url>', 'Media URL to play')
  .option('-d, --device <name>', 'Device name (uses first device if not specified)')
  .option('--skip-verify', 'Skip playlist verification before sending')
  .action(async (url: string, options: { device?: string; skipVerify?: boolean }) => {
    try {
      console.log(chalk.blue('\nPlay on FF1\n'));

      try {
        new URL(url);
      } catch (error) {
        console.error(chalk.red('\nInvalid URL:'), (error as Error).message);
        process.exit(1);
      }

      const config = getConfig();
      const duration = config.defaultDuration || 10;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { buildUrlItem, buildDP1Playlist } = require('./src/utilities/playlist-builder');

      const item = buildUrlItem(url, duration);
      const playlist = await buildDP1Playlist({ items: [item], title: item.title });

      if (!options.skipVerify) {
        const verifier = await import('./src/utilities/playlist-verifier');
        const { verifyPlaylist } = verifier;
        const verifyResult = verifyPlaylist(playlist);

        if (!verifyResult.valid) {
          console.error(chalk.red('\nPlaylist verification failed:'), verifyResult.error);

          if (verifyResult.details && verifyResult.details.length > 0) {
            console.log(chalk.yellow('\n   Validation errors:'));
            verifyResult.details.forEach((detail: { path: string; message: string }) => {
              console.log(chalk.yellow(`     • ${detail.path}: ${detail.message}`));
            });
          }

          console.log(chalk.yellow('\n   Use --skip-verify to send anyway (not recommended)\n'));
          process.exit(1);
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sendPlaylistToDevice } = require('./src/utilities/ff1-device');

      const result = await sendPlaylistToDevice({
        playlist,
        deviceName: options.device,
      });

      if (result.success) {
        console.log(chalk.green('✓ Sent'));
        if (result.deviceName) {
          console.log(chalk.dim(`  Device: ${result.deviceName}`));
        }
        if (result.device) {
          console.log(chalk.dim(`  Host: ${result.device}`));
        }
        console.log();
      } else {
        console.error(chalk.red('\nSend failed:'), result.error);
        if (result.details) {
          console.error(chalk.dim(`  Details: ${result.details}`));
        }
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('send')
  .description('Send a playlist file to an FF1 device')
  .argument('<file>', 'Path to the playlist file')
  .option('-d, --device <name>', 'Device name (uses first device if not specified)')
  .option('--skip-verify', 'Skip playlist verification before sending')
  .action(async (file: string, options: { device?: string; skipVerify?: boolean }) => {
    try {
      console.log(chalk.blue('\nSend playlist to FF1\n'));

      // Read the playlist file
      const content = await fs.readFile(file, 'utf-8');
      const playlist: Playlist = JSON.parse(content);

      // Verify playlist before sending (unless skipped)
      if (!options.skipVerify) {
        console.log(chalk.cyan('Verify playlist'));

        const verifier = await import('./src/utilities/playlist-verifier');
        const { verifyPlaylist } = verifier;

        const verifyResult = verifyPlaylist(playlist);

        if (!verifyResult.valid) {
          console.error(chalk.red('\nPlaylist verification failed:'), verifyResult.error);

          if (verifyResult.details && verifyResult.details.length > 0) {
            console.log(chalk.yellow('\n   Validation errors:'));
            verifyResult.details.forEach((detail: { path: string; message: string }) => {
              console.log(chalk.yellow(`     • ${detail.path}: ${detail.message}`));
            });
          }

          console.log(chalk.yellow('\n   Use --skip-verify to send anyway (not recommended)\n'));
          process.exit(1);
        }

        console.log(chalk.green('✓ Verified\n'));
      }

      // Import the sending utility
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sendPlaylistToDevice } = require('./src/utilities/ff1-device');

      // Send the playlist
      const result = await sendPlaylistToDevice({
        playlist,
        deviceName: options.device,
      });

      if (result.success) {
        console.log(chalk.green('✓ Sent'));
        if (result.deviceName) {
          console.log(chalk.dim(`  Device: ${result.deviceName}`));
        }
        if (result.device) {
          console.log(chalk.dim(`  Host: ${result.device}`));
        }
        console.log();
      } else {
        console.error(chalk.red('\nSend failed:'), result.error);
        if (result.details) {
          console.error(chalk.dim(`  Details: ${result.details}`));
        }
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), (error as Error).message);
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

program.parse();
