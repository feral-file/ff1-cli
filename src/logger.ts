/**
 * Simple logging utility that respects verbose mode
 */

import chalk from 'chalk';

// Global verbose flag
let isVerbose = false;

/**
 * Set verbose mode
 * @param {boolean} verbose - Whether to enable verbose logging
 */
export function setVerbose(verbose: boolean): void {
  isVerbose = verbose;
}

/**
 * Log debug message (only in verbose mode)
 * @param {...any} args - Arguments to log
 */
export function debug(...args: unknown[]): void {
  if (isVerbose) {
    console.log(chalk.dim('[DEBUG]'), ...args);
  }
}

/**
 * Log info message (only in verbose mode)
 * @param {...any} args - Arguments to log
 */
export function info(...args: unknown[]): void {
  if (isVerbose) {
    console.log(chalk.blue('[INFO]'), ...args);
  }
}

/**
 * Log warning message (only in verbose mode)
 * @param {...any} args - Arguments to log
 */
export function warn(...args: unknown[]): void {
  if (isVerbose) {
    console.warn(chalk.yellow('[WARN]'), ...args);
  }
}

/**
 * Log message only in verbose mode (no prefix)
 * @param {...any} args - Arguments to log
 */
export function verbose(...args: unknown[]): void {
  if (isVerbose) {
    console.log(...args);
  }
}

/**
 * Log error message (always shown, but with more details in verbose mode)
 * @param {...any} args - Arguments to log
 */
export function error(...args: unknown[]): void {
  if (isVerbose) {
    console.error(chalk.red('[ERROR]'), ...args);
  } else {
    // In non-verbose mode, errors are still shown but handled by the caller
    // This allows the orchestrator to show clean error messages
    console.error(chalk.red('[ERROR]'), ...args);
  }
}

/**
 * Log message that always shows (bypass verbose mode)
 * @param {...any} args - Arguments to log
 */
export function always(...args: unknown[]): void {
  console.log(...args);
}
