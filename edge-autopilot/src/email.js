import nodemailer from 'nodemailer';

/**
 * EmailNotifier - Email notifications and daily digest reports
 * 
 * Features:
 * - SMTP email sending
 * - HTML email templates
 * - Daily digest reports
 * - Critical alert emails
 * - Session summary emails
 */
export class EmailNotifier {
  constructor(config = {}) {
    this.enabled = config.enabled ?? !!config.smtp?.host;
    this.config = {
      smtp: {
        host: config.smtp?.host || process.env.SMTP_HOST,
        port: config.smtp?.port || process.env.SMTP_PORT || 587,
        secure: config.smtp?.secure ?? false,
        auth: {
          user: config.smtp?.user || process.env.SMTP_USER,
          pass: config.smtp?.pass || process.env.SMTP_PASS
        }
      },
      from: config.from || process.env.EMAIL_FROM || 'Edge Autopilot <autopilot@localhost>',
      to: config.to || process.env.EMAIL_TO,
      replyTo: config.replyTo || config.to
    };
    
    this.transporter = null;
    this.sessionStats = [];
  }

  /**
   * Initialize the email transporter
   */
  async init() {
    if (!this.enabled || this.transporter) return;
    
    try {
      this.transporter = nodemailer.createTransport(this.config.smtp);
      await this.transporter.verify();
      console.log('📧 Email notifications enabled');
    } catch (error) {
      console.warn('📧 Email setup failed:', error.message);
      this.enabled = false;
    }
  }

  /**
   * Send a session summary email
   */
  async sendSessionSummary(stats, insights) {
    if (!this.enabled) return;
    await this.init();

    const duration = Math.round((Date.now() - new Date(stats.started)) / 1000 / 60);
    const successRate = stats.tasksCompleted > 0 
      ? Math.round((stats.tasksCompleted / (stats.tasksCompleted + (stats.tasksFailed || 0))) * 100)
      : 0;

    const statusEmoji = stats.errors > 0 ? '⚠️' : '✅';
    const subject = `${statusEmoji} Autopilot Session Complete - ${stats.tasksCompleted} tasks`;

    const html = this.renderTemplate('session-summary', {
      statusEmoji,
      duration,
      successRate,
      stats,
      insights,
      timestamp: new Date().toISOString()
    });

    return this.send(subject, html);
  }

  /**
   * Send a critical alert email
   */
  async sendCriticalAlert(action, details) {
    if (!this.enabled) return;
    await this.init();

    const subject = `🚨 CRITICAL: Autopilot requires attention`;

    const html = this.renderTemplate('critical-alert', {
      action,
      details,
      timestamp: new Date().toISOString()
    });

    return this.send(subject, html, { priority: 'high' });
  }

  /**
   * Send an approval request email
   */
  async sendApprovalRequest(action, details, approvalUrl) {
    if (!this.enabled) return;
    await this.init();

    const subject = `⚠️ Autopilot: Approval needed for ${action.type}`;

    const html = this.renderTemplate('approval-request', {
      action,
      details,
      approvalUrl,
      timestamp: new Date().toISOString()
    });

    return this.send(subject, html);
  }

  /**
   * Send a daily digest email
   */
  async sendDailyDigest(sessions) {
    if (!this.enabled) return;
    await this.init();

    const totalTasks = sessions.reduce((sum, s) => sum + (s.tasksCompleted || 0), 0);
    const totalErrors = sessions.reduce((sum, s) => sum + (s.errors || 0), 0);
    
    const subject = `📊 Autopilot Daily Digest - ${totalTasks} tasks, ${sessions.length} sessions`;

    const html = this.renderTemplate('daily-digest', {
      sessions,
      totalTasks,
      totalErrors,
      date: new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    });

    return this.send(subject, html);
  }

