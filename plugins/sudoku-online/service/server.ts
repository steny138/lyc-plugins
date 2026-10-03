/**
 * 共同服務的 Node 外殼：只負責 HTTP，請求一律交給 core.ts 的 handle。
 * 由房主的 mod 以 `$.process.spawn` 啟動（ADR 0001）。
 *
 * 啟動成功時在 stdout 印出一行 JSON：`{ port, addresses }`（addresses 為區網 IPv4）；
 * 埠被佔用等失敗時把原因印到 stderr，並以非 0 結束。
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'

import { createService } from './core.ts'

/** 共同服務的固定預設埠；被佔用時啟動失敗，不自動換埠 */
const DEFAULT_PORT = 47900

const service = createService(randomUUID(), { newCredential: randomUUID })

const server = createServer((req, res) => {
  let body = ''
  req.setEncoding('utf8')
  req.on('data', chunk => (body += chunk))
  req.on('end', () => {
    const { status, text } = service.handle({ method: req.method ?? 'GET', path: req.url ?? '/', body })
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(text)
  })
})

/** 本機對區網的 IPv4 位址 */
const lanAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .flatMap(info => (info && info.family === 'IPv4' && !info.internal ? [info.address] : []))

server.on('error', error => {
  console.error(error.message)
  process.exit(1)
})

server.listen(DEFAULT_PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ port: DEFAULT_PORT, addresses: lanAddresses() }))
})
