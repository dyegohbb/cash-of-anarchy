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
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`
}

function createInitialForm() {
  return {
    descricao: '', valor: '', tipo: 'Saída', categoria: '', carteira: '',
    tipoPagamento: 'À vista', modoParcelamento: 'valorParcela', parcelas: '2',
    competencia: localMonthValue(), dataLancamento: localDateValue(),
  }
}

function toCompetence(monthValue) {
  const [year, month] = String(monthValue).split('-')
  return year && month ? `${month}/${year}` : ''
}

function fromCompetence(value) {
  const [month, year] = String(value || '').split('/')
  return year && month ? `${year}-${month}` : localMonthValue()
}

function competenceReference(value) {
  const [year, month] = String(value || '').split('-')
  return year && month ? `01/${month}/${year}` : '—'
}

function formatDateBr(value) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(Number(value) || 0))
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

function RecurringScreen({ settings, onBack }) {
  const emptyForm = () => ({
    recurringId: '', descricao: '', valor: '', tipo: 'Saída',
    categoria: settings.categorias[0] || '', carteira: settings.carteiras[0] || '',
    dataInicio: localDateValue(), competenciaInicial: localMonthValue(),
    periodicidade: 'Mensal', status: 'Ativa',
  })
  const [items, setItems] = useState([])
  const [mode, setMode] = useState('list')
  const [form, setForm] = useState(emptyForm)
  const [processingCompetence, setProcessingCompetence] = useState(localMonthValue)
  const [loading, setLoading] = useState('listar')
  const [message, setMessage] = useState({ kind: '', text: '' })

  async function loadItems() {
    setLoading('listar')
    try {
      const result = await callApi({ action: 'listarRecorrentes' })
      setItems(result.recorrentes || [])
    } catch (error) { setMessage({ kind: 'error', text: error.message }) }
    finally { setLoading('') }
  }

  useEffect(() => { loadItems() }, [])

  function openNew() {
    setForm(emptyForm()); setMessage({ kind: '', text: '' }); setMode('form')
  }

  function openEdit(item) {
    setForm({
      recurringId: item.recurringId, descricao: item.descricao, valor: String(Math.abs(item.valor)), tipo: item.tipo,
      categoria: item.categoria, carteira: item.carteira, dataInicio: item.dataInicio,
      competenciaInicial: fromCompetence(item.competenciaInicial), periodicidade: item.periodicidade, status: item.status,
    })
    setMessage({ kind: '', text: '' }); setMode('form')
  }

  async function saveRecurring(event) {
    event.preventDefault(); setLoading('salvar'); setMessage({ kind: '', text: '' })
    const editing = Boolean(form.recurringId)
    try {
      const result = await callApi({
        action: editing ? 'atualizarRecorrente' : 'adicionarRecorrente', ...form,
        valor: Number(form.valor), competenciaInicial: toCompetence(form.competenciaInicial),
      })
      setMessage({ kind: 'success', text: result.message })
      await loadItems(); setMode('list')
    } catch (error) { setMessage({ kind: 'error', text: error.message }) }
    finally { setLoading('') }
  }

  async function processCompetence() {
    setLoading('processar'); setMessage({ kind: '', text: '' })
    try {
      const result = await callApi({ action: 'processarRecorrentes', competencia: toCompetence(processingCompetence) })
      setMessage({ kind: 'success', text: result.message })
    } catch (error) { setMessage({ kind: 'error', text: error.message }) }
    finally { setLoading('') }
  }

  async function removeCompetence() {
    const competence = toCompetence(processingCompetence)
    if (!window.confirm(`Remover os lançamentos recorrentes de ${competence}? As regras continuarão cadastradas.`)) return
    setLoading('remover'); setMessage({ kind: '', text: '' })
    try {
      const result = await callApi({ action: 'removerLancamentosRecorrentes', competencia: competence })
      setMessage({ kind: 'success', text: result.message })
    } catch (error) { setMessage({ kind: 'error', text: error.message }) }
    finally { setLoading('') }
  }

  return <main className="shell">
    <header className="brand"><button className="backButton" onClick={onBack} aria-label="Voltar para novo lançamento">←</button><div><p className="eyebrow">GERENCIAMENTO</p><h1>Lançamentos recorrentes</h1></div></header>
    <section className="recurringHero"><div><p className="kicker">RECORRÊNCIAS</p><h2>Todo mês.<br /><em>Sem esquecer.</em></h2></div>
      {mode === 'list' && <button className="submitButton newRecurring" onClick={openNew}>Nova recorrência <span>＋</span></button>}
    </section>

    {mode === 'list' && <section className="recurringProcessor">
      <div><p className="kicker">GERAR LANÇAMENTOS</p><h3>Processar uma competência</h3><p>Cria ou remove somente os lançamentos recorrentes do mês escolhido.</p></div>
      <label>Competência<input required type="month" value={processingCompetence} disabled={Boolean(loading)} onChange={(event) => setProcessingCompetence(event.target.value)} /><small className="fieldHint">Referência: {competenceReference(processingCompetence)}</small></label>
      <div className="recurringProcessorActions"><button className="submitButton" disabled={Boolean(loading) || !processingCompetence} onClick={processCompetence}>{loading === 'processar' ? 'Processando…' : 'Processar mês'} <span>→</span></button><button className="dangerButton" disabled={Boolean(loading) || !processingCompetence} onClick={removeCompetence}>{loading === 'remover' ? 'Removendo…' : 'Remover lançamentos do mês'}</button></div>
    </section>}

    {mode === 'list' ? <section className="recurringList" aria-busy={loading === 'listar'}>
      {loading === 'listar' && <div className="emptyState">Carregando recorrências…</div>}
      {!loading && !items.length && <div className="emptyState"><strong>Nenhuma recorrência cadastrada.</strong><span>Crie despesas ou receitas que se repetem mensalmente.</span></div>}
      {items.map((item) => <article className="recurringCard" key={item.recurringId}>
        <div className="recurringCardTop"><div><span className="recurringCategory">{item.categoria}</span><h3>{item.descricao}</h3></div><span className={`statusBadge ${item.status === 'Ativa' ? 'active' : 'inactive'}`}>{item.status}</span></div>
        <strong className={`recurringValue ${item.valor < 0 ? 'amountNegative' : 'amountPositive'}`}>{formatMoney(item.valor)}</strong>
        <dl><div><dt>Carteira</dt><dd>{item.carteira}</dd></div><div><dt>Início</dt><dd>{formatDateBr(item.dataInicio)}</dd></div><div><dt>Competência inicial</dt><dd>{item.competenciaInicial}</dd></div><div><dt>Recorrência</dt><dd>{item.periodicidade}</dd></div></dl>
        <button className="editButton" onClick={() => openEdit(item)}>Editar recorrência <span>→</span></button>
      </article>)}
    </section> : <section className="panel recurringFormPanel">
      <div className="panelHeading"><div><span>R</span><h3>{form.recurringId ? 'Editar recorrência' : 'Nova recorrência'}</h3></div><button className="cancelButton" onClick={() => setMode('list')}>Cancelar</button></div>
      <form className="launchForm" onSubmit={saveRecurring}>
        <label className="fieldFull">Descrição<input required maxLength="100" autoCapitalize="sentences" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex.: Netflix" /></label>
        <label>Valor (R$)<input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="0,00" /></label>
        <label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option>Saída</option><option>Entrada</option></select></label>
        <label>Categoria<select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>{settings.categorias.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Carteira<select value={form.carteira} onChange={(e) => setForm({ ...form, carteira: e.target.value })}>{settings.carteiras.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Data de início<input required type="date" value={form.dataInicio} onChange={(e) => setForm({ ...form, dataInicio: e.target.value })} /></label>
        <label>Competência inicial<input required type="month" value={form.competenciaInicial} onChange={(e) => setForm({ ...form, competenciaInicial: e.target.value })} /><small className="fieldHint">Referência: {competenceReference(form.competenciaInicial)}</small></label>
        <label>Periodicidade<select value={form.periodicidade} onChange={(e) => setForm({ ...form, periodicidade: e.target.value })}><option>Mensal</option></select></label>
        <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Ativa</option><option>Inativa</option></select></label>
        <button className="submitButton fieldFull" disabled={loading === 'salvar'} type="submit">{loading === 'salvar' ? 'Salvando…' : form.recurringId ? 'Salvar alterações' : 'Criar recorrência'} <span>→</span></button>
      </form>
    </section>}
    {message.text && <div className={`notice floatingNotice ${message.kind}`} role="status">{message.text}</div>}
    <footer><span>RECORRÊNCIAS · MENSAL</span><p>Regras separadas dos lançamentos financeiros.</p><span>V0.4</span></footer>
  </main>
}

function App() {
  const [hasAccess, setHasAccess] = useState(() => sessionStorage.getItem(SESSION_KEY) === 'true')
  const [form, setForm] = useState(createInitialForm)
  const [settings, setSettings] = useState({ carteiras: [], categorias: [] })
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [status, setStatus] = useState({ kind: '', message: '' })
  const [loading, setLoading] = useState('')
  const [view, setView] = useState('launch')
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

  const launchSummary = useMemo(() => {
    const value = Number(form.valor) || 0
    const count = isInstallment ? Number(form.parcelas) || 0 : 1
    const summary = !isInstallment ? { total: value, installment: value } : form.modoParcelamento === 'valorTotal'
      ? { total: value, installment: count ? value / count : 0 }
      : { total: value * count, installment: value }
    const sign = form.tipo === 'Saída' ? -1 : 1
    return { total: summary.total * sign, installment: summary.installment * sign }
  }, [form.valor, form.parcelas, form.modoParcelamento, form.tipo, isInstallment])

  function grantAccess(result) {
    setSettings(result.configuracoes || { carteiras: [], categorias: [] })
    setSettingsLoaded(true)
    setHasAccess(true)
    setStatus({ kind: 'success', message: result.message })
  }

  async function reloadSpreadsheet() {
    setLoading('planilha'); setStatus({ kind: '', message: '' })
    try {
      const result = await callApi({ action: 'inicializar' })
      setSettings(result.configuracoes || { carteiras: [], categorias: [] })
      setSettingsLoaded(true)
      setStatus({ kind: 'success', message: 'Planilha recarregada e estrutura conferida.' })
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
  if (view === 'recurring') return <RecurringScreen settings={settings} onBack={() => setView('launch')} />

  return <main className="shell">
    <header className="brand"><span className="brandMark" aria-hidden="true">C$</span><div><p className="eyebrow">FINANÇAS SEM BUROCRACIA</p><h1>Cash Of Anarchy</h1></div>
      <span className={`connection ${configured ? 'online' : ''}`}><i /> {configured ? 'Sheets conectado' : 'Modo demonstração'}</span></header>

    <section className="hero compactHero"><div><p className="kicker">NOVO LANÇAMENTO</p><h2>Lance agora.<br /><em>Controle sempre.</em></h2><p className="lead">Registre receitas, despesas e lançamentos parcelados. Entradas ficam positivas; saídas, negativas.</p></div>
      <div className="heroActions"><button className="setupButton recurringNav" onClick={() => setView('recurring')}><span>Lançamentos recorrentes</span><small>Visualize, crie e edite recorrências</small></button>
      <button className="setupButton" disabled={Boolean(loading)} onClick={reloadSpreadsheet}><span>{loading === 'planilha' ? 'Recarregando…' : 'Recarregar planilha'}</span><small>Confere as colunas e atualiza carteiras e categorias</small></button></div></section>

    <section className="settingsStrip"><div><span>CARTEIRAS</span><strong>{settings.carteiras.length}</strong></div><div><span>CATEGORIAS</span><strong>{settings.categorias.length}</strong></div><p>Edite a aba “Configuracoes” no Google Sheets e toque em recarregar.</p></section>

    <section className="panel"><div className="panelHeading"><div><span>01</span><h3>Dados do lançamento</h3></div><p>Todos os campos são obrigatórios.</p></div>
      <form className="launchForm" onSubmit={handleSubmit}>
        <label className="fieldFull">Descrição<input required maxLength="100" autoCapitalize="sentences" enterKeyHint="next" placeholder="Ex.: Mercado do mês" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label>
        <label>Movimento<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option>Saída</option><option>Entrada</option></select></label>
        <label>Categoria<select required value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>{settings.categorias.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Carteira / origem<select required value={form.carteira} onChange={(e) => setForm({ ...form, carteira: e.target.value })}>{settings.carteiras.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Data do lançamento<input required type="date" value={form.dataLancamento} onChange={(e) => setForm({ ...form, dataLancamento: e.target.value })} /></label>
        <label>Competência inicial<input required type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} /><small className="fieldHint">Referência: {competenceReference(form.competencia)}</small></label>
        <label>Tipo de pagamento<select value={form.tipoPagamento} onChange={(e) => setForm({ ...form, tipoPagamento: e.target.value })}><option>À vista</option><option>Parcelado</option></select></label>

        {isInstallment && <fieldset className="fieldFull installmentOptions"><legend>Como deseja informar o valor?</legend>
          <label className="radioCard"><input type="radio" name="modoParcelamento" value="valorParcela" checked={form.modoParcelamento === 'valorParcela'} onChange={(e) => setForm({ ...form, modoParcelamento: e.target.value })} /><span><strong>Valor da parcela</strong><small>O total será valor × parcelas</small></span></label>
          <label className="radioCard"><input type="radio" name="modoParcelamento" value="valorTotal" checked={form.modoParcelamento === 'valorTotal'} onChange={(e) => setForm({ ...form, modoParcelamento: e.target.value })} /><span><strong>Valor total</strong><small>O sistema divide e ajusta centavos</small></span></label>
        </fieldset>}

        <label>{isInstallment && form.modoParcelamento === 'valorTotal' ? 'Valor total (R$)' : isInstallment ? 'Valor da parcela (R$)' : 'Valor (R$)'}
          <input required min="0.01" step="0.01" type="number" inputMode="decimal" enterKeyHint="next" placeholder="0,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></label>
        {isInstallment && <label>Quantidade de parcelas<input required min="2" max="120" step="1" type="number" inputMode="numeric" enterKeyHint="done" value={form.parcelas} onChange={(e) => setForm({ ...form, parcelas: e.target.value })} /></label>}

        <div className={`launchSummary ${form.tipo === 'Saída' ? 'amountNegative' : 'amountPositive'}`}><span>{isInstallment ? `${form.parcelas || 0} parcelas de aproximadamente` : form.tipo}</span><strong>{formatMoney(launchSummary.installment)}</strong>{isInstallment && <small>Total: {formatMoney(launchSummary.total)} · centavos ajustados automaticamente</small>}</div>
        <button className="submitButton saveLaunch" disabled={Boolean(loading) || !settings.carteiras.length || !settings.categorias.length} type="submit">{loading === 'adicionar' ? 'Salvando lançamentos…' : isInstallment ? 'Gerar e salvar parcelas' : 'Salvar lançamento'} <span>→</span></button>
      </form>
      {status.message && <div className={`notice ${status.kind}`} role="status">{status.message}</div>}
    </section>
    <footer><span>REACT · APPS SCRIPT · SHEETS</span><p>groupId agrupa parcelas do mesmo lançamento.</p><span>V0.5</span></footer>
  </main>
}

export default App
