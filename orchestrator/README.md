# Agent Workflow

Each agent works on a feature branch named `agent/<role>/<task-id>`.

Commit format: `[AgentName]: <message>`

After each major feature, open a PR targeting `main`.

Logging

Send JSON logs to `tools/log-action.js` via stdin.

Example:

{ "timestamp": "2026-02-05T12:00:00Z", "agent": "VM Engineer", "action": "implemented", "artifact": "bytecode parser", "files": ["packages/vm/src/bytecode.ts"], "status": "done", "next": "runtime core" }
