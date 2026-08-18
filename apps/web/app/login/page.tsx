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
  const [showPassword, setShowPassword] = useState(false)

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
    <div className="min-h-screen flex flex-row-reverse" style={{ background: '#000000' }}>
      {/* Right side — Form */}
      <div className="w-full lg:w-[45%] flex flex-col justify-start px-8 md:px-12 lg:px-16 pt-16 pb-12 relative">
        {/* Back button */}
        <Link href="/" className="absolute top-6 right-6 flex items-center gap-1 px-3 py-2 rounded-full transition-all hover:bg-[rgba(255,255,255,0.05)]" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-xs font-medium text-[#6a7a8a]">← Back</span>
        </Link>

        <div className="max-w-md w-full">
          {/* Logo */}
          <img src="/KAYO.png" alt="KAYO" className="h-24 mb-3" />

          {/* Heading */}
          <h1 className="font-heading font-bold text-3xl md:text-4xl text-white leading-tight">
            Secure Access.
          </h1>
          <h2 className="font-heading font-bold text-3xl md:text-4xl leading-tight mb-2" style={{ color: '#4a9eff' }}>
            Global Impact.
          </h2>
          <p className="text-sm mb-4" style={{ color: '#5a6a7a' }}>
            Sign in to your account and continue securing what matters.
          </p>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2 text-white">Email Address</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4a5a6a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full pl-10 pr-4 py-3.5 rounded-xl text-sm text-white placeholder-[#4a5a6a] outline-none focus:border-[#4a9eff]"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-2 text-white">Password</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4a5a6a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-10 py-3.5 rounded-xl text-sm text-white placeholder-[#4a5a6a] outline-none focus:border-[#4a9eff]"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
                  required
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a5a6a] hover:text-white">
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,68,68,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,68,68,0.2)' }}>
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded accent-[#4a9eff]" />
                <span className="text-xs" style={{ color: '#6a7a8a' }}>Remember me</span>
              </label>
              <span className="text-xs font-medium cursor-pointer" style={{ color: '#4a9eff' }}>Forgot password?</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #2a7fff, #1a5fd4)' }}
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>Sign In <span>→</span></>
              )}
            </button>
          </form>

          <p className="text-sm mt-4 text-center lg:text-left" style={{ color: '#5a6a7a' }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="font-medium" style={{ color: '#4a9eff' }}>Sign up</Link>
          </p>
        </div>
      </div>

      {/* Left side — Globe image */}
      <div className="hidden lg:flex w-[55%] items-start justify-center pt-12 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(30,80,180,0.15) 0%, transparent 70%)' }} />
        <img src="/globe.png" alt="Global Security" className="w-[95%] max-w-[700px] object-contain relative z-10" />
      </div>
    </div>
  )
}
