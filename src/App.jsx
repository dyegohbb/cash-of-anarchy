import { useEffect, useMemo, useState } from 'react'
import { callApi, isApiConfigured } from './api.js'

const ACCESS_PASSWORD = import.meta.env.VITE_ACCESS_PASSWORD || ''
const MAX_ATTEMPTS = 3
const LOCK_DURATION_MS = 15 * 60 * 1000
const ATTEMPTS_KEY = 'cash-of-anarchy:access-attempts'
const LOCK_KEY = 'cash-of-anarchy:locked-until'
const SESSION_KEY = 'cash-of-anarchy:access-granted'

function localDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function localMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function createInitialForm() {
  return {
    descricao: '', valor: '', tipo: 'Saída', categoria: '', carteira: '',
    tipoPagamento: 'À vista', modoParcelamento: 'valorParcela', parcelas: '2',
    competencia: localMonthValue(), dataCompra: localDateValue(),
  }
}

function toCompetence(monthValue) {
  const [year, month] = String(monthValue).split('-')
  return year && month ? `${month}/${year}` : ''
}

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)
}

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
        localStorage.removeItem(LOCK_KEY); localStorage.removeItem(ATTEMPTS_KEY)
        setLockedUntil(0); setAttempts(0); setMessage('')
      }
    }
    updateLock()
    const timer = setInterval(updateLock, 1000)
    return () => clearInterval(timer)
  }, [lockedUntil])

  async function handleSubmit(event) {
    event.preventDefault()
    if (remainingSeconds > 0 || loading) return
    if (!ACCESS_PASSWORD) return setMessage('A variável VITE_ACCESS_PASSWORD não foi configurada.')
    if (password !== ACCESS_PASSWORD) {
      const nextAttempts = attempts + 1
      setPassword('')
      if (nextAttempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCK_DURATION_MS
        localStorage.setItem(LOCK_KEY, String(until)); localStorage.setItem(ATTEMPTS_KEY, String(MAX_ATTEMPTS))
        setAttempts(MAX_ATTEMPTS); setLockedUntil(until); setMessage('Acesso bloqueado após três tentativas incorretas.')
      } else {
        localStorage.setItem(ATTEMPTS_KEY, String(nextAttempts)); setAttempts(nextAttempts)
        setMessage(`Senha incorreta. Você ainda tem ${MAX_ATTEMPTS - nextAttempts} tentativa(s).`)
      }
      return
    }
    setLoading(true); setMessage('')
    try {
      const result = await callApi({ action: 'inicializar' })
      localStorage.removeItem(ATTEMPTS_KEY); localStorage.removeItem(LOCK_KEY)
      sessionStorage.setItem(SESSION_KEY, 'true')
      onAccess(result)
    } catch (error) {
      setMessage(`Senha correta, mas a aplicação não pôde ser inicializada: ${error.message}`)
    } finally { setLoading(false) }
  }

  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = String(remainingSeconds % 60).padStart(2, '0')
  return <main className="accessPage"><section className="accessCard">
    <span className="brandMark accessMark" aria-hidden="true">C$</span><p className="kicker">ACESSO RESTRITO</p><h1>Cash Of Anarchy</h1>
    <p>Informe a senha padrão para preparar suas planilhas e entrar no sistema.</p>
    <form className="accessForm" onSubmit={handleSubmit}><label>Senha de acesso
      <input required type="password" autoComplete="current-password" enterKeyHint="go" value={password} disabled={remainingSeconds > 0 || loading} onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" />
    </label><button className="submitButton" disabled={remainingSeconds > 0 || loading} type="submit">
      {loading ? 'Preparando planilhas…' : remainingSeconds > 0 ? `Bloqueado por ${minutes}:${seconds}` : 'Entrar'} <span>→</span>
    </button></form>
    {message && <div className="notice error" role="alert">{message}</div>}
    <small className="attemptHint">Máximo de três tentativas. O bloqueio dura 15 minutos neste navegador.</small>
  </section></main>
}

