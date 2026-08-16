'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { formatRelativeTime, getSeverityColor } from '@/lib/utils'

export default function AssessmentsPage() {
  const queryClient = useQueryClient()
  const [scanTarget, setScanTarget] = useState('')
  const [scanType, setScanType] = useState<'url' | 'repository'>('url')

  const { data: scans, isLoading } = useQuery({
    queryKey: ['scans'],
    queryFn: () => fetch('/api/scans/', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    }).then(r => r.ok ? r.json() : []),
    refetchInterval: 5000,
  })

  const submitScan = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('access_token')
      const resp = await fetch(`/api/scans/${scanType}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: scanType, target: scanTarget }),
      })
      return resp.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
      setScanTarget('')
    },
  })

  const getPostureColor = (rating: string | null) => {
    if (!rating) return 'var(--text-muted)'
    if (rating === 'Critical' || rating === 'High') return '#ff4444'
    if (rating === 'Medium') return '#ffd700'
    return '#00ff88'
  }

  return (
    <div className="space-y-8">
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
        </div>
      </div>

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
                <div key={scan.scan_id} className="px-6 py-4 flex items-center gap-4 transition-colors animate-fade-in"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
                    <span className="text-sm font-bold font-mono" style={{ color: getPostureColor(scan.posture_rating) }}>
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
    </div>
  )
}
