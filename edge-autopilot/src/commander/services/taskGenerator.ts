import type { Task, TaskTemplate } from '../types';

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'migrate',
    name: 'Migrate',
    icon: 'ArrowRightLeft',
    description: 'Database or API migration tasks',
    promptTemplate: `Migrate {source} to {target}:

1. Analyze current {source} implementation
2. Create migration plan
3. Implement migration with rollback support
4. Verify data integrity
5. Document changes

Do not ask questions - just do it.`,
  },
  {
    id: 'audit',
    name: 'Audit',
    icon: 'ClipboardCheck',
    description: 'Code quality and security audits',
    promptTemplate: `Audit the codebase for {focus}:

1. Scan all relevant files
2. Identify issues and vulnerabilities
3. Create ./audit/{focus}-audit.md with findings
4. Prioritize issues by severity
5. Suggest fixes for critical issues

Do not ask questions - just do it.`,
  },
  {
    id: 'fix',
    name: 'Fix',
    icon: 'Wrench',
    description: 'Bug fixes and error resolution',
    promptTemplate: `Fix {issue}:

1. Locate the source of the issue
2. Analyze root cause
3. Implement fix with minimal changes
4. Verify fix doesn't break existing functionality
5. Add error handling if needed

Do not ask questions - just do it.`,
  },
  {
    id: 'feature',
    name: 'Feature',
    icon: 'Sparkles',
    description: 'New feature implementation',
    promptTemplate: `Implement {feature}:

1. Plan the implementation approach
2. Create necessary files and components
3. Implement core functionality
4. Add proper error handling
5. Update routes/navigation if needed
6. Run build to verify

Do not ask questions - just do it.`,
  },
  {
    id: 'refactor',
    name: 'Refactor',
    icon: 'RefreshCw',
    description: 'Code refactoring and cleanup',
    promptTemplate: `Refactor {target}:

1. Analyze current implementation
2. Identify improvement opportunities
3. Refactor with clean code principles
4. Ensure no functionality is broken
5. Run tests and build

Do not ask questions - just do it.`,
  },
  {
    id: 'test',
    name: 'Test',
    icon: 'TestTube',
    description: 'Test creation and coverage',
    promptTemplate: `Add tests for {target}:

1. Identify testable units
2. Create test files following project conventions
3. Write unit tests for core logic
4. Add integration tests if applicable
5. Run tests and ensure they pass

Do not ask questions - just do it.`,
  },
];

let taskIdCounter = 0;

export function generateTaskId(): string {
  return `task-${Date.now()}-${++taskIdCounter}`;
}

export function parseNaturalLanguageToTasks(description: string, projectName: string): Task[] {
  const lines = description.trim().split('\n').filter(line => line.trim());
  const tasks: Task[] = [];

  for (const line of lines) {
    const trimmed = line.replace(/^[\d\-\*\.\)]+\s*/, '').trim();
    if (!trimmed) continue;

    tasks.push({
      id: generateTaskId(),
      description: trimmed,
      prompt: `In ${projectName}, ${trimmed.toLowerCase()}:

1. Analyze what needs to be done
2. Implement the changes
3. Verify the implementation works
4. Run build to check for errors

Do not ask questions - just do it.`,
      status: 'pending',
    });
  }

  return tasks;
}

export function applyTemplate(template: TaskTemplate, variables: Record<string, string>, projectName: string): Task {
  let prompt = template.promptTemplate;

  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  prompt = `In ${projectName}, ${prompt}`;

  return {
    id: generateTaskId(),
    description: `${template.name}: ${Object.values(variables).join(' ')}`,
    prompt,
    status: 'pending',
  };
}

export function generateYamlFromTasks(name: string, tasks: Task[]): string {
  const yaml = [`name: ${name}`, 'tasks:'];

  for (const task of tasks) {
    yaml.push(`  - id: ${task.id}`);
    yaml.push(`    description: ${task.description}`);
    yaml.push(`    prompt: |`);
    const promptLines = task.prompt.split('\n');
    for (const line of promptLines) {
      yaml.push(`      ${line}`);
    }
  }

  return yaml.join('\n');
}
