/**
 * WebSocket client — singleton that connects to the backend WS endpoint.
 * Authenticates via JWT token stored in localStorage.
 * Pages use: wsClient.on('incident.created', handler)
 */

type Handler = (data: any) => void

class WebSocketClient {
  private ws: WebSocket | null = null
  private handlers: Map<string, Set<Handler>> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 2000
  private maxDelay = 30000
  private shouldConnect = false

  connect() {
    this.shouldConnect = true
    this._connect()
  }

  private _connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return

    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    if (!token) return // not logged in yet

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const wsBase = apiUrl.replace(/^http/, 'ws')
    const url = `${wsBase}/ws?token=${encodeURIComponent(token)}`

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.reconnectDelay = 2000 // reset backoff
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'ping') return
          const listeners = this.handlers.get(msg.type)
          if (listeners) listeners.forEach(fn => fn(msg.data))
          // also fire wildcard listeners
          const wildcards = this.handlers.get('*')
          if (wildcards) wildcards.forEach(fn => fn(msg))
        } catch {}
      }

      this.ws.onclose = () => {
        this.ws = null
        if (this.shouldConnect) this._scheduleReconnect()
      }

      this.ws.onerror = () => {
        this.ws?.close()
      }
    } catch {}
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxDelay)
      this._connect()
    }, this.reconnectDelay)
  }

  disconnect() {
    this.shouldConnect = false
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.ws?.close()
    this.ws = null
  }

  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler)
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

export const wsClient = new WebSocketClient()

// React hook for components that need connection status
export { type Handler }
