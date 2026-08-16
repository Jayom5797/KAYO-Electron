'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '@/lib/api-client'

const schema = z.object({
  app_name: z.string().min(1, 'App name is required').max(255),
  git_repo: z.string().min(1, 'Git repository URL is required'),
  git_branch: z.string().min(1, 'Branch is required'),
})

type FormData = z.infer<typeof schema>

export default function NewDeploymentPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([])

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { git_branch: 'main' },
  })

  const addEnvVar = () => setEnvVars(prev => [...prev, { key: '', value: '' }])
  const removeEnvVar = (i: number) => setEnvVars(prev => prev.filter((_, idx) => idx !== i))
  const updateEnvVar = (i: number, field: 'key' | 'value', val: string) => {
    setEnvVars(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e))
  }

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    setError(null)
    try {
      const env_vars: Record<string, string> = {}
      envVars.forEach(({ key, value }) => { if (key) env_vars[key] = value })

      const deployment = await apiClient.createDeployment({
        app_name: data.app_name,
        git_repo: data.git_repo,
        git_branch: data.git_branch,
        env_vars,
      })
      router.push(`/dashboard/deployments/${deployment.deployment_id}`)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to create deployment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black"

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Deployment</h1>
        <p className="mt-1 text-sm text-gray-500">Deploy an application from a Git repository</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-lg shadow p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">App Name</label>
          <input {...register('app_name')} type="text" className={inputClass} placeholder="my-app" />
          {errors.app_name && <p className="mt-1 text-xs text-red-600">{errors.app_name.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Git Repository URL</label>
          <input {...register('git_repo')} type="text" className={inputClass} placeholder="https://github.com/org/repo" />
          {errors.git_repo && <p className="mt-1 text-xs text-red-600">{errors.git_repo.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
          <input {...register('git_branch')} type="text" className={inputClass} placeholder="main" />
          {errors.git_branch && <p className="mt-1 text-xs text-red-600">{errors.git_branch.message}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Environment Variables</label>
            <button type="button" onClick={addEnvVar} className="text-xs text-gray-600 border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">
              + Add Variable
            </button>
          </div>
          {envVars.length === 0 ? (
            <p className="text-xs text-gray-400">No environment variables</p>
          ) : (
            <div className="space-y-2">
              {envVars.map((ev, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text" value={ev.key} placeholder="KEY"
                    onChange={e => updateEnvVar(i, 'key', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                  />
                  <input
                    type="text" value={ev.value} placeholder="value"
                    onChange={e => updateEnvVar(i, 'value', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                  />
                  <button type="button" onClick={() => removeEnvVar(i)} className="text-xs text-red-500 hover:text-red-700 px-2">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button" onClick={() => router.back()} disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-black rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Deployment'}
          </button>
        </div>
      </form>
    </div>
  )
}
