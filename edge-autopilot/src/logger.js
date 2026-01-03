import { writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

/**
 * Logger - Handles all logging for the supervisor
 */
export class Logger {
  constructor(config = {}) {
    this.config = {
      directory: config.directory || './logs/',
      level: config.level || 'info',
      include_prompts: config.include_prompts ?? true,
      include_responses: config.include_responses ?? true
    };
    
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
    this.currentLevel = this.levels[this.config.level] || 1;
    
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = join(this.config.directory, `session-${this.sessionId}.log`);
    this.jsonLog = join(this.config.directory, `session-${this.sessionId}.json`);
    
    this.entries = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    if (!existsSync(this.config.directory)) {
      await mkdir(this.config.directory, { recursive: true });
    }
    
    // Write session header
    await writeFile(this.logFile, `
════════════════════════════════════════════════════════════
  EDGE AUTOPILOT SESSION LOG
  Started: ${new Date().toISOString()}
  Session: ${this.sessionId}
════════════════════════════════════════════════════════════

`);
    
    this.initialized = true;
  }

  async log(level, message, data = null) {
    if (this.levels[level] < this.currentLevel) return;
    
    await this.init();
    
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level,
      message,
      data
    };
    
    this.entries.push(entry);
    
    // Console output with colors
    const colors = {
      debug: chalk.gray,
      info: chalk.white,
      warn: chalk.yellow,
      error: chalk.red
    };
    
    const prefix = {
      debug: '🔍',
      info: '📝',
      warn: '⚠️',
      error: '❌'
    };
    
    const colorFn = colors[level] || chalk.white;
    console.log(colorFn(`${prefix[level]} [${timestamp.slice(11, 19)}] ${message}`));
    
    if (data && level !== 'debug') {
      console.log(chalk.gray(`   ${JSON.stringify(data).slice(0, 200)}`));
    }
    
    // File output
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}\n`;
    await appendFile(this.logFile, logLine);
  }

  debug(message, data) { return this.log('debug', message, data); }
  info(message, data) { return this.log('info', message, data); }
  warn(message, data) { return this.log('warn', message, data); }
  error(message, data) { return this.log('error', message, data); }

  /**
   * Save the complete JSON log for analysis
   */
  async saveJsonLog() {
    await writeFile(this.jsonLog, JSON.stringify(this.entries, null, 2));
  }

  /**
   * Generate a summary of the session
   */
  async generateSummary() {
    const summary = {
      sessionId: this.sessionId,
      startTime: this.entries[0]?.timestamp,
      endTime: this.entries[this.entries.length - 1]?.timestamp,
      totalEntries: this.entries.length,
      byLevel: {
        debug: this.entries.filter(e => e.level === 'debug').length,
        info: this.entries.filter(e => e.level === 'info').length,
        warn: this.entries.filter(e => e.level === 'warn').length,
        error: this.entries.filter(e => e.level === 'error').length
      }
    };
    
    const summaryFile = join(this.config.directory, `summary-${this.sessionId}.json`);
    await writeFile(summaryFile, JSON.stringify(summary, null, 2));
    
    return summary;
  }
}
