'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { formatDate, getSeverityColor } from '@/lib/utils'
import { wsClient } from '@/lib/websocket-client'
import Link from 'next/link'

const SEVERITIES = ['', 'critical', 'high', 'medium', 'low']

export default function IncidentsPage() {
  const [severityFilter, setSeverityFilter] = useState('')
  const queryClient = useQueryClient()

  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['incidents'] })
    wsClient.on('incident.created', handler)
    wsClient.on('incident.updated', handler)
    return () => { wsClient.off('incident.created', handler); wsClient.off('incident.updated', handler) }
  }, [queryClient])

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', 0, 100, severityFilter],
    queryFn: () => apiClient.getIncidents(0, 100, severityFilter || undefined),
  })

  const filtered = incidents ?? []

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-white">Security Incidents</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Detected threats and suspicious activities</p>
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span className="inline-block w-2 h-2 rounded-full animate-pulse-dot" style={{ background: '#00ff88' }} />
          Live
        </div>
      </div>

      {/* Filter bar */}
      <div className="glass-card p-4 flex flex-wrap gap-2">
        {SEVERITIES.map(s => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
            style={{
              background: severityFilter === s ? 'rgba(255, 68, 68, 0.15)' : 'rgba(255,255,255,0.04)',
              color: severityFilter === s ? '#ff4444' : 'var(--text-secondary)',
              border: `1px solid ${severityFilter === s ? 'rgba(255, 68, 68, 0.3)' : 'var(--border)'}`,
            }}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-xs self-center" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} incident{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* List */}
      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="flex gap-4 items-center">
                <div className="skeleton h-6 w-16 rounded-md" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-2/3" />
                  <div className="skeleton h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="stagger">
            {filtered.map((incident: any) => (
              <Link
                key={incident.incident_id}
                href={`/dashboard/incidents/${incident.incident_id}`}
                className="flex items-start gap-4 px-6 py-4 transition-colors duration-150 animate-fade-in group"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className={`mt-0.5 badge flex-shrink-0 ${
                  incident.severity === 'critical' ? 'badge-critical' :
                  incident.severity === 'high' ? 'badge-high' :
                  incident.severity === 'medium' ? 'badge-medium' : 'badge-low'
                }`}>
                  {incident.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white group-hover:text-white transition-colors">
                    {incident.title || incident.attack_pattern || `Incident ${incident.incident_id.toString().slice(0,8)}`}
                  </p>
                  {incident.description && (
                    <p className="mt-0.5 text-xs truncate" style={{ color: 'var(--text-muted)' }}>{incident.description}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>{formatDate(incident.created_at)}</span>
                    {incident.mitre_technique && (
                      <span className="px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(100,180,255,0.1)', color: '#64b4ff', border: '1px solid rgba(100,180,255,0.2)' }}>
                        {incident.mitre_technique}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`flex-shrink-0 badge ${
                  incident.status === 'new' ? 'badge-critical' :
                  incident.status === 'investigating' ? 'badge-high' : 'badge-success'
                }`}>
                  {incident.status}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 animate-fade-in" style={{ color: 'var(--text-muted)' }}>
            <span className="text-4xl mb-4 opacity-25">🛡️</span>
            <p className="text-sm font-medium">No incidents found</p>
            <p className="text-xs mt-1">Your environment looks clean</p>
          </div>
        )}
      </div>
    </div>
  )
}
