'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { formatDate, getSeverityColor } from '@/lib/utils'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import dynamic from 'next/dynamic'

// D3 graph is client-only
const AttackGraphVisualization = dynamic(
  () => import('@/components/graph/AttackGraphVisualization').then(m => m.AttackGraphVisualization),
  { ssr: false, loading: () => <div className="h-64 flex items-center justify-center text-sm text-gray-400">Loading graph...</div> }
)

export default function IncidentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const incidentId = params.id as string
  const [notes, setNotes] = useState('')
  const [showGraph, setShowGraph] = useState(false)
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState('')

  const { data: incident, isLoading } = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => apiClient.getIncident(incidentId),
  })

  const { data: attackPath, isLoading: graphLoading } = useQuery({
    queryKey: ['attack-path', incidentId],
    queryFn: () => apiClient.getIncidentAttackPath(incidentId),
    enabled: showGraph,
  })

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiClient.updateIncident(incidentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] })
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
    },
  })

  const handleAddNote = () => {
    if (!notes.trim()) return
    const current = incident?.notes || []
    updateMutation.mutate({ notes: [...current, { text: notes, timestamp: new Date().toISOString() }] })
    setNotes('')
  }

  const handleExplain = async () => {
    setExplaining(true)
    setExplainError('')
    try {
      await apiClient.explainIncident(incidentId)
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] })
    } catch (e: any) {
      setExplainError(e?.response?.data?.detail || 'Failed to generate explanation')
    } finally {
      setExplaining(false)
    }
  }

  // Normalise attack-path response → graph format
  const graphData = (() => {
    if (!attackPath) return { nodes: [], links: [] }
    const snap = attackPath.graph_snapshot || {}
    const rawNodes: any[] = snap.nodes || attackPath.attack_chain || []
    const rawLinks: any[] = snap.links || snap.edges || []
    const nodes = rawNodes.map((n: any, i: number) => ({
      id: n.id || String(i),
      type: n.type || n.entity_type || 'Process',
      label: n.label || n.name || n.id || String(i),
      properties: n.properties || {},
    }))
    const links = rawLinks.length
      ? rawLinks.map((l: any) => ({ source: l.source || l.from, target: l.target || l.to, type: l.type || l.relationship || 'LEADS_TO' }))
      : rawNodes.slice(1).map((_: any, i: number) => ({ source: String(i), target: String(i + 1), type: 'LEADS_TO' }))
    return { nodes, links }
  })()

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading incident...</div>
  )
  if (!incident) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Incident not found</div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back + status */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-900">← Back</button>
        <select
          value={incident.status}
          onChange={e => updateMutation.mutate({ status: e.target.value })}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          <option value="new">New</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
          <option value="false_positive">False Positive</option>
        </select>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-wrap gap-2 mb-3">
          <span className={`px-2.5 py-0.5 rounded-md text-xs font-semibold border ${getSeverityColor(incident.severity)}`}>
            {incident.severity}
          </span>
          <span className={`px-2.5 py-0.5 rounded-md text-xs font-semibold border ${
            incident.status === 'new' ? 'bg-red-50 text-red-700 border-red-200' :
            incident.status === 'investigating' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
            'bg-green-50 text-green-700 border-green-200'
          }`}>{incident.status}</span>
          {incident.mitre_technique && (
            <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              {incident.mitre_technique}
            </span>
          )}
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-4">
          {incident.title || incident.attack_pattern || `Incident ${incident.incident_id.toString().slice(0, 8)}`}
        </h1>
        {incident.description && <p className="text-sm text-gray-600 mb-4">{incident.description}</p>}
        <div className="flex flex-wrap gap-6 text-xs text-gray-500">
          <span>Detected: <span className="text-gray-800 font-medium">{formatDate(incident.created_at)}</span></span>
          {incident.resolved_at && <span>Resolved: <span className="text-gray-800 font-medium">{formatDate(incident.resolved_at)}</span></span>}
          {incident.attack_pattern && <span>Pattern: <span className="text-gray-800 font-medium">{incident.attack_pattern}</span></span>}
        </div>
      </div>

      {/* AI Analysis */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">AI Analysis</h2>
          <button
            onClick={handleExplain}
            disabled={explaining}
            className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {explaining ? 'Generating...' : incident.ai_summary ? 'Regenerate' : 'Generate Explanation'}
          </button>
        </div>
        {explainError && <p className="text-xs text-red-500 mb-3">{explainError}</p>}
        {incident.ai_summary ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{incident.ai_summary}</p>
        ) : (
          <p className="text-sm text-gray-400 italic">No AI analysis yet. Click &quot;Generate Explanation&quot; to analyze this incident with AI.</p>
        )}
      </div>

      {/* Attack Graph */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Attack Graph</h2>
          <button
            onClick={() => setShowGraph(v => !v)}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {showGraph ? 'Hide' : 'Show Graph'}
          </button>
        </div>
        {showGraph && (
          graphLoading ? (
            <div className="h-32 flex items-center justify-center text-sm text-gray-400">Loading graph data...</div>
          ) : graphData.nodes.length > 0 ? (
            <AttackGraphVisualization data={graphData} width={720} height={460} />
          ) : (
            <div className="h-32 flex flex-col items-center justify-center text-gray-400 text-sm">
              <p>No graph data for this incident.</p>
              <p className="text-xs mt-1 text-gray-300">Graph is populated by the detection engine when events are ingested.</p>
            </div>
          )
        )}
      </div>

      {/* Investigation Notes */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Investigation Notes</h2>
        <div className="space-y-3 mb-4">
          {incident.notes?.length > 0 ? incident.notes.map((note: any, i: number) => (
            <div key={i} className="border-l-4 border-gray-200 pl-4 py-1">
              <p className="text-sm text-gray-700">{note.text}</p>
              <p className="text-xs text-gray-400 mt-1">{formatDate(note.timestamp)}</p>
            </div>
          )) : <p className="text-sm text-gray-400">No notes yet.</p>}
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add investigation notes..."
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black mb-2"
        />
        <button
          onClick={handleAddNote}
          disabled={!notes.trim() || updateMutation.isPending}
          className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          Add Note
        </button>
      </div>
    </div>
  )
}
