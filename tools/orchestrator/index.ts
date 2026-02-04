import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

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

const validIndexLine = /^index [0-9a-f]{7,}\.\.[0-9a-f]{7,}( [0-7]{6})?$/
const validModeLine = /^(new file mode|deleted file mode|old mode|new mode) [0-7]{6}$/
const validSimilarityLine = /^(similarity index|dissimilarity index) \d+%$/

function normalizePatch(patch: string): { text: string; changed: boolean } {
  const lines = patch.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []
  let changed = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === "```" || trimmed === "```diff" || trimmed === "```patch") {
      changed = true
      continue
    }

    if (trimmed === "..." || trimmed === "^...") {
      changed = true
      continue
    }

    if (line.startsWith("index ") && !validIndexLine.test(line)) {
      changed = true
      continue
    }

    if ((line.startsWith("new file mode ") || line.startsWith("deleted file mode ") || line.startsWith("old mode ") || line.startsWith("new mode ")) && !validModeLine.test(line)) {
      changed = true
      continue
    }

    if ((line.startsWith("similarity index ") || line.startsWith("dissimilarity index ")) && !validSimilarityLine.test(line)) {
      changed = true
      continue
    }

    out.push(line)
  }

  const firstPatchLine = out.findIndex(line => line.startsWith("diff --git ") || line.startsWith("--- "))
  if (firstPatchLine > 0) {
    out.splice(0, firstPatchLine)
    changed = true
  }

  return { text: `${out.join("\n").trim()}\n`, changed }
}

function isPatchLike(text: string): boolean {
  const hasGitDiff = /^diff --git /m.test(text)
  if (hasGitDiff) return true

  const hasUnifiedMarkers = /^--- /m.test(text) && /^\+\+\+ /m.test(text) && /^@@ /m.test(text)
  return hasUnifiedMarkers
}

function canApplyPatch(path: string): boolean {
  try {
    sh(`git apply --check --whitespace=nowarn "${path}"`)
    return true
  } catch {
    return false
  }
}

type MaterializedFile = { path: string; content: string }

function normalizeDiffPath(rawPath: string): string | null {
  if (!rawPath || rawPath === "/dev/null") return null
  const path = rawPath.replace(/^[ab]\//, "").replace(/\\/g, "/")
  if (!path || path.startsWith("/") || path.split("/").includes("..")) return null
  return path
}

function parseAddOnlyPatchFiles(patch: string): { files: MaterializedFile[]; isFullyAddOnly: boolean } {
  const lines = patch.replace(/\r\n/g, "\n").split("\n")
  const files: MaterializedFile[] = []
  let hasUnsupported = false

  let currentPath: string | null = null
  let currentLines: string[] = []
  let sawHunk = false
  let isAddOnly = true

  const flush = () => {
    if (currentPath && sawHunk && isAddOnly) {
      files.push({ path: currentPath, content: `${currentLines.join("\n")}\n` })
    }
    if (currentPath && sawHunk && !isAddOnly) hasUnsupported = true
    currentPath = null
    currentLines = []
    sawHunk = false
    isAddOnly = true
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ") || line.startsWith("--- ")) {
      flush()
      continue
    }

    if (line.startsWith("+++ ")) {
      flush()
      currentPath = normalizeDiffPath(line.slice(4).trim())
      continue
    }

    if (!currentPath) continue

    if (line.startsWith("@@ ")) {
      sawHunk = true
      if (!/^@@ -0,0 \+\d+(,\d+)? @@/.test(line)) isAddOnly = false
      continue
    }

    if (!sawHunk) continue
    if (line.startsWith("+")) {
      currentLines.push(line.slice(1))
      continue
    }

    if (line === "\\ No newline at end of file") continue
    isAddOnly = false
  }

  flush()
  return { files, isFullyAddOnly: files.length > 0 && !hasUnsupported }
}

function materializeAddOnlyPatch(patch: string): number {
  const parsed = parseAddOnlyPatchFiles(patch)
  if (!parsed.isFullyAddOnly) return 0

  const files = parsed.files
  for (const f of files) {
    const abs = join(repoRoot, f.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content, "utf8")
  }
  return files.length
}

function applyPatch(patch: string) {
  const p = join(scratchDir, "patch.diff")
  const normalized = normalizePatch(patch)
  if (!normalized.text.trim()) throw new Error("Patch was empty after normalization")
  if (!isPatchLike(normalized.text)) throw new Error("Model response did not contain a valid unified diff")

  if (normalized.changed) {
    console.error("[orchestrator] malformed diff detected; retrying with normalized patch")
  }
  writeFileSync(p, normalized.text, "utf8")

  if (canApplyPatch(p)) {
    shInherit(`git apply --whitespace=nowarn "${p}"`)
    return
  }

  const materialized = materializeAddOnlyPatch(normalized.text)
  if (materialized > 0) {
    console.error(`[orchestrator] applied ${materialized} file(s) from add-only patch fallback`)
    return
  }

  throw new Error("Patch parse succeeded but changes do not apply to the current repository state")
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
  const m = output.match(/```(?:diff|patch)\s*([\s\S]*?)```/im)
  if (m?.[1] && isPatchLike(m[1])) return m[1].trim() + "\n"

  const diffStart = output.search(/^diff --git /m)
  if (diffStart >= 0) return output.slice(diffStart).trim() + "\n"

  const unifiedStart = output.search(/^--- /m)
  if (unifiedStart >= 0) {
    const candidate = output.slice(unifiedStart).trim() + "\n"
    if (isPatchLike(candidate)) return candidate
  }

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
