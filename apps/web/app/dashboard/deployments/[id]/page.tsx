'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { formatDate, getStatusColor } from '@/lib/utils'
import { useParams, useRouter } from 'next/navigation'

export default function DeploymentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const deploymentId = params.id as string

  const { data: deployment, isLoading } = useQuery({
    queryKey: ['deployment', deploymentId],
    queryFn: () => apiClient.getDeployment(deploymentId),
  })

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-500">Loading deployment...</div></div>
  }

  if (!deployment) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-500">Deployment not found</div></div>
  }

  const buildLogs = Array.isArray(deployment.build_logs)
    ? deployment.build_logs.map((l: any) => typeof l === 'string' ? l : `[${l.level || 'info'}] ${l.message || JSON.stringify(l)}`).join('\n')
    : typeof deployment.build_logs === 'string'
    ? deployment.build_logs
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to deployments
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{deployment.app_name}</h1>
            <span className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium border ${getStatusColor(deployment.status)}`}>
              {deployment.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Configuration</h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-gray-500">Git Repo</dt>
                <dd className="text-gray-900 font-mono text-xs break-all">{deployment.git_repo}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Branch</dt>
                <dd className="text-gray-900">{deployment.git_branch}</dd>
              </div>
              {deployment.image_name && (
                <div>
                  <dt className="text-gray-500">Image</dt>
                  <dd className="text-gray-900 font-mono text-xs break-all">{deployment.image_name}</dd>
                </div>
              )}
              {deployment.git_commit_sha && (
                <div>
                  <dt className="text-gray-500">Commit</dt>
                  <dd className="text-gray-900 font-mono text-xs">{deployment.git_commit_sha.slice(0, 8)}</dd>
                </div>
              )}
              <div>
                <dt className="text-gray-500">Namespace</dt>
                <dd className="text-gray-900 font-mono text-xs">{deployment.k8s_namespace}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Created</dt>
                <dd className="text-gray-900">{formatDate(deployment.created_at)}</dd>
              </div>
              {deployment.deployed_at && (
                <div>
                  <dt className="text-gray-500">Deployed</dt>
                  <dd className="text-gray-900">{formatDate(deployment.deployed_at)}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {deployment.env_vars && Object.keys(deployment.env_vars).length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Environment Variables</h2>
            <div className="bg-gray-50 rounded-md p-4">
              <dl className="space-y-2 text-sm font-mono">
                {Object.entries(deployment.env_vars).map(([key, value]) => (
                  <div key={key} className="flex">
                    <dt className="text-gray-700 w-1/3">{key}</dt>
                    <dd className="text-gray-900 w-2/3">{value as string}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Build Logs</h2>
        <div className="bg-gray-900 rounded-md p-4 overflow-x-auto max-h-96 overflow-y-auto">
          <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
            {buildLogs || 'No build logs available'}
          </pre>
        </div>
      </div>
    </div>
  )
}
