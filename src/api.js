const API_URL = import.meta.env.VITE_APPS_SCRIPT_URL?.trim()
const AUTH_TOKEN_KEY = 'cash-of-anarchy:google-id-token'
const AUTH_ERROR_KEY = 'cash-of-anarchy:auth-error'

export function getAuthToken() {
  return sessionStorage.getItem(AUTH_TOKEN_KEY) || ''
}

export function setAuthToken(token) {
  if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token)
  else sessionStorage.removeItem(AUTH_TOKEN_KEY)
}

export function clearAuthToken() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY)
}

export function consumeAuthError() {
  const message = sessionStorage.getItem(AUTH_ERROR_KEY) || ''
  sessionStorage.removeItem(AUTH_ERROR_KEY)
  return message
}

export function isApiConfigured() {
  return Boolean(API_URL && !API_URL.includes('SEU_DEPLOYMENT_ID'))
}

export async function callApi(payload, tokenOverride) {
  if (!isApiConfigured()) {
    throw new Error('Configure VITE_APPS_SCRIPT_URL para conectar o Google Sheets.')
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, idToken: tokenOverride || getAuthToken() }),
  })

  const data = await response.json()
  if (!response.ok || !data.ok) {
    if (data.code === 'AUTH_REQUIRED' && !tokenOverride) {
      sessionStorage.setItem(AUTH_ERROR_KEY, data.error || 'Sua sessão Google expirou. Entre novamente.')
      clearAuthToken()
      window.dispatchEvent(new CustomEvent('cash-of-anarchy:auth-expired'))
    }
    throw new Error(data.error || 'Não foi possível concluir a operação.')
  }
  return data
}
