const STORAGE_KEY = 'gander:server_url'

export function getServerUrl(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setServerUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ''))
}

export function clearServerUrl(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// Server-declared limits (GET /api/config), fetched once per session with
// safe fallbacks matching the server defaults
export interface ServerConfig {
  maxUploadMb: number
  maxMessageLength: number
}

const FALLBACK_CONFIG: ServerConfig = { maxUploadMb: 500, maxMessageLength: 4000 }

let configPromise: Promise<ServerConfig> | null = null

export function getServerConfig(): Promise<ServerConfig> {
  if (!configPromise) {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    configPromise = fetch(`${base}/api/config`)
      .then(res => (res.ok ? res.json() : FALLBACK_CONFIG))
      .then((cfg: Partial<ServerConfig>) => ({ ...FALLBACK_CONFIG, ...cfg }))
      .catch(() => {
        configPromise = null // retry on next call
        return FALLBACK_CONFIG
      })
  }
  return configPromise
}
