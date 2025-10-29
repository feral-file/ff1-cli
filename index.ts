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
import * as readline from 'readline';
import { getConfig, validateConfig, createSampleConfig, listAvailableModels } from './src/config';
import { buildPlaylist, buildPlaylistDirect } from './src/main';
import type { Playlist } from './src/types';

const program = new Command();

/**
 * Display playlist creation summary with next steps.
 *
 * @param {Playlist} playlist - The created playlist object
 * @param {string} outputPath - Path where the playlist was saved
 */
function displayPlaylistSummary(playlist: Playlist, outputPath: string) {
  console.log(chalk.green('\n✅ Playlist created!'));
  console.log();
  console.log(chalk.bold('Next steps:'));
  console.log(chalk.gray(` • View it locally: open ./${outputPath}`));
  console.log(chalk.gray(` • Send it to your FF1: send last`));
  console.log(chalk.gray(` • Publish to feed: publish playlist`));
  console.log();
}

program
  .name('ff1')
  .description(
    'CLI to fetch NFT information and build DP1 playlists using AI (Grok, ChatGPT, Gemini)'
  )
  .version('1.0.0');

program
  .command('chat')
  .description('Start an interactive chat to build playlists using natural language')
  .argument('[content]', 'Optional: Direct chat content (non-interactive mode)')
  .option('-o, --output <filename>', 'Output filename for the playlist', 'playlist.json')
  .option(
    '-m, --model <name>',
    'AI model to use (grok, chatgpt, gemini) - defaults to config setting'
  )
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
          console.error(chalk.red(`❌ Invalid model: "${options.model}"`));
          console.log(chalk.yellow(`\nAvailable models: ${availableModels.join(', ')}`));
          process.exit(1);
        }

        const modelName = options.model || config.defaultModel;

        const validation = validateConfig(modelName);
        if (!validation.valid) {
          console.error(chalk.red('❌ Configuration Error:'));
          validation.errors.forEach((error) => {
            console.error(chalk.red(`  • ${error}`));
          });
          console.log(chalk.yellow('\nRun: node index.js config init\n'));
          process.exit(1);
        }

        // NON-INTERACTIVE MODE: If content is provided as argument
        if (content) {
          console.log(chalk.blue('\n💬 FF1 Playlist Chat (Non-Interactive Mode)\n'));
          console.log(chalk.gray(`🤖 Using AI model: ${modelName}\n`));
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
              console.log(chalk.green('\n✅ Playlist Created Successfully!'));
              console.log(chalk.gray(`   Title: ${result.playlist.title}`));
              console.log(chalk.gray(`   Items: ${result.playlist.items?.length || 0}`));
              console.log(chalk.gray(`   Output: ${options.output}\n`));
            }

            process.exit(0);
          } catch (error) {
            console.error(chalk.red('\n❌ Error:'), (error as Error).message);
            if (options.verbose) {
              console.error(chalk.gray((error as Error).stack));
            }
            process.exit(1);
          }
        }

        // INTERACTIVE MODE: Start conversation loop
        console.log(chalk.blue('\n💬 Welcome to FF1 Playlist Chat!\n'));
        console.log(chalk.gray('Tell me what playlist you want to create.'));
        console.log(chalk.gray('Press Ctrl+C to exit.\n'));
        console.log(chalk.gray(`🤖 Using AI model: ${modelName}\n`));
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  - "Get tokens 1,2,3 from Ethereum contract 0xabc"'));
        console.log(chalk.gray('  - "Get token 42 from Tezos contract KT1abc"'));
        console.log(chalk.gray('  - "Get 3 from Social Codes and 2 from 0xdef"'));
        console.log(
          chalk.gray(
            '  - "Build a playlist of my Tezos works from address tz1... plus 3 from Social Codes"'
          )
        );
        console.log(chalk.gray('  (Tip) Add -v to see tool calls'));
        console.log();

        // Continuous conversation loop
        while (true) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const userInput = await new Promise<string>((resolve) => {
            rl.question(chalk.yellow('You: '), (answer: string) => {
              rl.close();
              resolve(answer.trim());
            });
          });

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
              console.log(chalk.gray(`\n[DEBUG] result.sentToDevice: ${result?.sentToDevice}`));
              console.log(chalk.gray(`[DEBUG] result.action: ${result?.action}`));
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
            console.error(chalk.red('❌ Error:'), (error as Error).message);
            if (options.verbose) {
              console.error(chalk.gray((error as Error).stack));
            }
            console.log(); // Blank line after error
          }
        }
      } catch (error) {
        if ((error as Error).message !== 'readline was closed') {
          console.error(chalk.red('\n❌ Error:'), (error as Error).message);
          if (process.env.DEBUG) {
            console.error(chalk.gray((error as Error).stack));
          }
        }
        console.log(chalk.blue('\n👋 Goodbye!\n'));
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
      console.log(chalk.blue('\n🔍 Verifying playlist...\n'));

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
      console.error(chalk.red('\n❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate a DP1 playlist file (alias for verify)')
  .argument('<file>', 'Path to the playlist file')
  .action(async (file: string) => {
    try {
      console.log(chalk.blue('\n🔍 Verifying playlist...\n'));

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
      console.error(chalk.red('\n❌ Error:'), (error as Error).message);
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
      console.log(chalk.blue('\n🔏 Signing playlist...\n'));

      // Import the signing utility
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { signPlaylistFile } = require('./src/utilities/playlist-signer');

      // Sign the playlist
      const result = await signPlaylistFile(file, options.key, options.output);

      if (result.success) {
        console.log(chalk.green('\n✅ Playlist signed successfully!'));
        if (result.playlist?.signature) {
          console.log(chalk.gray(`   Signature: ${result.playlist.signature.substring(0, 30)}...`));
        }
        console.log();
      } else {
        console.error(chalk.red('\n❌ Failed to sign playlist:'), result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Error:'), (error as Error).message);
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
      console.log(chalk.blue('\n📤 Sending playlist to FF1 device...\n'));

      // Read the playlist file
      const content = await fs.readFile(file, 'utf-8');
      const playlist: Playlist = JSON.parse(content);

      // Verify playlist before sending (unless skipped)
      if (!options.skipVerify) {
        console.log(chalk.cyan('🔍 Verifying playlist...'));

        const verifier = await import('./src/utilities/playlist-verifier');
        const { verifyPlaylist } = verifier;

        const verifyResult = verifyPlaylist(playlist);

        if (!verifyResult.valid) {
          console.error(chalk.red('\n❌ Playlist verification failed:'), verifyResult.error);

          if (verifyResult.details && verifyResult.details.length > 0) {
            console.log(chalk.yellow('\n   Validation errors:'));
            verifyResult.details.forEach((detail: { path: string; message: string }) => {
              console.log(chalk.yellow(`     • ${detail.path}: ${detail.message}`));
            });
          }

          console.log(chalk.yellow('\n   Use --skip-verify to send anyway (not recommended)\n'));
          process.exit(1);
        }

        console.log(chalk.green('✓ Playlist verified successfully\n'));
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
        console.log(chalk.green('✅ Playlist sent successfully!'));
        if (result.deviceName) {
          console.log(chalk.gray(`   Device: ${result.deviceName}`));
        }
        if (result.device) {
          console.log(chalk.gray(`   Host: ${result.device}`));
        }
        console.log();
      } else {
        console.error(chalk.red('\n❌ Failed to send playlist:'), result.error);
        if (result.details) {
          console.error(chalk.gray(`   Details: ${result.details}`));
        }
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Error:'), (error as Error).message);
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
      console.log(chalk.blue('\n📡 Publishing playlist to feed server...\n'));

      const { getFeedConfig } = await import('./src/config');
      const { publishPlaylist } = await import('./src/utilities/playlist-publisher');

      const feedConfig = getFeedConfig();

      if (!feedConfig.baseURLs || feedConfig.baseURLs.length === 0) {
        console.error(chalk.red('\n❌ No feed servers configured'));
        console.log(chalk.yellow('   Add feed server URLs to config.json: feed.baseURLs\n'));
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
          console.error(chalk.red('\n❌ Invalid server index'));
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
        console.log(chalk.green('✅ Playlist published successfully!'));
        if (result.playlistId) {
          console.log(chalk.gray(`   Playlist ID: ${result.playlistId}`));
        }
        console.log(chalk.gray(`   Server: ${result.feedServer}`));
        if (result.message) {
          console.log(chalk.gray(`   Status: ${result.message}`));
        }
        console.log();
      } else {
        console.error(chalk.red('\n❌ Failed to publish playlist'));
        if (result.error) {
          console.error(chalk.red(`   ${result.error}`));
        }
        if (result.message) {
          console.log(chalk.yellow(`\n${result.message}`));
        }
        console.log();
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Error:'), (error as Error).message);
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
          console.error(chalk.red('❌ No parameters provided'));
          console.log(chalk.yellow('\nUsage:'));
          console.log('  node index.js build params.json');
          console.log('  cat params.json | node index.js build');
          console.log('  echo \'{"requirements":[...]}\' | node index.js build');
          process.exit(1);
        }

        params = JSON.parse(stdin);
      }

      if (options.verbose) {
        console.log(chalk.blue('\n📋 Parameters:'));
        console.log(chalk.gray(JSON.stringify(params, null, 2)));
        console.log();
      }

      console.log(chalk.blue('\n🚀 Building playlist from parameters...\n'));

      const result = await buildPlaylistDirect(params, {
        verbose: options.verbose,
        outputPath: options.output,
      });

      if (result && result.playlist) {
        console.log(chalk.green('\n✅ Playlist Created Successfully!'));
        console.log(chalk.gray(`   Title: ${result.playlist.title}`));
        console.log(chalk.gray(`   Items: ${result.playlist.items?.length || 0}`));
        console.log(chalk.gray(`   Output: ${options.output}\n`));
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Error:'), (error as Error).message);
      if (options.verbose) {
        console.error(chalk.gray((error as Error).stack));
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
        console.log(chalk.blue('\n🔧 Creating config.json...\n'));
        const configPath = await createSampleConfig();
        console.log(chalk.green(`✓ Created ${configPath}`));
        console.log(chalk.yellow('\nPlease edit config.json and add your API key.\n'));
      } else if (action === 'show') {
        const config = getConfig();
        console.log(chalk.blue('\n⚙️  Current Configuration:\n'));
        console.log(chalk.bold('Default Model:'), chalk.white(config.defaultModel));
        console.log(chalk.bold('Default Duration:'), chalk.white(config.defaultDuration + 's'));
        console.log(chalk.bold('\nAvailable Models:\n'));

        const models = listAvailableModels();
        models.forEach((modelName) => {
          const modelConfig = config.models[modelName];
          const isCurrent = modelName === config.defaultModel;
          console.log(`  ${isCurrent ? chalk.green('→') : ' '} ${chalk.bold(modelName)}`);
          console.log(
            `    API Key: ${modelConfig.apiKey && modelConfig.apiKey !== 'your_api_key_here' ? chalk.green('✓ Set') : chalk.red('✗ Not set')}`
          );
          console.log(`    Base URL: ${chalk.gray(modelConfig.baseURL)}`);
          console.log(`    Model: ${chalk.gray(modelConfig.model)}`);
          console.log(
            `    Function Calling: ${modelConfig.supportsFunctionCalling ? chalk.green('✓ Supported') : chalk.red('✗ Not supported')}`
          );
          console.log();
        });
      } else if (action === 'validate') {
        const validation = validateConfig();

        console.log(chalk.blue('\n🔍 Validating configuration...\n'));

        if (validation.valid) {
          console.log(chalk.green('✓ Configuration is valid!\n'));
        } else {
          console.log(chalk.red('✗ Configuration has errors:\n'));
          validation.errors.forEach((error) => {
            console.log(chalk.red(`  • ${error}`));
          });
          console.log();
          process.exit(1);
        }
      } else {
        console.error(chalk.red(`\n❌ Unknown action: ${action}`));
        console.log(chalk.yellow('Available actions: init, show, validate\n'));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
