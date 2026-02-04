import { readFileSync } from "node:fs"
import { join } from "node:path"

const must = (cond, msg) => { if (!cond) throw new Error(msg) }

const isa = readFileSync(join(process.cwd(), "spec/isa.md"), "utf8")
const blob = readFileSync(join(process.cwd(), "spec/blob.md"), "utf8")

must(isa.includes("ISA v0"), "missing ISA spec")
must(blob.includes("Blob v0"), "missing blob spec")

console.log("tests: ok")
