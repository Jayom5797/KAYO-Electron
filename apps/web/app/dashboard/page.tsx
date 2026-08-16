'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import { apiClient } from '@/lib/api-client'
import { formatRelativeTime, getSeverityColor, getStatusColor } from '@/lib/utils'
import { analyzeZip, type AnalysisResult } from '@/lib/project-analyzer'
import Link from 'next/link'

function StatCard({ label, value, sub, icon, color }: { label: string; value: string | number; sub?: string; icon: string; color: string }) {
  return (
    <div className="glass-card p-5 card-hover animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <p className="text-3xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="glass-card p-5">
      <div className="skeleton h-3 w-20 mb-3" />
      <div className="skeleton h-8 w-12" />
    </div>
  )
}

export default function DashboardPage() {
  const { data: incidents, isLoading: incidentsLoading } = useQuery({
    queryKey: ['incidents', 0, 5],
    queryFn: () => apiClient.getIncidents(0, 5),
  })

  const { data: deployments, isLoading: deploymentsLoading } = useQuery({
    queryKey: ['deployments', 0, 5],
    queryFn: () => apiClient.getDeployments(0, 5),
  })

  const criticalCount = incidents?.filter((i: any) => i.severity === 'critical').length ?? 0
  const openCount     = incidents?.filter((i: any) => i.status === 'new').length ?? 0
  const runningDeps   = deployments?.filter((d: any) => d.status === 'running').length ?? 0

  // Project analyzer state
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.zip')) { setAnalyzeError('Please upload a .zip file'); return }
    setAnalyzing(true)
    setAnalyzeError(null)
    setAnalysis(null)
    try {
      const result = await analyzeZip(file)
      setAnalysis(result)
      setShowAnalysis(true)
    } catch (err: any) {
      setAnalyzeError(err.message || 'Failed to analyze ZIP')
    } finally {
      setAnalyzing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="animate-fade-in">
        <h1 className="text-2xl font-heading font-bold text-white">Security Overview</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Real-time threat detection and behavior analysis</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        {incidentsLoading || deploymentsLoading ? (
          [1,2,3,4].map(i => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard label="Total Incidents" value={incidents?.length ?? 0} sub="all time" icon="⚠" color="var(--text)" />
            <StatCard label="Open" value={openCount} sub="need attention" icon="🔴" color={openCount > 0 ? '#ff6b6b' : 'var(--text)'} />
            <StatCard label="Critical" value={criticalCount} sub="high priority" icon="💀" color={criticalCount > 0 ? '#ff4444' : 'var(--text)'} />
            <StatCard label="Active Deploys" value={runningDeps} sub="running now" icon="🚀" color="#00ff88" />
          </>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incidents */}
        <div className="glass-card overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold text-white">Recent Incidents</h2>
            <Link href="/dashboard/incidents" className="text-xs transition-colors" style={{ color: 'var(--text-muted)' }}>
              View all →
            </Link>
          </div>
          <div>
            {incidentsLoading ? (
              <div className="p-6 space-y-3">
                {[1,2,3].map(i => <div key={i} className="skeleton h-12 w-full" />)}
              </div>
            ) : incidents && incidents.length > 0 ? (
              <div className="stagger">
                {incidents.map((incident: any) => (
                  <Link
                    key={incident.incident_id}
                    href={`/dashboard/incidents/${incident.incident_id}`}
                    className="flex items-center gap-4 px-6 py-4 transition-colors duration-150 animate-fade-in"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span className={`badge ${
                      incident.severity === 'critical' ? 'badge-critical' :
                      incident.severity === 'high' ? 'badge-high' :
                      incident.severity === 'medium' ? 'badge-medium' : 'badge-low'
                    }`}>
                      {incident.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {incident.title || incident.attack_pattern || `Incident ${incident.incident_id.toString().slice(0,8)}`}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(incident.created_at)}</p>
                    </div>
                    <span className={`badge ${
                      incident.status === 'new' ? 'badge-critical' :
                      incident.status === 'resolved' ? 'badge-success' : 'badge-high'
                    }`}>{incident.status}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--text-muted)' }}>
                <span className="text-3xl mb-3 opacity-30">🛡️</span>
                <p className="text-sm">No incidents detected</p>
              </div>
            )}
          </div>
        </div>

        {/* Deployments */}
        <div className="glass-card overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold text-white">Active Deployments</h2>
            <Link href="/dashboard/deployments" className="text-xs transition-colors" style={{ color: 'var(--text-muted)' }}>
              View all →
            </Link>
          </div>
          <div>
            {deploymentsLoading ? (
              <div className="p-6 space-y-3">
                {[1,2,3].map(i => <div key={i} className="skeleton h-12 w-full" />)}
              </div>
            ) : deployments && deployments.length > 0 ? (
              <div className="stagger">
                {deployments.map((deployment: any) => (
                  <Link
                    key={deployment.deployment_id}
                    href={`/dashboard/deployments/${deployment.deployment_id}`}
                    className="flex items-center gap-4 px-6 py-4 transition-colors duration-150 animate-fade-in"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      deployment.status === 'running' ? 'animate-pulse-dot' : ''
                    }`} style={{
                      background: deployment.status === 'running' ? '#00ff88' :
                        deployment.status === 'failed' ? '#ff4444' : '#ffb800'
                    }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{deployment.app_name}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{deployment.image_name || deployment.git_repo}</p>
                    </div>
                    <span className={`badge ${
                      deployment.status === 'running' ? 'badge-success' :
                      deployment.status === 'failed' ? 'badge-critical' : 'badge-high'
                    }`}>{deployment.status}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--text-muted)' }}>
                <span className="text-3xl mb-3 opacity-30">🚀</span>
                <p className="text-sm">No active deployments</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Project Analyzer */}
      <div className="glass-card overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold text-white">Project Analyzer</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Upload your project ZIP to analyze code quality, security, endpoints, and services</p>
          </div>
          <div className="flex items-center gap-3">
            {analysis && (
              <button onClick={() => setShowAnalysis(!showAnalysis)} className="btn-ghost text-xs">
                {showAnalysis ? 'Hide Report' : 'Show Report'}
              </button>
            )}
            <input ref={fileInputRef} type="file" accept=".zip" onChange={handleZipUpload} className="hidden" id="zip-upload" />
            <label htmlFor="zip-upload" className={`cursor-pointer text-sm font-medium rounded-lg transition-colors px-4 py-2 ${analyzing ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ background: 'linear-gradient(135deg, var(--primary), #cc2222)', color: 'white', boxShadow: '0 4px 12px var(--primary-glow)' }}>
              {analyzing ? 'Analyzing...' : analysis ? 'Re-analyze ZIP' : 'Upload ZIP'}
            </label>
          </div>
        </div>

        {analyzeError && (
          <div className="px-6 py-3 text-sm" style={{ background: 'rgba(255,68,68,0.1)', borderBottom: '1px solid rgba(255,68,68,0.2)', color: '#ff6b6b' }}>{analyzeError}</div>
        )}

        {analyzing && (
          <div className="px-6 py-12 text-center">
            <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#ff4444', borderTopColor: 'transparent' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Analyzing project structure...</p>
          </div>
        )}

        {analysis && showAnalysis && (
          <div className="p-6 space-y-6">
            {/* Frameworks + Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--text-muted)' }}>Frameworks & Stack</p>
                <div className="flex flex-wrap gap-2">
                  {analysis.frameworks.map((f, i) => (
                    <span key={i} className="px-3 py-1 rounded-full text-xs font-medium" style={{
                      background: f.type === 'frontend' ? 'rgba(100,180,255,0.1)' : f.type === 'backend' ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)',
                      color: f.type === 'frontend' ? '#64b4ff' : f.type === 'backend' ? '#00ff88' : 'var(--text-secondary)',
                      border: `1px solid ${f.type === 'frontend' ? 'rgba(100,180,255,0.2)' : f.type === 'backend' ? 'rgba(0,255,136,0.2)' : 'var(--border)'}`,
                    }}>
                      {f.name}{f.version ? ` ${f.version}` : ''}
                    </span>
                  ))}
                  {analysis.frameworks.length === 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No frameworks detected</span>}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--text-muted)' }}>Code Stats</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { val: analysis.stats.totalFiles, label: 'Files' },
                    { val: analysis.stats.totalLines.toLocaleString(), label: 'Lines' },
                    { val: Object.keys(analysis.stats.languages).length, label: 'Languages' },
                  ].map(({ val, label }) => (
                    <div key={label} className="rounded-lg p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                      <div className="text-lg font-bold text-white">{val}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(analysis.stats.languages).sort((a,b) => b[1]-a[1]).slice(0,5).map(([lang, lines]) => (
                    <span key={lang} className="text-xs rounded px-2 py-0.5" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>{lang}: {lines.toLocaleString()}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Services */}
            <div>
              <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--text-muted)' }}>Services Detected</p>
              {analysis.services.filter(s => s.found).length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No known services detected</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {analysis.services.filter(s => s.found).map((svc, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(0,255,136,0.05)', border: '1px solid rgba(0,255,136,0.2)' }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#00ff88' }} />
                      <div>
                        <div className="text-xs font-medium text-white">{svc.name}</div>
                        {svc.sources.length > 0 && (
                          <div className="text-xs truncate max-w-[140px]" style={{ color: 'var(--text-muted)' }} title={svc.sources.join(', ')}>{svc.sources[0]}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Endpoints */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--text-muted)' }}>
                  Open Endpoints <span style={{ color: 'var(--text-muted)' }}>({analysis.openEndpoints.length})</span>
                </p>
                <div className="rounded-lg overflow-hidden max-h-48 overflow-y-auto" style={{ border: '1px solid var(--border)' }}>
                  {analysis.openEndpoints.length === 0 ? (
                    <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>None detected</div>
                  ) : analysis.openEndpoints.map((ep, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded" style={{
                        background: ep.method === 'GET' ? 'rgba(0,255,136,0.1)' : ep.method === 'POST' ? 'rgba(100,180,255,0.1)' : 'rgba(255,255,255,0.05)',
                        color: ep.method === 'GET' ? '#00ff88' : ep.method === 'POST' ? '#64b4ff' : 'var(--text-secondary)',
                      }}>{ep.method}</span>
                      <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{ep.path}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--text-muted)' }}>
                  Protected Endpoints <span style={{ color: 'var(--text-muted)' }}>({analysis.protectedEndpoints.length})</span>
                </p>
                <div className="rounded-lg overflow-hidden max-h-48 overflow-y-auto" style={{ border: '1px solid var(--border)' }}>
                  {analysis.protectedEndpoints.length === 0 ? (
                    <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>None detected</div>
                  ) : analysis.protectedEndpoints.map((ep, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded" style={{
                        background: ep.method === 'GET' ? 'rgba(0,255,136,0.1)' : ep.method === 'POST' ? 'rgba(100,180,255,0.1)' : ep.method === 'DELETE' ? 'rgba(255,68,68,0.1)' : 'rgba(255,255,255,0.05)',
                        color: ep.method === 'GET' ? '#00ff88' : ep.method === 'POST' ? '#64b4ff' : ep.method === 'DELETE' ? '#ff6b6b' : 'var(--text-secondary)',
                      }}>{ep.method}</span>
                      <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{ep.path}</span>
                      <span className="text-xs" style={{ color: '#ffb800' }}>🔒</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Code Quality + Security */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Code Quality</p>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                      <div className="h-full rounded-full" style={{
                        width: `${analysis.codeQuality.score}%`,
                        background: analysis.codeQuality.score >= 80 ? '#00ff88' : analysis.codeQuality.score >= 60 ? '#ffb800' : '#ff4444',
                      }} />
                    </div>
                    <span className="text-sm font-bold" style={{
                      color: analysis.codeQuality.score >= 80 ? '#00ff88' : analysis.codeQuality.score >= 60 ? '#ffb800' : '#ff4444',
                    }}>
                      {analysis.codeQuality.score}/100
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  {analysis.codeQuality.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg" style={{
                      background: issue.severity === 'error' ? 'rgba(255,68,68,0.08)' : issue.severity === 'warning' ? 'rgba(255,184,0,0.08)' : 'rgba(255,255,255,0.03)',
                      color: issue.severity === 'error' ? '#ff6b6b' : issue.severity === 'warning' ? '#ffd700' : 'var(--text-secondary)',
                    }}>
                      <span>{issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : '✓'}</span>
                      <span>{issue.message}{issue.file ? ` (${issue.file})` : ''}</span>
                    </div>
                  ))}
                  {analysis.codeQuality.positives.map((p, i) => (
                    <div key={`pos-${i}`} className="flex items-start gap-2 text-xs p-2 rounded-lg" style={{ background: 'rgba(0,255,136,0.06)', color: '#00ff88' }}>
                      <span>✓</span><span>{p}</span>
                    </div>
                  ))}
                  {analysis.duplicateEndpoints.length > 0 && (
                    <div className="flex items-start gap-2 text-xs p-2 rounded-lg" style={{ background: 'rgba(255,68,68,0.08)', color: '#ff6b6b' }}>
                      <span>✗</span>
                      <span>Duplicate endpoints: {analysis.duplicateEndpoints.map(d => `${d.method} ${d.path} (×${d.count})`).join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase mb-3" style={{ color: 'var(--text-muted)' }}>Security</p>
                <div className="space-y-2">
                  {analysis.security.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg" style={{
                      background: issue.severity === 'error' ? 'rgba(255,68,68,0.08)' : issue.severity === 'warning' ? 'rgba(255,184,0,0.08)' : 'rgba(0,255,136,0.06)',
                      color: issue.severity === 'error' ? '#ff6b6b' : issue.severity === 'warning' ? '#ffd700' : '#00ff88',
                    }}>
                      <span>{issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : '✓'}</span>
                      <span>{issue.message}{issue.file ? ` (${issue.file})` : ''}</span>
                    </div>
                  ))}
                </div>
                {analysis.envFiles.length > 0 && (
                  <div className="mt-3 p-2 rounded-lg text-xs" style={{ background: 'rgba(0,255,136,0.06)', color: '#00ff88' }}>
                    ✓ .env files found: {analysis.envFiles.map(f => f.split('/').pop()).join(', ')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!analysis && !analyzing && (
          <div className="px-6 py-10 text-center" style={{ color: 'var(--text-muted)' }}>
            <span className="text-3xl block mb-3 opacity-30">📄</span>
            <p className="text-sm">Upload a ZIP of your project to get a full analysis report</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>All analysis runs locally in your browser — no data is uploaded anywhere</p>
          </div>
        )}
      </div>
    </div>
  )
}
