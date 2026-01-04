import React, { useState } from 'react';
import {
  ArrowRightLeft,
  ClipboardCheck,
  Wrench,
  Sparkles,
  RefreshCw,
  TestTube,
  X,
} from 'lucide-react';
import type { Task, TaskTemplate, Project } from '../types';
import { TASK_TEMPLATES, applyTemplate } from '../services/taskGenerator';

interface TemplateButtonsProps {
  project: Project | null;
  onTaskGenerated: (task: Task) => void;
  disabled?: boolean;
}

const iconMap: Record<string, React.ReactNode> = {
  ArrowRightLeft: <ArrowRightLeft className="w-4 h-4" />,
  ClipboardCheck: <ClipboardCheck className="w-4 h-4" />,
  Wrench: <Wrench className="w-4 h-4" />,
  Sparkles: <Sparkles className="w-4 h-4" />,
  RefreshCw: <RefreshCw className="w-4 h-4" />,
  TestTube: <TestTube className="w-4 h-4" />,
};

export function TemplateButtons({ project, onTaskGenerated, disabled }: TemplateButtonsProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});

  function handleTemplateClick(template: TaskTemplate) {
    setSelectedTemplate(template);
    // Extract variables from template
    const matches = template.promptTemplate.match(/\{(\w+)\}/g) || [];
    const vars: Record<string, string> = {};
    matches.forEach((match) => {
      const key = match.slice(1, -1);
      vars[key] = '';
    });
    setVariables(vars);
  }

  function handleApply() {
    if (!selectedTemplate || !project) return;

    const task = applyTemplate(selectedTemplate, variables, project.name);
    onTaskGenerated(task);
    setSelectedTemplate(null);
    setVariables({});
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Quick Templates</h3>

      <div className="grid grid-cols-2 gap-2">
        {TASK_TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => handleTemplateClick(template)}
            disabled={disabled || !project}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <span className="text-teal-400">{iconMap[template.icon]}</span>
            <span className="text-sm text-slate-300">{template.name}</span>
          </button>
        ))}
      </div>

      {/* Template Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <span className="text-teal-400">{iconMap[selectedTemplate.icon]}</span>
                <h3 className="text-lg font-medium text-slate-200">{selectedTemplate.name}</h3>
              </div>
              <button
                onClick={() => setSelectedTemplate(null)}
                className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-sm text-slate-400">{selectedTemplate.description}</p>

              {Object.keys(variables).map((key) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <input
                    type="text"
                    value={variables[key]}
                    onChange={(e) => setVariables({ ...variables, [key]: e.target.value })}
                    placeholder={`Enter ${key}...`}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-slate-700">
              <button
                onClick={() => setSelectedTemplate(null)}
                className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={Object.values(variables).some((v) => !v.trim())}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