  /**
   * Send an email
   */
  async send(subject, html, options = {}) {
    if (!this.enabled || !this.transporter) return null;

    try {
      const result = await this.transporter.sendMail({
        from: this.config.from,
        to: this.config.to,
        replyTo: this.config.replyTo,
        subject,
        html,
        ...options
      });
      
      console.log(`📧 Email sent: ${subject}`);
      return result;
    } catch (error) {
      console.error('📧 Email send failed:', error.message);
      return null;
    }
  }

  /**
   * Render an email template
   */
  renderTemplate(template, data) {
    const templates = {
      'session-summary': (d) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autopilot Session Summary</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f1f5f9; padding: 20px; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; overflow: hidden;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #3b82f6 0%, #a855f7 100%); padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; color: white;">${d.statusEmoji} Session Complete</h1>
    </div>
    
    <!-- Stats Grid -->
    <div style="padding: 24px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 12px; text-align: center; background: #334155; border-radius: 8px 0 0 0;">
            <div style="font-size: 28px; font-weight: bold; color: #22c55e;">${d.stats.tasksCompleted}</div>
            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Tasks Done</div>
          </td>
          <td style="padding: 12px; text-align: center; background: #334155;">
            <div style="font-size: 28px; font-weight: bold; color: #3b82f6;">${d.stats.actionsApproved || 0}</div>
            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Actions</div>
          </td>
          <td style="padding: 12px; text-align: center; background: #334155;">
            <div style="font-size: 28px; font-weight: bold; color: #eab308;">${d.duration}m</div>
            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Duration</div>
          </td>
          <td style="padding: 12px; text-align: center; background: #334155; border-radius: 0 8px 0 0;">
            <div style="font-size: 28px; font-weight: bold; color: ${d.stats.errors > 0 ? '#ef4444' : '#22c55e'};">${d.stats.errors || 0}</div>
            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Errors</div>
          </td>
        </tr>
      </table>
      
      <!-- Success Rate Bar -->
      <div style="margin-top: 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="font-size: 12px; color: #94a3b8;">Success Rate</span>
          <span style="font-size: 12px; color: #94a3b8;">${d.successRate}%</span>
        </div>
        <div style="background: #334155; border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background: ${d.successRate >= 80 ? '#22c55e' : d.successRate >= 50 ? '#eab308' : '#ef4444'}; height: 100%; width: ${d.successRate}%;"></div>
        </div>
      </div>

      ${d.insights ? `
      <!-- Insights -->
      <div style="margin-top: 24px; padding: 16px; background: #334155; border-radius: 8px;">
        <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #94a3b8;">Session Insights</h3>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Total Actions:</strong> ${d.insights.totalActions}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Average Risk:</strong> ${(d.insights.averageRisk * 100).toFixed(1)}%</p>
        ${d.insights.mostEdited?.[0] ? `<p style="margin: 4px 0; font-size: 13px;"><strong>Most Edited:</strong> ${d.insights.mostEdited[0][0]}</p>` : ''}
      </div>
      ` : ''}
    </div>
    
    <!-- Footer -->
    <div style="padding: 16px 24px; background: #0f172a; text-align: center;">
      <p style="margin: 0; font-size: 11px; color: #64748b;">
        Edge Autopilot • ${d.timestamp}
      </p>
    </div>
  </div>
</body>
</html>`,

      'critical-alert': (d) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f1f5f9; padding: 20px; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; overflow: hidden; border: 2px solid #ef4444;">
    <div style="background: #ef4444; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; color: white;">🚨 Critical Alert</h1>
    </div>
    
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px 0; font-size: 16px;">A critical action requires your immediate attention:</p>
      
      <div style="background: #334155; padding: 16px; border-radius: 8px; border-left: 4px solid #ef4444;">
        <p style="margin: 0 0 8px 0;"><strong>Action:</strong> ${d.action.type}</p>
        <p style="margin: 0 0 8px 0;"><strong>Target:</strong> ${d.action.target || 'N/A'}</p>
        <p style="margin: 0 0 8px 0;"><strong>Risk Level:</strong> <span style="color: #ef4444;">${d.action.riskLevel}</span></p>
        ${d.action.reason ? `<p style="margin: 0;"><strong>Reason:</strong> ${d.action.reason}</p>` : ''}
      </div>
      
      <div style="margin-top: 24px; text-align: center;">
        <p style="color: #94a3b8; font-size: 13px;">Session has been paused pending your review.</p>
      </div>
    </div>
    
    <div style="padding: 16px 24px; background: #0f172a; text-align: center;">
      <p style="margin: 0; font-size: 11px; color: #64748b;">${d.timestamp}</p>
    </div>
  </div>
</body>
</html>`,

      'approval-request': (d) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f1f5f9; padding: 20px; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; overflow: hidden;">
    <div style="background: #eab308; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; color: #000;">⚠️ Approval Required</h1>
    </div>
    
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px 0; font-size: 16px;">An action requires your approval to proceed:</p>
      
      <div style="background: #334155; padding: 16px; border-radius: 8px;">
        <p style="margin: 0 0 8px 0;"><strong>Action:</strong> ${d.action.type}</p>
        <p style="margin: 0 0 8px 0;"><strong>Target:</strong> ${d.details.target || 'N/A'}</p>
        <p style="margin: 0;"><strong>Risk Score:</strong> ${((d.details.risk || 0) * 100).toFixed(0)}%</p>
      </div>
      
      ${d.approvalUrl ? `
      <div style="margin-top: 24px; text-align: center;">
        <a href="${d.approvalUrl}" style="display: inline-block; padding: 12px 32px; background: #22c55e; color: #000; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 8px;">✓ Approve</a>
        <a href="${d.approvalUrl}?deny=1" style="display: inline-block; padding: 12px 32px; background: #ef4444; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">✗ Deny</a>
      </div>
      ` : ''}
    </div>
    
    <div style="padding: 16px 24px; background: #0f172a; text-align: center;">
      <p style="margin: 0; font-size: 11px; color: #64748b;">${d.timestamp}</p>
    </div>
  </div>
</body>
</html>`,

      'daily-digest': (d) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f1f5f9; padding: 20px; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #3b82f6 0%, #a855f7 100%); padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; color: white;">📊 Daily Digest</h1>
      <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">${d.date}</p>
    </div>
    
    <div style="padding: 24px;">
      <!-- Summary Stats -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 16px; text-align: center; background: #334155; border-radius: 8px 0 0 8px;">
            <div style="font-size: 32px; font-weight: bold; color: #22c55e;">${d.totalTasks}</div>
            <div style="font-size: 11px; color: #94a3b8;">TOTAL TASKS</div>
          </td>
          <td style="padding: 16px; text-align: center; background: #334155;">
            <div style="font-size: 32px; font-weight: bold; color: #3b82f6;">${d.sessions.length}</div>
            <div style="font-size: 11px; color: #94a3b8;">SESSIONS</div>
          </td>
          <td style="padding: 16px; text-align: center; background: #334155; border-radius: 0 8px 8px 0;">
            <div style="font-size: 32px; font-weight: bold; color: ${d.totalErrors > 0 ? '#ef4444' : '#22c55e'};">${d.totalErrors}</div>
            <div style="font-size: 11px; color: #94a3b8;">ERRORS</div>
          </td>
        </tr>
      </table>
      
      <!-- Sessions List -->
      <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #94a3b8;">Sessions</h3>
      ${d.sessions.map((s, i) => `
        <div style="background: #334155; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 13px;">Session ${i + 1}</span>
            <span style="font-size: 12px; color: #94a3b8;">${s.tasksCompleted || 0} tasks</span>
          </div>
        </div>
      `).join('')}
    </div>
    
    <div style="padding: 16px 24px; background: #0f172a; text-align: center;">
      <p style="margin: 0; font-size: 11px; color: #64748b;">Edge Autopilot Daily Digest</p>
    </div>
  </div>
</body>
</html>`
    };

    return templates[template]?.(data) || '';
  }
}

/**
 * Create email notifier from config
 */
export function createEmailNotifier(config) {
  const emailConfig = config?.notifications?.email || {};
  return new EmailNotifier(emailConfig);
}
