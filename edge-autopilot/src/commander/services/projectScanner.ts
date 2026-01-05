import type { Project } from '../types';

const API_BASE = 'http://localhost:3849';

export async function scanProjects(): Promise<Project[]> {
  try {
    const response = await fetch(`${API_BASE}/api/projects`);
    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to scan projects:', error);
    // Return fallback data if server isn't running
    return [
      { name: 'edge-autopilot/edge-autopilot', path: '/Users/g/VScode-Programs/Projects/edge-autopilot/edge-autopilot', hasPackageJson: true, hasTasks: true },
      { name: 'edge-oracle', path: '/Users/g/VScode-Programs/Projects/edge-oracle', hasPackageJson: true, hasTasks: false },
    ];
  }
}

export async function getProjectTasks(projectName: string): Promise<{ name: string; path: string }[]> {
  try {
    const response = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectName)}/tasks`);
    if (!response.ok) {
      throw new Error(`Failed to fetch tasks: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to get project tasks:', error);
    return [];
  }
}

export function getProjectsRoot(): string {
  return '/Users/g/VScode-Programs/Projects';
}
