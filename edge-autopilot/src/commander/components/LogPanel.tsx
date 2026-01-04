import React, { useEffect, useRef } from 'react';
import { Terminal, FileEdit, CheckCircle, XCircle, AlertTriangle, Info, Trash2 } from 'lucide-react';
import type { LogEntry } from '../types';

interface LogPanelProps {
  logs: LogEntry[];
  onClear: () => void;
}

export function LogPanel({ logs, onClear }: LogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const typeIcons = {
    info: <Info className="w-3.5 h-3.5 text-blue-400" />,
    success: <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
    error: <XCircle className="w-3.5 h-3.5 text-red-400" />,
    warning: <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />,
    'file-change': <FileEdit className="w-3.5 h-3.5 text-purple-400" />,
  };

  const typeColors = {
    info: 'text-slate-300',
    success: 'text-green-300',
    error: 'text-red-300',
    warning: 'text-yellow-300',
    'file-change': 'text-purple-300',
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <div className="flex items-center gap-2 text-slate-300">
          <Terminal className="w-4 h-4" />
          <span className="text-sm font-medium">Logs</span>
          <span className="text-xs text-slate-500">({logs.length})</span>
        </div>
        {logs.length > 0 && (
          <button
            onClick={onClear}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            title="Clear logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Terminal className="w-8 h-8 mb-2 opacity-50" />
            <p>No logs yet</p>
            <p className="text-xs mt-1">Run tasks to see output</p>
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 py-1">
              <span className="text-slate-600 flex-shrink-0">
                {log.timestamp.toLocaleTimeString()}
              </span>
              <span className="flex-shrink-0">{typeIcons[log.type]}</span>
              <span className={typeColors[log.type]}>
                {log.message}
                {log.filePath && (
                  <span className="text-slate-500 ml-1">({log.filePath})</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
