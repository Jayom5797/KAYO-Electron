'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatRelativeTime } from '@/lib/utils'

interface DepStatus { status: 'up' | 'down'; response_ms?: number; error?: string }
interface CheckResult {
  url: string; status: 'up' | 'down' | 'checking'
  statusCode?: number; responseTime?: number; checkedAt: string
  error?: string; version?: string; service?: string
  dependencies?: Record<string, DepStatus>
}
interface HistoryEntry { status: 'up' | 'down'; responseTime?: number; checkedAt: string }
interface EndpointResult {
  method: string; path: string; summary?: string
  status: 'up' | 'down' | 'checking' | 'idle'
  statusCode?: number; responseTime?: number; checkedAt?: string; error?: string
}

const DEP_LABELS: Record<string, string> = {
  postgresql: 'PostgreSQL', redis: 'Redis', kafka: 'Kafka',
  neo4j: 'Neo4j', clickhouse: 'ClickHouse',
}

const METHOD_STYLE: Record<string, { bg: string; color: string }> = {
  GET:    { bg: 'rgba(0,255,136,0.1)', color: '#00ff88' },
  POST:   { bg: 'rgba(100,180,255,0.1)', color: '#64b4ff' },
  PUT:    { bg: 'rgba(255,184,0,0.1)', color: '#ffd700' },
  PATCH:  { bg: 'rgba(255,150,0,0.1)', color: '#ff9600' },
  DELETE: { bg: 'rgba(255,68,68,0.1)', color: '#ff6b6b' },
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
  const [endpoints, setEndpoints] = useState<Record<string, EndpointResult[]>>({})
  const [specStatus, setSpecStatus] = useState<Record<string, string>>({})
  const [expandedEndpoints, setExpandedEndpoints] = useState<Record<string, boolean>>({})
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('kayo_monitors_v3')
    if (saved) { try { setMonitors(JSON.parse(saved)) } catch {} }
  }, [])

  const saveMonitors = (list: string[]) => {
    localStorage.setItem('kayo_monitors_v3', JSON.stringify(list))
    setMonitors(list)
  }

  const checkUrl = useCallback(async (url: string) => {
    setResults(prev => ({ ...prev, [url]: { ...prev[url], url, status: 'checking', checkedAt: new Date().toISOString() } }))
    try {
      const res = await fetch(`/api/monitor/check?url=${encodeURIComponent(url)}`, { cache: 'no-store' })
      const data = await res.json()
      const entry: CheckResult = {
        url, status: data.ok ? 'up' : 'down', statusCode: data.status_code,
        responseTime: data.response_time_ms, checkedAt: new Date().toISOString(),
        error: data.error, version: data.body?.version, service: data.body?.service,
        dependencies: data.body?.dependencies,
      }
      setResults(prev => ({ ...prev, [url]: entry }))
      setHistory(prev => {
        const newEntry: HistoryEntry = { status: entry.status === 'up' ? 'up' : 'down', responseTime: data.response_time_ms, checkedAt: entry.checkedAt }
        const list: HistoryEntry[] = [newEntry, ...(prev[url] || [])].slice(0, 40)
        return { ...prev, [url]: list }
      })
    } catch (e: any) {
      setResults(prev => ({ ...prev, [url]: { url, status: 'down', checkedAt: new Date().toISOString(), error: e.message } }))
    }
  }, [])

  const fetchSpec = useCallback(async (url: string) => {
    setSpecStatus(prev => ({ ...prev, [url]: 'loading' }))
    try {
      const res = await fetch(`/api/monitor/spec?url=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (!data.found) { setSpecStatus(prev => ({ ...prev, [url]: 'not_found' })); return }
      const spec = data.spec
      const paths = spec.paths || {}
      const discovered: EndpointResult[] = []
      Object.entries(paths).forEach(([path, methods]: [string, any]) => {
        Object.entries(methods).forEach(([method, info]: [string, any]) => {
          if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
            discovered.push({ method: method.toUpperCase(), path, summary: (info as any).summary || '', status: 'idle' })
          }
        })
      })
      setEndpoints(prev => ({ ...prev, [url]: discovered }))
      setSpecStatus(prev => ({ ...prev, [url]: `found:${data.path} (${discovered.length} endpoints)` }))
    } catch {
      setSpecStatus(prev => ({ ...prev, [url]: 'error' }))
    }
  }, [])

  const checkEndpoint = useCallback(async (baseUrl: string, ep: EndpointResult) => {
    const fullUrl = baseUrl.replace(/\/$/, '') + ep.path
    setEndpoints(prev => ({
      ...prev,
      [baseUrl]: (prev[baseUrl] || []).map(e =>
        e.method === ep.method && e.path === ep.path ? { ...e, status: 'checking' } : e
      )
    }))
    try {
      const res = await fetch(`/api/monitor/endpoint?url=${encodeURIComponent(fullUrl)}`)
      const data = await res.json()
      setEndpoints(prev => ({
        ...prev,
        [baseUrl]: (prev[baseUrl] || []).map(e =>
          e.method === ep.method && e.path === ep.path
            ? { ...e, status: data.ok ? 'up' : 'down', statusCode: data.status_code, responseTime: data.response_time_ms, checkedAt: new Date().toISOString(), error: data.error }
            : e
        )
      }))
    } catch {}
  }, [])

  const checkAllEndpoints = useCallback(async (baseUrl: string) => {
    const eps = endpoints[baseUrl] || []
    const getEndpoints = eps.filter(e => e.method === 'GET')
    for (const ep of getEndpoints) {
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
    if (!url.startsWith('http')) url = 'http://' + url
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
    setSpecStatus(prev => { const n = { ...prev }; delete n[url]; return n })
  }

  const uptimePercent = (url: string) => {
    const h = history[url] || []
    if (!h.length) return null
    return Math.round((h.filter(e => e.status === 'up').length / h.length) * 100)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-white">Backend Monitor</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Monitor health, dependencies, and auto-discover all API endpoints via OpenAPI spec</p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="rounded accent-red-500" />
          Auto-refresh (30s)
        </label>
      </div>

      {/* Add URL */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-semibold text-white mb-3">Add Backend URL</h2>
        <form onSubmit={addMonitor} className="flex gap-3">
          <input
            type="text" value={inputUrl} onChange={e => setInputUrl(e.target.value)}
            placeholder="http://localhost:8000 or https://api.yourdomain.com"
            className="input-dark flex-1 font-mono text-sm"
          />
          <button type="submit" disabled={!inputUrl.trim()} className="btn-primary disabled:opacity-50 whitespace-nowrap">
            Add & Monitor
          </button>
        </form>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Checks <span className="font-mono">/health</span> every 30s. Use &quot;Discover Endpoints&quot; to auto-load all API routes from the OpenAPI spec.
        </p>
      </div>

      {monitors.length === 0 ? (
        <div className="glass-card p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          <span className="text-3xl block mb-3 opacity-30">📡</span>
          No backends monitored yet. Add a URL above to start.
        </div>
      ) : (
        <div className="space-y-6">
          {monitors.map(url => {
            const r = results[url]
            const uptime = uptimePercent(url)
            const hist = history[url] || []
            const eps = endpoints[url] || []
            const spec = specStatus[url]
            const isExpanded = expandedEndpoints[url]

            return (
              <div key={url} className="glass-card overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-3">
                    <StatusDot status={r?.status || 'idle'} />
                    <div>
                      <p className="text-sm font-mono font-medium text-white">{url}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {r?.service && <span className="mr-2">{r.service}</span>}
                        {r?.version && <span className="mr-2">v{r.version}</span>}
                        {r?.checkedAt && r.status !== 'checking' && <span>Last checked {formatRelativeTime(r.checkedAt)}</span>}
                        {r?.status === 'checking' && <span>Checking...</span>}
                        {r?.error && <span style={{ color: '#ff6b6b' }} className="ml-2">{r.error}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => checkUrl(url)} className="btn-ghost text-xs px-3 py-1">Check now</button>
                    <button onClick={() => removeMonitor(url)} className="text-xs px-2 py-1" style={{ color: '#ff6b6b' }}>Remove</button>
                  </div>
                </div>

                {/* Stats */}
                <div className="px-6 py-4 grid grid-cols-4 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>API Status</div>
                    <div className="text-sm font-semibold" style={{
                      color: !r || r.status === 'checking' ? 'var(--text-muted)' : r.status === 'up' ? '#00ff88' : '#ff4444'
                    }}>
                      {!r || r.status === 'checking' ? '—' : r.status === 'up' ? 'UP' : 'DOWN'}
                    </div>
                    {r?.statusCode && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>HTTP {r.statusCode}</div>}
                  </div>
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Response Time</div>
                    <div className="text-sm font-semibold text-white">{r?.responseTime ? `${r.responseTime}ms` : '—'}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Uptime</div>
                    <div className="text-sm font-semibold" style={{
                      color: uptime === null ? 'var(--text-muted)' : uptime >= 99 ? '#00ff88' : uptime >= 90 ? '#ffd700' : '#ff4444'
                    }}>
                      {uptime !== null ? `${uptime}%` : '—'}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{hist.length} checks</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Error Rate</div>
                    <div className="text-sm font-semibold" style={{
                      color: uptime === null ? 'var(--text-muted)' : (100 - uptime) === 0 ? '#00ff88' : '#ff4444'
                    }}>
                      {uptime !== null ? `${100 - uptime}%` : '—'}
                    </div>
                  </div>
                </div>

                {/* Dependencies */}
                {r?.dependencies && Object.keys(r.dependencies).length > 0 && (
                  <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                    <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--text-muted)' }}>Service Dependencies</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {Object.entries(r.dependencies).map(([key, dep]) => (
                        <div key={key} className="rounded-lg p-3" style={{
                          background: dep.status === 'up' ? 'rgba(0,255,136,0.05)' : 'rgba(255,68,68,0.05)',
                          border: `1px solid ${dep.status === 'up' ? 'rgba(0,255,136,0.2)' : 'rgba(255,68,68,0.2)'}`,
                        }}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <StatusDot status={dep.status} />
                            <span className="text-xs font-medium text-white">{DEP_LABELS[key] || key}</span>
                          </div>
                          <div className="text-xs font-semibold" style={{ color: dep.status === 'up' ? '#00ff88' : '#ff4444' }}>
                            {dep.status === 'up' ? 'UP' : 'DOWN'}
                          </div>
                          {dep.response_ms && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{dep.response_ms}ms</div>}
                          {dep.error && <div className="text-xs truncate" style={{ color: '#ff6b6b' }} title={dep.error}>{dep.error}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* History bar */}
                {hist.length > 0 && (
                  <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Response time history ({hist.length} checks)</p>
                    <div className="flex items-end gap-0.5 h-10">
                      {[...hist].reverse().map((h, i) => {
                        const maxMs = Math.max(...hist.filter(e => e.responseTime).map(e => e.responseTime || 0), 1)
                        const height = h.responseTime ? Math.max(4, Math.round((h.responseTime / maxMs) * 40)) : 4
                        return (
                          <div key={i} style={{ height: `${height}px`, background: h.status === 'up' ? '#00ff88' : '#ff4444' }}
                            title={`${h.status.toUpperCase()} · ${h.responseTime ? h.responseTime + 'ms · ' : ''}${formatRelativeTime(h.checkedAt)}`}
                            className="flex-1 rounded-sm opacity-70" />
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* OpenAPI Endpoint Discovery */}
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)' }}>API Endpoints</p>
                      {spec && (
                        <p className="text-xs mt-0.5" style={{
                          color: spec.startsWith('found') ? '#00ff88' : spec === 'loading' ? 'var(--text-muted)' : '#ff6b6b'
                        }}>
                          {spec === 'loading' ? 'Discovering...' : spec.startsWith('found') ? `✓ ${spec.replace('found:', '')}` : '✗ No OpenAPI spec found'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {eps.length > 0 && (
                        <>
                          <button onClick={() => checkAllEndpoints(url)} className="btn-ghost text-xs px-3 py-1">
                            Check all GET
                          </button>
                          <button onClick={() => setExpandedEndpoints(prev => ({ ...prev, [url]: !isExpanded }))} className="btn-ghost text-xs px-3 py-1">
                            {isExpanded ? 'Collapse' : `Show ${eps.length} endpoints`}
                          </button>
                        </>
                      )}
                      <button onClick={() => fetchSpec(url)} className="btn-primary text-xs px-3 py-1.5">
                        {spec === 'loading' ? 'Loading...' : eps.length > 0 ? 'Re-discover' : 'Discover Endpoints'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && eps.length > 0 && (
                    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                      {/* Table header */}
                      <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                        <div className="col-span-1">Method</div>
                        <div className="col-span-4">Path</div>
                        <div className="col-span-3 hidden md:block">Summary</div>
                        <div className="col-span-2">Status</div>
                        <div className="col-span-1">Time</div>
                        <div className="col-span-1"></div>
                      </div>
                      {eps.map((ep, i) => {
                        const mStyle = METHOD_STYLE[ep.method] || { bg: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }
                        return (
                          <div key={i} className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-xs"
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div className="col-span-1">
                              <span className="font-mono font-semibold px-1.5 py-0.5 rounded" style={{ background: mStyle.bg, color: mStyle.color }}>
                                {ep.method}
                              </span>
                            </div>
                            <div className="col-span-4 font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{ep.path}</div>
                            <div className="col-span-3 hidden md:block truncate" style={{ color: 'var(--text-muted)' }}>{ep.summary}</div>
                            <div className="col-span-2">
                              {ep.status === 'idle' ? <span style={{ color: 'var(--text-muted)' }}>—</span> :
                               ep.status === 'checking' ? <span className="animate-pulse-dot" style={{ color: '#ffd700' }}>checking</span> : (
                                <div className="flex items-center gap-1.5">
                                  <StatusDot status={ep.status} />
                                  <span style={{ color: ep.status === 'up' ? '#00ff88' : '#ff4444' }}>
                                    {ep.statusCode || (ep.status === 'up' ? 'UP' : 'DOWN')}
                                  </span>
                                  {(ep.statusCode === 401 || ep.statusCode === 403) && (
                                    <span className="px-1 rounded" style={{ background: 'rgba(255,184,0,0.1)', color: '#ffd700', border: '1px solid rgba(255,184,0,0.2)', fontSize: '0.65rem' }}>🔒</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="col-span-1" style={{ color: 'var(--text-muted)' }}>
                              {ep.responseTime ? `${ep.responseTime}ms` : '—'}
                            </div>
                            <div className="col-span-1 text-right">
                              {ep.method === 'GET' && (
                                <button onClick={() => checkEndpoint(url, ep)} style={{ color: 'var(--text-secondary)' }}>
                                  Check
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
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
