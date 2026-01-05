#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { Supervisor } from './supervisor-v2.js';
import { loadConfig } from './config.js';
import { TaskQueue } from './tasks.js';
import { getProviderInfo, createProvider, resolveModel, PROVIDERS } from './providers/index.js';

const program = new Command();

const banner = `
╔═══════════════════════════════════════════╗
║         EDGE AUTOPILOT v1.1               ║
║   AI Agent Supervisor - Multi-Provider    ║
╚═══════════════════════════════════════════╝
`;

program
  .name('autopilot')
  .description('AI Agent Supervisor - runs AI agents (Claude or OpenAI)')
  .version('1.1.0');

program
  .command('autopilot')
  .description('Run in autonomous mode')
  .option('-t, --tasks <file>', 'Task file', './tasks/example-queue.yaml')
  .option('-c, --config <file>', 'Config file', './config.yaml')
  .option('-p, --provider <provider>', 'AI provider (claude, openai)', '')
  .option('-m, --model <model>', 'AI model (opus/sonnet/haiku for Claude, gpt-4o/gpt-4-turbo/gpt-3.5-turbo for OpenAI)', '')
  .option('--no-dashboard', 'Disable the web dashboard')
  .action(async (options) => {
    console.log(chalk.cyan(banner));
    console.log(chalk.yellow('🤖 Starting AUTOPILOT mode...\n'));

    const config = await loadConfig(options.config);
    config.mode = 'autopilot';
    config.dashboard = options.dashboard !== false;

    // Provider priority: CLI flag > config file > default (claude)
    if (options.provider) {
      config.provider = options.provider;
    }
    config.provider = config.provider || 'claude';

    // Model priority: CLI flag > config file > default
    if (options.model) {
      config.model = options.model;
    }

    const workDir = config.workingDirectory || process.cwd();
    const providerInfo = getProviderInfo(config.provider, config.model);

    console.log(chalk.gray(`📁 Working directory: ${workDir}`));
    console.log(chalk.gray(`🤖 Provider: ${providerInfo.provider}`));
    console.log(chalk.gray(`🧠 Model: ${providerInfo.model}\n`));

    const supervisor = new Supervisor(config);
    const queue = new TaskQueue(options.tasks);
    await supervisor.runQueue(queue);
  });

program
  .command('copilot')
  .description('Run in assisted mode')
  .option('-c, --config <file>', 'Config file', './config.yaml')
  .option('-p, --provider <provider>', 'AI provider (claude, openai)', '')
  .option('-m, --model <model>', 'AI model', '')
  .action(async (options) => {
    console.log(chalk.cyan(banner));
    console.log(chalk.green('👥 Starting COPILOT mode...\n'));

    const config = await loadConfig(options.config);
    config.mode = 'copilot';

    if (options.provider) {
      config.provider = options.provider;
    }
    config.provider = config.provider || 'claude';

    if (options.model) {
      config.model = options.model;
    }

    const workDir = config.workingDirectory || process.cwd();
    const providerInfo = getProviderInfo(config.provider, config.model);

    console.log(chalk.gray(`📁 Working directory: ${workDir}`));
    console.log(chalk.gray(`🤖 Provider: ${providerInfo.provider}`));
    console.log(chalk.gray(`🧠 Model: ${providerInfo.model}\n`));

    const supervisor = new Supervisor(config);
    await supervisor.startInteractive();
  });

program
  .command('run <prompt...>')
  .description('Run a single task immediately')
  .option('-c, --config <file>', 'Config file', './config.yaml')
  .option('-d, --dir <path>', 'Working directory')
  .option('-p, --provider <provider>', 'AI provider (claude, openai)', '')
  .option('-m, --model <model>', 'AI model to use', '')
  .action(async (promptParts, options) => {
    console.log(chalk.cyan(banner));

    const prompt = promptParts.join(' ');
    console.log(chalk.green(`\n📋 Task: ${prompt}\n`));

    const config = await loadConfig(options.config);

    if (options.dir) {
      config.workingDirectory = options.dir;
    }

    // Provider priority: CLI flag > config file > default (claude)
    if (options.provider) {
      config.provider = options.provider;
    }
    config.provider = config.provider || 'claude';

    // Model priority: CLI flag > config file
    if (options.model) {
      config.model = options.model;
    }

    const workDir = config.workingDirectory || process.cwd();
    const providerInfo = getProviderInfo(config.provider, config.model);

    console.log(chalk.gray(`📁 Working directory: ${workDir}`));
    console.log(chalk.gray(`🤖 Provider: ${providerInfo.provider}`));
    console.log(chalk.gray(`🧠 Model: ${providerInfo.model}\n`));

    const provider = createProvider(config.provider, config);
    const resolvedModel = resolveModel(config.provider, config.model);

    try {
      const result = await provider.runTask(prompt, {
        model: resolvedModel,
        workDir
      });

      if (result.code === 0) {
        console.log(chalk.green('\n✓ Task completed'));
      } else {
        console.log(chalk.red(`\n✗ Task failed with code ${result.code}`));
        process.exit(1);
      }
    } catch (error) {
      console.log(chalk.red(`\n✗ Task failed: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show configuration and environment info')
  .option('-c, --config <file>', 'Config file', './config.yaml')
  .action(async (options) => {
    console.log(chalk.cyan(banner));

    const config = await loadConfig(options.config);
    const workDir = config.workingDirectory || process.cwd();
    const provider = config.provider || 'claude';
    const providerInfo = getProviderInfo(provider, config.model);

    console.log(chalk.bold('Edge Autopilot Status'));
    console.log(chalk.gray('Node:'), process.version);
    console.log(chalk.gray('Config file:'), options.config);
    console.log(chalk.gray('Working directory:'), workDir);
    console.log(chalk.gray('Dashboard enabled:'), Boolean(config.dashboard));
    console.log(chalk.gray('Mode:'), config.mode || '(not set)');
    console.log(chalk.gray('Provider:'), providerInfo.provider);
    console.log(chalk.gray('Model:'), providerInfo.model);

    // Show available providers
    console.log(chalk.bold('\nAvailable Providers:'));
    for (const [key, prov] of Object.entries(PROVIDERS)) {
      const models = Object.keys(prov.models).filter(m => !['default', 'fast', 'best'].includes(m));
      console.log(chalk.gray(`  ${key}:`), models.join(', '));
    }

    // Check API keys
    console.log(chalk.bold('\nAPI Keys:'));
    console.log(chalk.gray('  ANTHROPIC_API_KEY:'), process.env.ANTHROPIC_API_KEY ? '✓ set' : '✗ not set');
    console.log(chalk.gray('  OPENAI_API_KEY:'), process.env.OPENAI_API_KEY ? '✓ set' : '✗ not set');
  });

program.parse();
