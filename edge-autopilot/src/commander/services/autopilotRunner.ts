import type { Task, LogEntry, SessionStats, AutopilotSession } from '../types';

export type LogCallback = (entry: LogEntry) => void;
export type StatsCallback = (stats: SessionStats) => void;
export type TaskUpdateCallback = (task: Task) => void;

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
  private session: AutopilotSession | null = null;
  private abortController: AbortController | null = null;
  private onLog: LogCallback;
  private onStats: StatsCallback;
  private onTaskUpdate: TaskUpdateCallback;

  constructor(
    onLog: LogCallback,
    onStats: StatsCallback,
    onTaskUpdate: TaskUpdateCallback
  ) {
    this.onLog = onLog;
    this.onStats = onStats;
    this.onTaskUpdate = onTaskUpdate;
  }

  async start(tasks: Task[], projectPath: string): Promise<void> {
    this.abortController = new AbortController();
    const startTime = new Date();

    this.onLog(createLogEntry('info', `Starting autopilot session with ${tasks.length} tasks`));
    this.onLog(createLogEntry('info', `Project: ${projectPath}`));

    for (let i = 0; i < tasks.length; i++) {
      if (this.abortController.signal.aborted) {
        this.onLog(createLogEntry('warning', 'Session aborted by user'));
        break;
      }

      const task = tasks[i];
      task.status = 'running';
      this.onTaskUpdate(task);
      this.onStats(calculateStats(tasks, startTime));

      this.onLog(createLogEntry('info', `[${i + 1}/${tasks.length}] Starting: ${task.description}`, task.id));

      // Simulate task execution (in real implementation, this would call the CLI)
      try {
        await this.executeTask(task, projectPath);
        task.status = 'complete';
        task.completedAt = new Date().toISOString();
        this.onLog(createLogEntry('success', `Completed: ${task.description}`, task.id));
      } catch (error) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : 'Unknown error';
        this.onLog(createLogEntry('error', `Failed: ${task.description} - ${task.error}`, task.id));
      }

      this.onTaskUpdate(task);
      this.onStats(calculateStats(tasks, startTime));
    }

    this.onLog(createLogEntry('info', 'Autopilot session completed'));
    this.onStats(calculateStats(tasks, startTime));
  }

  private async executeTask(task: Task, projectPath: string): Promise<void> {
    // In a real implementation, this would:
    // 1. Write the task to a temp YAML file
    // 2. Spawn the autopilot CLI process
    // 3. Stream output to logs
    // 4. Handle completion/failure

    // For now, simulate with a delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Simulate occasional file changes
    if (Math.random() > 0.5) {
      this.onLog(createLogEntry(
        'file-change',
        `Modified: src/components/Example.tsx`,
        task.id,
        `${projectPath}/src/components/Example.tsx`
      ));
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.onLog(createLogEntry('warning', 'Stopping autopilot session...'));
    }
  }

  isRunning(): boolean {
    return this.abortController !== null && !this.abortController.signal.aborted;
  }
}
