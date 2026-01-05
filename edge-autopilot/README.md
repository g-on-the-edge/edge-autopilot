# Edge Autopilot 🤖

**AI Agent Supervisor for Claude Code** - Runs as "you" to orchestrate coding sessions.

## What is this?

Edge Autopilot is a supervisor layer that sits on top of Claude Code, allowing you to:

1. **Autopilot Mode**: Queue up tasks and let them run overnight. Auto-accepts routine actions, pauses on risky ones.
2. **Copilot Mode**: Real-time acceleration. Auto-accepts the boring stuff, alerts you on decisions.

## Features (v2)

- 🤖 **Smart Detection** - ML-like action classification with risk scoring
- 💬 **Slack Notifications** - Rich messages with interactive approve/deny buttons
- 📧 **Email Notifications** - Session summaries, critical alerts, daily digests
- 📊 **Real-time Dashboard** - Mobile-friendly PWA for monitoring sessions
- 🐙 **GitHub Integration** - Actions workflows, PR automation, issue creation
- 🛡️ **Safety Rails** - Protected paths, risk thresholds, auto-stop conditions
- 📝 **Full Logging** - Every action recorded with risk analysis

## Quick Start

```bash
# Install dependencies
npm install

# Open the Command Center (easy mode)
npm run command-center
# UI opens at http://localhost:3848

# Set up Slack (optional)
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."

# Start copilot mode with dashboard
npm run copilot
# Dashboard at http://localhost:3847

# Run overnight with task queue
npm run autopilot -- --tasks ./tasks/my-queue.yaml

# Single task with auto-accept
npm run autopilot -- run "Add dark mode support to the dashboard"
```

## Command Center (easy mode)

If you want the “dummy-proof” UI:

- Run `npm run command-center` (starts the UI + local API)
- In the UI: 1) pick a project 2) add tasks 3) press “Run All”

If you’re using the VS Code extension, you can also click the status bar button:

- “Command Center” button (bottom-right) → starts it + opens the UI

## Dashboard

Access the real-time dashboard at `http://localhost:3847` when running:

- **Live action feed** with risk indicators
- **Task queue** visualization
- **Session stats** (tasks, actions, errors)
- **Risk distribution** chart
- **Pause/Resume** controls
- **Session insights** (most edited files, command frequency)

## Slack Integration

Set your webhook URL and get rich notifications:

```yaml
# config.yaml
notifications:
  slack:
    enabled: true
    webhook_url: ${SLACK_WEBHOOK_URL}
    channel: "#autopilot"
```

You'll receive:
- 🚀 Session start/end summaries
- 📋 Task progress updates
- ⚠️ Approval requests with interactive buttons
- ❌ Error alerts with retry options

## Smart Detection

Actions are analyzed with multiple factors:

```
file_delete + recursive flag + glob pattern = HIGH RISK (0.85)
file_edit + config file + high frequency = MEDIUM RISK (0.55)
npm_install + dev dependency = LOW RISK (0.25)
```

Configure thresholds in `config.yaml`:

```yaml
detection:
  risk_thresholds:
    auto_deny: 0.9       # Automatically block
    require_approval: 0.7 # Must approve manually
    warn: 0.5            # Log warning but allow
```

## Mobile Dashboard (PWA)

The dashboard is now a Progressive Web App:
- **Install on phone** - Add to home screen from Safari/Chrome
- **Works offline** - Service worker caches the UI
- **Touch optimized** - Swipe gestures, haptic feedback
- **Bottom navigation** - Easy thumb access to all views
- **Pull to refresh** - Native-feeling updates
- **Approval modals** - Approve/deny actions from your phone

## Email Notifications

Get email alerts for important events:

```yaml
notifications:
  email:
    enabled: true
    smtp:
      host: smtp.example.com
      port: 587
      user: ${SMTP_USER}
      pass: ${SMTP_PASS}
    from: "Autopilot <autopilot@example.com>"
    to: you@example.com
    send_on:
      - session_complete
      - task_failed  
      - critical_action
      - daily_digest
```

Email types:
- **Session Summary** - Stats, insights, success rate
- **Critical Alert** - High-risk actions needing attention
- **Approval Request** - Actions waiting for your decision
- **Daily Digest** - Overview of all sessions that day

## GitHub Actions Integration

### Scheduled Runs (Overnight Automation)

```yaml
# .github/workflows/autopilot-scheduled.yml
on:
  schedule:
    - cron: '0 2 * * 1-5'  # 2 AM UTC weekdays
  workflow_dispatch:
    inputs:
      task_file:
        default: 'tasks/nightly-queue.yaml'
```

Trigger manually from GitHub Actions UI or run on schedule.

### PR Review Automation

Automatically review PRs and respond to commands:

```
/autopilot fix     # Auto-fix review suggestions
/autopilot test    # Generate tests for changes
/autopilot docs    # Update documentation
/autopilot <task>  # Run any custom task
```

### On-Demand Tasks via API

Trigger tasks programmatically:

```bash
# Via GitHub API
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{"event_type":"autopilot-task","client_payload":{"task":"Add unit tests"}}'
```

### Environment Variables

Set these secrets in your GitHub repo:

