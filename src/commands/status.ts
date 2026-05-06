import { Command } from 'commander';
import chalk from 'chalk';
import {
  isMissingConfigValue,
  readConfigFile,
  resolveExistingConfigPath,
} from './helpers/config-files';

export const statusCommand = new Command('status')
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

      const hasApiKey = defaultModel ? !isMissingConfigValue(defaultModelConfig?.apiKey) : false;

      const statuses = [
        {
          label: 'Config file',
          ok: true,
          detail: configPath,
        },
        {
          label: `Default model (${defaultModelLabel}) API key`,
          ok: hasApiKey,
          optional: true,
        },
        {
          label: 'Playlist signing key',
          ok: !isMissingConfigValue(config.playlist?.privateKey || ''),
        },
        {
          label: 'Playlist signing role',
          ok: !isMissingConfigValue(config.playlist?.role || ''),
          optional: true,
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
        let label: string;
        if (status.ok) {
          label = chalk.green('OK');
        } else if (status.optional) {
          label = chalk.yellow('Not set');
        } else {
          label = chalk.red('Missing');
        }
        const detail = status.detail ? chalk.dim(` (${status.detail})`) : '';
        const hint = !status.ok && status.optional ? chalk.dim(' (only needed for chat)') : '';
        console.log(`${label} ${status.label}${detail}${hint}`);
      });

      const hasRequired = statuses.some((status) => !status.ok && !status.optional);
      if (hasRequired) {
        console.log(chalk.dim('\nRun: ff1 setup'));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\nStatus check failed:'), (error as Error).message);
      process.exit(1);
    }
  });
