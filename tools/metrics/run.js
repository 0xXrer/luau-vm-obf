import { statSync } from "node:fs"
import { join } from "node:path"

const files = [
  "runtime/vm.lua",
  "compiler/blob.lua",
]

let total = 0
for (const f of files) {
  const s = statSync(join(process.cwd(), f)).size
  total += s
}

console.log("metrics:size_bytes", total)
if (total > 64 * 1024) {
  console.error("metrics gate failed: runtime/compiler too big")
  process.exit(1)
}
