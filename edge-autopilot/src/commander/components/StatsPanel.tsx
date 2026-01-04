import React from 'react';
import { CheckCircle, XCircle, Clock, Loader2, Timer } from 'lucide-react';
import type { SessionStats } from '../types';

interface StatsPanelProps {
  stats: SessionStats;
}

export function StatsPanel({ stats }: StatsPanelProps) {
  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  };

  const completionPercent = stats.totalTasks > 0
    ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
    : 0;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Session Stats</h3>

      {/* Progress bar */}
      {stats.totalTasks > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Progress</span>
            <span className="text-slate-300">{completionPercent}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-teal-500 to-blue-500 transition-all duration-300"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <div>
            <p className="text-lg font-semibold text-slate-200">{stats.completedTasks}</p>
            <p className="text-xs text-slate-500">Completed</p>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg">
          <XCircle className="w-4 h-4 text-red-400" />
          <div>
            <p className="text-lg font-semibold text-slate-200">{stats.failedTasks}</p>
            <p className="text-xs text-slate-500">Failed</p>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg">
          <Clock className="w-4 h-4 text-slate-400" />
          <div>
            <p className="text-lg font-semibold text-slate-200">{stats.pendingTasks}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg">
          <Loader2 className={`w-4 h-4 text-blue-400 ${stats.runningTasks > 0 ? 'animate-spin' : ''}`} />
          <div>
            <p className="text-lg font-semibold text-slate-200">{stats.runningTasks}</p>
            <p className="text-xs text-slate-500">Running</p>
          </div>
        </div>
      </div>

      {/* Duration */}
      {stats.startTime && (
        <div className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg">
          <Timer className="w-4 h-4 text-teal-400" />
          <div>
            <p className="text-sm font-medium text-slate-200">
              {stats.duration ? formatDuration(stats.duration) : 'Running...'}
            </p>
            <p className="text-xs text-slate-500">
              Started: {stats.startTime.toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
