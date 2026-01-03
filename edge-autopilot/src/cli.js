#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { Supervisor } from './supervisor-v2.js';
import { loadConfig } from './config.js';
import { TaskQueue } from './tasks.js';

const program = new Command();

const banner = `
╔═══════════════════════════════════════════╗
║         EDGE AUTOPILOT v1.0               ║
║   AI Agent Supervisor for Claude Code     ║
╚═══════════════════════════════════════════╝
`;

program
  .name('autopilot')
  .description('AI Agent Supervisor - runs Claude Code as you')
  .version('1.0.0');

program
  .command('autopilot')
  .description('Run in autonomous mode')
  .option('-t, --tasks <file>', 'Task file', './tasks/example-queue.yaml')
  .option('-c, --config <file>', 'Config file', './config.yaml')
  .action(async (options) => {
    console.log(chalk.cyan(banner));
    console.log(chalk.yellow('🤖 Starting AUTOPILOT mode...\n'));
    
    const config = await loadConfig(options.config);
    config.mode = 'autopilot';
    
    const workDir = config.workingDirectory || process.cwd();
    console.log(chalk.gray(`📁 Working directory: ${workDir}\n`));
    
    const supervisor = new Supervisor(config);
    const queue = new TaskQueue(options.tasks);
    await supervisor.runQueue(queue);
  });

program
  .command('copilot')
  .description('Run in assisted mode')
  .option('-c, --config <file>', 'Config file', './config.yaml')
  .action(async (options) => {
    console.log(chalk.cyan(banner));
    console.log(chalk.green('👥 Starting COPILOT mode...\n'));
    
    const config = await loadConfig(options.config);
    config.mode = 'copilot';
    
    const supervisor = new Supervisor(config);
    await supervisor.startInteractive();
  });

program
  .command('run <prompt...>')
  .description('Run a single task immediately')
  .option('-c, --config <file>', 'Config file', './config.yaml')
  .option('-d, --dir <path>', 'Working directory')
  .action(async (promptParts, options) => {
    console.log(chalk.cyan(banner));
    
    const prompt = promptParts.join(' ');
    console.log(chalk.green(`\n📋 Task: ${prompt}\n`));
    
    const config = await loadConfig(options.config);
    
    if (options.dir) {
      config.workingDirectory = options.dir;
    }
    
    const workDir = config.workingDirectory || process.cwd();
    console.log(chalk.gray(`📁 Working directory: ${workDir}\n`));
    
    const { spawn } = await import('child_process');
    
    const proc = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
      cwd: workDir,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('\n✓ Task completed'));
      } else {
        console.log(chalk.red(`\n✗ Task failed with code ${code}`));
        process.exit(1);
      }
    });
  });

program.parse();
