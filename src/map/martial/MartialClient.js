/** Thrown when the back end can't be reached at all (not started, or the dev proxy failed). */
export class BackendOfflineError extends Error {
  constructor() {
    super('I can’t reach mission control. Start the back end with “python -m backend.server” and try again.')
    this.name = 'BackendOfflineError'
  }
}

/**
 * Talks to the Martial agent served by backend/server.py (the Vite dev server forwards /api to it).
 */
export class MartialClient {
  /** @param {string} baseUrl prefix of the agent's endpoints */
  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl
  }

  /** { ollama, model, model_installed } from the back end, or { backend: false } if it is down. */
  async health() {
    try {
      const r = await fetch(`${this.baseUrl}/health`)
      if (!r.ok) throw new Error()
      return await r.json()
    } catch {
      return { backend: false }
    }
  }

  /**
   * Sends one request about a site. Resolves to { skill, source, reply, highlight?, route? }.
   * Throws BackendOfflineError, an Error with the back end's message, or an AbortError.
   */
  async ask({ siteId, message, routes, signal }) {
    let res
    try {
      res = await fetch(`${this.baseUrl}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          site: siteId,
          message,
          routes: routes.map((r) => ({ id: r.id, name: r.name, kind: r.kind, cells: r.cells })),
        }),
      })
    } catch (e) {
      if (e.name === 'AbortError') throw e
      throw new BackendOfflineError()
    }
    const body = await res.json().catch(() => null)
    if (!body) throw new BackendOfflineError() // the dev server's proxy could not reach the back end
    if (!res.ok || !body.reply) throw new Error(body.error ?? `The back end answered ${res.status}.`)
    return body
  }
}

export const martialClient = new MartialClient()
