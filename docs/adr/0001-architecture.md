# ADR 0001: Architecture

Status: Draft

Decision

Monorepo with workspace packages: architecture, vm, obfuscator, cli. TypeScript only. Build via `tsc -b` with project references.

Consequences

Clear module boundaries and independent build targets. Shared types live in `packages/architecture`.
