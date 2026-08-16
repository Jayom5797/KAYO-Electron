'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { useParams, useRouter } from 'next/navigation'
import { AttackGraphVisualization } from '@/components/graph/AttackGraphVisualization'

export default function IncidentGraphPage() {
  const params = useParams()
  const router = useRouter()
  const incidentId = params.id as string

  const { data: attackPath, isLoading } = useQuery({
    queryKey: ['incident-attack-path', incidentId],
    queryFn: async () => {
      const response = await apiClient.getIncidentAttackPath(incidentId)
      return response
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading attack graph...</div>
      </div>
    )
  }

  if (!attackPath) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">No attack path data available</div>
      </div>
    )
  }

  // Transform attack path data to graph format
  const graphData = {
    nodes: attackPath.affected_entities?.map((entity: any) => ({
      id: entity.id,
      type: entity.type,
      label: entity.name || entity.id,
      properties: entity.properties,
    })) || [],
    links: attackPath.attack_chain?.map((step: any, idx: number) => ({
      source: step.from_entity,
      target: step.to_entity,
      type: step.relationship_type,
      timestamp: step.timestamp,
    })) || [],
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← Back to incident
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Attack Graph</h1>
          <p className="text-sm text-gray-600">
            Confidence Score: {(attackPath.confidence_score * 100).toFixed(1)}%
          </p>
        </div>

        <AttackGraphVisualization data={graphData} width={1000} height={700} />
      </div>

      {attackPath.root_cause && attackPath.root_cause.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Root Cause</h2>
          <div className="space-y-2">
            {attackPath.root_cause.map((entity: any, idx: number) => (
              <div key={idx} className="p-3 bg-gray-50 rounded-md">
                <div className="font-medium text-sm">{entity.type}</div>
                <div className="text-xs text-gray-600 font-mono">{entity.id}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {attackPath.timeline && attackPath.timeline.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Attack Timeline</h2>
          <div className="space-y-3">
            {attackPath.timeline.map((event: any, idx: number) => (
              <div key={idx} className="flex gap-4">
                <div className="flex-shrink-0 w-24 text-xs text-gray-500">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-900">{event.description}</div>
                  {event.entities && (
                    <div className="text-xs text-gray-500 mt-1">
                      Entities: {event.entities.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
