const API_URL = import.meta.env.VITE_APPS_SCRIPT_URL?.trim()

export function isApiConfigured() {
  return Boolean(API_URL && !API_URL.includes('SEU_DEPLOYMENT_ID'))
}

export async function callApi(payload, idToken = '') {
  if (!isApiConfigured()) {
    throw new Error('Configure VITE_APPS_SCRIPT_URL antes de usar o aplicativo.')
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, idToken }),
  })

  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Não foi possível concluir a operação.')
  }
  return data
}
