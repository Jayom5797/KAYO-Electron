'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const { setUser } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiClient.login(email, password)
      const user = await apiClient.getCurrentUser()
      setUser(user)
      router.push('/dashboard')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0d0d12' }}>
      <div className="w-full max-w-md p-8 animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg, #ff4444, #cc2222)', boxShadow: '0 8px 32px rgba(255, 68, 68, 0.3)' }}>
            <span className="text-white text-2xl font-bold font-heading">K</span>
          </div>
          <h1 className="text-3xl font-bold text-white font-heading">KAYO</h1>
          <p className="text-sm mt-1" style={{ color: '#6b6b7b' }}>Security Lifecycle Platform</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="glass-card p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#a0a0b0' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="input-dark"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#a0a0b0' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-dark"
                required
              />
            </div>

            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(255,68,68,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,68,68,0.2)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
              style={{ padding: '12px 24px', fontSize: '0.9rem' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </div>
        </form>

        <p className="text-center text-sm mt-6" style={{ color: '#6b6b7b' }}>
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium" style={{ color: '#ff4444' }}>
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
