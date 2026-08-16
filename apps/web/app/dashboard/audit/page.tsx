'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { formatDate } from '@/lib/utils'

export default function AuditLogPage() {
  const [actionFilter, setActionFilter] = useState('')
  const [resourceFilter, setResourceFilter] = useState('')

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-logs', actionFilter, resourceFilter],
    queryFn: () => apiClient.getAuditLogs(0, 100, actionFilter || undefined, resourceFilter || undefined),
  })

  const statusColor = (code: number) => {
    if (code < 300) return { bg: 'rgba(0,255,136,0.08)', color: '#00ff88', border: 'rgba(0,255,136,0.3)' }
    if (code < 400) return { bg: 'rgba(100,180,255,0.08)', color: '#64b4ff', border: 'rgba(100,180,255,0.3)' }
    if (code < 500) return { bg: 'rgba(255,184,0,0.08)', color: '#ffd700', border: 'rgba(255,184,0,0.3)' }
    return { bg: 'rgba(255,68,68,0.08)', color: '#ff6b6b', border: 'rgba(255,68,68,0.3)' }
  }

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-heading font-bold text-white">Audit Logs</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Immutable record of all security-sensitive operations</p>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-4 flex flex-wrap gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Action</label>
            <input
              type="text"
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              placeholder="e.g. login, create"
              className="input-dark text-sm"
              style={{ width: '160px', padding: '6px 12px' }}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Resource</label>
            <select
              value={resourceFilter}
              onChange={e => setResourceFilter(e.target.value)}
              className="input-dark text-sm"
              style={{ width: '140px', padding: '6px 12px' }}
            >
              <option value="">All</option>
              <option value="auth">auth</option>
              <option value="incidents">incidents</option>
              <option value="deployments">deployments</option>
              <option value="tenants">tenants</option>
              <option value="invitations">invitations</option>
              <option value="webhooks">webhooks</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-2 px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <div className="col-span-2">Time</div>
            <div className="col-span-2">Action</div>
            <div className="col-span-1">Method</div>
            <div className="col-span-4">Path</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2">IP</div>
          </div>

          {isLoading ? (
            <div className="px-6 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              <div className="w-6 h-6 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#ff4444', borderTopColor: 'transparent' }} />
              Loading...
            </div>
          ) : logs && logs.length > 0 ? (
            <div className="stagger">
              {logs.map((log: any) => {
                const sc = statusColor(log.response_status)
                return (
                  <div key={log.log_id} className="grid grid-cols-12 gap-2 px-6 py-3 items-center text-xs transition-colors animate-fade-in"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div className="col-span-2" style={{ color: 'var(--text-muted)' }}>{formatDate(log.created_at)}</div>
                    <div className="col-span-2 font-medium text-white">{log.action}</div>
                    <div className="col-span-1 font-mono" style={{ color: 'var(--text-secondary)' }}>{log.request_method}</div>
                    <div className="col-span-4 font-mono truncate" style={{ color: 'var(--text-muted)' }}>{log.request_path}</div>
                    <div className="col-span-1">
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                        {log.response_status}
                      </span>
                    </div>
                    <div className="col-span-2 font-mono" style={{ color: 'var(--text-muted)' }}>{log.ip_address || '—'}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-6 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              <span className="text-3xl block mb-3 opacity-30">📋</span>
              No audit logs found
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
