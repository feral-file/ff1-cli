import chalk from 'chalk';
import { isPlaylistSourceUrl, loadPlaylistSource } from '../../utilities/playlist-source';
import type { Playlist } from '../../types';

export interface PlaylistVerificationResult {
  valid: boolean;
  error?: string;
  details?: Array<{ path: string; message: string }>;
  playlist?: Playlist;
}

/**
 * Print the standard "playlist saved" footer with the next-step hint.
 *
 * Used by `chat` and `build` after they write a playlist to disk, so the
 * surface message stays consistent across both commands.
 */
export function displayPlaylistSummary(playlist: Playlist, outputPath: string) {
  console.log(chalk.green('\nPlaylist saved'));
  console.log(chalk.dim(`  Output: ./${outputPath}`));
  console.log(chalk.dim('  Next: play last | publish playlist'));
  console.log();
}

/**
 * Print a focused failure for playlist source loading problems with a
 * URL-vs-file aware hint block.
 */
export function printPlaylistSourceLoadFailure(source: string, error: Error): void {
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
 * Print playlist verification failure details consistently across all
 * commands that verify before sending or publishing.
 */
export function printPlaylistVerificationFailure(
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
 * Load a playlist from a path or URL and run DP-1 verification on it.
 */
export async function verifyPlaylistSource(source: string): Promise<PlaylistVerificationResult> {
  const loaded = await loadPlaylistSource(source);

  const verifier = await import('../../utilities/playlist-verifier');
  const { verifyPlaylist } = verifier;
  const verifyResult = await verifyPlaylist(loaded.playlist);

  return {
    ...verifyResult,
    playlist: verifyResult.valid ? loaded.playlist : undefined,
  };
}

/**
 * Run the shared verify/validate command flow. Both `ff1 verify` and
 * `ff1 validate` call this with the same body.
 */
export async function runVerifyCommand(source: string): Promise<void> {
  try {
    console.log(chalk.blue('\nVerify playlist\n'));

    const verifier = await import('../../utilities/playlist-verifier');
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
