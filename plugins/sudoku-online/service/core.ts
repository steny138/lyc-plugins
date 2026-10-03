/**
 * 共同服務核心：純函式，不碰 Node 也不碰引擎。
 * Node 外殼（server.ts）與引擎測試都把請求交給同一份 `handle`。
 */

export type Request = { method: string; path: string; body?: string }
export type Response = { status: number; text: string }
export type Service = { handle: (request: Request) => Response }

const json = (status: number, value: unknown): Response => ({ status, text: JSON.stringify(value) })

export const createService = (instanceId: string): Service => {
  let count = 0

  return {
    handle: ({ method, path }) => {
      if (method === 'GET' && path === '/state') return json(200, { instanceId, count })
      if (method === 'POST' && path === '/bump') {
        count += 1

        return json(200, { instanceId, count })
      }

      return json(404, { error: 'not found' })
    },
  }
}
