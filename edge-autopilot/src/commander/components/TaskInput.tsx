import React, { useState } from 'react';
import { Sparkles, Loader2, FileText } from 'lucide-react';
import type { Task, Project } from '../types';
import { parseNaturalLanguageToTasks, generateYamlFromTasks } from '../services/taskGenerator';

interface TaskInputProps {
  project: Project | null;
  onTasksGenerated: (tasks: Task[]) => void;
  disabled?: boolean;
}

export function TaskInput({ project, onTasksGenerated, disabled }: TaskInputProps) {
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [generatedYaml, setGeneratedYaml] = useState('');

  async function handleGenerate() {
    if (!description.trim() || !project) return;

    setIsGenerating(true);
    try {
      // Simulate AI generation delay
      await new Promise(resolve => setTimeout(resolve, 500));

      const tasks = parseNaturalLanguageToTasks(description, project.name);
      const yaml = generateYamlFromTasks(`${project.name} Tasks`, tasks);

      setGeneratedYaml(yaml);
      onTasksGenerated(tasks);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-300">Task Description</label>
        {generatedYaml && (
          <button
            onClick={() => setShowYaml(!showYaml)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            {showYaml ? 'Hide' : 'Show'} YAML
          </button>
        )}
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={disabled}
        placeholder={`Describe what you want to accomplish...

Examples:
- Add user authentication with email/password
- Fix the bug in the checkout flow
- Migrate database from Firestore to Supabase
- Audit the codebase for security issues

You can also list multiple tasks:
1. Create login page
2. Add form validation
3. Connect to auth API`}
        className="w-full h-40 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
      />

      <button
        onClick={handleGenerate}
        disabled={disabled || !description.trim() || !project || isGenerating}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-500 hover:to-blue-500 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-teal-600 disabled:hover:to-blue-600"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating Tasks...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Generate Tasks
          </>
        )}
      </button>

      {showYaml && generatedYaml && (
        <div className="mt-3 p-3 bg-slate-900 border border-slate-700 rounded-lg">
          <pre className="text-xs text-slate-400 overflow-x-auto whitespace-pre-wrap">{generatedYaml}</pre>
        </div>
      )}
    </div>
  );
}
