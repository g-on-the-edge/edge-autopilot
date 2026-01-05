export interface Project {
  name: string;
  path: string;
  hasPackageJson: boolean;
  hasTasks: boolean;
  lastModified?: Date;
}

export interface Task {
  id: string;
  description: string;
  prompt: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  completedAt?: string;
  error?: string;
  output?: string;  // Full output from Claude
}

export interface TaskResult {
  taskId: string;
  description: string;
  status: 'complete' | 'failed';
  output: string;
  completedAt: string;
  duration?: number;
  filesChanged?: string[];
}

export interface TaskFile {
  name?: string;
  tasks: Task[];
  filePath?: string;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'error' | 'warning' | 'file-change';
  message: string;
  taskId?: string;
  filePath?: string;
}

export interface SessionStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  pendingTasks: number;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
}

export interface AutopilotSession {
  id: string;
  project: Project;
  taskFile: TaskFile;
  stats: SessionStats;
  logs: LogEntry[];
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
}

export interface TaskTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptTemplate: string;
}
