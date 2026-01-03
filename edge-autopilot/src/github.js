import https from 'https';

/**
 * GitHubIntegration - Trigger and manage GitHub Actions workflows
 * 
 * Features:
 * - Trigger workflow runs
 * - Create/update issues for failures
 * - Post PR comments
 * - Update commit status checks
 * - Webhook receiver for CI/CD events
 */
export class GitHubIntegration {
  constructor(config = {}) {
    this.token = config.token || process.env.GITHUB_TOKEN;
    this.owner = config.owner || process.env.GITHUB_OWNER;
    this.repo = config.repo || process.env.GITHUB_REPO;
    this.enabled = !!(this.token && this.owner && this.repo);
    
    this.baseUrl = 'api.github.com';
    this.headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Edge-Autopilot',
      'Authorization': `Bearer ${this.token}`
    };
  }

  /**
   * Trigger a GitHub Actions workflow
   */
  async triggerWorkflow(workflowId, ref = 'main', inputs = {}) {
    if (!this.enabled) {
      console.log('[GitHub] Integration disabled, would trigger:', workflowId);
      return null;
    }

    const path = `/repos/${this.owner}/${this.repo}/actions/workflows/${workflowId}/dispatches`;
    
    const body = {
      ref,
      inputs
    };

    try {
      const result = await this.request('POST', path, body);
      console.log(`[GitHub] Triggered workflow: ${workflowId}`);
      return result;
    } catch (error) {
      console.error('[GitHub] Failed to trigger workflow:', error.message);
      return null;
    }
  }

  /**
   * Create an issue for a failed task
   */
  async createIssue(title, body, labels = ['autopilot', 'automated']) {
    if (!this.enabled) return null;

    const path = `/repos/${this.owner}/${this.repo}/issues`;
    
    try {
      const result = await this.request('POST', path, {
        title,
        body,
        labels
      });
      console.log(`[GitHub] Created issue: ${result.number}`);
      return result;
    } catch (error) {
      console.error('[GitHub] Failed to create issue:', error.message);
      return null;
    }
  }

  /**
   * Create a task failure issue
   */
  async createTaskFailureIssue(task, error, logs) {
    const title = `[Autopilot] Task Failed: ${task.description?.slice(0, 50)}`;
    
    const body = `## Autopilot Task Failure Report

**Task ID:** \`${task.id}\`
**Priority:** ${task.priority || 'normal'}
**Timestamp:** ${new Date().toISOString()}

### Task Description
${task.description || task.prompt}

### Error
\`\`\`
${error.message || error}
\`\`\`

### Context
${task.context || 'No additional context provided'}

### Recent Logs
\`\`\`
${(logs || []).slice(-20).join('\n')}
\`\`\`

---
*This issue was automatically created by Edge Autopilot*`;

    return this.createIssue(title, body, ['autopilot', 'bug', 'automated']);
  }

  /**
   * Update commit status (for CI integration)
   */
  async updateCommitStatus(sha, state, description, context = 'autopilot') {
    if (!this.enabled) return null;

    const path = `/repos/${this.owner}/${this.repo}/statuses/${sha}`;
    
    try {
      const result = await this.request('POST', path, {
        state, // pending, success, error, failure
        description,
        context
      });
      console.log(`[GitHub] Updated status for ${sha.slice(0, 7)}: ${state}`);
      return result;
    } catch (error) {
      console.error('[GitHub] Failed to update status:', error.message);
      return null;
    }
  }

  /**
   * Post a comment on a PR
   */
  async commentOnPR(prNumber, body) {
    if (!this.enabled) return null;

    const path = `/repos/${this.owner}/${this.repo}/issues/${prNumber}/comments`;
    
    try {
      const result = await this.request('POST', path, { body });
      console.log(`[GitHub] Commented on PR #${prNumber}`);
      return result;
    } catch (error) {
      console.error('[GitHub] Failed to comment on PR:', error.message);
      return null;
    }
  }

  /**
   * Post autopilot summary as PR comment
   */
  async postPRSummary(prNumber, stats, insights) {
    const successRate = stats.tasksCompleted > 0 
      ? Math.round((stats.tasksCompleted / (stats.tasksCompleted + (stats.tasksFailed || 0))) * 100)
      : 0;

    const statusEmoji = stats.errors > 0 ? '⚠️' : '✅';
    
    const body = `## ${statusEmoji} Autopilot Session Report

| Metric | Value |
|--------|-------|
| Tasks Completed | ${stats.tasksCompleted} |
| Tasks Failed | ${stats.tasksFailed || 0} |
| Actions Approved | ${stats.actionsApproved || 0} |
| Files Changed | ${stats.filesChanged || 0} |
| Errors | ${stats.errors || 0} |
| Success Rate | ${successRate}% |

${insights ? `
### Insights
- **Total Actions:** ${insights.totalActions}
- **Average Risk:** ${(insights.averageRisk * 100).toFixed(1)}%
${insights.mostEdited?.[0] ? `- **Most Edited:** \`${insights.mostEdited[0][0]}\`` : ''}
` : ''}

---
*Automated by Edge Autopilot*`;

    return this.commentOnPR(prNumber, body);
  }

  /**
   * Get workflow runs
   */
  async getWorkflowRuns(workflowId, status = null) {
    if (!this.enabled) return [];

    let path = `/repos/${this.owner}/${this.repo}/actions/workflows/${workflowId}/runs`;
    if (status) path += `?status=${status}`;
    
    try {
      const result = await this.request('GET', path);
      return result.workflow_runs || [];
    } catch (error) {
      console.error('[GitHub] Failed to get workflow runs:', error.message);
      return [];
    }
  }

  /**
   * Download workflow artifact
   */
  async downloadArtifact(artifactId) {
    if (!this.enabled) return null;

    const path = `/repos/${this.owner}/${this.repo}/actions/artifacts/${artifactId}/zip`;
    
    try {
      const result = await this.request('GET', path, null, true);
      return result;
    } catch (error) {
      console.error('[GitHub] Failed to download artifact:', error.message);
      return null;
    }
  }

  /**
   * Make an API request
   */
  async request(method, path, body = null, binary = false) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        path,
        method,
        headers: { ...this.headers }
      };

      if (body) {
        options.headers['Content-Type'] = 'application/json';
      }

      const req = https.request(options, (res) => {
        let data = binary ? [] : '';
        
        res.on('data', (chunk) => {
          if (binary) data.push(chunk);
          else data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (binary) resolve(Buffer.concat(data));
            else if (data) resolve(JSON.parse(data));
            else resolve({ ok: true });
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
          }
        });
      });

      req.on('error', reject);
      
      if (body) {
        req.write(JSON.stringify(body));
      }
      
      req.end();
    });
  }
}

