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
