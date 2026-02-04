import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

type Role = "architect" | "compiler" | "vm" | "redteam" | "qa" | "release"

type Task = {
  id: string
  title: string
  role: Role
  goal: string
  constraints: string[]
  done: string[]
  filesHint: string[]
}

type LlmMessage = { role: "system" | "user"; content: string }

export type Llm = {
  complete(input: { messages: LlmMessage[]; temperature?: number }): Promise<string>
}

const shInherit = (cmd: string) => execSync(cmd, { stdio: "inherit" })
const sh = (cmd: string) => execSync(cmd, { stdio: "pipe" }).toString("utf8")

const repoRoot = process.cwd()
const scratchDir = join(repoRoot, ".agent-scratch")

function ensureScratch() {
  if (!existsSync(scratchDir)) mkdirSync(scratchDir, { recursive: true })
}

function gitClean() {
  shInherit("git reset --hard")
  shInherit("git clean -fd")
}

function applyPatch(patch: string) {
  const p = join(scratchDir, "patch.diff")
  writeFileSync(p, patch, "utf8")
  shInherit(`git apply --whitespace=nowarn "${p}"`)
}

function getDiff(): string {
  return sh("git diff --patch")
}

function runChecks() {
  shInherit("npm test")
  shInherit("npm run metrics")
}

function mkIssueText(t: Task) {
  return [
    `GOAL:\n${t.goal}`,
    `CONSTRAINTS:\n- ${t.constraints.join("\n- ")}`,
    `DEFINITION_OF_DONE:\n- ${t.done.join("\n- ")}`,
    `FILES_HINT:\n- ${t.filesHint.join("\n- ")}`,
  ].join("\n\n")
}

function loadPrompt(role: Role): string {
  return readFileSync(join(repoRoot, "tools/orchestrator/prompts", `${role}.txt`), "utf8")
}

function extractPatch(output: string): string | null {
  const m = output.match(/```diff\s*([\s\S]*?)```/m)
  if (m?.[1]) return m[1].trim() + "\n"
  const m2 = output.match(/(^diff --git[\s\S]*)$/m)
  if (m2?.[1]) return m2[1].trim() + "\n"
  return null
}

async function runRole(llm: Llm, task: Task) {
  const system = loadPrompt(task.role)
  const user = mkIssueText(task)

  const out = await llm.complete({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  })

  const patch = extractPatch(out)
  if (!patch) throw new Error(`No patch produced by role=${task.role}`)

  applyPatch(patch)

  const diff = getDiff()
  if (!diff.trim()) throw new Error(`Empty diff after applying patch role=${task.role}`)

  shInherit("git add -A")
  shInherit(`git commit -m "agent(${task.role}): ${task.title}"`)
}

export async function orchestrate(llm: Llm) {
  ensureScratch()
  gitClean()

  const tasks: Task[] = [
    {
      id: "t1",
      title: "ISA v0 + blob spec",
      role: "architect",
      goal: "Define VM ISA v0 and blob format for Luau virtualization MVP.",
      constraints: ["No semantic breaking.", "Small runtime."],
      done: ["spec updated", "versioned formats"],
      filesHint: ["spec/isa.md", "spec/blob.md"],
    },
    {
      id: "t2",
      title: "Compiler emits blob",
      role: "compiler",
      goal: "Implement Luau->IR->VIR lowering and blob encoder for ISA v0.",
      constraints: ["Must pass tests", "Keep code minimal"],
      done: ["compiler builds", "tests added"],
      filesHint: ["compiler/**", "tests/**"],
    },
    {
      id: "t3",
      title: "Runtime VM executes blob",
      role: "vm",
      goal: "Implement Luau VM runtime that decodes blob and executes ISA v0.",
      constraints: ["No global state leaks", "Keep runtime small"],
      done: ["runtime works", "tests pass"],
      filesHint: ["runtime/**", "tests/**"],
    },
    {
      id: "t4",
      title: "Redteam detectors",
      role: "redteam",
      goal: "Implement internal detector tooling for current VM.",
      constraints: ["Fast", "Minimal deps"],
      done: ["tools/redteam exists", "reports score"],
      filesHint: ["tools/redteam/**"],
    },
    {
      id: "t5",
      title: "Fuzzer + shrinker",
      role: "qa",
      goal: "Add deterministic fuzz tests for VM vs reference.",
      constraints: ["Deterministic seeds", "Fast for CI"],
      done: ["fuzz runs", "shrinks failures"],
      filesHint: ["tools/tests/**"],
    },
    {
      id: "t6",
      title: "Metrics gates",
      role: "release",
      goal: "Add metrics gates for size/perf/redteam score.",
      constraints: ["Fail fast", "Report numbers"],
      done: ["npm run metrics works"],
      filesHint: ["tools/metrics/**"],
    },
  ]

  for (const t of tasks) {
    await runRole(llm, t)
    runChecks()
  }

  shInherit("git log --oneline -n 20")
}