```
ANTHROPIC_API_KEY    # Claude API key
SLACK_WEBHOOK_URL    # Slack notifications
SMTP_HOST            # Email server
SMTP_USER            # Email username
SMTP_PASS            # Email password
EMAIL_TO             # Recipient email
GITHUB_TOKEN         # For API calls (auto-provided in Actions)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Edge Autopilot v2.1                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────┐    ┌──────────────┐    ┌────────────────┐       │
│  │  CLI/API  │───▶│  Supervisor  │───▶│  Claude Code   │       │
│  └───────────┘    └──────┬───────┘    └────────────────┘       │
│                          │                                      │
│         ┌────────────────┼────────────────┐                    │
│         ▼                ▼                ▼                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Smart     │  │  Dashboard  │  │  Notifiers  │            │
│  │  Detector   │  │    (PWA)    │  │             │            │
│  └─────────────┘  └─────────────┘  └──────┬──────┘            │
│                                           │                    │
│                        ┌──────────────────┼──────────────────┐ │
│                        ▼                  ▼                  ▼ │
│                 ┌───────────┐      ┌───────────┐      ┌──────┐│
│                 │   Slack   │      │   Email   │      │GitHub││
│                 └───────────┘      └───────────┘      └──────┘│
│                                                                 │
│         ┌───────────────────────────────────────────┐          │
│         │              GitHub Actions               │          │
│         │  ┌─────────┐ ┌─────────┐ ┌─────────────┐ │          │
│         │  │Schedule │ │PR Review│ │ On-Demand   │ │          │
│         │  └─────────┘ └─────────┘ └─────────────┘ │          │
│         └───────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

Built for Edge Oracle @ Emplify Health

## Modes

### Autopilot Mode (Background/Overnight)

Perfect for:
- Overnight refactoring sessions
- Bulk documentation updates
- Test coverage improvements
- Code cleanup and linting fixes

```bash
# Run the example queue
npm run autopilot

# Run with dry-run to see what would happen
npm run autopilot -- --dry-run

# Custom task file
npm run autopilot -- --tasks ./my-tasks.yaml
```

### Copilot Mode (Real-time)

Perfect for:
- Speeding up your normal workflow
- Auto-accepting routine file edits
- Getting notifications for important decisions

```bash
npm run copilot
```

In copilot mode:
- Type any prompt to run it through Claude Code
- Use `/pause` to stop auto-accepting
- Use `/status` to see session stats
- Use `/quit` to exit

## Configuration

Edit `config.yaml` to customize behavior:

```yaml
# What actions to auto-accept
autopilot:
  auto_accept:
    - file_create
    - file_edit
    - terminal_command
  
  # Always pause for these
  require_approval:
    - file_delete
    - git_push
    - database_migration

# Context injected into every prompt
context:
  project_standards: |
    - Use TypeScript for all new files
    - Follow existing patterns
    
  current_focus: |
    Working on Edge Oracle platform
```

## Task Queue Format

Create YAML files in `./tasks/`:

```yaml
tasks:
  - id: my-task
    priority: high  # high | normal | low
    description: Short description for logs
    prompt: |
      The actual prompt for Claude Code.
      Be specific about what you want done.
    context: |
      Additional context about the codebase,
      relevant files, or constraints.
```

## Safety Features

- **Protected Paths**: Won't touch `.env` files or secrets
- **Action Limits**: Max changes per session
- **Stop Conditions**: Halts on errors or unknown actions
- **Dry Run**: Preview what would happen
- **Full Logging**: Every action recorded for review

## Logs

All sessions are logged to `./logs/`:
- `session-{timestamp}.log` - Human-readable log
- `session-{timestamp}.json` - Machine-readable for analysis
- `summary-{timestamp}.json` - Session statistics

## How It Works

1. **Spawns Claude Code** with your prompt
2. **Monitors Output** for action patterns (file edits, commands, etc.)
3. **Classifies Actions** using pattern matching
4. **Applies Rules** from your config
5. **Auto-responds** or pauses based on action type
6. **Logs Everything** for your review

## CLI Commands

```bash
# Run task queue
autopilot autopilot [--tasks <file>] [--dry-run]

# Interactive mode
autopilot copilot [--project <path>]

# Single task
autopilot run "<prompt>" [--auto]

# Add task to queue
autopilot add-task "<description>" [--priority high|normal|low]

# View status
autopilot status

# View logs
autopilot logs [-n 50] [-f]
```

## Requirements

- Node.js 18+
- Claude Code CLI installed and authenticated

## Tips for Best Results

1. **Be Specific**: Detailed prompts get better results
2. **Set Context**: Use the context field to give Claude knowledge about your codebase
3. **Start Small**: Test with `--dry-run` first
4. **Review Logs**: Check what happened before the next run
5. **Iterate**: Refine your task definitions based on results

## Example Workflow

**Morning:**
```bash
# Check what ran overnight
autopilot logs -n 100

# Review any paused actions
autopilot status
```

**During the Day:**
```bash
# Speed up your workflow
npm run copilot
```

**Evening:**
```bash
# Queue up overnight work
autopilot add-task "Refactor auth module to use new API" --priority high
autopilot add-task "Add unit tests to utils/" --priority normal

# Start the overnight run
npm run autopilot
```

---

Built for Edge Oracle @ Emplify Health
