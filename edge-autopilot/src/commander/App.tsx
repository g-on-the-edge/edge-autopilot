import React, { useState, useCallback } from 'react';
import { Bot, Zap } from 'lucide-react';
import type { Project, Task, LogEntry, SessionStats, TaskResult } from './types';
import {
  ProjectSelector,
  TaskInput,
  TaskList,
  LogPanel,
  StatsPanel,
  TemplateButtons,
  ResultsPanel,
} from './components';
import { AutopilotRunner, createLogEntry, calculateStats } from './services/autopilotRunner';

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<TaskResult[]>([]);
  const [stats, setStats] = useState<SessionStats>({
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    runningTasks: 0,
    pendingTasks: 0,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [runner, setRunner] = useState<AutopilotRunner | null>(null);
  const [activeTab, setActiveTab] = useState<'logs' | 'results'>('logs');

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

  const handleTaskResult = useCallback((result: TaskResult) => {
    setResults((prev) => [...prev, result]);
    // Auto-switch to results tab when a task completes
    setActiveTab('results');
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
    setActiveTab('logs');  // Switch to logs when starting
    const newRunner = new AutopilotRunner(handleLog, handleStats, handleTaskUpdate, handleTaskResult);
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

  function handleClearResults() {
    setResults([]);
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
              <h2 className="text-sm font-semibold text-white">How to use this (3 steps)</h2>
              <ol className="mt-3 space-y-2 text-sm">
                <li className={`flex gap-2 ${!project ? 'text-teal-300' : 'text-slate-300'}`}>
                  <span className="text-slate-500">1.</span>
                  <span>Pick a project on the left</span>
                </li>
                <li className={`flex gap-2 ${project && tasks.length === 0 ? 'text-teal-300' : 'text-slate-300'}`}>
                  <span className="text-slate-500">2.</span>
                  <span>Add tasks (use Templates or type a task)</span>
                </li>
                <li className={`flex gap-2 ${project && tasks.length > 0 && !isRunning ? 'text-teal-300' : 'text-slate-300'}`}>
                  <span className="text-slate-500">3.</span>
                  <span>Press “Run All”</span>
                </li>
              </ol>
              <p className="mt-3 text-xs text-slate-500">
                Tip: Watch “Logs” while it runs; check “Results” after.
              </p>
            </div>

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

          {/* Right Panel - Tabs for Logs/Results */}
          <div className="col-span-4 bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden flex flex-col">
            {/* Tab Headers */}
            <div className="flex border-b border-slate-700">
              <button
                onClick={() => setActiveTab('logs')}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'logs'
                    ? 'text-teal-400 border-b-2 border-teal-400 bg-slate-800/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Logs ({logs.length})
              </button>
              <button
                onClick={() => setActiveTab('results')}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'results'
                    ? 'text-teal-400 border-b-2 border-teal-400 bg-slate-800/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Results ({results.length})
                {results.length > 0 && activeTab !== 'results' && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-teal-500 text-white rounded-full">
                    New
                  </span>
                )}
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === 'logs' ? (
                <LogPanel logs={logs} onClear={handleClearLogs} />
              ) : (
                <ResultsPanel results={results} onClear={handleClearResults} />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
