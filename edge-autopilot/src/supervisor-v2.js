import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import notifier from 'node-notifier';
import { EventEmitter } from 'events';
import readline from 'readline';

import { Logger } from './logger.js';
import { SmartDetector } from './smart-detector.js';
import { SlackNotifier } from './slack.js';
import { Dashboard } from './dashboard.js';

/**
 * SupervisorV2 - Enhanced supervisor with Slack, Smart Detection, and Dashboard
 * 
 * Integrations:
 * - SmartDetector: ML-like action detection with risk scoring
 * - SlackNotifier: Rich Slack notifications with interactive buttons
 * - Dashboard: Real-time web monitoring
 */
export class Supervisor extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    
    // Core modules
    this.logger = new Logger(config.logging);
    this.detector = new SmartDetector();
    this.slack = new SlackNotifier(config.notifications?.slack);
    this.dashboard = new Dashboard({
      port: config.dashboard?.port || 3847,
      logsDir: config.logging?.directory || './logs'
    });
    
    // Session state
    this.activeProcess = null;
    this.isPaused = false;
    this.sessionStats = {
      started: new Date(),
      tasksCompleted: 0,
      tasksFailed: 0,
      actionsApproved: 0,
      actionsDenied: 0,
      errors: 0,
      filesChanged: 0
    };
    
    // Pending approvals
    this.pendingApprovals = new Map();
    
    // Set up dashboard event handlers
    this.setupDashboardEvents();
  }

  /**
   * Set up event handlers for dashboard interactions
   */
  setupDashboardEvents() {
    this.dashboard.on('approve', (actionId) => {
      const pending = this.pendingApprovals.get(actionId);
      if (pending) {
        pending.resolve('approve');
        this.pendingApprovals.delete(actionId);
      }
    });

    this.dashboard.on('deny', (actionId) => {
      const pending = this.pendingApprovals.get(actionId);
      if (pending) {
        pending.resolve('deny');
        this.pendingApprovals.delete(actionId);
      }
    });

    this.dashboard.on('pause', () => {
      this.isPaused = true;
      this.dashboard.updateMode('paused');
      this.logger.info('Session paused via dashboard');
    });

    this.dashboard.on('resume', () => {
      this.isPaused = false;
      this.dashboard.updateMode(this.config.mode);
      this.logger.info('Session resumed via dashboard');
    });
  }

  /**
   * Run a queue of tasks in sequence
   */
  async runQueue(taskQueue) {
    const tasks = await taskQueue.getTasks();
    this.logger.info(`Starting queue with ${tasks.length} tasks`);
    
    // Start dashboard
    await this.dashboard.start();
    this.dashboard.updateMode(this.config.mode);
    this.dashboard.updateQueue(tasks);
    this.dashboard.updateStats(this.sessionStats);
    
    // Send Slack notification
    await this.slack.sessionStart(this.config.mode, tasks.length);
    
    const spinner = ora('Processing task queue...').start();
    
    for (const task of tasks) {
      if (this.isPaused) {
        spinner.text = 'Paused - waiting...';
        await this.waitForResume();
      }
      
      spinner.text = `Task: ${task.description?.slice(0, 50)}...`;
      this.dashboard.updateTask(task);
      
      await this.slack.taskStart(task);
      const taskStart = Date.now();
      
      try {
        await this.runSingle(task.prompt || task.description, task.context);
        
        this.sessionStats.tasksCompleted++;
        await taskQueue.markComplete(task.id);
        
        const taskStats = {
          duration: Date.now() - taskStart,
          actionsApproved: this.sessionStats.actionsApproved,
          filesChanged: this.sessionStats.filesChanged,
          errors: 0
        };
        
        this.dashboard.taskCompleted(task);
        await this.slack.taskComplete(task, taskStats);
        
      } catch (error) {
        this.sessionStats.errors++;
        this.sessionStats.tasksFailed++;
        
        this.logger.error(`Task failed: ${task.id}`, error);
        this.dashboard.taskFailed(task, error.message);
        await this.slack.taskFailed(task, error);
        
        if (this.sessionStats.errors >= this.config.autopilot.stop_on?.error_count) {
          spinner.fail('Stopped: Too many consecutive errors');
          break;
        }
      }
      
      // Update dashboard stats
      this.dashboard.updateStats(this.sessionStats);
      this.dashboard.updateInsights(this.detector.getInsights());
    }
    
    spinner.succeed(`Queue complete: ${this.sessionStats.tasksCompleted} tasks`);
    
    // Final notifications
    await this.slack.sessionComplete(this.sessionStats);
    this.printSummary();
    
    // Keep dashboard running after completion
    if (this.dashboard.sessionComplete) {
      this.dashboard.sessionComplete();
    }
  }

 /**
   * Run a single prompt through Claude Code
   */
  async runSingle(prompt, context = '') {
    const fullPrompt = this.buildPrompt(prompt, context);
    this.logger.info(`Running: ${prompt.slice(0, 100)}...`);

    return new Promise((resolve, reject) => {
      const args = ['-p', '--dangerously-skip-permissions', fullPrompt];
      const workDir = this.config.workingDirectory || process.cwd();

      const proc = spawn('claude', args, {
        cwd: workDir,
        stdio: 'inherit',
        env: { ...process.env, FORCE_COLOR: '1' }
      });

      proc.on('close', (code) => {
        this.activeProcess = null;
        this.logger.info(`Task completed with code ${code}`);
        this.sessionStats.tasksCompleted++;
        this.sessionStats.filesChanged++;
        this.dashboard.updateStats(this.sessionStats);
        resolve({ code });
      });

      proc.on('error', (err) => {
        this.activeProcess = null;
        this.sessionStats.errors++;
        this.sessionStats.tasksFailed++;
        this.logger.error('Spawn error:', err.message);
        reject(err);
      });

      this.activeProcess = proc;
    });
  }
  
  /**
   * Handle detected action with smart risk assessment
   */
  async handleAction(action) {
    // Update dashboard
    this.dashboard.addAction(action);
    
    // Get recommendation from smart detector
    const recommendation = this.detector.shouldAutoAccept(action, this.config);
    
    // Handle critical/dangerous actions
    if (action.riskLevel === 'critical' || action.type === 'dangerous_command') {
      this.logger.warn(`CRITICAL: ${action.reason || action.type}`, action);
      await this.slack.requestApproval(action, action);
      this.sessionStats.actionsDenied++;
      
      // In a real implementation, would pause and wait for approval
      return 'deny';
    }
    
    // Auto-accept based on recommendation
    if (recommendation.accept === true) {
      this.logger.info(`Auto-accepted: ${action.type}`, { 
        target: action.target,
        risk: action.riskScore 
      });
      this.sessionStats.actionsApproved++;
      
      if (action.type.startsWith('file_')) {
        this.sessionStats.filesChanged++;
      }
      
      return 'accept';
    }
    
    // Quick confirm (copilot mode)
    if (recommendation.accept === 'quick_confirm') {
      this.logger.info(`Quick confirm: ${action.type}`, action.target);
      // Would show brief notification then auto-accept after timeout
      this.sessionStats.actionsApproved++;
      return 'accept';
    }
    
    // Requires approval
    if (recommendation.accept === false) {
      this.logger.warn(`Requires approval: ${action.type}`, {
        reason: recommendation.reason,
        target: action.target
      });
      
      // Send Slack notification for approval
      if (this.config.mode === 'autopilot') {
        await this.slack.requestApproval(action, {
          target: action.target,
          risk: action.riskScore,
          reason: recommendation.reason
        });
      }
      
      // System notification
      this.notify(`Action requires approval: ${action.type}`, 'warn');
      
      return 'pause';
    }
    
    return 'accept';
  }

  /**
   * Start interactive copilot mode
   */
  async startInteractive(projectPath) {
    // Start dashboard
    await this.dashboard.start();
    this.dashboard.updateMode('copilot');
    
    console.log(chalk.green('\n👥 Copilot mode active\n'));
    console.log(chalk.gray(`📊 Dashboard: http://localhost:${this.config.dashboard?.port || 3847}`));
    if (this.config.workingDirectory) {
      console.log(chalk.gray(`📁 Working directory: ${this.config.workingDirectory}`));
    }
    console.log(chalk.gray('\nCommands:'));
    console.log(chalk.gray('  /task <description>  - Run a task'));
    console.log(chalk.gray('  /status              - Show status'));
    console.log(chalk.gray('  /pause               - Pause auto-accept'));
    console.log(chalk.gray('  /resume              - Resume auto-accept'));
    console.log(chalk.gray('  /insights            - Show session insights'));
    console.log(chalk.gray('  /quit                - Exit copilot\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on('line', async (input) => {
      const trimmed = input.trim();
      
      if (trimmed.startsWith('/')) {
        const [cmd, ...args] = trimmed.slice(1).split(' ');
        
        switch (cmd) {
          case 'task':
            if (args.length === 0) {
              console.log(chalk.yellow('Usage: /task <description>'));
            } else {
              console.log(chalk.cyan('\n--- Running Task ---\n'));
              try {
                await this.runSingle(args.join(' '));
                console.log(chalk.green('--- Task Complete ---\n'));
              } catch (error) {
                console.log(chalk.red(`--- Task Failed: ${error.message} ---\n`));
              }
            }
            break;
          case 'status':
            this.printStatus();
            break;
          case 'pause':
            this.isPaused = true;
            this.dashboard.updateMode('paused');
            console.log(chalk.yellow('⏸ Auto-accept paused'));
            break;
          case 'resume':
            this.isPaused = false;
            this.dashboard.updateMode('copilot');
            console.log(chalk.green('▶ Auto-accept resumed'));
            break;
          case 'insights':
            this.printInsights();
            break;
          case 'quit':
            await this.shutdown();
            process.exit(0);
          default:
            console.log(chalk.red(`Unknown command: ${cmd}`));
            console.log(chalk.gray('Available: /task, /status, /pause, /resume, /insights, /quit'));
        }
      } else if (trimmed) {
        // Treat bare input as a task
        console.log(chalk.cyan('\n--- Running Task ---\n'));
        try {
          await this.runSingle(trimmed);
          console.log(chalk.green('--- Task Complete ---\n'));
        } catch (error) {
          console.log(chalk.red(`--- Task Failed: ${error.message} ---\n`));
        }
      }
      
      rl.prompt();
    });

    rl.setPrompt(chalk.cyan('copilot> '));
    rl.prompt();
  }

  /**
   * Wait for session to be resumed
   */
  async waitForResume() {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (!this.isPaused) {
          clearInterval(check);
          resolve();
        }
      }, 500);
    });
  }

  /**
   * Build the full prompt with context injection
   */
  buildPrompt(prompt, taskContext = '') {
    const parts = [];
    
    if (this.config.context?.project_standards) {
      parts.push(`[Project Standards]\n${this.config.context.project_standards}`);
    }
    
    if (this.config.context?.current_focus) {
      parts.push(`[Current Focus]\n${this.config.context.current_focus}`);
    }
    
    if (taskContext) {
      parts.push(`[Task Context]\n${taskContext}`);
    }
    
    if (this.config.context?.error_handling) {
      parts.push(`[Error Handling]\n${this.config.context.error_handling}`);
    }
    
    parts.push(`[Task]\n${prompt}`);
    
    return parts.join('\n\n');
  }

  /**
   * Send a system notification
   */
  notify(message, type = 'info') {
    notifier.notify({
      title: 'Edge Autopilot',
      message,
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
    console.log(`Paused: ${this.isPaused ? chalk.red('Yes') : chalk.green('No')}`);
    console.log(`Uptime: ${uptime} minutes`);
    console.log(`Tasks completed: ${this.sessionStats.tasksCompleted}`);
    console.log(`Tasks failed: ${this.sessionStats.tasksFailed}`);
    console.log(`Actions approved: ${this.sessionStats.actionsApproved}`);
    console.log(`Actions denied: ${this.sessionStats.actionsDenied}`);
    console.log(`Files changed: ${this.sessionStats.filesChanged}`);
    console.log(`Errors: ${this.sessionStats.errors}`);
    console.log('');
  }

  /**
   * Print session insights
   */
  printInsights() {
    const insights = this.detector.getInsights();
    
    console.log(chalk.cyan('\n═══ Session Insights ═══'));
    console.log(`Total actions: ${insights.totalActions}`);
    console.log(`Average risk: ${(insights.averageRisk * 100).toFixed(1)}%`);
    console.log('\nBy risk level:');
    for (const [level, count] of Object.entries(insights.byRisk)) {
      if (count > 0) {
        console.log(`  ${level}: ${count}`);
      }
    }
    console.log('\nMost edited files:');
    for (const [file, stats] of insights.mostEdited.slice(0, 5)) {
      console.log(`  ${file}: ${stats.edits} edits`);
    }
    console.log('');
  }

  /**
   * Print session summary
   */
  printSummary() {
    const duration = Math.round((Date.now() - this.sessionStats.started) / 1000 / 60);
    const insights = this.detector.getInsights();
    
    console.log(chalk.cyan('\n╔═══════════════════════════════════════════╗'));
    console.log(chalk.cyan('║           SESSION SUMMARY                 ║'));
    console.log(chalk.cyan('╚═══════════════════════════════════════════╝\n'));
    
    console.log(`Duration: ${duration} minutes`);
    console.log(`Tasks completed: ${chalk.green(this.sessionStats.tasksCompleted)}`);
    console.log(`Tasks failed: ${chalk.red(this.sessionStats.tasksFailed)}`);
    console.log(`Actions approved: ${chalk.green(this.sessionStats.actionsApproved)}`);
    console.log(`Actions denied: ${chalk.yellow(this.sessionStats.actionsDenied)}`);
    console.log(`Files changed: ${this.sessionStats.filesChanged}`);
    console.log(`Errors: ${chalk.red(this.sessionStats.errors)}`);
    console.log(`Average risk: ${(insights.averageRisk * 100).toFixed(1)}%`);
    console.log(`\nLogs: ${this.config.logging?.directory || './logs/'}`);
    console.log(`Dashboard: http://localhost:${this.config.dashboard?.port || 3847}\n`);
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.logger.info('Shutting down...');
    
    if (this.activeProcess) {
      this.activeProcess.kill();
    }
    
    await this.logger.generateSummary();
    await this.dashboard.stop();
    
    this.printSummary();
  }
}
