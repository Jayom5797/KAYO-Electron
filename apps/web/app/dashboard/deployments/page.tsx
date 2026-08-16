'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { formatDate, getStatusColor } from '@/lib/utils'
import Link from 'next/link'

export default function DeploymentsPage() {
  const router = useRouter()

  const { data: deployments, isLoading } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => apiClient.getDeployments(0, 100),
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-white">Deployments</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Manage your application deployments</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/deployments/new')}
          className="btn-primary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Deployment
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="flex gap-4 items-center">
                <div className="skeleton w-2 h-2 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-1/3" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
                <div className="skeleton h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : deployments && deployments.length > 0 ? (
          <div>
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <div className="col-span-3">App</div>
              <div className="col-span-4">Source</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Created</div>
              <div className="col-span-1"></div>
            </div>
            {/* Table Body */}
            <div className="stagger">
              {deployments.map((d: any) => (
                <div key={d.deployment_id} className="grid grid-cols-12 gap-4 px-6 py-4 items-center transition-colors duration-100 animate-fade-in"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="col-span-3 flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      d.status === 'running' ? 'animate-pulse-dot' : ''
                    }`} style={{
                      background: d.status === 'running' ? '#00ff88' :
                        d.status === 'failed' ? '#ff4444' :
                        d.status === 'pending' ? '#ffd700' : '#6b6b7b'
                    }} />
                    <Link
                      href={`/dashboard/deployments/${d.deployment_id}`}
                      className="text-sm font-medium text-white hover:underline"
                    >
                      {d.app_name}
                    </Link>
                  </div>
                  <div className="col-span-4 text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                    {d.image_name || d.git_repo}
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{
                      background: d.status === 'running' ? 'rgba(0,255,136,0.08)' :
                        d.status === 'failed' ? 'rgba(255,68,68,0.08)' :
                        d.status === 'pending' ? 'rgba(255,184,0,0.08)' : 'rgba(255,255,255,0.04)',
                      color: d.status === 'running' ? '#00ff88' :
                        d.status === 'failed' ? '#ff6b6b' :
                        d.status === 'pending' ? '#ffd700' : 'var(--text-muted)',
                      border: `1px solid ${
                        d.status === 'running' ? 'rgba(0,255,136,0.3)' :
                        d.status === 'failed' ? 'rgba(255,68,68,0.3)' :
                        d.status === 'pending' ? 'rgba(255,184,0,0.3)' : 'var(--border)'
                      }`,
                    }}>
                      {d.status}
                    </span>
                  </div>
                  <div className="col-span-2 text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(d.created_at)}</div>
                  <div className="col-span-1 text-right">
                    <Link
                      href={`/dashboard/deployments/${d.deployment_id}`}
                      className="text-xs font-medium transition-colors" style={{ color: 'var(--text-muted)' }}
                    >
                      View →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 animate-fade-in" style={{ color: 'var(--text-muted)' }}>
            <span className="text-4xl mb-4 opacity-25">🚀</span>
            <p className="text-sm font-medium">No deployments yet</p>
            <button
              onClick={() => router.push('/dashboard/deployments/new')}
              className="mt-3 text-xs underline underline-offset-2" style={{ color: '#ff4444' }}
            >
              Create your first deployment
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
