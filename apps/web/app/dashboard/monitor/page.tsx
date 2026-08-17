'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatRelativeTime } from '@/lib/utils'

interface CheckResult {
  url: string; status: 'up' | 'down' | 'checking'
  statusCode?: number; responseTime?: number; checkedAt: string
  error?: string; version?: string; service?: string
  dependencies?: Record<string, { status: 'up' | 'down'; response_ms?: number; error?: string }>
}
interface HistoryEntry { status: 'up' | 'down'; responseTime?: number; checkedAt: string }
interface DiscoveredEndpoint {
  method: string; path: string; source: string
  status?: number; responseTime?: number; contentType?: string
  liveStatus?: 'up' | 'down' | 'checking' | 'idle'
  liveCode?: number; liveTime?: number
}

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  traffic_interception: { label: 'Traffic', color: '#ff9600' },
  static_analysis: { label: 'JS/HTML', color: '#64b4ff' },
  robots: { label: 'Robots/Sitemap', color: '#00ff88' },
  bruteforce: { label: 'Probe', color: '#ffd700' },
  headers: { label: 'Headers', color: '#c084fc' },
}

function StatusDot({ status }: { status: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
    status === 'checking' ? 'animate-pulse-dot' : ''
  }`} style={{
    background: status === 'up' ? '#00ff88' : status === 'down' ? '#ff4444' : status === 'checking' ? '#ffd700' : '#6b6b7b'
  }} />
}

export default function MonitorPage() {
  const [inputUrl, setInputUrl] = useState('')
  const [monitors, setMonitors] = useState<string[]>([])
  const [results, setResults] = useState<Record<string, CheckResult>>({})
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({})
  const [endpoints, setEndpoints] = useState<Record<string, DiscoveredEndpoint[]>>({})
  const [discovering, setDiscovering] = useState<Record<string, boolean>>({})
  const [expandedEndpoints, setExpandedEndpoints] = useState<Record<string, boolean>>({})
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('kayo_monitors_v4')
    if (saved) { try { setMonitors(JSON.parse(saved)) } catch {} }
  }, [])

  const saveMonitors = (list: string[]) => {
    localStorage.setItem('kayo_monitors_v4', JSON.stringify(list))
    setMonitors(list)
  }

  const checkUrl = useCallback(async (url: string) => {
    setResults(prev => ({ ...prev, [url]: { ...prev[url], url, status: 'checking', checkedAt: new Date().toISOString() } }))
    try {
      const res = await fetch(`/api/monitor/check?url=${encodeURIComponent(url + '/health')}`, { cache: 'no-store' })
      const data = await res.json()
      const entry: CheckResult = {
        url, status: data.ok ? 'up' : 'down', statusCode: data.status_code,
        responseTime: data.response_time_ms, checkedAt: new Date().toISOString(),
        error: data.error, version: data.body?.version, service: data.body?.service,
        dependencies: data.body?.dependencies,
      }
      setResults(prev => ({ ...prev, [url]: entry }))
      setHistory(prev => {
        const h: HistoryEntry = { status: entry.status === 'up' ? 'up' : 'down', responseTime: data.response_time_ms, checkedAt: entry.checkedAt }
        return { ...prev, [url]: [h, ...(prev[url] || [])].slice(0, 40) }
      })
    } catch (e: any) {
      setResults(prev => ({ ...prev, [url]: { url, status: 'down', checkedAt: new Date().toISOString(), error: e.message } }))
    }
  }, [])

  const discoverEndpoints = useCallback(async (url: string) => {
    setDiscovering(prev => ({ ...prev, [url]: true }))
    try {
      const res = await fetch('/api/monitor/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      setEndpoints(prev => ({
        ...prev,
        [url]: (data.endpoints || []).map((ep: any) => ({ ...ep, liveStatus: ep.status ? (ep.status < 400 ? 'up' : 'down') : 'idle' }))
      }))
    } catch {}
    setDiscovering(prev => ({ ...prev, [url]: false }))
  }, [])

  const checkEndpoint = useCallback(async (baseUrl: string, ep: DiscoveredEndpoint) => {
    setEndpoints(prev => ({
      ...prev,
      [baseUrl]: (prev[baseUrl] || []).map(e =>
        e.method === ep.method && e.path === ep.path ? { ...e, liveStatus: 'checking' } : e
      )
    }))
    try {
      const fullUrl = baseUrl.replace(/\/$/, '') + ep.path
      const res = await fetch(`/api/monitor/check?url=${encodeURIComponent(fullUrl)}`, { cache: 'no-store' })
      const data = await res.json()
      setEndpoints(prev => ({
        ...prev,
        [baseUrl]: (prev[baseUrl] || []).map(e =>
          e.method === ep.method && e.path === ep.path
            ? { ...e, liveStatus: data.ok ? 'up' : 'down', liveCode: data.status_code, liveTime: data.response_time_ms }
            : e
        )
      }))
    } catch {}
  }, [])

  const checkAllEndpoints = useCallback(async (baseUrl: string) => {
    const eps = endpoints[baseUrl] || []
    for (const ep of eps.filter(e => e.method === 'GET')) {
      await checkEndpoint(baseUrl, ep)
    }
  }, [endpoints, checkEndpoint])

  useEffect(() => {
    if (!monitors.length) return
    monitors.forEach(url => checkUrl(url))
    if (!autoRefresh) return
    const timer = setInterval(() => monitors.forEach(url => checkUrl(url)), 30000)
    return () => clearInterval(timer)
  }, [monitors, autoRefresh, checkUrl])

  const addMonitor = (e: React.FormEvent) => {
    e.preventDefault()
    let url = inputUrl.trim()
    if (!url) return
    if (!url.startsWith('http')) url = 'https://' + url
    url = url.replace(/\/$/, '')
    if (monitors.includes(url)) { setInputUrl(''); return }
    saveMonitors([...monitors, url])
    setInputUrl('')
    checkUrl(url)
  }

  const removeMonitor = (url: string) => {
    saveMonitors(monitors.filter(u => u !== url))
    setResults(prev => { const n = { ...prev }; delete n[url]; return n })
    setHistory(prev => { const n = { ...prev }; delete n[url]; return n })
    setEndpoints(prev => { const n = { ...prev }; delete n[url]; return n })
  }

  const uptimePercent = (url: string) => {
    const h = history[url] || []
    if (!h.length) return null
    return Math.round((h.filter(e => e.status === 'up').length / h.length) * 100)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-heading font-bold text-white">Backend Monitor</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Monitor health and auto-discover API endpoints via traffic analysis</p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="rounded accent-red-500" />
          Auto-refresh (30s)
        </label>
      </div>

      {/* Add URL */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-semibold text-white mb-3">Add Target</h2>
        <form onSubmit={addMonitor} className="flex gap-3">
          <input
            type="text" value={inputUrl} onChange={e => setInputUrl(e.target.value)}
            placeholder="https://tcetcercd.in or http://localhost:8000"
            className="input-dark flex-1 font-mono text-sm"
          />
          <button type="submit" disabled={!inputUrl.trim()} className="btn-primary disabled:opacity-50 whitespace-nowrap">
            Add & Monitor
          </button>
        </form>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Monitors /health every 30s. Use "Discover Endpoints" to find all routes via traffic interception, JS analysis, and path probing.
        </p>
      </div>

      {monitors.length === 0 ? (
        <div className="glass-card p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          <span className="text-3xl block mb-3 opacity-30">📡</span>
          No targets monitored yet. Add a URL above to start.
        </div>
      ) : (
        <div className="space-y-6">
          {monitors.map(url => {
            const r = results[url]
            const uptime = uptimePercent(url)
            const hist = history[url] || []
            const eps = endpoints[url] || []
            const isDiscovering = discovering[url]
            const isExpanded = expandedEndpoints[url]

            return (
              <div key={url} className="glass-card overflow-hidden animate-fade-in">
                {/* Header */}
                <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-3">
                    <StatusDot status={r?.status || 'idle'} />
                    <div>
                      <p className="text-sm font-mono font-medium text-white">{url}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {r?.service && <span className="mr-2">{r.service}</span>}
                        {r?.version && <span className="mr-2">v{r.version}</span>}
                        {r?.checkedAt && r.status !== 'checking' && <span>Checked {formatRelativeTime(r.checkedAt)}</span>}
                        {r?.status === 'checking' && <span>Checking...</span>}
                        {r?.error && <span style={{ color: '#ff6b6b' }} className="ml-2">{r.error}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => checkUrl(url)} className="btn-ghost text-xs px-3 py-1">Check</button>
                    <button onClick={() => setAutoRefresh(!autoRefresh)} className="btn-ghost text-xs px-3 py-1" style={{ color: autoRefresh ? '#ffd700' : '#00ff88' }}>
                      {autoRefresh ? '⏸ Pause' : '▶ Resume'}
                    </button>
                    <button onClick={() => removeMonitor(url)} className="text-xs px-2 py-1" style={{ color: '#ff6b6b' }}>Remove</button>
                  </div>
                </div>

                {/* Stats row */}
                <div className="px-6 py-4 grid grid-cols-4 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Status</div>
                    <div className="text-sm font-semibold" style={{
                      color: !r || r.status === 'checking' ? 'var(--text-muted)' : r.status === 'up' ? '#00ff88' : '#ff4444'
                    }}>{!r || r.status === 'checking' ? '—' : r.status === 'up' ? 'UP' : 'DOWN'}</div>
                    {r?.statusCode && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>HTTP {r.statusCode}</div>}
                  </div>
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Response</div>
                    <div className="text-sm font-semibold text-white">{r?.responseTime ? `${r.responseTime}ms` : '—'}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Uptime</div>
                    <div className="text-sm font-semibold" style={{
                      color: uptime === null ? 'var(--text-muted)' : uptime >= 99 ? '#00ff88' : uptime >= 90 ? '#ffd700' : '#ff4444'
                    }}>{uptime !== null ? `${uptime}%` : '—'}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Endpoints</div>
                    <div className="text-sm font-semibold text-white">{eps.length || '—'}</div>
                  </div>
                </div>

                {/* Dependencies */}
                {r?.dependencies && Object.keys(r.dependencies).length > 0 && (
                  <div className="px-6 py-3 flex gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
                    {Object.entries(r.dependencies).map(([key, dep]) => (
                      <div key={key} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded" style={{
                        background: dep.status === 'up' ? 'rgba(0,255,136,0.05)' : 'rgba(255,68,68,0.05)',
                        border: `1px solid ${dep.status === 'up' ? 'rgba(0,255,136,0.2)' : 'rgba(255,68,68,0.2)'}`,
                      }}>
                        <StatusDot status={dep.status} />
                        <span className="text-white font-medium">{key}</span>
                        {dep.response_ms && <span style={{ color: 'var(--text-muted)' }}>{dep.response_ms}ms</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* History bar */}
                {hist.length > 1 && (
                  <div className="px-6 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-end gap-0.5 h-8">
                      {[...hist].reverse().map((h, i) => {
                        const maxMs = Math.max(...hist.filter(e => e.responseTime).map(e => e.responseTime || 0), 1)
                        const height = h.responseTime ? Math.max(4, Math.round((h.responseTime / maxMs) * 32)) : 4
                        return (
                          <div key={i} style={{ height: `${height}px`, background: h.status === 'up' ? '#00ff88' : '#ff4444' }}
                            title={`${h.status.toUpperCase()} · ${h.responseTime ? h.responseTime + 'ms' : 'timeout'}`}
                            className="flex-1 rounded-sm opacity-60" />
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Endpoint Discovery */}
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)' }}>Discovered Endpoints</p>
                      {eps.length > 0 && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {eps.length} endpoints from {[...new Set(eps.map(e => e.source))].length} sources
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {eps.length > 0 && (
                        <>
                          <button onClick={() => checkAllEndpoints(url)} className="btn-ghost text-xs px-3 py-1">
                            Ping All
                          </button>
                          <button onClick={() => setExpandedEndpoints(prev => ({ ...prev, [url]: !isExpanded }))} className="btn-ghost text-xs px-3 py-1">
                            {isExpanded ? 'Collapse' : `Show ${eps.length}`}
                          </button>
                        </>
                      )}
                      <button onClick={() => discoverEndpoints(url)} disabled={isDiscovering}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
                        {isDiscovering ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                            Discovering...
                          </span>
                        ) : eps.length > 0 ? 'Re-discover' : 'Discover Endpoints'}
                      </button>
                    </div>
                  </div>

                  {/* Source legend */}
                  {eps.length > 0 && isExpanded && (
                    <div className="flex gap-3 mb-3 flex-wrap">
                      {Object.entries(SOURCE_LABELS).map(([key, { label, color }]) => {
                        const count = eps.filter(e => e.source === key).length
                        if (count === 0) return null
                        return (
                          <span key={key} className="text-xs flex items-center gap-1.5" style={{ color }}>
                            <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                            {label} ({count})
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {isExpanded && eps.length > 0 && (
                    <div className="rounded-lg overflow-hidden max-h-[400px] overflow-y-auto" style={{ border: '1px solid var(--border)' }}>
                      {eps.map((ep, i) => {
                        const srcStyle = SOURCE_LABELS[ep.source] || { label: ep.source, color: 'var(--text-muted)' }
                        return (
                          <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-xs transition-colors"
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span className="font-mono font-semibold px-1.5 py-0.5 rounded" style={{
                              background: 'rgba(0,255,136,0.1)', color: '#00ff88',
                            }}>{ep.method}</span>
                            <span className="font-mono flex-1 truncate text-white">{ep.path}</span>
                            <span className="px-1.5 py-0.5 rounded" style={{
                              background: `${srcStyle.color}15`, color: srcStyle.color, border: `1px solid ${srcStyle.color}30`,
                              fontSize: '0.65rem',
                            }}>{srcStyle.label}</span>
                            {ep.liveStatus && ep.liveStatus !== 'idle' && (
                              <span className="flex items-center gap-1">
                                <StatusDot status={ep.liveStatus} />
                                {ep.liveCode && <span style={{ color: ep.liveStatus === 'up' ? '#00ff88' : '#ff4444' }}>{ep.liveCode}</span>}
                                {ep.liveTime && <span style={{ color: 'var(--text-muted)' }}>{ep.liveTime}ms</span>}
                              </span>
                            )}
                            {ep.status && !ep.liveCode && (
                              <span style={{ color: 'var(--text-muted)' }}>{ep.status}</span>
                            )}
                            <button onClick={() => checkEndpoint(url, ep)} className="px-1.5 py-0.5 rounded" style={{ color: 'var(--text-secondary)' }}>
                              Ping
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {!isExpanded && eps.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {eps.slice(0, 8).map((ep, i) => (
                        <span key={i} className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                          {ep.path}
                        </span>
                      ))}
                      {eps.length > 8 && <span className="text-xs self-center" style={{ color: 'var(--text-muted)' }}>+{eps.length - 8} more</span>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