/**
 * GitHub webhook handler for CI/CD events
 */
export class GitHubWebhookHandler {
  constructor(supervisor, config = {}) {
    this.supervisor = supervisor;
    this.secret = config.webhook_secret || process.env.GITHUB_WEBHOOK_SECRET;
    this.handlers = new Map();
    
    this.setupDefaultHandlers();
  }

  setupDefaultHandlers() {
    // Handle workflow run completion
    this.on('workflow_run', async (payload) => {
      if (payload.action === 'completed') {
        const run = payload.workflow_run;
        console.log(`[Webhook] Workflow ${run.name} completed: ${run.conclusion}`);
        
        if (run.conclusion === 'failure') {
          // Could trigger autopilot to fix issues
          this.supervisor?.emit('workflow_failed', run);
        }
      }
    });

    // Handle PR events
    this.on('pull_request', async (payload) => {
      if (payload.action === 'opened' || payload.action === 'synchronize') {
        console.log(`[Webhook] PR ${payload.pull_request.number}: ${payload.action}`);
        this.supervisor?.emit('pr_updated', payload.pull_request);
      }
    });

    // Handle issue comments (for commands)
    this.on('issue_comment', async (payload) => {
      if (payload.action === 'created') {
        const comment = payload.comment.body;
        
        // Look for autopilot commands
        if (comment.startsWith('/autopilot ')) {
          const command = comment.slice('/autopilot '.length).trim();
          console.log(`[Webhook] Autopilot command: ${command}`);
          this.supervisor?.emit('github_command', {
            command,
            issue: payload.issue,
            user: payload.comment.user
          });
        }
      }
    });
  }

  /**
   * Register an event handler
   */
  on(event, handler) {
    this.handlers.set(event, handler);
  }

  /**
   * Handle an incoming webhook
   */
  async handleWebhook(event, payload, signature) {
    // Verify signature if secret is configured
    if (this.secret && signature) {
      const crypto = await import('crypto');
      const expected = 'sha256=' + crypto
        .createHmac('sha256', this.secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      if (signature !== expected) {
        throw new Error('Invalid webhook signature');
      }
    }

    const handler = this.handlers.get(event);
    if (handler) {
      await handler(payload);
    }
  }

  /**
   * Create an Express-compatible middleware
   */
  middleware() {
    return async (req, res) => {
      try {
        const event = req.headers['x-github-event'];
        const signature = req.headers['x-hub-signature-256'];
        
        await this.handleWebhook(event, req.body, signature);
        res.status(200).json({ ok: true });
      } catch (error) {
        console.error('[Webhook] Error:', error.message);
        res.status(400).json({ error: error.message });
      }
    };
  }
}

/**
 * Create GitHub integration from config
 */
export function createGitHubIntegration(config) {
  const githubConfig = config?.integrations?.github || {};
  return new GitHubIntegration(githubConfig);
}