function App() {
  const [hasAccess, setHasAccess] = useState(() => sessionStorage.getItem(SESSION_KEY) === 'true')
  const [form, setForm] = useState(createInitialForm)
  const [settings, setSettings] = useState({ carteiras: [], categorias: [] })
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [status, setStatus] = useState({ kind: '', message: '' })
  const [loading, setLoading] = useState('')
  const configured = isApiConfigured()
  const isInstallment = form.tipoPagamento === 'Parcelado'

  useEffect(() => {
    if (!hasAccess || settingsLoaded) return
    callApi({ action: 'obterConfiguracoes' })
      .then((result) => {
        setSettings(result.configuracoes || { carteiras: [], categorias: [] })
        setSettingsLoaded(true)
      })
      .catch((error) => setStatus({ kind: 'error', message: error.message }))
  }, [hasAccess, settingsLoaded])

  useEffect(() => {
    setForm((current) => ({
      ...current,
      carteira: settings.carteiras.includes(current.carteira) ? current.carteira : settings.carteiras[0] || '',
      categoria: settings.categorias.includes(current.categoria) ? current.categoria : settings.categorias[0] || '',
    }))
  }, [settings])

  const purchaseSummary = useMemo(() => {
    const value = Number(form.valor) || 0
    const count = isInstallment ? Number(form.parcelas) || 0 : 1
    if (!isInstallment) return { total: value, installment: value }
    return form.modoParcelamento === 'valorTotal'
      ? { total: value, installment: count ? value / count : 0 }
      : { total: value * count, installment: value }
  }, [form.valor, form.parcelas, form.modoParcelamento, isInstallment])

  function grantAccess(result) {
    setSettings(result.configuracoes || { carteiras: [], categorias: [] })
    setSettingsLoaded(true)
    setHasAccess(true)
    setStatus({ kind: 'success', message: result.message })
  }

  async function reloadSettings() {
    setLoading('configuracoes'); setStatus({ kind: '', message: '' })
    try {
      const result = await callApi({ action: 'obterConfiguracoes' })
      setSettings(result.configuracoes)
      setSettingsLoaded(true)
      setStatus({ kind: 'success', message: 'Categorias e carteiras atualizadas.' })
    } catch (error) { setStatus({ kind: 'error', message: error.message }) }
    finally { setLoading('') }
  }

  async function handleSubmit(event) {
    event.preventDefault(); setLoading('adicionar'); setStatus({ kind: '', message: '' })
    try {
      const result = await callApi({
        action: 'adicionar', ...form, valor: Number(form.valor), parcelas: isInstallment ? Number(form.parcelas) : 1,
        competencia: toCompetence(form.competencia),
      })
      setStatus({ kind: 'success', message: result.message })
      setForm((current) => ({ ...createInitialForm(), categoria: current.categoria, carteira: current.carteira }))
    } catch (error) { setStatus({ kind: 'error', message: error.message }) }
    finally { setLoading('') }
  }

  if (!hasAccess) return <AccessGate onAccess={grantAccess} />

  return <main className="shell">
    <header className="brand"><span className="brandMark" aria-hidden="true">C$</span><div><p className="eyebrow">FINANÇAS SEM BUROCRACIA</p><h1>Cash Of Anarchy</h1></div>
      <span className={`connection ${configured ? 'online' : ''}`}><i /> {configured ? 'Sheets conectado' : 'Modo demonstração'}</span></header>

    <section className="hero compactHero"><div><p className="kicker">NOVO LANÇAMENTO</p><h2>Compre agora.<br /><em>Controle depois.</em></h2><p className="lead">Registre compras à vista ou parceladas. Cada parcela entra automaticamente na competência correta.</p></div>
      <button className="setupButton" disabled={Boolean(loading)} onClick={reloadSettings}><span>{loading === 'configuracoes' ? 'Atualizando…' : 'Atualizar configurações'}</span><small>Recarrega carteiras e categorias da planilha</small></button></section>

    <section className="settingsStrip"><div><span>CARTEIRAS</span><strong>{settings.carteiras.length}</strong></div><div><span>CATEGORIAS</span><strong>{settings.categorias.length}</strong></div><p>Edite a aba “Configuracoes” no Google Sheets e toque em atualizar.</p></section>

    <section className="panel"><div className="panelHeading"><div><span>01</span><h3>Dados da compra</h3></div><p>Todos os campos são obrigatórios.</p></div>
      <form className="purchaseForm" onSubmit={handleSubmit}>
        <label className="fieldFull">Descrição<input required maxLength="100" autoCapitalize="sentences" enterKeyHint="next" placeholder="Ex.: Mercado do mês" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label>
        <label>Movimento<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option>Saída</option><option>Entrada</option></select></label>
        <label>Categoria<select required value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>{settings.categorias.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Carteira / origem<select required value={form.carteira} onChange={(e) => setForm({ ...form, carteira: e.target.value })}>{settings.carteiras.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Data da compra<input required type="date" value={form.dataCompra} onChange={(e) => setForm({ ...form, dataCompra: e.target.value })} /></label>
        <label>Competência inicial<input required type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} /></label>
        <label>Tipo de pagamento<select value={form.tipoPagamento} onChange={(e) => setForm({ ...form, tipoPagamento: e.target.value })}><option>À vista</option><option>Parcelado</option></select></label>

        {isInstallment && <fieldset className="fieldFull installmentOptions"><legend>Como deseja informar o valor?</legend>
          <label className="radioCard"><input type="radio" name="modoParcelamento" value="valorParcela" checked={form.modoParcelamento === 'valorParcela'} onChange={(e) => setForm({ ...form, modoParcelamento: e.target.value })} /><span><strong>Valor da parcela</strong><small>O total será valor × parcelas</small></span></label>
          <label className="radioCard"><input type="radio" name="modoParcelamento" value="valorTotal" checked={form.modoParcelamento === 'valorTotal'} onChange={(e) => setForm({ ...form, modoParcelamento: e.target.value })} /><span><strong>Valor total</strong><small>O sistema divide e ajusta centavos</small></span></label>
        </fieldset>}

        <label>{isInstallment && form.modoParcelamento === 'valorTotal' ? 'Valor total (R$)' : isInstallment ? 'Valor da parcela (R$)' : 'Valor (R$)'}
          <input required min="0.01" step="0.01" type="number" inputMode="decimal" enterKeyHint="next" placeholder="0,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></label>
        {isInstallment && <label>Quantidade de parcelas<input required min="2" max="120" step="1" type="number" inputMode="numeric" enterKeyHint="done" value={form.parcelas} onChange={(e) => setForm({ ...form, parcelas: e.target.value })} /></label>}

        <div className="purchaseSummary"><span>{isInstallment ? `${form.parcelas || 0} parcelas de aproximadamente` : 'Total do lançamento'}</span><strong>{formatMoney(purchaseSummary.installment)}</strong>{isInstallment && <small>Total: {formatMoney(purchaseSummary.total)} · centavos ajustados automaticamente</small>}</div>
        <button className="submitButton savePurchase" disabled={Boolean(loading) || !settings.carteiras.length || !settings.categorias.length} type="submit">{loading === 'adicionar' ? 'Salvando lançamentos…' : isInstallment ? 'Gerar e salvar parcelas' : 'Salvar lançamento'} <span>→</span></button>
      </form>
      {status.message && <div className={`notice ${status.kind}`} role="status">{status.message}</div>}
    </section>
    <footer><span>REACT · APPS SCRIPT · SHEETS</span><p>purchaseId agrupa todas as parcelas da mesma compra.</p><span>V0.3</span></footer>
  </main>
}

export default App
