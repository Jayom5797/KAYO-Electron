'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

export default function CompliancePage() {
  const [eraseConfirm, setEraseConfirm] = useState('')
  const [eraseResult, setEraseResult] = useState<any>(null)
  const [exportData, setExportData] = useState<any>(null)

  const { data: report, isLoading, refetch } = useQuery({
    queryKey: ['compliance-report'],
    queryFn: () => apiClient.getComplianceReport(),
  })

  const retentionMutation = useMutation({
    mutationFn: () => apiClient.enforceRetention(),
  })

  const eraseMutation = useMutation({
    mutationFn: () => apiClient.eraseData(),
    onSuccess: (data) => setEraseResult(data),
  })

  const exportMutation = useMutation({
    mutationFn: () => apiClient.exportData(),
    onSuccess: (data) => setExportData(data),
  })

  const handleExportDownload = () => {
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kayo-data-export-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-heading font-bold text-white">Compliance</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>SOC 2 report, GDPR data controls, and retention policies</p>
      </div>

      {/* SOC 2 Report */}
      <div className="glass-card p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">SOC 2 Compliance Report</h2>
          <button onClick={() => refetch()} className="btn-ghost text-xs px-3 py-1">Refresh</button>
        </div>

        {isLoading ? (
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            <div className="w-6 h-6 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#ff4444', borderTopColor: 'transparent' }} />
          </div>
        ) : report ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: 'Total Audit Logs', value: report.audit_logs?.total ?? 0, color: 'var(--text)' },
                { label: 'Logs (30 days)', value: report.audit_logs?.last_30_days ?? 0, color: 'var(--text)' },
                { label: 'Failed Logins (30d)', value: report.audit_logs?.failed_login_attempts ?? 0, color: '#ff4444' },
                { label: 'Open Incidents', value: report.incidents?.open ?? 0, color: 'var(--text)' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  <div className="text-2xl font-bold" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>

            <div>
              <h3 className="text-sm font-medium text-white mb-2">Security Controls</h3>
              <div className="space-y-1">
                {report.controls && Object.entries(report.controls).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    <span style={{ color: '#00ff88' }}>✓</span>
                    <span style={{ color: 'var(--text-muted)' }} className="capitalize">{key.replace(/_/g, ' ')}:</span>
                    <span className="text-white">{value as string}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-white mb-2">Retention Policy</h3>
              <div className="flex gap-4">
                {report.retention_policy && Object.entries(report.retention_policy).map(([key, days]) => (
                  <div key={key} className="rounded px-3 py-2 text-sm" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-muted)' }} className="capitalize">{key.replace(/_/g, ' ')}: </span>
                    <span className="font-medium text-white">{days as number} days</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => retentionMutation.mutate()}
              disabled={retentionMutation.isPending}
              className="btn-primary disabled:opacity-50"
            >
              {retentionMutation.isPending ? 'Running...' : 'Enforce Retention Policy Now'}
            </button>
            {retentionMutation.isSuccess && (
              <p className="text-sm" style={{ color: '#00ff88' }}>Retention enforcement started in background.</p>
            )}
          </div>
        ) : null}
      </div>

      {/* GDPR Export */}
      <div className="glass-card p-6 animate-fade-in">
        <h2 className="text-lg font-semibold text-white mb-2">GDPR — Data Portability (Art. 20)</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Export all your tenant data as JSON.</p>
        <div className="flex gap-3">
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            className="btn-primary disabled:opacity-50"
          >
            {exportMutation.isPending ? 'Exporting...' : 'Export Data'}
          </button>
          {exportData && (
            <button onClick={handleExportDownload} className="btn-ghost">
              Download JSON
            </button>
          )}
        </div>
        {exportData && (
          <p className="mt-2 text-sm" style={{ color: '#00ff88' }}>
            Export ready: {exportData.incidents?.length ?? 0} incidents, {exportData.deployments?.length ?? 0} deployments
          </p>
        )}
      </div>

      {/* GDPR Erasure */}
      <div className="glass-card p-6 animate-fade-in" style={{ border: '1px solid rgba(255, 68, 68, 0.2)' }}>
        <h2 className="text-lg font-semibold mb-2" style={{ color: '#ff4444' }}>GDPR — Right to Erasure (Art. 17)</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Permanently delete all tenant data. This action is irreversible.
          Type <span className="font-mono font-bold text-white">DELETE ALL DATA</span> to confirm.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={eraseConfirm}
            onChange={e => setEraseConfirm(e.target.value)}
            placeholder="DELETE ALL DATA"
            className="input-dark font-mono"
            style={{ width: '200px' }}
          />
          <button
            onClick={() => eraseMutation.mutate()}
            disabled={eraseConfirm !== 'DELETE ALL DATA' || eraseMutation.isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #ff4444, #cc0000)', color: 'white', boxShadow: '0 4px 12px rgba(255, 68, 68, 0.3)' }}
          >
            {eraseMutation.isPending ? 'Erasing...' : 'Erase All Data'}
          </button>
        </div>
        {eraseResult && (
          <p className="mt-2 text-sm" style={{ color: '#ff6b6b' }}>Data erased: {JSON.stringify(eraseResult.deleted)}</p>
        )}
      </div>
    </div>
  )
}
