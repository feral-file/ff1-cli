import * as readline from 'readline';
import chalk from 'chalk';

/**
 * Wrapper around readline that yields a promise-returning ask() function
 * and a close() to dispose the interface. Used by interactive commands
 * (setup, status, chat, device add) so they share one prompt convention.
 */
export interface Prompt {
  ask: (question: string) => Promise<string>;
  close: () => void;
}

export function createPrompt(): Prompt {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = async (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(chalk.yellow(question), (answer: string) => {
        resolve(answer.trim());
      });
    });

  return {
    ask,
    close: () => rl.close(),
  };
}

export async function promptYesNo(
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
