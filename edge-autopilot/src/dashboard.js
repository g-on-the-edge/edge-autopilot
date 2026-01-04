import { createServer } from 'http';
import { EventEmitter } from 'events';
import { WebSocketServer } from 'ws';

/**
 * Dashboard - Real-time web monitoring dashboard for Edge Autopilot
 *
 * Features:
 * - HTTP server serving HTML dashboard
 * - WebSocket for real-time updates
 * - Event emission for approve/deny/pause/resume actions
 */
export class Dashboard extends EventEmitter {
  constructor(config = {}) {
    super();
    this.port = config.port || 3847;
    this.logsDir = config.logsDir || './logs';

    this.server = null;
    this.wss = null;
    this.clients = new Set();

    // State
    this.state = {
      mode: 'idle',
      currentTask: null,
      queue: [],
      actions: [],
      stats: {
        started: new Date(),
        tasksCompleted: 0,
        tasksFailed: 0,
        actionsApproved: 0,
        actionsDenied: 0,
        errors: 0,
        filesChanged: 0
      },
      insights: null,
      sessionComplete: false
    };
  }

  /**
   * Start the dashboard server
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);

        // Send current state to new client
        ws.send(JSON.stringify({ type: 'state', data: this.state }));

        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message.toString());
            this.handleClientMessage(data);
          } catch (e) {
            // Ignore invalid messages
          }
        });

        ws.on('close', () => {
          this.clients.delete(ws);
        });
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Dashboard port ${this.port} in use, trying ${this.port + 1}`);
          this.port++;
          this.server.listen(this.port);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, () => {
        console.log(`Dashboard running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the dashboard server
   */
  async stop() {
    return new Promise((resolve) => {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();

      if (this.wss) {
        this.wss.close();
      }

      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle HTTP requests
   */
  handleRequest(req, res) {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.getHtml());
    } else if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.state));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  /**
   * Handle WebSocket messages from clients
   */
  handleClientMessage(data) {
    switch (data.type) {
      case 'approve':
        this.emit('approve', data.actionId);
        break;
      case 'deny':
        this.emit('deny', data.actionId);
        break;
      case 'pause':
        this.emit('pause');
        break;
      case 'resume':
        this.emit('resume');
        break;
    }
  }

