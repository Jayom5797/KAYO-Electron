'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/lib/auth-store'
import { apiClient } from '@/lib/api-client'
import { wsClient } from '@/lib/websocket-client'

const NAV = [
  { href: '/dashboard',             label: 'Dashboard',    icon: '◉' },
  { href: '/dashboard/projects',    label: 'Projects',     icon: '⚡' },
  { href: '/dashboard/assessments', label: 'Assessments',  icon: '🔍' },
  { href: '/dashboard/assets',      label: 'Assets',       icon: '◫' },
  { href: '/dashboard/deployments', label: 'Deployments',  icon: '🚀' },
  { href: '/dashboard/incidents',   label: 'Incidents',    icon: '⚠' },
  { href: '/dashboard/monitor',     label: 'Monitor',      icon: '📡' },
  { href: '/dashboard/audit',       label: 'Audit',        icon: '📋' },
  { href: '/dashboard/settings',    label: 'Settings',     icon: '⚙' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isAuthenticated, setUser, logout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = await apiClient.getCurrentUser()
        setUser(currentUser)
        wsClient.connect()
      } catch {
        router.push('/login')
      }
    }
    if (!isAuthenticated) {
      checkAuth()
    } else {
      wsClient.connect()
    }
    return () => { wsClient.disconnect() }
  }, [isAuthenticated, setUser, router])

  const handleLogout = () => {
    apiClient.logout()
    logout()
    router.push('/login')
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0d0d12' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm" style={{ color: '#a0a0b0' }}>Authenticating...</p>
        </div>
      </div>
    )
  }

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

  return (
    <div className="min-h-screen flex" style={{ background: '#08080c' }}>
      {/* Sidebar */}
      <aside
        className="fixed left-0 top-0 h-full z-50 flex flex-col transition-all duration-300"
        style={{
          width: sidebarOpen ? '240px' : '64px',
          background: '#0a0a0f',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #ff4444, #cc2222)' }}>
            <span className="text-white text-sm font-bold">K</span>
          </div>
          {sidebarOpen && (
            <div>
              <span className="text-white font-heading font-bold text-lg">KAYO</span>
              <span className="block text-xs" style={{ color: '#6b6b7b' }}>Security Engine</span>
            </div>
          )}
        </div>

        {/* Nav Links */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {NAV.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive(href)
                  ? 'text-white'
                  : 'hover:text-white'
              }`}
              style={{
                background: isActive(href) ? 'rgba(255, 68, 68, 0.1)' : 'transparent',
                color: isActive(href) ? '#ffffff' : '#a0a0b0',
                borderLeft: isActive(href) ? '3px solid #ff4444' : '3px solid transparent',
              }}
            >
              <span className="text-base w-5 text-center">{icon}</span>
              {sidebarOpen && <span>{label}</span>}
            </Link>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {sidebarOpen && (
            <div className="flex items-center gap-2 px-2 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #ff4444, #ff9600)' }}>
                <span className="text-white text-xs font-semibold">
                  {user?.email?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white truncate">{user?.email}</p>
              </div>
              <button onClick={handleLogout} className="text-xs px-2 py-1 rounded" style={{ color: '#6b6b7b' }}>
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute top-4 right-[-12px] w-6 h-6 rounded-full flex items-center justify-center text-xs"
          style={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', color: '#a0a0b0' }}
        >
          {sidebarOpen ? '‹' : '›'}
        </button>
      </aside>

      {/* Main content */}
      <main
        className="flex-1 transition-all duration-300 p-6 overflow-auto"
        style={{ marginLeft: sidebarOpen ? '240px' : '64px', minHeight: '100vh' }}
      >
        <div className="max-w-7xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  )
}
