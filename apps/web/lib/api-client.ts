import axios, { AxiosError, AxiosInstance } from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.client.interceptors.request.use(
      (config) => {
        const token = this.getToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => Promise.reject(error)
    )

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          this.clearToken()
          if (typeof window !== 'undefined') {
            window.location.href = '/login'
          }
        }
        return Promise.reject(error)
      }
    )
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('access_token')
  }

  private clearToken(): void {
    if (typeof window === 'undefined') return
    localStorage.removeItem('access_token')
    localStorage.removeItem('tenant_id')
    localStorage.removeItem('user_id')
  }

  setToken(token: string, tenantId: string, userId: string): void {
    if (typeof window === 'undefined') return
    localStorage.setItem('access_token', token)
    localStorage.setItem('tenant_id', tenantId)
    localStorage.setItem('user_id', userId)
  }

  async login(email: string, password: string) {
    const formData = new FormData()
    formData.append('username', email)
    formData.append('password', password)

    const response = await this.client.post('/api/auth/login', formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    const { access_token, tenant_id, user_id } = response.data
    this.setToken(access_token, tenant_id, user_id)

    return response.data
  }

  async register(email: string, password: string, invitationToken: string) {
    const response = await this.client.post('/api/auth/register', {
      email,
      password,
      invitation_token: invitationToken,
    })
    return response.data
  }

  async getCurrentUser() {
    const response = await this.client.get('/api/auth/me')
    return response.data
  }

  async getDeployments(skip = 0, limit = 100) {
    const response = await this.client.get('/api/deployments', {
      params: { skip, limit },
    })
    return response.data
  }

  async getDeployment(deploymentId: string) {
    const response = await this.client.get(`/api/deployments/${deploymentId}`)
    return response.data
  }

  async createDeployment(data: any) {
    const response = await this.client.post('/api/deployments', data)
    return response.data
  }

  async getIncidents(skip = 0, limit = 100, severity?: string) {
    const response = await this.client.get('/api/incidents', {
      params: { skip, limit, severity },
    })
    return response.data
  }

  async getIncident(incidentId: string) {
    const response = await this.client.get(`/api/incidents/${incidentId}`)
    return response.data
  }

  async updateIncident(incidentId: string, data: any) {
    const response = await this.client.patch(`/api/incidents/${incidentId}`, data)
    return response.data
  }

  async getTenant(tenantId: string) {
    const response = await this.client.get(`/api/tenants/${tenantId}`)
    return response.data
  }

  async getInvitations(skip = 0, limit = 100, status?: string) {
    const response = await this.client.get('/api/invitations', {
      params: { skip, limit, status },
    })
    return response.data
  }

  async createInvitation(email: string, role: string) {
    const response = await this.client.post('/api/invitations', {
      email,
      role,
    })
    return response.data
  }

  async revokeInvitation(invitationId: string) {
    await this.client.delete(`/api/invitations/${invitationId}`)
  }

  async getIncidentAttackPath(incidentId: string) {
    const response = await this.client.get(`/api/incidents/${incidentId}/attack-path`)
    return response.data
  }

  async explainIncident(incidentId: string, forceRegenerate = false) {
    const response = await this.client.post(
      `/api/incidents/${incidentId}/explain`,
      null,
      { params: { force_regenerate: forceRegenerate } }
    )
    return response.data
  }

  async getWebhooks(skip = 0, limit = 100) {
    const response = await this.client.get('/api/webhooks', {
      params: { skip, limit },
    })
    return response.data
  }

  async createWebhook(data: any) {
    const response = await this.client.post('/api/webhooks', data)
    return response.data
  }

  async deleteWebhook(webhookId: string) {
    await this.client.delete(`/api/webhooks/${webhookId}`)
  }

  async updateWebhook(webhookId: string, data: any) {
    const response = await this.client.patch(`/api/webhooks/${webhookId}`, data)
    return response.data
  }

  async getWebhookDeliveries(webhookId: string) {
    const response = await this.client.get(`/api/webhooks/${webhookId}/deliveries`)
    return response.data
  }

  async getAuditLogs(skip = 0, limit = 100, action?: string, resourceType?: string) {
    const response = await this.client.get('/api/audit-logs', {
      params: { skip, limit, action, resource_type: resourceType },
    })
    return response.data
  }

  async signup(email: string, password: string) {
    const response = await this.client.post('/api/auth/signup', { email, password })
    return response.data
  }

  async getComplianceReport() {
    const response = await this.client.get('/api/compliance/report')
    return response.data
  }

  async enforceRetention() {
    const response = await this.client.post('/api/compliance/enforce-retention')
    return response.data
  }

  async eraseData() {
    const response = await this.client.post('/api/compliance/gdpr/erase')
    return response.data
  }

  async exportData() {
    const response = await this.client.post('/api/compliance/gdpr/export')
    return response.data
  }

  logout(): void {
    this.clearToken()
  }
}

export const apiClient = new ApiClient()
