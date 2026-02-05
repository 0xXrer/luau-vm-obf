import { appendFile } from 'node:fs/promises'
import { WebSocket } from 'ws'

const input = await new Promise((resolve) => {
  let data = ''
  process.stdin.on('data', (c) => (data += c))
  process.stdin.on('end', () => resolve(data))
})

const event = input ? JSON.parse(input) : null
if (!event) {
  process.exit(0)
}

const line = JSON.stringify(event) + '\n'
await appendFile(new URL('../orchestrator/log.jsonl', import.meta.url), line)

const wsUrl = process.env.LOG_WS
if (wsUrl) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.on('open', () => {
      ws.send(line, () => {
        ws.close()
        resolve(null)
      })
    })
    ws.on('error', reject)
  })
}
