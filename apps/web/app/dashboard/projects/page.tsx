'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'

const STATUS_CONFIG: Record<string, { bg: string; color: string; border: string }> = {
  active:       { bg: 'rgba(0,255,136,0.08)', color: '#00ff88', border: 'rgba(0,255,136,0.3)' },
  deploying:    { bg: 'rgba(100,180,255,0.08)', color: '#64b4ff', border: 'rgba(100,180,255,0.3)' },
  building:     { bg: 'rgba(100,180,255,0.08)', color: '#64b4ff', border: 'rgba(100,180,255,0.3)' },
  provisioning: { bg: 'rgba(100,180,255,0.08)', color: '#64b4ff', border: 'rgba(100,180,255,0.3)' },
  assessing:    { bg: 'rgba(255,184,0,0.08)', color: '#ffd700', border: 'rgba(255,184,0,0.3)' },
  gate_blocked: { bg: 'rgba(255,68,68,0.08)', color: '#ff6b6b', border: 'rgba(255,68,68,0.3)' },
  failed:       { bg: 'rgba(255,68,68,0.08)', color: '#ff6b6b', border: 'rgba(255,68,68,0.3)' },
  stopped:      { bg: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: 'var(--border)' },
  received:     { bg: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', border: 'var(--border)' },
}

export default function ProjectsPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceType, setSourceType] = useState('github')

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const token = localStorage.getItem('access_token')
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const resp = await fetch(`${baseUrl}/api/projects/`, { headers: { Authorization: `Bearer ${token}` } })
      return resp.ok ? resp.json() : []
    },
    refetchInterval: 3000,
  })

  const createProject = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('access_token')
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const resp = await fetch(`${baseUrl}/api/projects/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, source_url: sourceUrl, source_type: sourceType }),
      })
      return resp.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setShowCreate(false)
      setName('')
      setSourceUrl('')
    },
  })

  const deployProject = useMutation({
    mutationFn: async (projectId: string) => {
      const token = localStorage.getItem('access_token')
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const resp = await fetch(`${baseUrl}/api/projects/${projectId}/deploy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      return resp.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })

  const deleteProject = useMutation({
    mutationFn: async (projectId: string) => {
      const token = localStorage.getItem('access_token')
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      await fetch(`${baseUrl}/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })

  const getStatusStyle = (status: string) => STATUS_CONFIG[status] || STATUS_CONFIG.received

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-heading font-bold text-white">Projects</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Deploy and manage applications with autonomous security controls</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-primary"
        >
          + New Project
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="glass-card p-6 space-y-4 animate-slide-up" style={{ border: '1px solid rgba(255, 68, 68, 0.15)' }}>
          <h2 className="text-sm font-semibold text-white">Create Project</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Project name" className="input-dark"
            />
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}
              className="input-dark">
              <option value="github">GitHub Repository</option>
              <option value="zip">ZIP Upload</option>
            </select>
          </div>
          <input
            type="text" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="input-dark"
          />
          <div className="flex gap-2">
            <button onClick={() => createProject.mutate()}
              disabled={!name || !sourceUrl}
              className="btn-primary disabled:opacity-50">
              Create
            </button>
            <button onClick={() => setShowCreate(false)}
              className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {/* Project List */}
      <div className="space-y-3 stagger">
        {isLoading ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <div className="w-6 h-6 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#ff4444', borderTopColor: 'transparent' }} />
            Loading projects...
          </div>
        ) : projects?.length > 0 ? (
          projects.map((p: any) => {
            const statusStyle = getStatusStyle(p.status)
            return (
              <div key={p.project_id} className="glass-card p-5 card-hover animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${
                      p.status === 'active' ? 'animate-pulse-dot' :
                      ['deploying','building','provisioning','assessing'].includes(p.status) ? 'animate-pulse-dot' : ''
                    }`} style={{
                      background: p.status === 'active' ? '#00ff88' :
                        p.status === 'failed' || p.status === 'gate_blocked' ? '#ff4444' :
                        ['deploying','building','provisioning','assessing'].includes(p.status) ? '#64b4ff' : '#6b6b7b'
                    }} />
                    <div>
                      <Link href={`/dashboard/projects/${p.project_id}`} className="text-sm font-semibold text-white hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{p.source_url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {p.posture_score != null && (
                      <span className="text-xs font-bold font-mono" style={{
                        color: p.posture_score >= 70 ? '#00ff88' : p.posture_score >= 40 ? '#ffd700' : '#ff4444'
                      }}>
                        {p.posture_score}/100
                      </span>
                    )}
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{
                      background: statusStyle.bg,
                      color: statusStyle.color,
                      border: `1px solid ${statusStyle.border}`,
                    }}>
                      {p.status}
                    </span>
                    {p.status === 'received' && (
                      <button onClick={() => deployProject.mutate(p.project_id)}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{
                          background: 'rgba(100,180,255,0.15)', color: '#64b4ff', border: '1px solid rgba(100,180,255,0.3)'
                        }}>
                        Deploy
                      </button>
                    )}
                    {p.endpoint && (
                      <a href={p.endpoint} target="_blank" rel="noopener noreferrer"
                        className="text-xs hover:underline" style={{ color: '#64b4ff' }}>
                        {p.endpoint}
                      </a>
                    )}
                    {p.status !== 'deleting' && p.status !== 'deleted' && (
                      <button onClick={() => { if (confirm('Delete this project? This destroys its AWS infrastructure.')) deleteProject.mutate(p.project_id) }}
                        className="text-xs px-2 py-1 rounded transition-colors" style={{ color: '#ff6b6b' }}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {p.error && (
                  <p className="mt-2 text-xs px-3 py-1.5 rounded" style={{ background: 'rgba(255,68,68,0.08)', color: '#ff6b6b', border: '1px solid rgba(255,68,68,0.15)' }}>{p.error}</p>
                )}
                {p.aws_stack && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>AWS: {p.aws_stack} ({p.aws_region})</p>
                )}
              </div>
            )
          })
        ) : (
          <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
            <span className="text-3xl block mb-3 opacity-30">⚡</span>
            <p className="text-sm">No projects yet. Create one to start deploying.</p>
          </div>
        )}
      </div>
    </div>
  )
}
