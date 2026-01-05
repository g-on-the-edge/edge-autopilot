import React, { useState } from 'react';
import { FileText, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, Copy, Check, Trash2 } from 'lucide-react';
import type { TaskResult } from '../types';

interface ResultsPanelProps {
  results: TaskResult[];
  onClear?: () => void;
}

export function ResultsPanel({ results, onClear }: ResultsPanelProps) {
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-4">
        <FileText className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-sm">No results yet</p>
        <p className="text-xs mt-1 text-center">Task outputs and summaries will appear here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <div className="flex items-center gap-2 text-slate-300">
          <FileText className="w-4 h-4" />
          <span className="text-sm font-medium">Results</span>
          <span className="text-xs text-slate-500">({results.length})</span>
        </div>
        {onClear && results.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            title="Clear results"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {results.map((result) => (
          <div
            key={result.taskId}
            className={`border rounded-lg overflow-hidden transition-colors ${
              result.status === 'complete'
                ? 'border-green-500/30 bg-green-900/10'
                : 'border-red-500/30 bg-red-900/10'
            }`}
          >
            {/* Header */}
            <button
              onClick={() => setExpandedResult(expandedResult === result.taskId ? null : result.taskId)}
              className="w-full flex items-center gap-2 p-3 text-left hover:bg-slate-800/50 transition-colors"
            >
              {expandedResult === result.taskId ? (
                <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
              )}

              {result.status === 'complete' ? (
                <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 font-medium truncate">
                  {result.description}
                </p>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {result.duration ? formatDuration(result.duration) : 'N/A'}
                  </span>
                  <span>{new Date(result.completedAt).toLocaleTimeString()}</span>
                </div>
              </div>
            </button>

            {/* Expanded Content */}
            {expandedResult === result.taskId && (
              <div className="border-t border-slate-700">
                {/* Copy button */}
                <div className="flex justify-end px-3 py-1 bg-slate-800/30">
                  <button
                    onClick={() => copyToClipboard(result.output, result.taskId)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {copiedId === result.taskId ? (
                      <>
                        <Check className="w-3 h-3 text-green-400" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </button>
                </div>

                {/* Output */}
                <div className="p-3 bg-slate-900/50 max-h-80 overflow-y-auto">
                  {result.output ? (
                    <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                      {result.output}
                    </pre>
                  ) : (
                    <p className="text-xs text-slate-500 italic">No output captured</p>
                  )}
                </div>

                {/* Error if failed */}
                {result.status === 'failed' && (
                  <div className="p-3 border-t border-slate-700 bg-red-900/20">
                    <p className="text-xs text-red-400 font-medium mb-1">Error:</p>
                    <p className="text-xs text-red-300">{(result as any).error || 'Unknown error'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
