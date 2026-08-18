'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/lib/auth-store'
import { apiClient } from '@/lib/api-client'
import { wsClient } from '@/lib/websocket-client'
import {
  IconDashboard,
  IconZap,
  IconSearch,
  IconLayers,
  IconRocket,
  IconShieldAlert,
  IconRadar,
  IconClipboard,
  IconSettings,
  IconChevronLeft,
  IconChevronRight,
  IconLogout,
} from '@/components/ui/icons'

const NAV = [
  { href: '/dashboard',             label: 'Dashboard',    Icon: IconDashboard },
  { href: '/dashboard/projects',    label: 'Projects',     Icon: IconZap },
  { href: '/dashboard/assessments', label: 'Assessments',  Icon: IconSearch },
  { href: '/dashboard/assets',      label: 'Assets',       Icon: IconLayers },
  { href: '/dashboard/deployments', label: 'Deployments',  Icon: IconRocket },
  { href: '/dashboard/incidents',   label: 'Incidents',    Icon: IconShieldAlert },
  { href: '/dashboard/monitor',     label: 'Monitor',      Icon: IconRadar },
  { href: '/dashboard/audit',       label: 'Audit',        Icon: IconClipboard },
  { href: '/dashboard/settings',    label: 'Settings',     Icon: IconSettings },
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
          <div className="w-8 h-8 border-2 border-[#7c5cfc] border-t-transparent rounded-full animate-spin" />
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
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #7c5cfc, #5b3fd4)' }}>
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
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive(href) ? 'text-white' : 'hover:text-white'
              }`}
              style={{
                background: isActive(href) ? 'rgba(124, 92, 252, 0.1)' : 'transparent',
                color: isActive(href) ? '#ffffff' : '#a0a0b0',
                borderLeft: isActive(href) ? '3px solid #7c5cfc' : '3px solid transparent',
              }}
            >
              <Icon className={isActive(href) ? 'text-[#7c5cfc]' : 'text-[#6b6b7b]'} size={18} />
              {sidebarOpen && <span>{label}</span>}
            </Link>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {sidebarOpen && (
            <div className="flex items-center gap-2 px-2 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #7c5cfc, #64b4ff)' }}>
                <span className="text-white text-xs font-semibold">
                  {user?.email?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white truncate">{user?.email}</p>
              </div>
              <button onClick={handleLogout} className="p-1 rounded hover:bg-white/5 transition-colors" style={{ color: '#6b6b7b' }}>
                <IconLogout size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute top-4 right-[-12px] w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', color: '#a0a0b0' }}
        >
          {sidebarOpen ? <IconChevronLeft size={12} /> : <IconChevronRight size={12} />}
        </button>
      </aside>

      {/* Main content with grid background */}
      <main
        className="flex-1 transition-all duration-300 p-6 overflow-auto relative bg-grid"
        style={{ marginLeft: sidebarOpen ? '240px' : '64px', minHeight: '100vh' }}
      >
        {/* Radial glow at top */}
        <div className="absolute inset-0 bg-radial-fade pointer-events-none" />
        
        <div className="max-w-7xl mx-auto animate-fade-in relative z-10">
          {children}
        </div>
      </main>
    </div>
  )
}
