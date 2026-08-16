'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import Link from 'next/link'

export default function LandingPage() {
  const router = useRouter()
  const { setUser } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'signup'>('login')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'signup') {
        await apiClient.signup(email, password)
      }
      await apiClient.login(email, password)
      const user = await apiClient.getCurrentUser()
      setUser(user)
      router.push('/dashboard')
    } catch (err: any) {
      setError(err?.response?.data?.detail || (mode === 'login' ? 'Invalid credentials' : 'Signup failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#0d0d12' }}>
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(ellipse at top center, rgba(255, 68, 68, 0.08) 0%, transparent 60%), radial-gradient(ellipse at bottom right, rgba(255, 150, 0, 0.05) 0%, transparent 50%)',
        }} />
        {/* Red glow line at top */}
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #ff4444, transparent)' }} />

        <div className="relative max-w-6xl mx-auto px-6 pt-12 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-16">
            <div className="flex items-center gap-3">
              {/* KAYO Logo (SEVE-style SVG) */}
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #ff4444, #cc0000)', boxShadow: '0 4px 20px rgba(255, 68, 68, 0.4)' }}>
                <svg viewBox="0 0 500 500" width="22" height="22">
                  <path fill="#ffffff" d="M261,391 C321,351 345,295 338,224 C375,258 390,299 382,348 C374,401 333,445 280,456 C229,467 185,452 148,413 C189,418 226,412 261,391z"/>
                  <path fill="#ffffff" d="M197,331 C223,340 249,341 276,338 C265,363 205,387 165,384 C108,380 58,338 45,281 C32,226 56,175 88,150 C75,240 132,309 197,331z"/>
                  <path fill="#ffffff" d="M117,160 C125,99 171,52 230,43 C281,35 330,59 350,88 C296,81 248,96 209,135 C170,174 156,222 163,277 C129,245 113,206 117,160z"/>
                  <path fill="#ffffff" d="M435,174 C475,232 463,308 413,352 C420,297 405,249 366,210 C327,170 279,156 225,163 C270,107 375,92 435,174z"/>
                </svg>
              </div>
              <span className="text-white font-heading font-bold text-xl">KAYO</span>
              <span className="text-xs px-3 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: '#a0a0b0', border: '1px solid rgba(255,255,255,0.1)' }}>
                Security Lifecycle Platform
              </span>
            </div>
          </div>

          {/* Main Hero */}
          <div className="text-center mb-16">
            <h1 className="font-heading font-extrabold text-5xl md:text-6xl leading-tight mb-4">
              <span className="text-white">Assess. Deploy.</span><br/>
              <span style={{ background: 'linear-gradient(135deg, #ff4444, #ff9600)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Secure Everything.</span>
            </h1>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: '#6b6b7b' }}>
              One platform for security assessment, autonomous secure deployment, and continuous runtime threat detection.
            </p>
          </div>

          {/* Feature Pills */}
          <div className="flex flex-wrap justify-center gap-3 mb-12">
            {[
              { icon: '🔍', label: 'URL Assessment' },
              { icon: '🛡️', label: 'Security Gate' },
              { icon: '🚀', label: 'AWS Deploy' },
              { icon: '📡', label: 'Runtime Detection' },
              { icon: '🧠', label: 'AI Analysis' },
              { icon: '⚡', label: 'MITRE ATT&CK' },
            ].map(({ icon, label }) => (
              <span key={label} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#a0a0b0' }}>
                <span>{icon}</span> {label}
              </span>
            ))}
          </div>

          {/* Two Column: Features + Login */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Left: Mode Cards */}
            <div className="space-y-4">
              <div className="glass-card p-6 card-hover">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(100, 180, 255, 0.1)', border: '1px solid rgba(100, 180, 255, 0.2)' }}>
                    <span style={{ color: '#64b4ff' }}>🔍</span>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-base mb-1">Mode 1 — Assess</h3>
                    <p className="text-sm" style={{ color: '#6b6b7b' }}>Scan any live website or API via URL. TLS, headers, CSP, CORS, CVEs, secrets — full passive + optional active testing.</p>
                    <div className="flex gap-2 mt-3">
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(100,180,255,0.1)', color: '#64b4ff', border: '1px solid rgba(100,180,255,0.2)' }}>URL Scan</span>
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(100,180,255,0.1)', color: '#64b4ff', border: '1px solid rgba(100,180,255,0.2)' }}>Repo Scan</span>
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(100,180,255,0.1)', color: '#64b4ff', border: '1px solid rgba(100,180,255,0.2)' }}>CVE Lookup</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="glass-card p-6 card-hover">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255, 150, 0, 0.1)', border: '1px solid rgba(255, 150, 0, 0.2)' }}>
                    <span style={{ color: '#ff9600' }}>🚀</span>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-base mb-1">Mode 2 — Deploy + Observe</h3>
                    <p className="text-sm" style={{ color: '#6b6b7b' }}>Upload a GitHub repo or ZIP, auto-deploy to AWS with security gate enforcement, then continuously monitor for threats.</p>
                    <div className="flex gap-2 mt-3">
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,150,0,0.1)', color: '#ff9600', border: '1px solid rgba(255,150,0,0.2)' }}>GitHub</span>
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,150,0,0.1)', color: '#ff9600', border: '1px solid rgba(255,150,0,0.2)' }}>ZIP Upload</span>
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,150,0,0.1)', color: '#ff9600', border: '1px solid rgba(255,150,0,0.2)' }}>Auto-Deploy</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="glass-card p-6 card-hover">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(0, 255, 136, 0.1)', border: '1px solid rgba(0, 255, 136, 0.2)' }}>
                    <span style={{ color: '#00ff88' }}>⚡</span>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-base mb-1">Runtime Security</h3>
                    <p className="text-sm" style={{ color: '#6b6b7b' }}>MITRE ATT&CK detection, behavior graphs, anomaly detection, real-time alerting — powered by Kafka + Neo4j.</p>
                    <div className="flex gap-2 mt-3">
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(0,255,136,0.1)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.2)' }}>MITRE ATT&CK</span>
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(0,255,136,0.1)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.2)' }}>Graph Detection</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Login Form */}
            <div className="glass-card p-8" style={{ border: '1px solid rgba(255, 68, 68, 0.15)' }}>
              <div className="text-center mb-6">
                <h2 className="text-white font-heading font-bold text-xl">
                  {mode === 'login' ? 'Welcome Back' : 'Get Started'}
                </h2>
                <p className="text-sm mt-1" style={{ color: '#6b6b7b' }}>
                  {mode === 'login' ? 'Sign in to your security workstation' : 'Create your KAYO account'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="input-dark" required />
                </div>
                <div>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="input-dark" required />
                </div>

                {error && (
                  <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(255,68,68,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,68,68,0.2)' }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2" style={{ padding: '12px' }}>
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg viewBox="0 0 500 500" width="16" height="16"><path fill="#ffffff" d="M261,391 C321,351 345,295 338,224 C375,258 390,299 382,348 C374,401 333,445 280,456 C229,467 185,452 148,413 C189,418 226,412 261,391z"/><path fill="#ffffff" d="M197,331 C223,340 249,341 276,338 C265,363 205,387 165,384 C108,380 58,338 45,281 C32,226 56,175 88,150 C75,240 132,309 197,331z"/></svg>
                      {mode === 'login' ? 'Open KAYO' : 'Create Account'}
                    </>
                  )}
                </button>
              </form>

              <div className="text-center mt-4">
                <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="text-sm" style={{ color: '#ff4444' }}>
                  {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Feature Bar */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { icon: '🔬', title: 'Playwright Engine', desc: 'Real browser capture' },
              { icon: '🌐', title: 'KAYO Scanner', desc: 'Full security analysis' },
              { icon: '🤖', title: 'AI Analysis', desc: 'OpenAI + Groq' },
              { icon: '☁️', title: 'AWS Native', desc: 'ECS/Fargate deploy' },
              { icon: '🔒', title: 'Zero Trust', desc: 'Gate everything' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="glass-card p-4 text-center card-hover">
                <span className="text-2xl">{icon}</span>
                <p className="text-white text-sm font-semibold mt-2">{title}</p>
                <p className="text-xs" style={{ color: '#6b6b7b' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
