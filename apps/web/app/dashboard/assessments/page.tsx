'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { apiClient } from '@/lib/api-client'
import { formatRelativeTime, getSeverityColor } from '@/lib/utils'
import { wsClient } from '@/lib/websocket-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function AssessmentsPage() {
  const queryClient = useQueryClient()
  const [scanTarget, setScanTarget] = useState('')
  const [scanType, setScanType] = useState<'url' | 'repository'>('url')
  const [selectedScan, setSelectedScan] = useState<any>(null)
  const [deepScanResult, setDeepScanResult] = useState<any>(null)
  const [deepScanning, setDeepScanning] = useState(false)
  const [deepScanHistory, setDeepScanHistory] = useState<any[]>([])
  const [showCrawledPages, setShowCrawledPages] = useState(false)
  const [reconResult, setReconResult] = useState<any>(null)
  const [reconning, setReconning] = useState(false)
  const [activeScan, setActiveScan] = useState(false)

  // Load deep scan history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('kayo_deepscan_history')
    if (saved) { try { setDeepScanHistory(JSON.parse(saved)) } catch {} }
  }, [])

  // Listen for real-time scan completion events via WebSocket
  useEffect(() => {
    wsClient.connect()

    const onScanCompleted = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
      // If this is the currently selected scan, refresh its findings too
      if (selectedScan && data.scan_id === selectedScan.scan_id) {
        queryClient.invalidateQueries({ queryKey: ['findings', data.scan_id] })
        setSelectedScan((prev: any) => prev ? { ...prev, status: 'completed', posture_rating: data.posture_rating, posture_score: data.posture_score, total_findings: data.total_findings } : prev)
      }
    }

    const onScanFailed = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
      if (selectedScan && data.scan_id === selectedScan.scan_id) {
        setSelectedScan((prev: any) => prev ? { ...prev, status: 'failed', error: data.error } : prev)
      }
    }

    wsClient.on('scan.completed', onScanCompleted)
    wsClient.on('scan.failed', onScanFailed)

    return () => {
      wsClient.off('scan.completed', onScanCompleted)
      wsClient.off('scan.failed', onScanFailed)
    }
  }, [queryClient, selectedScan])

  const saveDeepScanHistory = (result: any) => {
    const entry = { ...result, scanned_at: new Date().toISOString() }
    const updated = [entry, ...deepScanHistory].slice(0, 20)
    setDeepScanHistory(updated)
    localStorage.setItem('kayo_deepscan_history', JSON.stringify(updated))
  }

  const deleteScan = useMutation({
    mutationFn: async (scanId: string) => {
      const token = localStorage.getItem('access_token')
      await fetch(`${API_URL}/api/scans/${scanId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
      setSelectedScan(null)
    },
  })

  const { data: scans, isLoading } = useQuery({
    queryKey: ['scans'],
    queryFn: async () => {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${API_URL}/api/scans/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      return res.ok ? res.json() : []
    },
    refetchInterval: 5000,
  })

  const { data: findings, isLoading: findingsLoading } = useQuery({
    queryKey: ['findings', selectedScan?.scan_id],
    queryFn: async () => {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${API_URL}/api/scans/${selectedScan.scan_id}/findings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      return res.ok ? res.json() : []
    },
    enabled: !!selectedScan?.scan_id && selectedScan?.status === 'completed',
  })

  const submitScan = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('access_token')
      const resp = await fetch(`${API_URL}/api/scans/${scanType}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: scanType, target: scanTarget, active_scan: activeScan }),
      })
      return resp.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
      setScanTarget('')
    },
  })

  const runDeepScan = async () => {
    if (!scanTarget) return
    setDeepScanning(true)
    setDeepScanResult(null)
    setReconResult(null)
    try {
      const res = await fetch('/api/monitor/deepscan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scanTarget, maxPages: 25, maxDepth: 3 }),
      })
      const data = await res.json()
      setDeepScanResult(data)
      saveDeepScanHistory(data)
    } catch (e: any) {
      setDeepScanResult({ error: e.message })
    }
    setDeepScanning(false)
  }

  const runRecon = async () => {
    if (!scanTarget) return
    setReconning(true)
    setReconResult(null)
    setDeepScanResult(null)
    try {
      const res = await fetch('/api/monitor/recon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scanTarget }),
      })
      const data = await res.json()
      setReconResult(data)
    } catch (e: any) {
      setReconResult({ error: e.message })
    }
    setReconning(false)
  }

  const getPostureColor = (rating: string | null) => {
    if (!rating) return 'var(--text-muted)'
    if (rating === 'Critical' || rating === 'High') return '#ff4444'
    if (rating === 'Medium') return '#ffd700'
    return '#00ff88'
  }

  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical': return { bg: 'rgba(255,68,68,0.1)', color: '#ff4444', border: 'rgba(255,68,68,0.3)' }
      case 'high': return { bg: 'rgba(255,150,0,0.1)', color: '#ff9600', border: 'rgba(255,150,0,0.3)' }
      case 'medium': return { bg: 'rgba(255,184,0,0.1)', color: '#ffd700', border: 'rgba(255,184,0,0.3)' }
      case 'low': return { bg: 'rgba(100,180,255,0.1)', color: '#64b4ff', border: 'rgba(100,180,255,0.3)' }
      default: return { bg: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', border: 'var(--border)' }
    }
  }

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-heading font-bold text-white">Security Assessments</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Scan URLs and repositories for security vulnerabilities</p>
      </div>

      {/* New Scan Form */}
      <div className="glass-card p-6 animate-slide-up" style={{ border: '1px solid rgba(255, 68, 68, 0.1)' }}>
        <h2 className="text-sm font-semibold text-white mb-4">New Assessment</h2>
        <div className="flex gap-3">
          <select
            value={scanType}
            onChange={(e) => setScanType(e.target.value as 'url' | 'repository')}
            className="input-dark"
            style={{ width: 'auto', minWidth: '140px' }}
          >
            <option value="url">URL Scan</option>
            <option value="repository">Repository Scan</option>
          </select>
          <input
            type="text"
            value={scanTarget}
            onChange={(e) => setScanTarget(e.target.value)}
            placeholder={scanType === 'url' ? 'https://example.com' : 'https://github.com/owner/repo'}
            className="input-dark flex-1"
          />
          <button
            onClick={() => submitScan.mutate()}
            disabled={!scanTarget || submitScan.isPending}
            className="btn-primary disabled:opacity-50 whitespace-nowrap"
          >
            {submitScan.isPending ? 'Scanning...' : 'Run Assessment'}
          </button>
          {/* Active scan toggle — enables intrusive vuln probing (SQLi, XSS, etc.) */}
          <label
            className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap px-3 py-2 rounded-lg transition-all"
            style={{
              background: activeScan ? 'rgba(255,68,68,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${activeScan ? 'rgba(255,68,68,0.35)' : 'var(--border)'}`,
            }}
            title="Enables active vulnerability probing: SQLi, XSS, path traversal, open redirect, IDOR. Only use on targets you own or are authorised to test."
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={activeScan}
              onChange={(e) => setActiveScan(e.target.checked)}
              aria-label="Enable active vulnerability scanning"
            />
            <div
              className="relative w-8 h-4 rounded-full transition-colors flex-shrink-0"
              style={{ background: activeScan ? '#ff4444' : 'rgba(255,255,255,0.1)' }}
            >
              <div
                className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-150"
                style={{
                  background: 'white',
                  left: activeScan ? '17px' : '2px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }}
              />
            </div>
            <span className="text-xs font-semibold" style={{ color: activeScan ? '#ff6b6b' : 'var(--text-muted)' }}>
              Active Scan
            </span>
          </label>
          <button
            onClick={runDeepScan}
            disabled={!scanTarget || deepScanning}
            className="whitespace-nowrap disabled:opacity-50 px-4 py-2 text-sm font-semibold rounded-lg transition-all"
            style={{ background: 'linear-gradient(135deg, #ff9600, #e68600)', color: 'white', boxShadow: '0 4px 12px rgba(255,150,0,0.3)' }}
          >
            {deepScanning ? '🔍 Deep Scanning...' : '🔍 Deep Scan'}
          </button>
          <button
            onClick={runRecon}
            disabled={!scanTarget || reconning}
            className="whitespace-nowrap disabled:opacity-50 px-4 py-2 text-sm font-semibold rounded-lg transition-all"
            style={{ background: 'linear-gradient(135deg, #c084fc, #9333ea)', color: 'white', boxShadow: '0 4px 12px rgba(147,51,234,0.3)' }}
          >
            {reconning ? '🕵️ Recon...' : '🕵️ Recon'}
          </button>
        </div>
      </div>

      {/* Deep Scan Results */}
      {deepScanning && (
        <div className="glass-card p-6 text-center animate-fade-in" style={{ border: '1px solid rgba(255,150,0,0.2)' }}>
          <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#ff9600', borderTopColor: 'transparent' }} />
          <p className="text-sm text-white font-medium">Deep scanning — crawling pages, analyzing JS, probing sensitive paths...</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>This may take 30-60 seconds depending on site size</p>
        </div>
      )}

      {deepScanResult && !deepScanning && (
        <div className="glass-card overflow-hidden animate-slide-up" style={{ border: '1px solid rgba(255,150,0,0.2)' }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <div>
              <h2 className="text-sm font-semibold text-white">🔍 Deep Scan Results</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Crawled {deepScanResult.pages_crawled} pages • {deepScanResult.total_findings} secrets/leaks found
              </p>
            </div>
            <div className="flex items-center gap-2">
              {deepScanResult.summary && Object.entries(deepScanResult.summary as Record<string, number>).filter(([,v]) => v > 0).map(([sev, count]) => (
                <span key={sev} className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{
                  ...getSeverityStyle(sev),
                  background: getSeverityStyle(sev).bg,
                  color: getSeverityStyle(sev).color,
                  border: `1px solid ${getSeverityStyle(sev).border}`,
                }}>{count} {sev}</span>
              ))}
              <button onClick={() => setDeepScanResult(null)} className="text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>✕</button>
            </div>
          </div>

          {/* Findings */}
          {deepScanResult.findings?.length > 0 && (
            <div className="max-h-[400px] overflow-y-auto">
              {deepScanResult.findings.map((f: any, i: number) => {
                const style = getSeverityStyle(f.severity)
                return (
                  <div key={i} className="px-6 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <div className="flex items-start gap-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold mt-0.5 flex-shrink-0" style={{
                        background: style.bg, color: style.color, border: `1px solid ${style.border}`,
                      }}>{f.severity}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{f.type}</p>
                        <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-secondary)' }}>{f.value}</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{f.context}</p>
                        <p className="text-xs mt-0.5 font-mono truncate" style={{ color: 'var(--text-muted)' }}>{f.location}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Sensitive files */}
          {deepScanResult.sensitive_files?.length > 0 && (
            <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase mb-2" style={{ color: '#ff9600' }}>Exposed Sensitive Files</p>
              <div className="flex flex-wrap gap-2">
                {deepScanResult.sensitive_files.map((f: any, i: number) => (
                  <span key={i} className="text-xs font-mono px-2 py-1 rounded" style={{
                    background: 'rgba(255,68,68,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,68,68,0.2)'
                  }}>{f.path}</span>
                ))}
              </div>
            </div>
          )}

          {/* Crawled pages summary */}
          {deepScanResult.crawled_pages?.length > 0 && (
            <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Pages Crawled ({deepScanResult.crawled_pages.length})</p>
                <button onClick={() => setShowCrawledPages(!showCrawledPages)} className="text-xs" style={{ color: '#64b4ff' }}>
                  {showCrawledPages ? 'Collapse' : 'Show All'}
                </button>
              </div>
              {showCrawledPages ? (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {deepScanResult.crawled_pages.map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.status < 400 ? '#00ff88' : '#ff4444' }} />
                      <span className="font-mono truncate flex-1 text-white">{p.url}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{p.status}</span>
                      {p.title && <span className="truncate max-w-[150px]" style={{ color: 'var(--text-muted)' }}>{p.title}</span>}
                      {p.forms ? <span style={{ color: '#ffd700' }}>{p.forms} forms</span> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {deepScanResult.crawled_pages.slice(0, 10).map((p: any, i: number) => (
                    <span key={i} className="text-xs font-mono px-2 py-0.5 rounded" style={{
                      background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px solid var(--border)'
                    }} title={p.url}>{new URL(p.url).pathname || '/'}</span>
                  ))}
                  {deepScanResult.crawled_pages.length > 10 && (
                    <span className="text-xs self-center" style={{ color: 'var(--text-muted)' }}>+{deepScanResult.crawled_pages.length - 10} more</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Git Repository Discovery */}
          {deepScanResult.git_repo && (
            <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase mb-2" style={{ color: '#64b4ff' }}>🔗 Git Repository Discovered</p>
              <a href={deepScanResult.git_repo} target="_blank" rel="noopener noreferrer"
                className="text-sm font-mono inline-flex items-center gap-2 px-3 py-2 rounded-lg transition-all hover:opacity-80"
                style={{ background: 'rgba(100,180,255,0.08)', color: '#64b4ff', border: '1px solid rgba(100,180,255,0.2)' }}>
                {deepScanResult.git_repo}
                <span className="text-xs">↗</span>
              </a>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                Use "Repository Scan" with this URL to scan the source code for secrets, vulnerable dependencies, and code patterns.
              </p>
            </div>
          )}

          {deepScanResult.total_findings === 0 && (
            <div className="px-6 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
              <span className="text-2xl block mb-2">✅</span>
              <p className="text-sm">No hardcoded secrets or sensitive file exposures found across {deepScanResult.pages_crawled} pages.</p>
            </div>
          )}
        </div>
      )}

      {/* Recon Results */}
      {reconning && (
        <div className="glass-card p-6 text-center animate-fade-in" style={{ border: '1px solid rgba(147,51,234,0.2)' }}>
          <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#c084fc', borderTopColor: 'transparent' }} />
          <p className="text-sm text-white font-medium">Running OSINT Recon — analyzing headers, probing configs, fingerprinting stack...</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Checking .git, package.json, headers, JS bundles, deployment platform</p>
        </div>
      )}

      {reconResult && !reconning && (
        <div className="glass-card overflow-hidden animate-slide-up" style={{ border: '1px solid rgba(147,51,234,0.2)' }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <div>
              <h2 className="text-sm font-semibold text-white">🕵️ Recon Results</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{reconResult.url}</p>
            </div>
            <button onClick={() => setReconResult(null)} className="text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>✕</button>
          </div>

          {/* Summary cards */}
          <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Stack</div>
              <div className="text-sm font-semibold text-white mt-1">{reconResult.tech_stack?.join(', ') || '—'}</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Hosting</div>
              <div className="text-sm font-semibold text-white mt-1">{reconResult.hosting || 'Unknown'}</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>CDN</div>
              <div className="text-sm font-semibold text-white mt-1">{reconResult.cdn || 'None'}</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{
              background: reconResult.git_repo ? 'rgba(0,255,136,0.05)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${reconResult.git_repo ? 'rgba(0,255,136,0.2)' : 'var(--border)'}`,
            }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Repository</div>
              <div className="text-sm font-semibold mt-1" style={{ color: reconResult.git_repo ? '#00ff88' : 'var(--text-muted)' }}>
                {reconResult.git_repo ? '✓ Found' : 'Not Found'}
              </div>
            </div>
          </div>

          {/* Git repo if found */}
          {reconResult.git_repo && (
            <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(0,255,136,0.02)' }}>
              <p className="text-xs font-semibold uppercase mb-2" style={{ color: '#00ff88' }}>🔗 Repository Discovered ({reconResult.git_repo_confidence} confidence)</p>
              <a href={reconResult.git_repo} target="_blank" rel="noopener noreferrer"
                className="text-sm font-mono inline-flex items-center gap-2 px-3 py-2 rounded-lg hover:opacity-80"
                style={{ background: 'rgba(0,255,136,0.08)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.2)' }}>
                {reconResult.git_repo} <span className="text-xs">↗</span>
              </a>
            </div>
          )}

          {/* Findings */}
          {reconResult.findings?.length > 0 && (
            <div className="max-h-[350px] overflow-y-auto">
              {reconResult.findings.map((f: any, i: number) => (
                <div key={i} className="px-6 py-3 flex items-start gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 flex-shrink-0" style={{
                    background: f.confidence === 'high' ? 'rgba(0,255,136,0.1)' : f.confidence === 'medium' ? 'rgba(255,184,0,0.1)' : 'rgba(255,255,255,0.05)',
                    color: f.confidence === 'high' ? '#00ff88' : f.confidence === 'medium' ? '#ffd700' : 'var(--text-muted)',
                    border: `1px solid ${f.confidence === 'high' ? 'rgba(0,255,136,0.3)' : f.confidence === 'medium' ? 'rgba(255,184,0,0.3)' : 'var(--border)'}`,
                  }}>{f.confidence}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">{f.type}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(147,51,234,0.1)', color: '#c084fc', fontSize: '0.6rem' }}>{f.method}</span>
                    </div>
                    <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>{f.value}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{f.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main content: scan list + findings detail */}
      <div className={`grid gap-6 ${selectedScan ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {/* Scan History */}
        <div className="glass-card overflow-hidden animate-fade-in">
          <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold text-white">Scan History</h2>
          </div>
          <div>
            {isLoading ? (
              <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
                <div className="w-6 h-6 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#ff4444', borderTopColor: 'transparent' }} />
                Loading...
              </div>
            ) : scans?.length > 0 ? (
              <div className="stagger">
                {scans.map((scan: any) => (
                  <div
                    key={scan.scan_id}
                    onClick={() => setSelectedScan(scan.scan_id === selectedScan?.scan_id ? null : scan)}
                    className="px-6 py-4 flex items-center gap-4 transition-colors animate-fade-in cursor-pointer group"
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      background: selectedScan?.scan_id === scan.scan_id ? 'rgba(255, 68, 68, 0.05)' : 'transparent',
                      borderLeft: selectedScan?.scan_id === scan.scan_id ? '3px solid #ff4444' : '3px solid transparent',
                    }}
                    onMouseEnter={(e) => { if (selectedScan?.scan_id !== scan.scan_id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                    onMouseLeave={(e) => { if (selectedScan?.scan_id !== scan.scan_id) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      scan.status === 'running' ? 'animate-pulse-dot' : ''
                    }`} style={{
                      background: scan.status === 'completed' ? '#00ff88' :
                        scan.status === 'running' ? '#ffd700' :
                        scan.status === 'failed' ? '#ff4444' : '#6b6b7b'
                    }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{scan.target}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {scan.type} scan • {formatRelativeTime(scan.created_at)}
                      </p>
                    </div>
                    {scan.posture_rating && (
                      <span className="text-xs font-bold font-mono" style={{ color: getPostureColor(scan.posture_rating) }}>
                        {scan.posture_rating}
                      </span>
                    )}
                    {scan.total_findings > 0 && (
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                        {scan.total_findings} findings
                      </span>
                    )}
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{
                      background: scan.status === 'completed' ? 'rgba(0,255,136,0.08)' :
                        scan.status === 'running' ? 'rgba(255,184,0,0.08)' :
                        scan.status === 'failed' ? 'rgba(255,68,68,0.08)' : 'rgba(255,255,255,0.04)',
                      color: scan.status === 'completed' ? '#00ff88' :
                        scan.status === 'running' ? '#ffd700' :
                        scan.status === 'failed' ? '#ff6b6b' : 'var(--text-muted)',
                      border: `1px solid ${
                        scan.status === 'completed' ? 'rgba(0,255,136,0.3)' :
                        scan.status === 'running' ? 'rgba(255,184,0,0.3)' :
                        scan.status === 'failed' ? 'rgba(255,68,68,0.3)' : 'var(--border)'
                      }`,
                    }}>{scan.status}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm('Delete this scan?')) deleteScan.mutate(scan.scan_id) }}
                      className="text-xs px-1.5 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: '#ff6b6b' }}
                      title="Delete scan"
                    >✕</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center" style={{ color: 'var(--text-muted)' }}>
                <span className="text-3xl block mb-3 opacity-30">🔍</span>
                <p className="text-sm">No assessments yet. Run your first scan above.</p>
              </div>
            )}
          </div>
        </div>

        {/* Findings Detail Panel */}
        {selectedScan && (
          <div className="glass-card overflow-hidden animate-slide-up" style={{ border: '1px solid rgba(255, 68, 68, 0.1)' }}>
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h2 className="text-sm font-semibold text-white">Scan Results</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{selectedScan.target}</p>
              </div>
              <div className="flex items-center gap-3">
                {selectedScan.posture_score != null && (
                  <div className="text-center">
                    <div className="text-2xl font-bold font-mono" style={{ color: getPostureColor(selectedScan.posture_rating) }}>
                      {selectedScan.posture_score}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>/ 100</div>
                  </div>
                )}
                <button onClick={() => setSelectedScan(null)} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-muted)' }}>✕</button>
              </div>
            </div>

            {/* Severity summary bar */}
            {selectedScan.finding_counts && (
              <div className="px-6 py-3 flex gap-3" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
                {Object.entries(selectedScan.finding_counts as Record<string, number>).filter(([, v]) => v > 0).map(([sev, count]) => {
                  const style = getSeverityStyle(sev)
                  return (
                    <span key={sev} className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{
                      background: style.bg, color: style.color, border: `1px solid ${style.border}`,
                    }}>
                      {count} {sev}
                    </span>
                  )
                })}
              </div>
            )}

            {/* Findings list */}
            <div className="max-h-[500px] overflow-y-auto">
              {findingsLoading ? (
                <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
                  <div className="w-5 h-5 border-2 rounded-full animate-spin mx-auto mb-2" style={{ borderColor: '#ff4444', borderTopColor: 'transparent' }} />
                  Loading findings...
                </div>
              ) : findings && findings.length > 0 ? (
                <div>
                  {findings.map((f: any, i: number) => {
                    const style = getSeverityStyle(f.severity)
                    return (
                      <div key={f.finding_id || i} className="px-6 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <div className="flex items-start gap-3">
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold mt-0.5 flex-shrink-0" style={{
                            background: style.bg, color: style.color, border: `1px solid ${style.border}`,
                          }}>
                            {f.severity}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white">
                              {f.title || `${f.type} — ${f.category}`}
                            </p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                              {f.description}
                            </p>
                            {f.endpoint && (
                              <p className="text-xs mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>
                                {f.endpoint}
                              </p>
                            )}
                            {f.remediation && (
                              <p className="text-xs mt-2 px-2 py-1.5 rounded" style={{ background: 'rgba(0,255,136,0.05)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.15)' }}>
                                💡 {f.remediation}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : selectedScan.status === 'completed' ? (
                <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
                  <p className="text-sm">No findings — clean scan!</p>
                </div>
              ) : (
                <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
                  <div className="w-5 h-5 border-2 rounded-full animate-spin mx-auto mb-2" style={{ borderColor: '#ffd700', borderTopColor: 'transparent' }} />
                  <p className="text-sm">Scan in progress...</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Deep Scan History */}
      {deepScanHistory.length > 0 && !deepScanResult && (
        <div className="glass-card overflow-hidden animate-fade-in">
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold text-white">🔍 Deep Scan History</h2>
            <button onClick={() => { setDeepScanHistory([]); localStorage.removeItem('kayo_deepscan_history') }}
              className="text-xs" style={{ color: 'var(--text-muted)' }}>Clear</button>
          </div>
          <div>
            {deepScanHistory.map((scan: any, i: number) => (
              <div key={i} className="px-6 py-3 flex items-center gap-4 cursor-pointer transition-colors"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                onClick={() => setDeepScanResult(scan)}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="text-sm">🔍</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{scan.url}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {scan.pages_crawled} pages • {formatRelativeTime(scan.scanned_at)}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                  {scan.total_findings} findings
                </span>
                {scan.git_repo && <span className="text-xs" style={{ color: '#64b4ff' }}>🔗 repo</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
