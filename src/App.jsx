import { useEffect, useMemo, useState } from 'react'
import { callApi, clearAuthToken, consumeAuthError, getAuthToken, isApiConfigured, setAuthToken } from './api.js'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || ''
const USER_KEY = 'cash-of-anarchy:google-user'
let googleIdentityInitialized = false
let googleCredentialCallback = null

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

function storedGoogleUser() {
  if (!getAuthToken()) return null
  try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null') }
  catch { return null }
}

function formatCompetenceLabel(value) {
  const [month, year] = String(value || '').split('/')
  if (!month || !year) return value || '—'
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(new Date(Number(year), Number(month) - 1, 1))
  return label.replace('.', '')
}

function AccessGate({ onAccess }) {
  const [message, setMessage] = useState(consumeAuthError)
  const [loading, setLoading] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) { setMessage('Configure VITE_GOOGLE_CLIENT_ID para ativar o login Google.'); return }
    let active = true
    const initializeGoogle = () => {
      if (!active || !window.google?.accounts?.id) return
      googleCredentialCallback = async ({ credential }) => {
        if (!active) return
        setLoading(true); setMessage('')
        try {
          const authentication = await callApi({ action: 'autenticarGoogle' }, credential)
          setAuthToken(authentication.sessionToken)
          const initialization = await callApi({ action: 'inicializar' })
          onAccess({ ...initialization, usuario: authentication.usuario })
        } catch (error) {
          clearAuthToken(); setMessage(error.message)
        } finally { if (active) setLoading(false) }
      }
      if (!googleIdentityInitialized) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => googleCredentialCallback?.(response),
          auto_select: false,
          cancel_on_tap_outside: true,
        })
        googleIdentityInitialized = true
      }
      const container = document.getElementById('googleSignInButton')
      if (container) {
        container.innerHTML = ''
        window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with', width: Math.min(360, window.innerWidth - 72) })
      }
      setGoogleReady(true)
    }
    const existing = document.getElementById('googleIdentityServices')
    if (window.google?.accounts?.id) initializeGoogle()
    else if (existing) existing.addEventListener('load', initializeGoogle, { once: true })
    else {
      const script = document.createElement('script')
      script.id = 'googleIdentityServices'; script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true
      script.addEventListener('load', initializeGoogle, { once: true }); script.addEventListener('error', () => active && setMessage('Não foi possível carregar o login Google.'))
      document.head.appendChild(script)
    }
    return () => { active = false; existing?.removeEventListener('load', initializeGoogle) }
  }, [onAccess])

  return <main className="accessPage"><section className="accessCard">
    <span className="brandMark accessMark" aria-hidden="true">C$</span><p className="kicker">ACESSO RESTRITO</p><h1>Cash Of Anarchy</h1>
    <p>Entre com a conta Google autorizada para acessar seus dados financeiros.</p>
    <div className={`googleLoginArea ${loading ? 'isLoading' : ''}`}><div id="googleSignInButton" />{loading && <span>Validando conta e preparando planilhas…</span>}{!googleReady && !message && <span>Carregando login seguro…</span>}</div>
    {message && <div className="notice error" role="alert">{message}</div>}
    <small className="attemptHint">Somente contas autorizadas no Apps Script conseguem ler ou alterar a planilha.</small>
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