  /**
   * Broadcast state update to all connected clients
   */
  broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    }
  }

  /**
   * Update the current mode
   */
  updateMode(mode) {
    this.state.mode = mode;
    this.broadcast('mode', mode);
  }

  /**
   * Update the current task
   */
  updateTask(task) {
    this.state.currentTask = task;
    this.broadcast('task', task);
  }

  /**
   * Update the task queue
   */
  updateQueue(queue) {
    this.state.queue = queue;
    this.broadcast('queue', queue);
  }

  /**
   * Add an action to the log
   */
  addAction(action) {
    const actionWithTimestamp = {
      ...action,
      timestamp: new Date().toISOString()
    };
    this.state.actions.unshift(actionWithTimestamp);
    // Keep only last 100 actions
    if (this.state.actions.length > 100) {
      this.state.actions = this.state.actions.slice(0, 100);
    }
    this.broadcast('action', actionWithTimestamp);
  }

  /**
   * Update session statistics
   */
  updateStats(stats) {
    this.state.stats = { ...this.state.stats, ...stats };
    console.log('[Dashboard] Broadcasting stats:', JSON.stringify(this.state.stats));
    this.broadcast('stats', this.state.stats);
  }

  /**
   * Update session insights
   */
  updateInsights(insights) {
    this.state.insights = insights;
    this.broadcast('insights', insights);
  }

  /**
   * Mark a task as completed
   */
  taskCompleted(task) {
    this.broadcast('taskCompleted', task);
  }

  /**
   * Mark a task as failed
   */
  taskFailed(task, error) {
    this.broadcast('taskFailed', { task, error });
  }

  /**
   * Mark the session as complete
   */
  sessionComplete() {
    this.state.sessionComplete = true;
    this.broadcast('sessionComplete', this.state.stats);
  }

  /**
   * Add output text to the live output panel
   * @param {string} text - The text to add to the output
   */
  addOutput(text) {
    this.broadcast('output', text);
  }

  /**
   * Get the full HTML dashboard
   */
  getHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edge Autopilot Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 1px solid #30363d;
      margin-bottom: 20px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo h1 {
      font-size: 24px;
      font-weight: 600;
      color: #58a6ff;
    }

    .status-badge {
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .status-idle { background: #30363d; color: #8b949e; }
    .status-autopilot { background: #238636; color: #fff; }
    .status-copilot { background: #1f6feb; color: #fff; }
    .status-paused { background: #9e6a03; color: #fff; }

    .controls {
      display: flex;
      gap: 10px;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: #238636;
      color: #fff;
    }

    .btn-primary:hover {
      background: #2ea043;
    }

    .btn-warning {
      background: #9e6a03;
      color: #fff;
    }

    .btn-warning:hover {
      background: #bb8009;
    }

    .btn-danger {
      background: #da3633;
      color: #fff;
    }

    .btn-danger:hover {
      background: #f85149;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    @media (max-width: 900px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: #c9d1d9;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }

    @media (max-width: 600px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .stat-item {
      text-align: center;
      padding: 16px;
      background: #0d1117;
      border-radius: 8px;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: #58a6ff;
    }

    .stat-value.success { color: #3fb950; }
    .stat-value.warning { color: #d29922; }
    .stat-value.danger { color: #f85149; }

    .stat-label {
      font-size: 12px;
      color: #8b949e;
      margin-top: 4px;
      text-transform: uppercase;
    }

    .current-task {
      background: #0d1117;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .task-label {
      font-size: 12px;
      color: #8b949e;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .task-description {
      font-size: 14px;
      color: #c9d1d9;
      line-height: 1.5;
    }

    .task-id {
      font-size: 12px;
      color: #8b949e;
      margin-top: 8px;
    }

    .no-task {
      color: #8b949e;
      font-style: italic;
    }

    .action-list {
      max-height: 400px;
      overflow-y: auto;
    }

    .action-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
      background: #0d1117;
      border-radius: 6px;
      margin-bottom: 8px;
    }

    .action-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }

    .action-icon.file { background: #1f6feb33; color: #58a6ff; }
    .action-icon.command { background: #23863633; color: #3fb950; }
    .action-icon.network { background: #9e6a0333; color: #d29922; }
    .action-icon.danger { background: #da363333; color: #f85149; }

    .action-content {
      flex: 1;
      min-width: 0;
    }

    .action-type {
      font-size: 13px;
      font-weight: 500;
      color: #c9d1d9;
    }

    .action-target {
      font-size: 12px;
      color: #8b949e;
      margin-top: 2px;
      word-break: break-all;
    }

    .action-time {
      font-size: 11px;
      color: #484f58;
      margin-top: 4px;
    }

    .action-risk {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: #30363d;
    }

    .risk-low { background: #23863633; color: #3fb950; }
    .risk-medium { background: #9e6a0333; color: #d29922; }
    .risk-high { background: #da363333; color: #f85149; }
    .risk-critical { background: #da3633; color: #fff; }

    .queue-list {
      max-height: 300px;
      overflow-y: auto;
    }

    .queue-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: #0d1117;
      border-radius: 6px;
      margin-bottom: 6px;
    }

    .queue-number {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #30363d;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 500;
      flex-shrink: 0;
    }

    .queue-item.completed .queue-number {
      background: #238636;
    }

    .queue-item.current .queue-number {
      background: #1f6feb;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .queue-description {
      font-size: 13px;
      color: #c9d1d9;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .queue-item.completed .queue-description {
      color: #8b949e;
      text-decoration: line-through;
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #8b949e;
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    .connection-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #8b949e;
    }

    .connection-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #da3633;
    }

    .connection-dot.connected {
      background: #3fb950;
    }

    .insights-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .insight-item {
      background: #0d1117;
      border-radius: 6px;
      padding: 12px;
    }

    .insight-label {
      font-size: 11px;
      color: #8b949e;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .insight-value {
      font-size: 18px;
      font-weight: 600;
      color: #c9d1d9;
    }

    .progress-bar {
      height: 4px;
      background: #30363d;
      border-radius: 2px;
      margin-top: 8px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: #58a6ff;
      border-radius: 2px;
      transition: width 0.3s;
    }

    .session-complete-banner {
      background: linear-gradient(135deg, #238636 0%, #1f6feb 100%);
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin-bottom: 20px;
      display: none;
    }

    .session-complete-banner.visible {
      display: block;
    }

    .session-complete-title {
      font-size: 20px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 8px;
    }

    .session-complete-subtitle {
      font-size: 14px;
      color: rgba(255,255,255,0.8);
    }

    .live-output {
      background: #0a0a0a;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      height: 300px;
      overflow-y: auto;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
      font-size: 12px;
      line-height: 1.5;
      color: #39ff14;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .live-output::-webkit-scrollbar {
      width: 8px;
    }

    .live-output::-webkit-scrollbar-track {
      background: #0a0a0a;
    }

    .live-output::-webkit-scrollbar-thumb {
      background: #30363d;
      border-radius: 4px;
    }

    .live-output::-webkit-scrollbar-thumb:hover {
      background: #484f58;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <h1>Edge Autopilot</h1>
        <span class="status-badge status-idle" id="status-badge">Idle</span>
      </div>
      <div class="controls">
        <button class="btn btn-warning" id="pause-btn" onclick="togglePause()">Pause</button>
        <div class="connection-status">
          <span class="connection-dot" id="connection-dot"></span>
          <span id="connection-text">Disconnected</span>
        </div>
      </div>
    </header>

    <div class="session-complete-banner" id="session-complete-banner">
      <div class="session-complete-title">Session Complete</div>
      <div class="session-complete-subtitle">All tasks have been processed</div>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value success" id="stat-completed">0</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat-item">
          <div class="stat-value danger" id="stat-failed">0</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="stat-approved">0</div>
          <div class="stat-label">Approved</div>
        </div>
        <div class="stat-item">
          <div class="stat-value warning" id="stat-denied">0</div>
          <div class="stat-label">Denied</div>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Current Task</span>
        </div>
        <div class="current-task" id="current-task">
          <div class="no-task">No task running</div>
        </div>

        <div class="card-header" style="margin-top: 20px;">
          <span class="card-title">Queue</span>
          <span id="queue-count" style="color: #8b949e; font-size: 13px;">0 tasks</span>
        </div>
        <div class="queue-list" id="queue-list">
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div>No tasks in queue</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Actions</span>
          <span id="action-count" style="color: #8b949e; font-size: 13px;">0 actions</span>
        </div>
        <div class="action-list" id="action-list">
          <div class="empty-state">
            <div class="empty-state-icon">⚡</div>
            <div>No actions yet</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;" id="insights-card">
      <div class="card-header">
        <span class="card-title">Session Insights</span>
      </div>
      <div class="insights-grid">
        <div class="insight-item">
          <div class="insight-label">Total Actions</div>
          <div class="insight-value" id="insight-total">0</div>
        </div>
        <div class="insight-item">
          <div class="insight-label">Average Risk</div>
          <div class="insight-value" id="insight-risk">0%</div>
          <div class="progress-bar">
            <div class="progress-fill" id="risk-progress" style="width: 0%"></div>
          </div>
        </div>
        <div class="insight-item">
          <div class="insight-label">Files Changed</div>
          <div class="insight-value" id="insight-files">0</div>
        </div>
        <div class="insight-item">
          <div class="insight-label">Uptime</div>
          <div class="insight-value" id="insight-uptime">0m</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;">
      <div class="card-header">
        <span class="card-title">Live Output</span>
        <span id="output-lines" style="color: #8b949e; font-size: 13px;">0 lines</span>
      </div>
      <pre class="live-output" id="live-output"></pre>
    </div>
  </div>

  <script>
    let ws = null;
    let state = {
      mode: 'idle',
      currentTask: null,
      queue: [],
      actions: [],
      stats: {},
      insights: null,
      sessionComplete: false
    };
    let isPaused = false;
    let sessionStartTime = Date.now();

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + window.location.host);

      ws.onopen = () => {
        document.getElementById('connection-dot').classList.add('connected');
        document.getElementById('connection-text').textContent = 'Connected';
      };

      ws.onclose = () => {
        document.getElementById('connection-dot').classList.remove('connected');
        document.getElementById('connection-text').textContent = 'Disconnected';
        setTimeout(connect, 2000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        document.getElementById('connection-dot').classList.remove('connected');
        document.getElementById('connection-text').textContent = 'Connection Error';
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
      };
    }

    function handleMessage(message) {
      switch (message.type) {
        case 'state':
          state = message.data;
          sessionStartTime = new Date(state.stats.started).getTime();
          updateAll();
          break;
        case 'mode':
          state.mode = message.data;
          updateMode();
          break;
        case 'task':
          state.currentTask = message.data;
          updateCurrentTask();
          break;
        case 'queue':
          state.queue = message.data;
          updateQueue();
          break;
        case 'action':
          state.actions.unshift(message.data);
          if (state.actions.length > 100) state.actions = state.actions.slice(0, 100);
          updateActions();
          break;
        case 'stats':
          state.stats = message.data;
          updateStats();
          break;
        case 'insights':
          state.insights = message.data;
          updateInsights();
          break;
        case 'taskCompleted':
        case 'taskFailed':
          updateQueue();
          break;
        case 'sessionComplete':
          state.sessionComplete = true;
          document.getElementById('session-complete-banner').classList.add('visible');
          break;
        case 'output':
          appendOutput(message.data);
          break;
      }
    }

    const MAX_OUTPUT_LINES = 200;
    let outputLines = [];

    function appendOutput(text) {
      const outputEl = document.getElementById('live-output');
      const linesCountEl = document.getElementById('output-lines');

      // Split incoming text by newlines and add to buffer
      const newLines = text.split('\\n');
      outputLines = outputLines.concat(newLines);

      // Trim to last MAX_OUTPUT_LINES
      if (outputLines.length > MAX_OUTPUT_LINES) {
        outputLines = outputLines.slice(-MAX_OUTPUT_LINES);
      }

      // Update display
      outputEl.textContent = outputLines.join('\\n');
      linesCountEl.textContent = outputLines.length + ' line' + (outputLines.length !== 1 ? 's' : '');

      // Auto-scroll to bottom
      outputEl.scrollTop = outputEl.scrollHeight;
    }

    function updateAll() {
      updateMode();
      updateCurrentTask();
      updateQueue();
      updateActions();
      updateStats();
      updateInsights();
      if (state.sessionComplete) {
        document.getElementById('session-complete-banner').classList.add('visible');
      }
    }

    function updateMode() {
      const badge = document.getElementById('status-badge');
      badge.textContent = state.mode.charAt(0).toUpperCase() + state.mode.slice(1);
      badge.className = 'status-badge status-' + state.mode;

      isPaused = state.mode === 'paused';
      const pauseBtn = document.getElementById('pause-btn');
      if (isPaused) {
        pauseBtn.textContent = 'Resume';
        pauseBtn.className = 'btn btn-primary';
      } else {
        pauseBtn.textContent = 'Pause';
        pauseBtn.className = 'btn btn-warning';
      }
    }

    function updateCurrentTask() {
      const container = document.getElementById('current-task');
      if (state.currentTask) {
        container.innerHTML = \`
          <div class="task-label">Running</div>
          <div class="task-description">\${escapeHtml(state.currentTask.description || state.currentTask.prompt || 'Task in progress')}</div>
          \${state.currentTask.id ? '<div class="task-id">ID: ' + escapeHtml(state.currentTask.id) + '</div>' : ''}
        \`;
      } else {
        container.innerHTML = '<div class="no-task">No task running</div>';
      }
    }

    function updateQueue() {
      const container = document.getElementById('queue-list');
      const countEl = document.getElementById('queue-count');

      if (!state.queue || state.queue.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div>No tasks in queue</div></div>';
        countEl.textContent = '0 tasks';
        return;
      }

      countEl.textContent = state.queue.length + ' task' + (state.queue.length !== 1 ? 's' : '');

      container.innerHTML = state.queue.map((task, i) => {
        const isCurrent = state.currentTask && state.currentTask.id === task.id;
        const isCompleted = task.status === 'completed';
        let classes = 'queue-item';
        if (isCurrent) classes += ' current';
        if (isCompleted) classes += ' completed';

        return \`
          <div class="\${classes}">
            <div class="queue-number">\${isCompleted ? '✓' : i + 1}</div>
            <div class="queue-description">\${escapeHtml(task.description || task.prompt || 'Task ' + (i + 1))}</div>
          </div>
        \`;
      }).join('');
    }

    function updateActions() {
      const container = document.getElementById('action-list');
      const countEl = document.getElementById('action-count');

      if (!state.actions || state.actions.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚡</div><div>No actions yet</div></div>';
        countEl.textContent = '0 actions';
        return;
      }

      countEl.textContent = state.actions.length + ' action' + (state.actions.length !== 1 ? 's' : '');

      container.innerHTML = state.actions.map(action => {
        const iconClass = getActionIconClass(action.type);
        const riskClass = getRiskClass(action.riskLevel || action.risk);
        const time = action.timestamp ? formatTime(action.timestamp) : '';

        return \`
          <div class="action-item">
            <div class="action-icon \${iconClass}">\${getActionIcon(action.type)}</div>
            <div class="action-content">
              <div class="action-type">\${escapeHtml(action.type || 'unknown')}</div>
              <div class="action-target">\${escapeHtml(action.target || action.path || action.command || '')}</div>
              <div class="action-time">\${time}</div>
            </div>
            \${action.riskLevel ? '<span class="action-risk ' + riskClass + '">' + action.riskLevel + '</span>' : ''}
          </div>
        \`;
      }).join('');
    }

    function updateStats() {
      document.getElementById('stat-completed').textContent = state.stats.tasksCompleted || 0;
      document.getElementById('stat-failed').textContent = state.stats.tasksFailed || 0;
      document.getElementById('stat-approved').textContent = state.stats.actionsApproved || 0;
      document.getElementById('stat-denied').textContent = state.stats.actionsDenied || 0;

      if (state.stats.started) {
        sessionStartTime = new Date(state.stats.started).getTime();
      }
    }

    function updateInsights() {
      const insights = state.insights || {};
      document.getElementById('insight-total').textContent = insights.totalActions || 0;

      const avgRisk = (insights.averageRisk || 0) * 100;
      document.getElementById('insight-risk').textContent = avgRisk.toFixed(1) + '%';
      document.getElementById('risk-progress').style.width = avgRisk + '%';

      document.getElementById('insight-files').textContent = state.stats.filesChanged || 0;
    }

    function updateUptime() {
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const hours = Math.floor(minutes / 60);

      let uptimeStr;
      if (hours > 0) {
        uptimeStr = hours + 'h ' + (minutes % 60) + 'm';
      } else {
        uptimeStr = minutes + 'm';
      }

      document.getElementById('insight-uptime').textContent = uptimeStr;
    }

    function togglePause() {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('WebSocket not connected');
        return;
      }
      
      if (isPaused) {
        ws.send(JSON.stringify({ type: 'resume' }));
      } else {
        ws.send(JSON.stringify({ type: 'pause' }));
      }
    }

    function getActionIconClass(type) {
      if (!type) return 'file';
      if (type.includes('file') || type.includes('read') || type.includes('write') || type.includes('edit')) return 'file';
      if (type.includes('command') || type.includes('bash') || type.includes('exec')) return 'command';
      if (type.includes('network') || type.includes('fetch') || type.includes('http')) return 'network';
      if (type.includes('danger') || type.includes('critical')) return 'danger';
      return 'file';
    }

    function getActionIcon(type) {
      if (!type) return '📄';
      if (type.includes('file') || type.includes('read')) return '📄';
      if (type.includes('write') || type.includes('edit')) return '✏️';
      if (type.includes('command') || type.includes('bash') || type.includes('exec')) return '⚙️';
      if (type.includes('network') || type.includes('fetch') || type.includes('http')) return '🌐';
      if (type.includes('danger') || type.includes('critical')) return '⚠️';
      return '📄';
    }

    function getRiskClass(risk) {
      if (!risk) return '';
      const r = risk.toLowerCase();
      if (r === 'critical') return 'risk-critical';
      if (r === 'high') return 'risk-high';
      if (r === 'medium') return 'risk-medium';
      return 'risk-low';
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Start connection and uptime timer
    connect();
    setInterval(updateUptime, 1000);
  </script>
</body>
</html>`;
  }
}
