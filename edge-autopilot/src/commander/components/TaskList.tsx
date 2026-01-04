import React from 'react';
import { Play, Square, CheckCircle, XCircle, Clock, Loader2, Trash2, GripVertical } from 'lucide-react';
import type { Task } from '../types';

interface TaskListProps {
  tasks: Task[];
  onUpdateTask: (task: Task) => void;
  onRemoveTask: (taskId: string) => void;
  onRunAll: () => void;
  onStop: () => void;
  isRunning: boolean;
}

export function TaskList({ tasks, onUpdateTask, onRemoveTask, onRunAll, onStop, isRunning }: TaskListProps) {
  const statusIcons = {
    pending: <Clock className="w-4 h-4 text-slate-400" />,
    running: <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />,
    complete: <CheckCircle className="w-4 h-4 text-green-400" />,
    failed: <XCircle className="w-4 h-4 text-red-400" />,
  };

  const statusColors = {
    pending: 'border-slate-700 bg-slate-800/50',
    running: 'border-blue-500/50 bg-blue-900/20',
    complete: 'border-green-500/30 bg-green-900/10',
    failed: 'border-red-500/30 bg-red-900/10',
  };

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
        <Clock className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-sm">No tasks yet</p>
        <p className="text-xs mt-1">Generate tasks from a description or use a template</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">
          Tasks ({tasks.length})
        </h3>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          ) : (
            <button
              onClick={onRunAll}
              disabled={tasks.every(t => t.status === 'complete')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-3.5 h-3.5" />
              Run All
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {tasks.map((task, index) => (
          <div
            key={task.id}
            className={`group flex items-start gap-3 p-3 border rounded-lg transition-colors ${statusColors[task.status]}`}
          >
            <div className="flex items-center gap-2 pt-0.5">
              <GripVertical className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100 cursor-grab" />
              <span className="text-xs text-slate-500 w-5">{index + 1}.</span>
              {statusIcons[task.status]}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-200 font-medium truncate">{task.description}</p>
              {task.error && (
                <p className="mt-1 text-xs text-red-400 truncate">{task.error}</p>
              )}
              {task.completedAt && (
                <p className="mt-1 text-xs text-slate-500">
                  Completed: {new Date(task.completedAt).toLocaleTimeString()}
                </p>
              )}
            </div>

            {!isRunning && task.status === 'pending' && (
              <button
                onClick={() => onRemoveTask(task.id)}
                className="p-1.5 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
