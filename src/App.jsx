import { useCallback, useEffect, useRef, useState } from 'react'
import { callApi } from './api.js'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
const initialForm = { descricao: '', valor: '', formaPagamento: 'Pix', tipo: 'Entrada' }

function Login({ onLogin, serverError }) {
  const buttonRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes('SEU_CLIENT_ID')) {
      setError('Configure VITE_GOOGLE_CLIENT_ID para habilitar o login.')
      return
    }
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      if (window.google?.accounts?.id && buttonRef.current) {
        clearInterval(timer)
        window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: ({ credential }) => onLogin(credential), auto_select: false })
        window.google.accounts.id.renderButton(buttonRef.current, { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'signin_with', width: 300 })
      } else if (attempts >= 50) {
        clearInterval(timer)
        setError('Não foi possível carregar o login do Google.')
      }
    }, 100)
    return () => clearInterval(timer)
  }, [onLogin])

  return <main className="loginPage"><section className="loginCard">
    <span className="brandMark loginMark" aria-hidden="true">C$</span>
    <p className="kicker">CASH OF ANARCHY</p>
    <h1>Entre para acessar<br /><em>sua planilha.</em></h1>
    <p>Use sua conta Google. O sistema só grava na planilha que você configurar.</p>
    <div className="googleButton" ref={buttonRef} />
    {(error || serverError) && <div className="notice error">{error || serverError}</div>}
  </section></main>
}

function App() {
  const [idToken, setIdToken] = useState('')
  const [user, setUser] = useState(null)
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [configuredSheet, setConfiguredSheet] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [status, setStatus] = useState({ kind: '', message: '' })
  const [loading, setLoading] = useState('')

  const handleLogin = useCallback(async (token) => {
    setLoading('login')
    setStatus({ kind: '', message: '' })
    try {
      const result = await callApi({ action: 'obterConfiguracao' }, token)
      setIdToken(token)
      setUser(result.user)
      setSpreadsheetId(result.spreadsheetId || '')
      setConfiguredSheet(Boolean(result.spreadsheetId))
    } catch (error) {
      setStatus({ kind: 'error', message: error.message })
    } finally { setLoading('') }
  }, [])

  function logout() {
    window.google?.accounts?.id?.disableAutoSelect()
    setIdToken(''); setUser(null); setSpreadsheetId(''); setConfiguredSheet(false)
  }

  async function run(action, payload = {}) {
    setLoading(action); setStatus({ kind: '', message: '' })
    try {
      const result = await callApi({ action, ...payload }, idToken)
      setStatus({ kind: 'success', message: result.message })
      return result
    } catch (error) {
      setStatus({ kind: 'error', message: error.message })
      return null
    } finally { setLoading('') }
  }

  async function saveSpreadsheet(event) {
    event.preventDefault()
    const result = await run('salvarConfiguracao', { spreadsheetId: spreadsheetId.trim() })
    if (result) { setSpreadsheetId(result.spreadsheetId); setConfiguredSheet(true) }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const saved = await run('adicionar', { ...form, valor: Number(form.valor) })
    if (saved) setForm(initialForm)
  }

  if (!idToken || !user) return <Login onLogin={handleLogin} serverError={status.message} />

  return <main className="shell">
    <header className="brand">
      <span className="brandMark" aria-hidden="true">C$</span>
      <div><p className="eyebrow">FINANÇAS SEM BUROCRACIA</p><h1>Cash Of Anarchy</h1></div>
      <div className="userBox"><div><strong>{user.name || user.email}</strong><small>{user.email}</small></div><button onClick={logout}>Sair</button></div>
    </header>

    <section className="hero compactHero"><div><p className="kicker">ÁREA AUTENTICADA</p><h2>Seu dinheiro.<br /><em>Suas regras.</em></h2></div>
      <span className={`connection ${configuredSheet ? 'online' : ''}`}><i /> {configuredSheet ? 'Planilha conectada' : 'Configuração pendente'}</span>
    </section>

    <section className="panel settingsPanel">
      <div className="panelHeading"><div><span>01</span><h3>Sua planilha</h3></div><p>Você pode trocar o destino quando quiser.</p></div>
      <form className="settingsForm" onSubmit={saveSpreadsheet}>
        <label>ID da planilha Google<input required maxLength="100" placeholder="Cole o trecho entre /d/ e /edit" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} /></label>
        <button className="submitButton" disabled={Boolean(loading)} type="submit">{loading === 'salvarConfiguracao' ? 'Verificando…' : configuredSheet ? 'Atualizar planilha' : 'Conectar planilha'} <span>→</span></button>
      </form>
      <p className="helper">Compartilhe essa planilha com a conta proprietária do Apps Script antes de conectar.</p>
    </section>

    <section className={`panel entryPanel ${!configuredSheet ? 'disabledPanel' : ''}`}>
      <div className="panelHeading"><div><span>02</span><h3>Novo lançamento</h3></div><p>{configuredSheet ? 'Será salvo na planilha conectada.' : 'Conecte uma planilha primeiro.'}</p></div>
      <form onSubmit={handleSubmit}>
        <label className="wide">Descrição<input disabled={!configuredSheet} required maxLength="100" placeholder="Ex.: Venda para João" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label>
        <label>Valor (R$)<input disabled={!configuredSheet} required min="0.01" step="0.01" type="number" inputMode="decimal" placeholder="150,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></label>
        <label>Tipo<select disabled={!configuredSheet} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option>Entrada</option><option>Saída</option></select></label>
        <label>Forma de pagamento<select disabled={!configuredSheet} value={form.formaPagamento} onChange={(e) => setForm({ ...form, formaPagamento: e.target.value })}><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option><option>Outro</option></select></label>
        <button className="submitButton" disabled={!configuredSheet || Boolean(loading)} type="submit">{loading === 'adicionar' ? 'Salvando…' : 'Salvar no Google Sheets'} <span>→</span></button>
      </form>
      {status.message && <div className={`notice ${status.kind}`} role="status">{status.message}</div>}
    </section>
    <footer><span>REACT · GOOGLE IDENTITY · SHEETS</span><p>Autenticação e destino validados pelo Apps Script.</p><span>V0.2</span></footer>
  </main>
}

export default App
