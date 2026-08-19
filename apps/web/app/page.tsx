'use client'

import { useState } from 'react'
import Link from 'next/link'

function ThreatIcon({ icon, label, highlight }: { icon: string; label: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className={`w-[72px] h-[72px] md:w-[88px] md:h-[88px] rounded-full flex items-center justify-center`} style={{
        background: highlight ? 'rgba(124,92,252,0.2)' : 'linear-gradient(135deg, rgba(60,40,150,0.3), rgba(30,80,180,0.2))',
        backdropFilter: 'blur(12px)',
        border: highlight ? '1px solid rgba(124,92,252,0.4)' : '1px solid rgba(100,130,255,0.15)',
        boxShadow: highlight ? '0 0 30px rgba(124,92,252,0.25)' : '0 0 15px rgba(80,100,200,0.1)',
      }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={highlight ? '#a78bfa' : '#7a9aff'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      </div>
      <span className="text-xs md:text-sm font-medium" style={{ color: highlight ? '#a78bfa' : '#7a8aaa' }}>{label}</span>
    </div>
  )
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen w-full" style={{ background: '#050507' }}>
      {/* Grid background */}
      <div className="fixed inset-0 bg-grid pointer-events-none" />

      {/* ═══ NAVBAR ═══ */}
      <nav className="fixed top-0 left-0 right-0 z-50 w-full px-4 md:px-12 pt-4 md:pt-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between rounded-full px-5 md:px-8 py-2.5" style={{ background: 'rgba(5,5,10,0.85)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {/* Brand */}
          <Link href="/" className="flex items-center">
            <img src="/KAYO.png" alt="KAYO" className="h-10 md:h-14" />
          </Link>

          {/* Center nav links — desktop */}
          <div className="hidden md:flex items-center gap-9">
            <Link href="/" className="text-base font-medium text-white transition-colors">Home</Link>
            <Link href="/dashboard" className="text-base font-medium text-[#7a7a8a] hover:text-white transition-colors">Dashboard</Link>
            <Link href="/dashboard/assessments" className="text-base font-medium text-[#7a7a8a] hover:text-white transition-colors">Assessments</Link>
            <Link href="/dashboard/monitor" className="text-base font-medium text-[#7a7a8a] hover:text-white transition-colors">Monitor</Link>
          </div>

          {/* Auth buttons — desktop */}
          <div className="hidden md:flex items-center gap-4">
            <Link href="/login" className="text-base font-medium text-[#9a9aaa] hover:text-white transition-colors px-3 py-2">
              Login
            </Link>
            <Link href="/signup" className="text-base font-medium px-6 py-2.5 rounded-full transition-all hover:shadow-[0_0_20px_rgba(124,92,252,0.3)]" style={{ background: 'linear-gradient(135deg, #7c5cfc, #5b3fd4)', color: 'white' }}>
              Sign Up
            </Link>
          </div>

          {/* Mobile hamburger / close */}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden flex flex-col items-center justify-center w-10 h-10 gap-1.5 p-2">
            {menuOpen ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <>
                <span className="w-6 h-0.5 rounded-full bg-white" />
                <span className="w-6 h-0.5 rounded-full bg-white" />
                <span className="w-6 h-0.5 rounded-full bg-white" />
              </>
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden mt-3 mx-2 rounded-2xl p-6 space-y-4 animate-fade-in" style={{ background: 'rgba(5,5,10,0.95)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Link href="/" onClick={() => setMenuOpen(false)} className="block text-base font-medium text-white py-2">Home</Link>
            <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="block text-base font-medium text-[#7a7a8a] py-2">Dashboard</Link>
            <Link href="/dashboard/assessments" onClick={() => setMenuOpen(false)} className="block text-base font-medium text-[#7a7a8a] py-2">Assessments</Link>
            <Link href="/dashboard/monitor" onClick={() => setMenuOpen(false)} className="block text-base font-medium text-[#7a7a8a] py-2">Monitor</Link>
            <div className="pt-4 flex flex-col gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <Link href="/login" onClick={() => setMenuOpen(false)} className="text-base font-medium text-[#9a9aaa] py-2">Login</Link>
              <Link href="/signup" onClick={() => setMenuOpen(false)} className="text-base font-medium px-6 py-3 rounded-full text-center" style={{ background: 'linear-gradient(135deg, #7c5cfc, #5b3fd4)', color: 'white' }}>
                Sign Up
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* ═══ HERO SECTION ═══ */}
      <section className="relative w-full h-screen flex flex-col items-center justify-end pb-16 md:justify-center md:pb-0 overflow-hidden">
        {/* Background image */}
        <div className="absolute inset-0 z-0">
          <img src="/hero.png" alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,5,7,0.4) 0%, rgba(5,5,7,0.7) 60%, #050507 100%)' }} />
        </div>

        {/* Content — pushed down */}
        <div className="relative z-10 text-center px-5 md:px-16 max-w-5xl mx-auto mt-24 md:mt-16">
          <h1 className="font-heading font-extrabold text-3xl sm:text-4xl md:text-6xl lg:text-7xl leading-[1.1] uppercase tracking-tight mb-8 md:mb-12">
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(180deg, #ffffff 0%, #c0c0d0 100%)' }}>
              Security Platform
            </span>
            <br />
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #a78bfa, #7c5cfc, #64b4ff)' }}>
              To Protect
            </span>
            <br />
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(180deg, #ffffff 0%, #8080a0 100%)' }}>
              Your Infrastructure
            </span>
          </h1>

          {/* Feature badges */}
          <div className="flex flex-wrap justify-center gap-2 md:gap-4 mt-6 md:mt-8">
            {[
              'AI-Powered Detection Engine',
              'Autonomous Secure Deployment',
              'Runtime Threat Analysis',
            ].map(text => (
              <span key={text} className="inline-flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-full text-xs md:text-sm font-medium" style={{ background: 'rgba(10,10,18,0.6)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', color: '#d0d0e0' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c5cfc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                {text}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-2 md:gap-4 mt-3 md:mt-4">
            {[
              'MITRE ATT&CK Coverage',
              'Behavior Graph Detection',
              'Zero Trust Architecture',
            ].map(text => (
              <span key={text} className="inline-flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-full text-xs md:text-sm font-medium" style={{ background: 'rgba(10,10,18,0.6)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', color: '#d0d0e0' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c5cfc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                {text}
              </span>
            ))}
          </div>

          {/* Get Started button */}
          <div className="mt-8 md:mt-12">
            <Link href="/signup" className="inline-flex items-center gap-2 text-base md:text-lg font-semibold px-8 md:px-10 py-3.5 md:py-4 rounded-full transition-all hover:shadow-[0_0_30px_rgba(124,92,252,0.4)] hover:scale-105" style={{ background: 'linear-gradient(135deg, #7c5cfc, #5b3fd4)', color: 'white' }}>
              Get Started
              <span>→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ PHASE CARDS SECTION ═══ */}
      <section className="w-full px-5 md:px-16 py-16 md:py-32" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 w-full">
          {/* Phase 01 */}
          <div className="rounded-2xl p-6 md:p-10 flex flex-col justify-between min-h-[300px] md:min-h-[380px] transition-all hover:border-[rgba(100,180,255,0.3)]" style={{ background: 'rgba(10,10,18,0.6)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div>
              <div className="flex items-center justify-between mb-6 md:mb-10">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ border: '2px solid #64b4ff' }}>
                  <div className="w-3 h-3 rounded-full" style={{ background: '#64b4ff' }} />
                </div>
                <span className="text-xs uppercase tracking-[0.2em] px-3 py-1.5 rounded-full font-medium" style={{ border: '1px solid rgba(255,255,255,0.1)', color: '#8a8a9a' }}>Phase 01</span>
              </div>
              <h3 className="text-white font-heading font-bold text-xl md:text-3xl leading-tight mb-4 md:mb-5">
                Security Assessment & Scanning
              </h3>
              <p className="text-sm md:text-base leading-relaxed" style={{ color: '#5a5a6a' }}>
                Scan any live website or API via URL. TLS, headers, CSP, CORS, CVEs, secrets — full passive and active testing with Playwright engine.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6 md:mt-8 pt-5 md:pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-xs uppercase tracking-[0.2em] font-medium" style={{ color: '#5a5a6a' }}>Inspect Pipeline</span>
              <span style={{ color: '#5a5a6a' }}>→</span>
            </div>
          </div>

          {/* Phase 02 */}
          <div className="rounded-2xl p-6 md:p-10 flex flex-col justify-between min-h-[300px] md:min-h-[380px] transition-all hover:border-[rgba(124,92,252,0.4)]" style={{ background: 'rgba(10,10,18,0.6)', backdropFilter: 'blur(12px)', border: '1px solid rgba(124,92,252,0.2)' }}>
            <div>
              <div className="flex items-center justify-between mb-6 md:mb-10">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ border: '2px solid #a78bfa' }}>
                  <div className="w-3 h-3 rounded-full" style={{ background: '#a78bfa' }} />
                </div>
                <span className="text-xs uppercase tracking-[0.2em] px-3 py-1.5 rounded-full font-medium" style={{ background: 'rgba(124,92,252,0.1)', border: '1px solid rgba(124,92,252,0.3)', color: '#a78bfa' }}>Phase 02</span>
              </div>
              <h3 className="text-white font-heading font-bold text-xl md:text-3xl leading-tight mb-4 md:mb-5">
                Autonomous Secure Deployment
              </h3>
              <p className="text-sm md:text-base leading-relaxed" style={{ color: '#5a5a6a' }}>
                Upload a GitHub repo or ZIP, auto-deploy to AWS with security gate enforcement, then continuously monitor for threats and anomalies.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6 md:mt-8 pt-5 md:pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-xs uppercase tracking-[0.2em] font-medium" style={{ color: '#5a5a6a' }}>Inspect Pipeline</span>
              <span style={{ color: '#5a5a6a' }}>→</span>
            </div>
          </div>

          {/* Phase 03 */}
          <div className="rounded-2xl p-6 md:p-10 flex flex-col justify-between min-h-[300px] md:min-h-[380px] transition-all hover:border-[rgba(255,100,100,0.3)]" style={{ background: 'rgba(10,10,18,0.6)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div>
              <div className="flex items-center justify-between mb-6 md:mb-10">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ border: '2px solid #ff6b6b' }}>
                  <div className="w-3 h-3 rounded-full" style={{ background: '#ff6b6b' }} />
                </div>
                <span className="text-xs uppercase tracking-[0.2em] px-3 py-1.5 rounded-full font-medium" style={{ border: '1px solid rgba(255,255,255,0.1)', color: '#8a8a9a' }}>Phase 03</span>
              </div>
              <h3 className="text-white font-heading font-bold text-xl md:text-3xl leading-tight mb-4 md:mb-5">
                Runtime Threat Detection & Response
              </h3>
              <p className="text-sm md:text-base leading-relaxed" style={{ color: '#5a5a6a' }}>
                MITRE ATT&CK detection, behavior graphs, anomaly detection, real-time alerting — powered by Kafka telemetry and Neo4j graph analysis.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6 md:mt-8 pt-5 md:pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-xs uppercase tracking-[0.2em] font-medium" style={{ color: '#5a5a6a' }}>Inspect Pipeline</span>
              <span style={{ color: '#5a5a6a' }}>→</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ DETECTION SECTION ═══ */}
      <section className="w-full px-5 md:px-16 py-20 md:py-28 relative overflow-hidden" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(124,92,252,0.06) 0%, transparent 60%)' }} />

        <div className="relative z-10 max-w-5xl mx-auto">
          {/* Top row */}
          <div className="grid grid-cols-5 gap-4 md:gap-6 mb-8">
            <ThreatIcon icon="M12 9v2m0 4h.01M5.07 19H18.93a2 2 0 001.72-2.98L13.72 4a2 2 0 00-3.44 0L3.34 16.02A2 2 0 005.07 19z" label="SQL Injection" />
            <ThreatIcon icon="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" label="XSS Attacks" />
            <ThreatIcon icon="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" label="Adware" />
            <ThreatIcon icon="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" label="Spyware" />
            <ThreatIcon icon="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" label="Trojans" />
          </div>

          {/* Center heading */}
          <div className="text-center py-10 md:py-14">
            <h2 className="font-heading font-extrabold text-3xl sm:text-4xl md:text-5xl lg:text-6xl uppercase tracking-tight text-white leading-[1.1] mb-4">
              Advanced Detection<br />
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #a78bfa, #64b4ff)' }}>& Threat Removal</span>
            </h2>
            <p className="text-sm md:text-base max-w-lg mx-auto leading-relaxed" style={{ color: '#5a5a6a' }}>
              KAYO specializes in identifying unique and hard-to-find threats across your infrastructure before removing any malicious activity from your systems.
            </p>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-5 gap-4 md:gap-6 mt-8">
            <ThreatIcon icon="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M3 3l18 18" label="Malware" />
            <ThreatIcon icon="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 2v2m8-2v2m-4-2v2M3 20h18M5 20V9h14v11" label="PUPs" />
            <ThreatIcon icon="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" label="Hijackers" highlight />
            <ThreatIcon icon="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" label="Ransomware" />
            <ThreatIcon icon="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6" label="Phishing" />
          </div>
        </div>
      </section>

      {/* ═══ CTA / CONNECT SECTION ═══ */}
      <section className="w-full px-5 md:px-16 py-16 md:py-32" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-xs md:text-sm uppercase tracking-[0.3em] mb-4 md:mb-6 font-medium" style={{ color: '#5a5a6a' }}>
          Ready to secure your infrastructure?
        </p>
        <h2 className="font-heading font-extrabold text-3xl sm:text-5xl md:text-7xl lg:text-8xl text-white leading-[0.95]">
          Get started with KAYO
          <span className="inline-block ml-3 md:ml-4 align-middle" style={{ color: '#7c5cfc' }}>↗</span>
        </h2>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="w-full px-5 md:px-16 py-12 md:py-16" style={{ background: 'rgba(8,8,14,0.7)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-10 md:gap-12">
          {/* Brand */}
          <div>
            <p className="text-white font-heading font-bold text-lg mb-2">KAYO</p>
            <p className="text-xs uppercase tracking-[0.2em] mb-4" style={{ color: '#5a5a6a' }}>Security Lifecycle Platform</p>
            <p className="text-sm leading-relaxed" style={{ color: '#4a4a5a' }}>
              Advanced security assessment, autonomous deployment, and runtime threat detection powered by behavior graphs and AI.
            </p>
          </div>

          {/* Links */}
          <div>
            <p className="text-xs uppercase tracking-[0.2em] font-medium mb-5" style={{ color: '#8a8a9a' }}>Platform</p>
            <div className="space-y-3">
              {['Assessments', 'Deployments', 'Monitor', 'Incidents'].map(item => (
                <Link key={item} href={`/dashboard/${item.toLowerCase()}`} className="flex items-center justify-between text-sm group" style={{ color: '#5a5a6a' }}>
                  <span className="group-hover:text-white transition-colors">{item}</span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="sm:col-span-2 md:col-span-1">
            <p className="text-xs uppercase tracking-[0.2em] font-medium mb-5" style={{ color: '#8a8a9a' }}>Stay in Touch</p>
            <div className="flex items-center gap-0 max-w-sm">
              <input type="email" placeholder="Enter your email" className="input-dark text-sm rounded-r-none flex-1" style={{ padding: '12px 14px' }} />
              <button className="px-4 py-3 rounded-r-lg text-white" style={{ background: 'linear-gradient(135deg, #7c5cfc, #5b3fd4)' }}>
                →
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