function DashboardScreen({ user, onNavigate, onSettingsUpdate, onSignOut }) {
  const [competence, setCompetence] = useState(localMonthValue)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState('dashboard')
  const [message, setMessage] = useState({ kind: '', text: '' })
  const [extractFilters, setExtractFilters] = useState({ description: '', category: '', wallet: '' })

  async function loadDashboard(selectedCompetence = competence, clearMessage = true) {
    setLoading('dashboard'); if (clearMessage) setMessage({ kind: '', text: '' })
    try {
      const result = await callApi({ action: 'obterDashboard', competencia: toCompetence(selectedCompetence) })
      setData(result)
    } catch (error) { setMessage({ kind: 'error', text: error.message }) }
    finally { setLoading('') }
  }

  useEffect(() => {
    setExtractFilters({ description: '', category: '', wallet: '' })
    loadDashboard(competence)
  }, [competence])

  async function syncSpreadsheet() {
    setLoading('planilha'); setMessage({ kind: '', text: '' })
    try {
      const result = await callApi({ action: 'inicializar' })
      onSettingsUpdate(result.configuracoes || { carteiras: [], categorias: [] })
      await loadDashboard(competence, false)
      setMessage({ kind: 'success', text: 'Planilha sincronizada e estrutura conferida.' })
    } catch (error) { setMessage({ kind: 'error', text: error.message }); setLoading('') }
  }

  async function syncSettings() {
    setLoading('configuracoes'); setMessage({ kind: '', text: '' })
    try {
      const result = await callApi({ action: 'obterConfiguracoes' })
      onSettingsUpdate(result.configuracoes || { carteiras: [], categorias: [] })
      setMessage({ kind: 'success', text: 'Carteiras e categorias sincronizadas.' })
    } catch (error) { setMessage({ kind: 'error', text: error.message }) }
    finally { setLoading('') }
  }

  const summary = data?.resumo || { income: 0, expenses: 0, balance: 0, count: 0 }
  const categories = data?.categorias || []
  const biggestCategory = Math.max(1, ...categories.map((item) => item.expenses))
  const launches = data?.lancamentos || []
  const installmentPayments = launches.filter((item) => item.installmentCount > 1)
  const availableCategories = [...new Set(launches.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const availableWallets = [...new Set(launches.map((item) => item.wallet).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const normalizedDescription = extractFilters.description.trim().toLocaleLowerCase('pt-BR')
  const filteredLaunches = launches.filter((item) => (
    (!normalizedDescription || item.description.toLocaleLowerCase('pt-BR').includes(normalizedDescription))
    && (!extractFilters.category || item.category === extractFilters.category)
    && (!extractFilters.wallet || item.wallet === extractFilters.wallet)
  ))
  const installmentTotal = installmentPayments.reduce((total, item) => total + item.value, 0)
  const extractTotal = filteredLaunches.reduce((total, item) => total + item.value, 0)
  const categoryTotal = categories.reduce((total, item) => total + item.expenses, 0)
  const walletTotal = (data?.carteiras || []).reduce((total, item) => total + item.balance, 0)

  return <main className="shell dashboardShell">
    <header className="brand dashboardBrand"><span className="brandMark" aria-hidden="true">C$</span><div><p className="eyebrow">CENTRAL FINANCEIRA</p><h1>Cash Of Anarchy</h1></div><button className="accountButton" onClick={onSignOut} aria-label={`Sair da conta ${user.email}`}><span>{user.email}</span><strong>Sair</strong></button></header>

    <section className="dashboardIntro"><div><p className="kicker">VISÃO GERAL</p><h2>Seu dinheiro.<br /><em>Sem neblina.</em></h2></div><label className="dashboardMonth">Mês analisado<input type="month" value={competence} onChange={(event) => setCompetence(event.target.value)} /></label></section>

    <nav className="dashboardActions" aria-label="Ações principais">
      <button className="primaryAction" onClick={() => onNavigate('launch')}><span>＋</span><strong>Novo lançamento</strong><small>Entrada, saída ou parcela</small></button>
      <button onClick={() => onNavigate('recurring')}><span>↻</span><strong>Recorrências</strong><small>Regras e processamento mensal</small></button>
      <button disabled={Boolean(loading)} onClick={syncSpreadsheet}><span>⇅</span><strong>{loading === 'planilha' ? 'Sincronizando…' : 'Sync planilha'}</strong><small>Estrutura e lançamentos</small></button>
      <button disabled={Boolean(loading)} onClick={syncSettings}><span>⚙</span><strong>{loading === 'configuracoes' ? 'Sincronizando…' : 'Sync configuração'}</strong><small>Carteiras e categorias</small></button>
    </nav>

    {message.text && <div className={`notice dashboardNotice ${message.kind}`} role="status">{message.text}</div>}
    {loading === 'dashboard' && !data ? <section className="dashboardLoading">Lendo sua planilha…</section> : <>
      <section className="metricGrid">
        <article className="metricCard"><span>ENTRADAS</span><strong className="positiveText">{formatMoney(summary.income)}</strong><small>{summary.count} lançamentos no mês</small></article>
        <article className="metricCard"><span>SAÍDAS</span><strong className="negativeText">{formatMoney(summary.expenses)}</strong><small>{summary.income ? Math.round((summary.expenses / summary.income) * 100) : 0}% das entradas</small></article>
        <article className={`metricCard balanceCard ${summary.balance < 0 ? 'negative' : ''}`}><span>SALDO PROJETADO</span><strong>{formatMoney(summary.balance)}</strong><small>{summary.balance < 0 ? 'Mês fecha no vermelho' : 'Margem disponível no mês'}</small></article>
        <article className="metricCard"><span>DÍVIDAS FUTURAS</span><strong>{formatMoney(data?.totalDividasFuturas)}</strong><small>A partir de {formatCompetenceLabel(toCompetence(competence))}</small></article>
      </section>

      <section className="dashboardSection"><div className="sectionTitle"><div><span>MACRO</span><h3>Horizonte financeiro</h3></div><p>Entradas, saídas e saldo por competência.</p></div>
        <div className="monthTimeline">{(data?.planejamento || []).length ? data.planejamento.map((month) => <article key={month.competence} className={month.balance < 0 ? 'monthNegative' : ''}><span>{formatCompetenceLabel(month.competence)}</span><strong>{formatMoney(month.expenses)}</strong><small>Saídas</small><div><i style={{ width: `${Math.min(100, month.income ? (month.expenses / month.income) * 100 : 100)}%` }} /></div><p className={month.balance < 0 ? 'negativeText' : 'positiveText'}>Saldo {formatMoney(month.balance)}</p></article>) : <div className="dashboardEmpty">Nenhum lançamento futuro encontrado.</div>}</div>
      </section>

      <div className="dashboardColumns"><section className="dashboardSection"><div className="sectionTitle"><div><span>MICRO</span><h3>Para onde vai</h3></div><p>Saídas do mês por categoria.</p></div><div className="breakdownList">{categories.length ? <>{categories.map((item) => <div key={item.name}><div><span>{item.name}</span><strong>{formatMoney(item.expenses)}</strong></div><i><b style={{ width: `${(item.expenses / biggestCategory) * 100}%` }} /></i></div>)}<div className="listTotal"><span>Total das saídas</span><strong className="negativeText">{formatMoney(categoryTotal)}</strong></div></> : <div className="dashboardEmpty">Sem despesas nesta competência.</div>}</div></section>
        <section className="dashboardSection"><div className="sectionTitle"><div><span>CARTEIRAS</span><h3>Impacto por conta</h3></div><p>Movimento líquido no mês.</p></div><div className="walletList">{(data?.carteiras || []).length ? <>{data.carteiras.map((item) => <div key={item.name}><span>{item.name}</span><strong className={item.balance < 0 ? 'negativeText' : 'positiveText'}>{formatMoney(item.balance)}</strong><small>{formatMoney(item.expenses)} em saídas</small></div>)}<div className="walletTotal"><span>Total líquido</span><strong className={walletTotal < 0 ? 'negativeText' : 'positiveText'}>{formatMoney(walletTotal)}</strong></div></> : <div className="dashboardEmpty">Sem movimentação por carteira.</div>}</div></section></div>

      <div className="dashboardDetailGrid"><section className="dashboardSection"><div className="sectionTitle"><div><span>PARCELAS DO MÊS</span><h3>Pagamentos parcelados</h3></div><p>Parcela atual e valor total da compra.</p></div><div className="futureTable installmentTable">{installmentPayments.length ? <>{installmentPayments.map((item) => <article key={item.id || `${item.groupId}-${item.installment}`}><div><span>{item.category}</span><strong>{item.description}</strong><small>{item.wallet} · Parcela {item.installment}/{item.installmentCount} · Compra total: {formatMoney(item.purchaseTotal)}</small></div><b className={item.value < 0 ? 'negativeText' : 'positiveText'}>{formatMoney(item.value)}</b></article>)}<div className="listTotal"><span>Somatório das parcelas do mês</span><strong className={installmentTotal < 0 ? 'negativeText' : 'positiveText'}>{formatMoney(installmentTotal)}</strong></div></> : <div className="dashboardEmpty">Nenhum pagamento parcelado nesta competência.</div>}</div></section>

      <section className="dashboardSection"><div className="sectionTitle"><div><span>{formatCompetenceLabel(toCompetence(competence)).toUpperCase()}</span><h3>Extrato do mês</h3></div><p>Tudo que entrou e saiu de todas as contas.</p></div>
        <div className="extractFilters">
          <label>Descrição<input type="search" inputMode="search" placeholder="Buscar parte da descrição" value={extractFilters.description} onChange={(event) => setExtractFilters((current) => ({ ...current, description: event.target.value }))} /></label>
          <label>Categoria<select value={extractFilters.category} onChange={(event) => setExtractFilters((current) => ({ ...current, category: event.target.value }))}><option value="">Todas</option>{availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label>Carteira<select value={extractFilters.wallet} onChange={(event) => setExtractFilters((current) => ({ ...current, wallet: event.target.value }))}><option value="">Todas</option>{availableWallets.map((wallet) => <option key={wallet} value={wallet}>{wallet}</option>)}</select></label>
        </div>
        <div className="futureTable currentLaunches">{filteredLaunches.length ? <>{filteredLaunches.map((item) => <article key={item.id || `${item.description}-${item.value}`}><div><span>{item.category}</span><strong>{item.description}</strong><small>{item.wallet}{item.installmentCount > 1 ? ` · Parcela ${item.installment}/${item.installmentCount}` : ''}</small></div><b className={item.value < 0 ? 'negativeText' : 'positiveText'}>{formatMoney(item.value)}</b></article>)}<div className="listTotal"><span>Total do extrato filtrado · {filteredLaunches.length} registro(s)</span><strong className={extractTotal < 0 ? 'negativeText' : 'positiveText'}>{formatMoney(extractTotal)}</strong></div></> : <div className="dashboardEmpty">Nenhum lançamento encontrado com esses filtros.</div>}</div></section></div>
    </>}
    <footer><span>DASHBOARD FINANCEIRO</span><p>Dados lidos diretamente do Google Sheets.</p><span>V0.6</span></footer>
  </main>
}

function App() {
  const [user, setUser] = useState(storedGoogleUser)
  const [form, setForm] = useState(createInitialForm)
  const [settings, setSettings] = useState({ carteiras: [], categorias: [] })
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [status, setStatus] = useState({ kind: '', message: '' })
  const [loading, setLoading] = useState('')
  const [view, setView] = useState('dashboard')
  const configured = isApiConfigured()
  const isInstallment = form.tipoPagamento === 'Parcelado'

  useEffect(() => {
    if (!user || settingsLoaded) return
    callApi({ action: 'obterConfiguracoes' })
      .then((result) => {
        setSettings(result.configuracoes || { carteiras: [], categorias: [] })
        setSettingsLoaded(true)
      })
      .catch((error) => setStatus({ kind: 'error', message: error.message }))
  }, [user, settingsLoaded])

  useEffect(() => {
    const expireSession = () => { sessionStorage.removeItem(USER_KEY); setUser(null); setSettingsLoaded(false) }
    window.addEventListener('cash-of-anarchy:auth-expired', expireSession)
    return () => window.removeEventListener('cash-of-anarchy:auth-expired', expireSession)
  }, [])

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
    sessionStorage.setItem(USER_KEY, JSON.stringify(result.usuario))
    setUser(result.usuario)
    setSettings(result.configuracoes || { carteiras: [], categorias: [] })
    setSettingsLoaded(true)
    setStatus({ kind: 'success', message: result.message })
  }

  function signOut() {
    clearAuthToken(); sessionStorage.removeItem(USER_KEY); setUser(null); setSettingsLoaded(false); setView('dashboard')
    window.google?.accounts?.id?.disableAutoSelect()
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

  if (!user) return <AccessGate onAccess={grantAccess} />
  if (view === 'dashboard') return <DashboardScreen user={user} onSignOut={signOut} onNavigate={setView} onSettingsUpdate={(nextSettings) => { setSettings(nextSettings); setSettingsLoaded(true) }} />
  if (view === 'recurring') return <RecurringScreen settings={settings} onBack={() => setView('dashboard')} />

  return <main className="shell">
    <header className="brand"><button className="backButton" onClick={() => setView('dashboard')} aria-label="Voltar ao dashboard">←</button><div><p className="eyebrow">NOVO LANÇAMENTO</p><h1>Cash Of Anarchy</h1></div>
      <span className={`connection ${configured ? 'online' : ''}`}><i /> {configured ? 'Sheets conectado' : 'Modo demonstração'}</span></header>

    <section className="hero compactHero"><div><p className="kicker">NOVO LANÇAMENTO</p><h2>Lance agora.<br /><em>Controle sempre.</em></h2><p className="lead">Registre receitas, despesas e lançamentos parcelados. Entradas ficam positivas; saídas, negativas.</p></div>
      </section>

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
