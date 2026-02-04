import "dotenv/config"
import { orchestrate, type Llm } from "./index.js"

type ChatMessage = { role: "system" | "user"; content: string }

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

class OpenRouterHttpError extends Error {
  constructor(
    readonly status: number,
    readonly model: string,
    readonly bodyText: string,
    readonly retryAfterMs: number | null,
  ) {
    super(`OpenRouter ${status} (${model}): ${bodyText}`)
  }
}

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error("OPENROUTER_API_KEY missing")

const primaryModel = process.env.OPENROUTER_MODEL || "qwen/qwen3-coder:free"
const fallbackModels = (process.env.OPENROUTER_FALLBACK_MODELS || "")
  .split(",")
  .map(m => m.trim())
  .filter(Boolean)

const models = Array.from(new Set([primaryModel, ...fallbackModels]))
const siteUrl = process.env.OPENROUTER_SITE_URL || "http://localhost"
const appName = process.env.OPENROUTER_APP_NAME || "luau-vm-obf"
const maxRetries = parseNonNegativeInt(process.env.OPENROUTER_MAX_RETRIES, 2)
const retryBaseMs = parseNonNegativeInt(process.env.OPENROUTER_RETRY_BASE_MS, 1500)

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value || "", 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000))

  const asDate = Date.parse(value)
  if (Number.isNaN(asDate)) return null
  return Math.max(0, asDate - Date.now())
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OpenRouterHttpError) {
    return err.status === 408 || err.status === 409 || err.status === 425 || err.status === 429 || err.status >= 500
  }
  return true
}

function shouldFallback(err: unknown): boolean {
  if (err instanceof OpenRouterHttpError) {
    return err.status === 404 || err.status === 429 || err.status >= 500
  }
  return true
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err
  return new Error(String(err))
}

async function request(model: string, messages: ChatMessage[], temperature = 0.2): Promise<string> {
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
      temperature,
    }),
  })

  if (!res.ok) {
    const bodyText = await res.text()
    throw new OpenRouterHttpError(
      res.status,
      model,
      bodyText,
      parseRetryAfterMs(res.headers.get("retry-after")),
    )
  }

  const j = await res.json() as CompletionResponse
  const text = j?.choices?.[0]?.message?.content
  if (!text) throw new Error("No text in OpenRouter response")
  return text
}

async function chat(messages: ChatMessage[], temperature = 0.2) {
  let lastErr: unknown

  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const model = models[modelIdx]

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await request(model, messages, temperature)
      } catch (err) {
        lastErr = err
        const canRetry = isRetryable(err) && attempt < maxRetries
        if (!canRetry) break

        const retryAfterMs = err instanceof OpenRouterHttpError ? err.retryAfterMs : null
        const waitMs = retryAfterMs ?? retryBaseMs * 2 ** attempt
        console.error(`[orchestrator] ${formatError(err)}; retrying in ${waitMs}ms`)
        await sleep(waitMs)
      }
    }

    const hasFallback = modelIdx < models.length - 1
    if (hasFallback && shouldFallback(lastErr)) {
      console.error(`[orchestrator] model=${model} failed; trying fallback model`)
      continue
    }

    break
  }

  throw toError(lastErr)
}

const llm: Llm = {
  async complete({ messages, temperature }) {
    return chat(messages, temperature)
  },
}

orchestrate(llm).catch((e) => {
  console.error(String(e?.stack || e))
  process.exitCode = 1
})
