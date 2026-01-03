import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import notifier from 'node-notifier';
import { EventEmitter } from 'events';
import { Logger } from './logger.js';
import { ActionClassifier } from './classifier.js';
import readline from 'readline';

/**
 * Supervisor - Manages Claude Code sessions and handles approvals
 * 
 * This is the core brain that:
 * 1. Spawns Claude Code processes
 * 2. Monitors their output for approval prompts
 * 3. Auto-responds based on your rules
 * 4. Logs everything for review
 */
export class Supervisor extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.logger = new Logger(config.logging);
    this.classifier = new ActionClassifier();
    this.activeProcess = null;
    this.sessionStats = {
      started: new Date(),
      tasksCompleted: 0,
      actionsApproved: 0,
      actionsDenied: 0,
      errors: 0
    };
  }

  /**
   * Run a queue of tasks in sequence
   */
  async runQueue(taskQueue) {
    const tasks = await taskQueue.getTasks();
    this.logger.info(`Starting queue with ${tasks.length} tasks`);
    
    const spinner = ora('Processing task queue...').start();
    
    for (const task of tasks) {
      spinner.text = `Task: ${task.description.slice(0, 50)}...`;
      
      try {
        await this.runSingle(task.prompt || task.description, task.context);
        this.sessionStats.tasksCompleted++;
        await taskQueue.markComplete(task.id);
      } catch (error) {
        this.sessionStats.errors++;
        this.logger.error(`Task failed: ${task.id}`, error);
        
        if (this.sessionStats.errors >= this.config.autopilot.stop_on.error_count) {
          spinner.fail('Stopped: Too many consecutive errors');
          this.notify('Autopilot stopped due to errors', 'error');
          break;
        }
      }
    }
    
    spinner.succeed(`Queue complete: ${this.sessionStats.tasksCompleted} tasks`);
    this.printSummary();
  }

  /**
   * Run a single prompt through Claude Code
   */
  async runSingle(prompt, context = '') {
    const fullPrompt = this.buildPrompt(prompt, context);
    this.logger.info(`Running: ${prompt.slice(0, 100)}...`);
    
    return new Promise((resolve, reject) => {
      const args = this.config.safety.dry_run 
        ? ['--print'] 
        : [];
      
      // In autopilot mode, we use dangerously-skip-permissions for auto-accept
      // But we still monitor output for our own logging
      if (this.config.mode === 'autopilot') {
        args.push('--dangerously-skip-permissions');
      }
      
      args.push(fullPrompt);
      
      this.activeProcess = spawn('claude', args, {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let currentAction = null;

      this.activeProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
        
        // Detect and classify actions
        const action = this.classifier.detect(text);
        if (action) {
          currentAction = action;
          this.handleAction(action);
        }
        
        this.logger.debug('stdout', text);
      });

      this.activeProcess.stderr.on('data', (data) => {
        const text = data.toString();
        process.stderr.write(chalk.red(text));
        this.logger.error('stderr', text);
      });

      this.activeProcess.on('close', (code) => {
        this.activeProcess = null;
        
        if (code === 0) {
          this.logger.info('Task completed successfully');
          resolve({ output, code });
        } else {
          this.logger.error(`Task exited with code ${code}`);
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      this.activeProcess.on('error', (error) => {
        this.logger.error('Process error', error);
        reject(error);
      });
    });
  }

  /**
   * Start interactive copilot mode
   */
  async startInteractive(projectPath) {
    console.log(chalk.green('Copilot mode active. Monitoring for Claude Code sessions...\n'));
    console.log(chalk.gray('Commands:'));
    console.log(chalk.gray('  /task <description>  - Add a task'));
    console.log(chalk.gray('  /status              - Show status'));
    console.log(chalk.gray('  /pause               - Pause auto-accept'));
    console.log(chalk.gray('  /resume              - Resume auto-accept'));
    console.log(chalk.gray('  /quit                - Exit copilot\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    let paused = false;

    rl.on('line', async (input) => {
      const trimmed = input.trim();
      
      if (trimmed.startsWith('/')) {
        const [cmd, ...args] = trimmed.slice(1).split(' ');
        
        switch (cmd) {
          case 'task':
            await this.runSingle(args.join(' '));
            break;
          case 'status':
            this.printStatus();
            break;
          case 'pause':
            paused = true;
            console.log(chalk.yellow('⏸ Auto-accept paused'));
            break;
          case 'resume':
            paused = false;
            console.log(chalk.green('▶ Auto-accept resumed'));
            break;
          case 'quit':
            this.printSummary();
            process.exit(0);
          default:
            console.log(chalk.red(`Unknown command: ${cmd}`));
        }
      } else if (trimmed) {
        // Treat as a new task
        await this.runSingle(trimmed);
      }
      
      rl.prompt();
    });

    rl.setPrompt(chalk.cyan('copilot> '));
    rl.prompt();
  }

  /**
   * Handle an action detected in Claude Code output
   */
  handleAction(action) {
    const modeConfig = this.config[this.config.mode];
    
    // Check if action is auto-accepted
    if (modeConfig.auto_accept?.includes(action.type)) {
      this.logger.info(`Auto-accepted: ${action.type}`, action.details);
      this.sessionStats.actionsApproved++;
      return 'accept';
    }
    
    // Check if action requires approval
    if (modeConfig.require_approval?.includes(action.type)) {
      this.logger.warn(`Requires approval: ${action.type}`, action.details);
      this.notify(`Action requires approval: ${action.type}`, 'warn');
      // In a full implementation, this would pause and wait for input
      return 'pause';
    }
    
    // Check quick confirm (copilot mode)
    if (modeConfig.quick_confirm?.includes(action.type)) {
      this.logger.info(`Quick confirm: ${action.type}`, action.details);
      // Would show brief notification then auto-accept
      this.sessionStats.actionsApproved++;
      return 'accept';
    }
    
    // Unknown action - check stop conditions
    if (this.config.autopilot.stop_on.unknown_action && this.config.mode === 'autopilot') {
      this.logger.warn(`Unknown action type: ${action.type}`);
      return 'stop';
    }
    
    return 'accept';
  }

  /**
   * Build the full prompt with context injection
   */
  buildPrompt(prompt, taskContext = '') {
    const parts = [];
    
    // Add project standards
    if (this.config.context?.project_standards) {
      parts.push(`[Project Standards]\n${this.config.context.project_standards}`);
    }
    
    // Add current focus
    if (this.config.context?.current_focus) {
      parts.push(`[Current Focus]\n${this.config.context.current_focus}`);
    }
    
    // Add task-specific context
    if (taskContext) {
      parts.push(`[Task Context]\n${taskContext}`);
    }
    
    // Add error handling instructions
    if (this.config.context?.error_handling) {
      parts.push(`[Error Handling]\n${this.config.context.error_handling}`);
    }
    
    // Add the actual prompt
    parts.push(`[Task]\n${prompt}`);
    
    return parts.join('\n\n');
  }

  /**
   * Send a system notification
   */
  notify(message, type = 'info') {
    if (!this.config.autopilot.notify?.on_complete) return;
    
    const icons = {
      info: '✓',
      warn: '⚠',
      error: '✗'
    };
    
    notifier.notify({
      title: 'Edge Autopilot',
      message: `${icons[type]} ${message}`,
      sound: type === 'error'
    });
  }

  /**
   * Print current status
   */
  printStatus() {
    const uptime = Math.round((Date.now() - this.sessionStats.started) / 1000 / 60);
    
    console.log(chalk.cyan('\n═══ Status ═══'));
    console.log(`Mode: ${chalk.yellow(this.config.mode)}`);
    console.log(`Uptime: ${uptime} minutes`);
    console.log(`Tasks completed: ${this.sessionStats.tasksCompleted}`);
    console.log(`Actions approved: ${this.sessionStats.actionsApproved}`);
    console.log(`Actions denied: ${this.sessionStats.actionsDenied}`);
    console.log(`Errors: ${this.sessionStats.errors}`);
    console.log('');
  }

  /**
   * Print session summary
   */
  printSummary() {
    const duration = Math.round((Date.now() - this.sessionStats.started) / 1000 / 60);
    
    console.log(chalk.cyan('\n╔═══════════════════════════════════════════╗'));
    console.log(chalk.cyan('║           SESSION SUMMARY                 ║'));
    console.log(chalk.cyan('╚═══════════════════════════════════════════╝\n'));
    
    console.log(`Duration: ${duration} minutes`);
    console.log(`Tasks completed: ${chalk.green(this.sessionStats.tasksCompleted)}`);
    console.log(`Actions approved: ${chalk.green(this.sessionStats.actionsApproved)}`);
    console.log(`Actions denied: ${chalk.yellow(this.sessionStats.actionsDenied)}`);
    console.log(`Errors: ${chalk.red(this.sessionStats.errors)}`);
    console.log(`\nLogs saved to: ${this.config.logging?.directory || './logs/'}\n`);
  }
}
