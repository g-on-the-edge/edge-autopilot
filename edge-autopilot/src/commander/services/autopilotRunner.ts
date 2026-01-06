import type { Task, LogEntry, SessionStats, TaskResult } from '../types';

// Use 127.0.0.1 instead of localhost to avoid IPv6 (::1) resolution issues
// where another dev server might be bound only on ::1 (and accidentally steal this port).
const WS_URL = 'ws://127.0.0.1:3849';
const API_BASE = 'http://127.0.0.1:3849';

export type LogCallback = (entry: LogEntry) => void;
export type StatsCallback = (stats: SessionStats) => void;
export type TaskUpdateCallback = (task: Task) => void;
export type TaskResultCallback = (result: TaskResult) => void;

let logIdCounter = 0;

export function createLogEntry(
  type: LogEntry['type'],
  message: string,
  taskId?: string,
  filePath?: string
): LogEntry {
  return {
    id: `log-${Date.now()}-${++logIdCounter}`,
    timestamp: new Date(),
    type,
    message,
    taskId,
    filePath,
  };
}

export function calculateStats(tasks: Task[], startTime?: Date): SessionStats {
  const stats: SessionStats = {
    totalTasks: tasks.length,
    completedTasks: tasks.filter(t => t.status === 'complete').length,
    failedTasks: tasks.filter(t => t.status === 'failed').length,
    runningTasks: tasks.filter(t => t.status === 'running').length,
    pendingTasks: tasks.filter(t => t.status === 'pending').length,
    startTime,
  };

  if (startTime && stats.runningTasks === 0 && stats.pendingTasks === 0) {
    stats.endTime = new Date();
    stats.duration = stats.endTime.getTime() - startTime.getTime();
  }

  return stats;
}

export class AutopilotRunner {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private onLog: LogCallback;
  private onStats: StatsCallback;
  private onTaskUpdate: TaskUpdateCallback;
  private onTaskResult: TaskResultCallback;
  private tasks: Task[] = [];
  private startTime: Date | null = null;

  constructor(
    onLog: LogCallback,
    onStats: StatsCallback,
    onTaskUpdate: TaskUpdateCallback,
    onTaskResult: TaskResultCallback
  ) {
    this.onLog = onLog;
    this.onStats = onStats;
    this.onTaskUpdate = onTaskUpdate;
    this.onTaskResult = onTaskResult;
  }

  async start(tasks: Task[], projectPath: string): Promise<void> {
    this.tasks = tasks;
    this.startTime = new Date();
    this.sessionId = `session-${Date.now()}`;

    this.onLog(createLogEntry('info', `Connecting to autopilot server...`));

    return new Promise((resolve, reject) => {
      let settled = false;

      const safeResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const safeReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      try {
        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
          this.onLog(createLogEntry('success', `Connected to autopilot server`));

          // Send start command
          this.ws?.send(JSON.stringify({
            type: 'start',
            tasks,
            projectPath,
            sessionId: this.sessionId,
          }));
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          this.onLog(createLogEntry('error', `WebSocket error: Connection failed. Is the server running?`));
          this.onLog(createLogEntry('info', `Start the server with: node src/commander/server.js`));
          safeReject(error);
        };

        this.ws.onclose = () => {
          const unfinished = this.tasks.filter(
            (t) => t.status === 'pending' || t.status === 'running'
          );

          if (unfinished.length > 0) {
            const nowIso = new Date().toISOString();
            this.onLog(
              createLogEntry(
                'warning',
                `Disconnected from autopilot server; marking ${unfinished.length} unfinished task${unfinished.length !== 1 ? 's' : ''} as failed.`
              )
            );

            for (const task of unfinished) {
              task.status = 'failed';
              task.completedAt = nowIso;
              task.error = task.error || 'Disconnected from autopilot server';
              this.onTaskUpdate(task);
            }
          } else {
            this.onLog(createLogEntry('info', `Disconnected from autopilot server`));
          }

          this.ws = null;
          this.onStats(calculateStats(this.tasks, this.startTime || undefined));
          safeResolve();
        };
      } catch (error) {
        this.onLog(createLogEntry('error', `Failed to connect: ${error}`));
        safeReject(error);
      }
    });
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'log':
        const entry = message.entry;
        this.onLog({
          id: `log-${Date.now()}-${++logIdCounter}`,
          timestamp: new Date(entry.timestamp),
          type: entry.type,
          message: entry.message,
          taskId: entry.taskId,
          filePath: entry.filePath,
        });
        break;

      case 'taskUpdate':
        const task = this.tasks.find(t => t.id === message.taskId);
        if (task) {
          task.status = message.status;
          if (message.completedAt) {
            task.completedAt = message.completedAt;
          }
          if (message.error) {
            task.error = message.error;
          }
          if (message.output) {
            task.output = message.output;
          }
          this.onTaskUpdate(task);
          this.onStats(calculateStats(this.tasks, this.startTime || undefined));
        }
        break;

      case 'taskResult':
        this.onTaskResult({
          taskId: message.taskId,
          description: message.description,
          status: message.status,
          output: message.output,
          completedAt: message.completedAt,
          duration: message.duration,
          filesChanged: message.filesChanged,
        });
        break;

      case 'complete':
        this.onLog(createLogEntry(
          message.exitCode === 0 ? 'success' : 'error',
          `Session completed with exit code ${message.exitCode}`
        ));
        this.onStats(calculateStats(this.tasks, this.startTime || undefined));
        break;

      case 'error':
        this.onLog(createLogEntry('error', message.message));
        break;

      case 'stopped':
        this.onLog(createLogEntry('warning', 'Session stopped by user'));
        break;
    }
  }

  stop(): void {
    if (this.ws && this.sessionId) {
      this.ws.send(JSON.stringify({
        type: 'stop',
        sessionId: this.sessionId,
      }));
      this.onLog(createLogEntry('warning', 'Stopping autopilot session...'));
    }
  }

  isRunning(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
