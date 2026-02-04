import "dotenv/config"
import { orchestrate, type Llm } from "./index.js"

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error("OPENROUTER_API_KEY missing")

const model = process.env.OPENROUTER_MODEL || "qwen/qwen3-coder:free"
const siteUrl = process.env.OPENROUTER_SITE_URL || "http://localhost"
const appName = process.env.OPENROUTER_APP_NAME || "luau-vm-obf"

async function chat(messages: { role: "system" | "user"; content: string }[]) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": siteUrl,
      "X-Title": appName,
    },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.2,
    }),
  })

  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`)

  const j: any = await res.json()
  const text = j?.choices?.[0]?.message?.content
  if (!text) throw new Error("No text in OpenRouter response")
  return text
}

const llm: Llm = {
  async complete({ messages }) {
    return chat(messages)
  },
}

orchestrate(llm).catch((e) => {
  console.error(String(e?.stack || e))
  process.exit(1)
})
