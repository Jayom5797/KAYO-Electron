'use client'

import { useQuery } from '@tanstack/react-query'
import { formatRelativeTime } from '@/lib/utils'

export default function AssetsPage() {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: () => fetch('/api/scans/assets', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
    }).then(r => r.ok ? r.json() : []),
  })

  return (
    <div className="space-y-8">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-heading font-bold text-white">Applications & Assets</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Track your applications across the security lifecycle</p>
      </div>

      <div className="glass-card overflow-hidden">
        <div>
          {isLoading ? (
            <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
              <div className="w-6 h-6 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#ff4444', borderTopColor: 'transparent' }} />
              Loading...
            </div>
          ) : assets?.length > 0 ? (
            <div className="stagger">
              {assets.map((asset: any) => (
                <div key={asset.asset_id} className="px-6 py-4 transition-colors animate-fade-in"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{asset.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {asset.type} • {asset.git_repo || asset.url || 'No source configured'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {asset.tags?.map((tag: string) => (
                        <span key={tag} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>{tag}</span>
                      ))}
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(asset.created_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center" style={{ color: 'var(--text-muted)' }}>
              <span className="text-3xl block mb-3 opacity-30">◫</span>
              <p className="text-sm">No assets registered. Assets are created when you deploy or assess an application.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
