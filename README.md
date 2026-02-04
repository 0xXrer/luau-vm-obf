# Luau VM Obfuscator MVP (Project Skeleton)

This is a minimal, production-oriented skeleton for a Luau VM-based obfuscator:
- `spec/` defines ISA + blob format.
- `compiler/` builds a blob (code + const pool).
- `runtime/` executes the blob via a small VM.
- `tools/orchestrator/` is an agent-team orchestrator that expects models to output `git diff`.

This is **MVP**, not "Luraph level" yet.

## Quick start

```bash
npm i
npm run build
npm test
npm run metrics
```

## Repo layout

- `spec/isa.md` — ISA definition (v0).
- `spec/blob.md` — blob layout (v0).
- `compiler/blob.lua` — blob packer.
- `runtime/vm.lua` — VM executor (few ops).
- `tools/tests/run.js` — sanity tests.
- `tools/metrics/run.js` — size + perf-ish metrics placeholder.
- `tools/orchestrator/` — multi-role orchestrator (Architect/Compiler/VM/Redteam/QA/Release).

## Notes

- This skeleton uses plain Lua-compatible code for runtime/compiler modules.
- You can run the Lua parts with any Lua 5.1+ runtime that has `bit32` (or adapt).
