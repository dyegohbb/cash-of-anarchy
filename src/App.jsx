import { useEffect, useState } from 'react'
import { callApi, isApiConfigured } from './api.js'

const ACCESS_PASSWORD = import.meta.env.VITE_ACCESS_PASSWORD || ''
const MAX_ATTEMPTS = 3
const LOCK_DURATION_MS = 15 * 60 * 1000
const ATTEMPTS_KEY = 'cash-of-anarchy:access-attempts'
const LOCK_KEY = 'cash-of-anarchy:locked-until'
const SESSION_KEY = 'cash-of-anarchy:access-granted'
const initialForm = { descricao: '', valor: '', formaPagamento: 'Pix', tipo: 'Entrada' }

function AccessGate({ onAccess }) {
  const [password, setPassword] = useState('')
  const [attempts, setAttempts] = useState(() => Number(localStorage.getItem(ATTEMPTS_KEY) || 0))
  const [lockedUntil, setLockedUntil] = useState(() => Number(localStorage.getItem(LOCK_KEY) || 0))
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const updateLock = () => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
      setRemainingSeconds(remaining)
      if (!remaining && lockedUntil) {
        localStorage.removeItem(LOCK_KEY)
        localStorage.removeItem(ATTEMPTS_KEY)
        setLockedUntil(0)
        setAttempts(0)
        setMessage('')
      }
    }
    updateLock()
    const timer = setInterval(updateLock, 1000)
    return () => clearInterval(timer)
  }, [lockedUntil])

  async function handleSubmit(event) {
    event.preventDefault()
    if (remainingSeconds > 0 || loading) return
    if (!ACCESS_PASSWORD) {
      setMessage('A variável VITE_ACCESS_PASSWORD não foi configurada.')
      return
    }
    if (password !== ACCESS_PASSWORD) {
      const nextAttempts = attempts + 1
      setPassword('')
      if (nextAttempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCK_DURATION_MS
        localStorage.setItem(LOCK_KEY, String(until))
        localStorage.setItem(ATTEMPTS_KEY, String(MAX_ATTEMPTS))
        setAttempts(MAX_ATTEMPTS)
        setLockedUntil(until)
        setMessage('Acesso bloqueado após três tentativas incorretas.')
      } else {
        localStorage.setItem(ATTEMPTS_KEY, String(nextAttempts))
        setAttempts(nextAttempts)
        setMessage(`Senha incorreta. Você ainda tem ${MAX_ATTEMPTS - nextAttempts} tentativa(s).`)
      }
      return
    }

    setLoading(true)
    setMessage('')
    try {
      const result = await callApi({ action: 'inicializar' })
      localStorage.removeItem(ATTEMPTS_KEY)
      localStorage.removeItem(LOCK_KEY)
      sessionStorage.setItem(SESSION_KEY, 'true')
      onAccess(result.message)
    } catch (error) {
      setMessage(`Senha correta, mas a planilha não pôde ser inicializada: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = String(remainingSeconds % 60).padStart(2, '0')
  return <main className="accessPage">
    <section className="accessCard">
      <span className="brandMark accessMark" aria-hidden="true">C$</span>
      <p className="kicker">ACESSO RESTRITO</p>
      <h1>Cash Of Anarchy</h1>
      <p>Informe a senha padrão para inicializar a planilha e entrar no sistema.</p>
      <form className="accessForm" onSubmit={handleSubmit}>
        <label>Senha de acesso
          <input autoFocus required type="password" autoComplete="current-password" value={password} disabled={remainingSeconds > 0 || loading}
            onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" />
        </label>
        <button className="submitButton" disabled={remainingSeconds > 0 || loading} type="submit">
          {loading ? 'Inicializando planilha…' : remainingSeconds > 0 ? `Bloqueado por ${minutes}:${seconds}` : 'Entrar'} <span>→</span>
        </button>
      </form>
      {message && <div className="notice error" role="alert">{message}</div>}
      <small className="attemptHint">Máximo de três tentativas. O bloqueio dura 15 minutos neste navegador.</small>
    </section>
  </main>
}

function App() {
  const [hasAccess, setHasAccess] = useState(() => sessionStorage.getItem(SESSION_KEY) === 'true')
  const [form, setForm] = useState(initialForm)
  const [status, setStatus] = useState({ kind: '', message: '' })
  const [loading, setLoading] = useState('')
  const configured = isApiConfigured()

  function grantAccess(message) {
    setHasAccess(true)
    setStatus({ kind: 'success', message })
  }

  async function run(action, payload = {}) {
    setLoading(action)
    setStatus({ kind: '', message: '' })
    try {
      const result = await callApi({ action, ...payload })
      setStatus({ kind: result.demo ? 'info' : 'success', message: result.message })
      return true
    } catch (error) {
      setStatus({ kind: 'error', message: error.message })
      return false
    } finally { setLoading('') }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const saved = await run('adicionar', { ...form, valor: Number(form.valor) })
    if (saved) setForm(initialForm)
  }

  if (!hasAccess) return <AccessGate onAccess={grantAccess} />

  return <main className="shell">
    <header className="brand"><span className="brandMark" aria-hidden="true">C$</span><div><p className="eyebrow">FINANÇAS SEM BUROCRACIA</p><h1>Cash Of Anarchy</h1></div>
      <span className={`connection ${configured ? 'online' : ''}`}><i /> {configured ? 'Sheets conectado' : 'Modo demonstração'}</span>
    </header>
    <section className="hero"><div><p className="kicker">MVP · R$ 0 / MÊS</p><h2>Seu dinheiro.<br /><em>Suas regras.</em></h2><p className="lead">Registre entradas e saídas em segundos. Os dados ficam organizados no seu próprio Google Sheets.</p></div>
      <button className="setupButton" disabled={Boolean(loading)} onClick={() => run('inicializar')}><span>{loading === 'inicializar' ? 'Preparando…' : 'Reinicializar planilha'}</span><small>Confere a aba “Lancamentos” e a tabela</small></button>
    </section>
    <section className="panel"><div className="panelHeading"><div><span>01</span><h3>Novo lançamento</h3></div><p>Os campos marcados são obrigatórios.</p></div>
      <form onSubmit={handleSubmit}>
        <label className="wide">Descrição<input required maxLength="100" placeholder="Ex.: Venda para João" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label>
        <label>Valor (R$)<input required min="0.01" step="0.01" type="number" inputMode="decimal" placeholder="150,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></label>
        <label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option>Entrada</option><option>Saída</option></select></label>
        <label>Forma de pagamento<select value={form.formaPagamento} onChange={(e) => setForm({ ...form, formaPagamento: e.target.value })}><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option><option>Outro</option></select></label>
        <button className="submitButton" disabled={Boolean(loading)} type="submit">{loading === 'adicionar' ? 'Salvando…' : 'Salvar no Google Sheets'} <span>→</span></button>
      </form>
      {status.message && <div className={`notice ${status.kind}`} role="status">{status.message}</div>}
    </section>
    <footer><span>HTML · CSS · REACT</span><p>Seus dados permanecem na sua conta Google.</p><span>V0.1</span></footer>
  </main>
}

export default App
