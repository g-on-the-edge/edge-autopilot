// Edge Autopilot - Main Entry Point
// Run with: node src/index.js or npm start

export { Supervisor } from './supervisor-v2.js';
export { TaskQueue } from './tasks.js';
export { Logger } from './logger.js';
export { SmartDetector } from './smart-detector.js';
export { SlackNotifier } from './slack.js';
export { EmailNotifier } from './email.js';
export { Dashboard } from './dashboard.js';
export { GitHubIntegration, GitHubWebhookHandler } from './github.js';
export { loadConfig } from './config.js';

// Quick start - run the CLI
import('./cli.js');
