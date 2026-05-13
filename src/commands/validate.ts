import { Command } from 'commander';
import { runValidateCommand, runVerifyCommand } from './helpers/playlist-display';

export const verifyCommand = new Command('verify')
  .description('Validate playlist structure and verify DP-1 signatures')
  .argument('<file>', 'Path to the playlist file or hosted playlist URL')
  .option(
    '--public-key <publicKey>',
    'Ed25519 public key for legacy verification (overrides deriving from playlist.privateKey / PLAYLIST_PRIVATE_KEY)'
  )
  .action(async (file: string, options: { publicKey?: string }) => {
    await runVerifyCommand(file, options.publicKey);
  });

export const validateCommand = new Command('validate')
  .description('Validate playlist structure only')
  .argument('<file>', 'Path to the playlist file or hosted playlist URL')
  .action(async (file: string) => {
    await runValidateCommand(file);
  });
