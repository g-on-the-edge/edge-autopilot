import https from 'https';

/**
 * SlackNotifier - Rich notifications for Autopilot events
 * 
 * Supports:
 * - Webhook notifications (no auth needed)
 * - Rich message formatting with blocks
 * - Thread replies for task updates
 * - Interactive buttons for approvals
 */
export class SlackNotifier {
  constructor(config = {}) {
    this.webhookUrl = config.webhook_url || process.env.SLACK_WEBHOOK_URL;
    this.channel = config.channel || '#autopilot';
    this.botName = config.bot_name || 'Edge Autopilot';
    this.botEmoji = config.bot_emoji || ':robot_face:';
    this.enabled = !!this.webhookUrl;
    
    // Track thread timestamps for replies
    this.sessionThread = null;
    this.taskThreads = new Map();
  }

  /**
   * Send session start notification
   */
  async sessionStart(mode, taskCount) {
    if (!this.enabled) return;

    const message = {
      text: `🚀 Autopilot session started`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚀 Autopilot Session Started`,
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Mode:*\n${mode === 'autopilot' ? '🤖 Autopilot' : '👥 Copilot'}`
            },
            {
              type: 'mrkdwn',
              text: `*Tasks:*\n${taskCount} queued`
            },
            {
              type: 'mrkdwn',
              text: `*Started:*\n<!date^${Math.floor(Date.now()/1000)}^{time}|${new Date().toLocaleTimeString()}>`
            },
            {
              type: 'mrkdwn',
              text: `*Machine:*\n${process.env.HOSTNAME || 'local'}`
            }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Session ID: \`${this.generateSessionId()}\``
            }
          ]
        }
      ]
    };

    const response = await this.send(message);
    this.sessionThread = response?.ts;
    return response;
  }

  /**
   * Send task start notification
   */
  async taskStart(task) {
    if (!this.enabled) return;

    const message = {
      text: `📋 Starting task: ${task.description}`,
      thread_ts: this.sessionThread,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 *Starting Task:* ${task.description}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Priority: ${this.priorityEmoji(task.priority)} ${task.priority} | ID: \`${task.id}\``
            }
          ]
        }
      ]
    };

    const response = await this.send(message);
    this.taskThreads.set(task.id, response?.ts);
    return response;
  }

  /**
   * Send task completion notification
   */
  async taskComplete(task, stats) {
    if (!this.enabled) return;

    const duration = stats.duration ? `${Math.round(stats.duration / 1000)}s` : 'unknown';

    const message = {
      text: `✅ Task completed: ${task.description}`,
      thread_ts: this.sessionThread,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Task Completed:* ${task.description}`
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Duration:*\n${duration}`
            },
            {
              type: 'mrkdwn',
              text: `*Actions:*\n${stats.actionsApproved || 0} approved`
            },
            {
              type: 'mrkdwn',
              text: `*Files Changed:*\n${stats.filesChanged || 0}`
            },
            {
              type: 'mrkdwn',
              text: `*Errors:*\n${stats.errors || 0}`
            }
          ]
        }
      ]
    };

    return this.send(message);
  }

  /**
   * Send task failure notification
   */
  async taskFailed(task, error) {
    if (!this.enabled) return;

    const message = {
      text: `❌ Task failed: ${task.description}`,
      thread_ts: this.sessionThread,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ *Task Failed:* ${task.description}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `\`\`\`${error.message || error}\`\`\``
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🔄 Retry',
                emoji: true
              },
              value: task.id,
              action_id: 'retry_task'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '⏭️ Skip',
                emoji: true
              },
              value: task.id,
              action_id: 'skip_task'
            }
          ]
        }
      ]
    };

    return this.send(message);
  }

  /**
   * Send approval request notification
   */
  async requestApproval(action, details) {
    if (!this.enabled) return;

    const message = {
      text: `⚠️ Approval needed: ${action.type}`,
      thread_ts: this.sessionThread,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ Approval Required',
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Action:* ${action.type}\n*Details:* ${JSON.stringify(details, null, 2)}`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '✅ Approve',
                emoji: true
              },
              style: 'primary',
              value: JSON.stringify({ action: action.type, approve: true }),
              action_id: 'approve_action'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '❌ Deny',
                emoji: true
              },
              style: 'danger',
              value: JSON.stringify({ action: action.type, approve: false }),
              action_id: 'deny_action'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '⏸️ Pause Session',
                emoji: true
              },
              value: 'pause',
              action_id: 'pause_session'
            }
          ]
        }
      ]
    };

    return this.send(message);
  }

  /**
   * Send session complete summary
   */
  async sessionComplete(stats) {
    if (!this.enabled) return;

    const duration = Math.round((Date.now() - stats.started) / 1000 / 60);
    const successRate = stats.tasksCompleted > 0 
      ? Math.round((stats.tasksCompleted / (stats.tasksCompleted + stats.tasksFailed)) * 100)
      : 0;

    const statusEmoji = stats.errors > 0 ? '⚠️' : '✅';
    const statusText = stats.errors > 0 ? 'Completed with errors' : 'Completed successfully';

    const message = {
      text: `${statusEmoji} Autopilot session complete`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${statusEmoji} Session Complete`,
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${statusText}*`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Duration:*\n${duration} minutes`
            },
            {
              type: 'mrkdwn',
              text: `*Success Rate:*\n${successRate}%`
            },
            {
              type: 'mrkdwn',
              text: `*Tasks Completed:*\n${stats.tasksCompleted}`
            },
            {
              type: 'mrkdwn',
              text: `*Tasks Failed:*\n${stats.tasksFailed || 0}`
            },
            {
              type: 'mrkdwn',
              text: `*Actions Approved:*\n${stats.actionsApproved}`
            },
            {
              type: 'mrkdwn',
              text: `*Errors:*\n${stats.errors}`
            }
          ]
        },
        {
          type: 'divider'
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `📊 View full logs at \`./logs/\` | Dashboard: \`http://localhost:3847\``
            }
          ]
        }
      ]
    };

    return this.send(message);
  }

  /**
   * Send progress update (for long-running tasks)
   */
  async progressUpdate(message, percentage) {
    if (!this.enabled) return;

    const progressBar = this.createProgressBar(percentage);

    const slackMessage = {
      text: message,
      thread_ts: this.sessionThread,
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `${progressBar} ${percentage}% | ${message}`
            }
          ]
        }
      ]
    };

    return this.send(slackMessage);
  }

  /**
   * Send a raw message
   */
  async send(message) {
    if (!this.enabled) {
      console.log('[Slack] Notifications disabled, would send:', message.text);
      return null;
    }

    const payload = {
      channel: this.channel,
      username: this.botName,
      icon_emoji: this.botEmoji,
      ...message
    };

    return new Promise((resolve, reject) => {
      const url = new URL(this.webhookUrl);
      
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ ok: true, ts: Date.now().toString() });
          } else {
            console.error('[Slack] Error:', data);
            resolve(null);
          }
        });
      });

      req.on('error', (error) => {
        console.error('[Slack] Request error:', error);
        resolve(null);
      });

      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  // Helper methods

  generateSessionId() {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  priorityEmoji(priority) {
    const emojis = { high: '🔴', normal: '🟡', low: '🟢' };
    return emojis[priority] || '⚪';
  }

  createProgressBar(percentage) {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}

/**
 * Create a configured notifier from config
 */
export function createSlackNotifier(config) {
  const slackConfig = config?.notifications?.slack || {};
  return new SlackNotifier(slackConfig);
}
