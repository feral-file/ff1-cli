import { Command } from 'commander';
import { runVerifyCommand } from './helpers/playlist-display';

// `verify` and `validate` are intentional aliases. Two registrations are
// kept (rather than commander's .alias()) because the long-standing CLI
// surface has both names appear in --help, and external scripts use both.

export const verifyCommand = new Command('verify')
  .description('Verify a DP1 playlist file against DP-1 specification')
  .argument('<file>', 'Path to the playlist file or hosted playlist URL')
  .action(async (file: string) => {
    await runVerifyCommand(file);
  });

export const validateCommand = new Command('validate')
  .description('Validate a DP1 playlist file (alias for verify)')
  .argument('<file>', 'Path to the playlist file or hosted playlist URL')
  .action(async (file: string) => {
    await runVerifyCommand(file);
  });
