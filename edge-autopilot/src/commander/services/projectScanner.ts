import type { Project } from '../types';

const PROJECTS_ROOT = '/Users/g/VScode-Programs/Projects';

export async function scanProjects(): Promise<Project[]> {
  // In browser context, we'll use a mock/API approach
  // This would be replaced with actual API calls to the backend
  const projects: Project[] = [
    { name: 'edge-autopilot', path: `${PROJECTS_ROOT}/edge-autopilot/edge-autopilot`, hasPackageJson: true, hasTasks: true },
    { name: 'edge-oracle', path: `${PROJECTS_ROOT}/edge-oracle`, hasPackageJson: true, hasTasks: false },
    { name: 'edge-cms', path: `${PROJECTS_ROOT}/edge-cms`, hasPackageJson: true, hasTasks: false },
  ];

  return projects;
}

export async function getProjectTasks(projectPath: string): Promise<string[]> {
  // Would scan project/tasks/*.yaml files
  const tasksPath = `${projectPath}/tasks`;
  // Return mock data for now
  return [
    'presentation-studio-integration.yaml',
    'firestore-to-supabase-phase2.yaml',
    'firestore-to-supabase-phase3.yaml',
  ];
}

export function getProjectsRoot(): string {
  return PROJECTS_ROOT;
}
