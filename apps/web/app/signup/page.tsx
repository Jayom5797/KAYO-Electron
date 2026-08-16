'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import Link from 'next/link'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiClient.signup(email, password)
      router.push('/login')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0d0d12' }}>
      <div className="w-full max-w-md p-8 animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg, #ff4444, #cc2222)', boxShadow: '0 8px 32px rgba(255, 68, 68, 0.3)' }}>
            <span className="text-white text-2xl font-bold font-heading">K</span>
          </div>
          <h1 className="text-3xl font-bold text-white font-heading">Create Account</h1>
          <p className="text-sm mt-1" style={{ color: '#6b6b7b' }}>Start securing your applications</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-5">
          <div className="glass-card p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#a0a0b0' }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="input-dark" required />
            </div>
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#a0a0b0' }}>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="input-dark" required />
            </div>

            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(255,68,68,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,68,68,0.2)' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full" style={{ padding: '12px' }}>
              {loading ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>

        <p className="text-center text-sm mt-6" style={{ color: '#6b6b7b' }}>
          Already have an account?{' '}
          <Link href="/login" className="font-medium" style={{ color: '#ff4444' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
