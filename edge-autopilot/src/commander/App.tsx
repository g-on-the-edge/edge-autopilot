import React, { useState, useCallback } from 'react';
import { Bot, Zap } from 'lucide-react';
import type { Project, Task, LogEntry, SessionStats } from './types';
import {
  ProjectSelector,
  TaskInput,
  TaskList,
  LogPanel,
  StatsPanel,
  TemplateButtons,
} from './components';
import { AutopilotRunner, createLogEntry, calculateStats } from './services/autopilotRunner';

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<SessionStats>({
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    runningTasks: 0,
    pendingTasks: 0,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [runner, setRunner] = useState<AutopilotRunner | null>(null);

  const handleLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => [...prev, entry]);
  }, []);

  const handleStats = useCallback((newStats: SessionStats) => {
    setStats(newStats);
  }, []);

  const handleTaskUpdate = useCallback((updatedTask: Task) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === updatedTask.id ? updatedTask : t))
    );
  }, []);

  function handleTasksGenerated(newTasks: Task[]) {
    setTasks((prev) => [...prev, ...newTasks]);
    setStats(calculateStats([...tasks, ...newTasks]));
  }

  function handleTaskGenerated(task: Task) {
    setTasks((prev) => [...prev, task]);
    setStats(calculateStats([...tasks, task]));
  }

  function handleRemoveTask(taskId: string) {
    const newTasks = tasks.filter((t) => t.id !== taskId);
    setTasks(newTasks);
    setStats(calculateStats(newTasks));
  }

  async function handleRunAll() {
    if (!project || tasks.length === 0) return;

    setIsRunning(true);
    const newRunner = new AutopilotRunner(handleLog, handleStats, handleTaskUpdate);
    setRunner(newRunner);

    // Reset pending tasks
    const resetTasks = tasks.map((t) =>
      t.status === 'failed' ? { ...t, status: 'pending' as const, error: undefined } : t
    );
    setTasks(resetTasks);

    try {
      await newRunner.start(resetTasks, project.path);
    } finally {
      setIsRunning(false);
      setRunner(null);
    }
  }

  function handleStop() {
    if (runner) {
      runner.stop();
      setIsRunning(false);
    }
  }

  function handleClearLogs() {
    setLogs([]);
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 bg-gradient-to-br from-teal-500 to-blue-600 rounded-lg">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Autopilot Commander</h1>
              <p className="text-xs text-slate-500">AI-powered task automation</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isRunning && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-900/30 border border-blue-500/30 rounded-full">
                <Zap className="w-4 h-4 text-blue-400 animate-pulse" />
                <span className="text-sm text-blue-300">Running</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-screen-2xl mx-auto p-4">
        <div className="grid grid-cols-12 gap-4 h-[calc(100vh-100px)]">
          {/* Left Panel */}
          <div className="col-span-3 space-y-4 overflow-y-auto">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <ProjectSelector
                selectedProject={project}
                onSelectProject={setProject}
                disabled={isRunning}
              />
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <TemplateButtons
                project={project}
                onTaskGenerated={handleTaskGenerated}
                disabled={isRunning}
              />
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <StatsPanel stats={stats} />
            </div>
          </div>

          {/* Center Panel */}
          <div className="col-span-5 space-y-4 overflow-y-auto">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <TaskInput
                project={project}
                onTasksGenerated={handleTasksGenerated}
                disabled={isRunning}
              />
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex-1">
              <TaskList
                tasks={tasks}
                onUpdateTask={handleTaskUpdate}
                onRemoveTask={handleRemoveTask}
                onRunAll={handleRunAll}
                onStop={handleStop}
                isRunning={isRunning}
              />
            </div>
          </div>

          {/* Right Panel */}
          <div className="col-span-4 bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
            <LogPanel logs={logs} onClear={handleClearLogs} />
          </div>
        </div>
      </main>
    </div>
  );
}
