import React, { useEffect, useState } from 'react';
import { FolderOpen, ChevronDown, RefreshCw } from 'lucide-react';
import type { Project } from '../types';
import { scanProjects } from '../services/projectScanner';

interface ProjectSelectorProps {
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  disabled?: boolean;
}

export function ProjectSelector({ selectedProject, onSelectProject, disabled }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setIsLoading(true);
    try {
      const scanned = await scanProjects();
      setProjects(scanned);
      if (scanned.length > 0 && !selectedProject) {
        onSelectProject(scanned[0]);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-slate-400 mb-1.5">Project</label>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-left transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-600 hover:bg-slate-750'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-4 h-4 text-teal-400 flex-shrink-0" />
          <span className="truncate text-slate-200">
            {isLoading ? 'Loading...' : selectedProject?.name || 'Select a project'}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto">
            {projects.map((project) => (
              <button
                key={project.path}
                onClick={() => {
                  onSelectProject(project);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                  selectedProject?.path === project.path
                    ? 'bg-teal-900/30 text-teal-300'
                    : 'hover:bg-slate-700 text-slate-200'
                }`}
              >
                <FolderOpen className="w-4 h-4 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{project.name}</div>
                  <div className="truncate text-xs text-slate-500">{project.path}</div>
                </div>
                {project.hasTasks && (
                  <span className="text-xs bg-teal-900/50 text-teal-400 px-1.5 py-0.5 rounded">tasks</span>
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-slate-700 p-2">
            <button
              onClick={loadProjects}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
