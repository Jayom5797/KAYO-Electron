'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { formatDate } from '@/lib/utils'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'connection' | 'invitations' | 'webhooks'>('connection')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [backendUrl, setBackendUrl] = useState('')
  const [saved, setSaved] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    const stored = localStorage.getItem('backend_url') || 'http://localhost:8000'
    setBackendUrl(stored)
  }, [])

  const handleSaveConnection = (e: React.FormEvent) => {
    e.preventDefault()
    const url = backendUrl.replace(/\/$/, '')
    localStorage.setItem('backend_url', url)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    window.location.reload()
  }

  const { data: invitations } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => apiClient.getInvitations(0, 100),
    enabled: activeTab === 'invitations',
  })

  const { data: webhooks } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiClient.getWebhooks(0, 100),
    enabled: activeTab === 'webhooks',
  })

  const createInvitationMutation = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      apiClient.createInvitation(data.email, data.role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
      setInviteEmail('')
      setInviteRole('member')
    },
  })

  const revokeInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => apiClient.revokeInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
    },
  })

  const handleCreateInvitation = (e: React.FormEvent) => {
    e.preventDefault()
    createInvitationMutation.mutate({ email: inviteEmail, role: inviteRole })
  }

  const tabs = [
    { id: 'connection', label: 'Connection' },
    { id: 'invitations', label: 'Team Members' },
    { id: 'webhooks', label: 'Webhooks' },
  ] as const

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-heading font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Manage team members and integrations</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              background: activeTab === tab.id ? 'rgba(255, 68, 68, 0.1)' : 'transparent',
              color: activeTab === tab.id ? '#ff4444' : 'var(--text-secondary)',
              border: activeTab === tab.id ? '1px solid rgba(255, 68, 68, 0.2)' : '1px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'connection' && (
        <div className="glass-card p-6 max-w-lg animate-fade-in">
          <h2 className="text-lg font-semibold text-white mb-1">Backend Connection</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            The frontend connects to the backend via the Next.js proxy.
            Make sure the backend is running on <span className="font-mono" style={{ color: '#64b4ff' }}>http://localhost:8000</span>.
          </p>
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#00ff88' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Proxy configured → <span className="font-mono" style={{ color: '#64b4ff' }}>http://localhost:8000</span></span>
          </div>
          <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            To change the backend URL, update <span className="font-mono">NEXT_PUBLIC_API_URL</span> in <span className="font-mono">.env.local</span> and restart.
          </p>
        </div>
      )}

      {activeTab === 'invitations' && (
        <div className="space-y-6 animate-fade-in">
          <div className="glass-card p-6" style={{ border: '1px solid rgba(255, 68, 68, 0.1)' }}>
            <h2 className="text-lg font-semibold text-white mb-4">Invite Team Member</h2>
            <form onSubmit={handleCreateInvitation} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Email</label>
                  <input
                    type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                    required className="input-dark" placeholder="analyst@security-team.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Role</label>
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="input-dark">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <button type="submit" disabled={createInvitationMutation.isPending} className="btn-primary disabled:opacity-50">
                {createInvitationMutation.isPending ? 'Sending...' : 'Send Invitation'}
              </button>
            </form>
          </div>

          <div className="glass-card overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <div className="col-span-4">Email</div>
              <div className="col-span-2">Role</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Created</div>
              <div className="col-span-2">Actions</div>
            </div>
            {invitations && invitations.length > 0 ? (
              <div className="stagger">
                {invitations.map((invitation: any) => (
                  <div key={invitation.invitation_id} className="grid grid-cols-12 gap-2 px-6 py-3 items-center text-sm"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                  >
                    <div className="col-span-4 text-white">{invitation.email}</div>
                    <div className="col-span-2" style={{ color: 'var(--text-secondary)' }}>{invitation.role}</div>
                    <div className="col-span-2">
                      <span className="badge text-xs" style={{
                        background: invitation.status === 'pending' ? 'rgba(255,184,0,0.08)' : invitation.status === 'accepted' ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.04)',
                        color: invitation.status === 'pending' ? '#ffd700' : invitation.status === 'accepted' ? '#00ff88' : 'var(--text-muted)',
                        border: `1px solid ${invitation.status === 'pending' ? 'rgba(255,184,0,0.3)' : invitation.status === 'accepted' ? 'rgba(0,255,136,0.3)' : 'var(--border)'}`,
                      }}>
                        {invitation.status}
                      </span>
                    </div>
                    <div className="col-span-2 text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(invitation.created_at)}</div>
                    <div className="col-span-2">
                      {invitation.status === 'pending' && (
                        <button onClick={() => revokeInvitationMutation.mutate(invitation.invitation_id)}
                          className="text-xs" style={{ color: '#ff6b6b' }}>Revoke</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-6 py-12 text-center" style={{ color: 'var(--text-muted)' }}>No invitations</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'webhooks' && <WebhooksTab />}
    </div>
  )
}

const EVENT_TYPES = [
  'incident.created', 'incident.updated', 'incident.resolved',
  'deployment.created', 'deployment.failed', 'deployment.succeeded',
  'alert.triggered', '*',
]

function WebhooksTab() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [selectedWebhook, setSelectedWebhook] = useState<any>(null)
  const [form, setForm] = useState({ name: '', url: '', event_types: ['incident.created'], description: '' })

  const { data: webhooks, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiClient.getWebhooks(0, 100),
  })

  const { data: deliveries } = useQuery({
    queryKey: ['webhook-deliveries', selectedWebhook?.webhook_id],
    queryFn: () => apiClient.getWebhookDeliveries(selectedWebhook.webhook_id),
    enabled: !!selectedWebhook,
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.createWebhook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      setShowForm(false)
      setForm({ name: '', url: '', event_types: ['incident.created'], description: '' })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: any) => apiClient.updateWebhook(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteWebhook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      if (selectedWebhook) setSelectedWebhook(null)
    },
  })

  const toggleEventType = (et: string) => {
    setForm(f => ({
      ...f,
      event_types: f.event_types.includes(et)
        ? f.event_types.filter(e => e !== et)
        : [...f.event_types, et],
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(form)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Webhooks</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Receive HTTP notifications for platform events</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? 'Cancel' : 'Add Webhook'}
        </button>
      </div>

      {showForm && (
        <div className="glass-card p-6 animate-slide-up" style={{ border: '1px solid rgba(255, 68, 68, 0.1)' }}>
          <h3 className="text-sm font-semibold text-white mb-4">New Webhook</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Name</label>
                <input type="text" required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Slack Alerts" className="input-dark" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>URL</label>
                <input type="url" required value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://hooks.slack.com/..." className="input-dark" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Event Types</label>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map(et => (
                  <button key={et} type="button" onClick={() => toggleEventType(et)}
                    className="px-3 py-1 rounded text-xs font-medium transition-all"
                    style={{
                      background: form.event_types.includes(et) ? 'rgba(255, 68, 68, 0.15)' : 'rgba(255,255,255,0.04)',
                      color: form.event_types.includes(et) ? '#ff4444' : 'var(--text-secondary)',
                      border: `1px solid ${form.event_types.includes(et) ? 'rgba(255, 68, 68, 0.3)' : 'var(--border)'}`,
                    }}
                  >
                    {et}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Description (optional)</label>
              <input type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="input-dark" />
            </div>
            <button type="submit" disabled={createMutation.isPending || form.event_types.length === 0}
              className="btn-primary disabled:opacity-50">
              {createMutation.isPending ? 'Creating...' : 'Create Webhook'}
            </button>
          </form>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : webhooks && webhooks.length > 0 ? (
          <div>
            <div className="grid grid-cols-12 gap-2 px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <div className="col-span-2">Name</div>
              <div className="col-span-3">URL</div>
              <div className="col-span-3">Events</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-3">Actions</div>
            </div>
            {webhooks.map((wh: any) => (
              <div key={wh.webhook_id} className="grid grid-cols-12 gap-2 px-6 py-3 items-center text-sm transition-colors"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div className="col-span-2 font-medium text-white">{wh.name}</div>
                <div className="col-span-3 text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>{wh.url}</div>
                <div className="col-span-3 text-xs" style={{ color: 'var(--text-muted)' }}>{wh.event_types.join(', ')}</div>
                <div className="col-span-1">
                  <span className="badge text-xs" style={{
                    background: wh.is_active ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.04)',
                    color: wh.is_active ? '#00ff88' : 'var(--text-muted)',
                    border: `1px solid ${wh.is_active ? 'rgba(0,255,136,0.3)' : 'var(--border)'}`,
                  }}>
                    {wh.is_active ? 'Active' : 'Off'}
                  </span>
                </div>
                <div className="col-span-3 flex gap-3 text-xs">
                  <button onClick={() => setSelectedWebhook(selectedWebhook?.webhook_id === wh.webhook_id ? null : wh)}
                    style={{ color: 'var(--text-secondary)' }}>Logs</button>
                  <button onClick={() => toggleMutation.mutate({ id: wh.webhook_id, is_active: !wh.is_active })}
                    style={{ color: 'var(--text-secondary)' }}>
                    {wh.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => deleteMutation.mutate(wh.webhook_id)} style={{ color: '#ff6b6b' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
            <span className="text-3xl block mb-3 opacity-30">🔗</span>
            No webhooks configured
          </div>
        )}
      </div>

      {selectedWebhook && (
        <div className="glass-card p-6 animate-slide-up">
          <h3 className="text-sm font-semibold text-white mb-4">
            Delivery Logs — {selectedWebhook.name}
          </h3>
          {deliveries && deliveries.length > 0 ? (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <div className="col-span-3">Event</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Code</div>
                <div className="col-span-2">Attempts</div>
                <div className="col-span-3">Time</div>
              </div>
              {deliveries.map((d: any) => (
                <div key={d.delivery_id} className="grid grid-cols-12 gap-2 px-4 py-2 text-xs items-center"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                >
                  <div className="col-span-3 text-white">{d.event_type}</div>
                  <div className="col-span-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium" style={{
                      background: d.status === 'delivered' ? 'rgba(0,255,136,0.08)' : 'rgba(255,68,68,0.08)',
                      color: d.status === 'delivered' ? '#00ff88' : '#ff6b6b',
                    }}>{d.status}</span>
                  </div>
                  <div className="col-span-2" style={{ color: 'var(--text-muted)' }}>{d.status_code ?? '—'}</div>
                  <div className="col-span-2" style={{ color: 'var(--text-muted)' }}>{d.attempts}</div>
                  <div className="col-span-3" style={{ color: 'var(--text-muted)' }}>{formatDate(d.created_at)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No deliveries yet</p>
          )}
        </div>
      )}
    </div>
  )
}
