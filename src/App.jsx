import { useEffect, useMemo, useState } from 'react'
import { callApi, clearAuthToken, consumeAuthError, getAuthToken, isApiConfigured, setAuthToken } from './api.js'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || ''
const USER_KEY = 'cash-of-anarchy:google-user'
const VALUES_VISIBLE_KEY = 'cash-of-anarchy:values-visible'
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

function formatMonthInput(value) {
  const [year, month] = String(value || '').split('-').map(Number)
  if (!year || !month) return 'mês selecionado'
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
}

function competenceRange(start, end) {
  const [startYear, startMonth] = String(start || '').split('-').map(Number)
  const [endYear, endMonth] = String(end || '').split('-').map(Number)
  if (!startYear || !startMonth || !endYear || !endMonth) return []
  const first = (startYear * 12) + startMonth
  const last = (endYear * 12) + endMonth
  if (last < first || last - first > 35) return []
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const absoluteMonth = first + index
    const month = ((absoluteMonth - 1) % 12) + 1
    const year = Math.floor((absoluteMonth - 1) / 12)
    return `${year}-${String(month).padStart(2, '0')}`
  })
}

function addMonthsToInput(value, amount) {
  const [year, month] = String(value || '').split('-').map(Number)
  if (!year || !month) return ''
  const date = new Date(year, month - 1 + amount, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function compareMonthInputs(left, right) {
  return String(left).localeCompare(String(right))
}

function cardCompetence(dateValue, closingDay) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number)
  if (!year || !month || !day) return localMonthValue()
  const offset = day > (Number(closingDay) || 25) ? 2 : 1
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function OperationModal({ operation, onClose }) {
  useEffect(() => {
    if (!operation.open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [operation.open])
  if (!operation.open) return null
  const finished = operation.status === 'success' || operation.status === 'error'
  return <div className="operationOverlay" role="presentation">
    <section className={`operationModal ${operation.status}`} role="dialog" aria-modal="true" aria-labelledby="operationTitle" aria-describedby="operationMessage">
      <span className="operationMark" aria-hidden="true">{operation.status === 'success' ? '✓' : operation.status === 'error' ? '!' : '↻'}</span>
      <p className="kicker">{operation.status === 'success' ? 'CONCLUÍDO' : operation.status === 'error' ? 'NÃO FOI POSSÍVEL CONCLUIR' : 'AGUARDE'}</p>
      <h3 id="operationTitle">{operation.title}</h3>
      <p id="operationMessage" className="operationMessage">{operation.message}</p>
      {operation.detail && <small className="operationDetail">{operation.detail}</small>}
      {operation.total > 0 && <div className="operationProgress" aria-label={`Progresso ${operation.current} de ${operation.total}`}><i style={{ width: `${Math.round((operation.current / operation.total) * 100)}%` }} /></div>}
      {finished ? <button type="button" className="submitButton operationOk" onClick={onClose}>OK <span>→</span></button> : <div className="operationSpinner" aria-hidden="true" />}
    </section>
  </div>
}

const CLOSED_OPERATION = { open: false, status: '', title: '', message: '', detail: '', current: 0, total: 0 }

function SheetLoadingOverlay({ visible, context, competence }) {
  useEffect(() => {
    if (!visible) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [visible])
  if (!visible) return null
  const isMonthChange = context === 'month'
  const isSync = context === 'sync'
  return <div className="sheetLoadingOverlay" role="status" aria-live="polite" aria-label="Carregando dados da planilha">
    <section className="sheetLoadingCard">
      <div className="sheetLoadingIcon" aria-hidden="true"><span /><i /><b /></div>
      <p className="kicker">GOOGLE SHEETS</p>
      <h3>{isMonthChange ? `Carregando ${formatMonthInput(competence)}` : isSync ? 'Sincronizando sua planilha' : 'Carregando sua planilha'}</h3>
      <p>{isMonthChange ? 'Buscando lançamentos, saldos e cartões desta competência…' : isSync ? 'Conferindo a estrutura e atualizando os dados financeiros…' : 'Preparando seu dashboard financeiro…'}</p>
      <div className="sheetLoadingBar"><i /></div>
      <small>Isso pode levar alguns segundos.</small>
    </section>
  </div>
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
  const [processingEndCompetence, setProcessingEndCompetence] = useState(localMonthValue)
  const [removalCompetence, setRemovalCompetence] = useState(localMonthValue)
  const [loading, setLoading] = useState('listar')
  const [message, setMessage] = useState({ kind: '', text: '' })
  const [operation, setOperation] = useState(CLOSED_OPERATION)

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
    setOperation({ open: true, status: 'loading', title: editing ? 'Salvando alterações' : 'Criando recorrência', message: 'Enviando os dados para sua planilha…', detail: '', current: 0, total: 0 })
    try {
      const result = await callApi({
        action: editing ? 'atualizarRecorrente' : 'adicionarRecorrente', ...form,
        valor: Number(form.valor), competenciaInicial: toCompetence(form.competenciaInicial),
      })
      setMessage({ kind: 'success', text: result.message })
      await loadItems(); setMode('list')
      setOperation({ open: true, status: 'success', title: editing ? 'Recorrência atualizada' : 'Recorrência criada', message: result.message, detail: 'A alteração já está disponível na sua planilha.', current: 0, total: 0 })
    } catch (error) {
      setMessage({ kind: 'error', text: error.message })
      setOperation({ open: true, status: 'error', title: 'Erro ao salvar recorrência', message: error.message, detail: 'Revise os dados e tente novamente.', current: 0, total: 0 })
    }
    finally { setLoading('') }
  }

  async function processCompetenceRange() {
    const months = competenceRange(processingCompetence, processingEndCompetence)
    if (!months.length) {
      setOperation({ open: true, status: 'error', title: 'Período inválido', message: 'A competência final deve ser igual ou posterior à inicial.', detail: 'O período pode ter no máximo 36 meses.', current: 0, total: 0 })
      return
    }
    setLoading('processar'); setMessage({ kind: '', text: '' })
    let created = 0
    try {
      for (let index = 0; index < months.length; index += 1) {
        const month = months[index]
        setOperation({ open: true, status: 'loading', title: 'Processando recorrências', message: `Processando ${formatMonthInput(month)}`, detail: `${index + 1}/${months.length}`, current: index + 1, total: months.length })
        const result = await callApi({ action: 'processarRecorrentes', competencia: toCompetence(month) })
        created += Number(result.lancamentosCriados || 0)
        setOperation((current) => ({ ...current, current: index + 1 }))
      }
      const resultMessage = `${months.length} competência(s) processada(s). ${created} lançamento(s) criado(s).`
      setMessage({ kind: 'success', text: resultMessage })
      setOperation({ open: true, status: 'success', title: 'Período processado', message: resultMessage, detail: `${formatMonthInput(months[0])} até ${formatMonthInput(months[months.length - 1])}`, current: months.length, total: months.length })
    } catch (error) {
      setMessage({ kind: 'error', text: error.message })
      setOperation((current) => ({ ...current, status: 'error', title: 'Processamento interrompido', message: error.message, detail: `${current.current}/${months.length} competência(s) concluída(s)` }))
    }
    finally { setLoading('') }
  }

  async function removeCompetence() {
    const competence = toCompetence(removalCompetence)
    if (!window.confirm(`Remover os lançamentos recorrentes de ${competence}? As regras continuarão cadastradas.`)) return
    setLoading('remover'); setMessage({ kind: '', text: '' })
    setOperation({ open: true, status: 'loading', title: 'Removendo lançamentos', message: `Removendo ${formatMonthInput(removalCompetence)}`, detail: 'As regras de recorrência serão mantidas.', current: 0, total: 0 })
    try {
      const result = await callApi({ action: 'removerLancamentosRecorrentes', competencia: competence })
      setMessage({ kind: 'success', text: result.message })
      setOperation({ open: true, status: 'success', title: 'Remoção concluída', message: result.message, detail: `${formatMonthInput(removalCompetence)} foi processado.`, current: 0, total: 0 })
    } catch (error) {
      setMessage({ kind: 'error', text: error.message })
      setOperation({ open: true, status: 'error', title: 'Erro ao remover lançamentos', message: error.message, detail: 'Nenhuma regra de recorrência foi removida.', current: 0, total: 0 })
    }
    finally { setLoading('') }
  }

  return <main className="shell">
    <header className="brand"><button className="backButton" onClick={onBack} aria-label="Voltar para novo lançamento">←</button><div><p className="eyebrow">GERENCIAMENTO</p><h1>Lançamentos recorrentes</h1></div></header>
    <section className="recurringHero"><div><p className="kicker">RECORRÊNCIAS</p><h2>Todo mês.<br /><em>Sem esquecer.</em></h2></div>
      {mode === 'list' && <button className="submitButton newRecurring" onClick={openNew}>Nova recorrência <span>＋</span></button>}
    </section>

    {mode === 'list' && <section className="recurringProcessor rangeProcessor">
      <div className="processorIntro"><p className="kicker">GERAR LANÇAMENTOS</p><h3>Processar um período</h3><p>O frontend processa uma competência por vez, em ordem, usando a ação mensal existente.</p></div>
      <div className="rangeFields"><label>Competência inicial<input required type="month" value={processingCompetence} disabled={Boolean(loading)} onChange={(event) => setProcessingCompetence(event.target.value)} /></label><label>Competência final<input required type="month" min={processingCompetence} value={processingEndCompetence} disabled={Boolean(loading)} onChange={(event) => setProcessingEndCompetence(event.target.value)} /></label></div>
      <div className="recurringProcessorActions"><button className="submitButton" disabled={Boolean(loading) || !processingCompetence || !processingEndCompetence} onClick={processCompetenceRange}>{loading === 'processar' ? 'Processando período…' : 'Processar período'} <span>→</span></button></div>
      <div className="removalProcessor"><label>Remover lançamentos de<input required type="month" value={removalCompetence} disabled={Boolean(loading)} onChange={(event) => setRemovalCompetence(event.target.value)} /></label><button className="dangerButton" disabled={Boolean(loading) || !removalCompetence} onClick={removeCompetence}>{loading === 'remover' ? 'Removendo…' : 'Remover lançamentos do mês'}</button></div>
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
    <OperationModal operation={operation} onClose={() => setOperation(CLOSED_OPERATION)} />
    <footer><span>RECORRÊNCIAS · MENSAL</span><p>Regras separadas dos lançamentos financeiros.</p><span>V0.4</span></footer>
  </main>
}

function ProjectionScreen({ settings, onBack }) {
  const [form, setForm] = useState({
    descricao: '', carteira: settings.carteiras[0] || 'Dinheiro', tipoPagamento: 'Parcelado',
    modoValor: 'valorParcela', valor: '', parcelas: '12', competenciaInicial: localMonthValue(), horizonte: '12',
  })
  const [result, setResult] = useState(null)
  const [operation, setOperation] = useState(CLOSED_OPERATION)
  const [running, setRunning] = useState(false)

  function createSimulationEntries() {
    const installmentCount = form.tipoPagamento === 'À vista' ? 1 : Number(form.parcelas)
    const rawCents = Math.round(Number(form.valor) * 100)
    if (!rawCents || !Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 120) return []
    if (form.tipoPagamento === 'Parcelado' && form.modoValor === 'valorTotal') {
      const base = Math.floor(rawCents / installmentCount)
      const remainder = rawCents % installmentCount
      return Array.from({ length: installmentCount }, (_, index) => ({
        month: addMonthsToInput(form.competenciaInicial, index),
        value: -((base + (index < remainder ? 1 : 0)) / 100), installment: index + 1, installmentCount,
      }))
    }
    return Array.from({ length: installmentCount }, (_, index) => ({
      month: addMonthsToInput(form.competenciaInicial, index), value: -(rawCents / 100), installment: index + 1, installmentCount,
    }))
  }

  async function runProjection(event) {
    event.preventDefault()
    const horizon = Number(form.horizonte)
    const simulationEntries = createSimulationEntries()
    if (!form.descricao.trim() || !form.carteira || !simulationEntries.length || !Number.isInteger(horizon) || horizon < 1 || horizon > 36) {
      setOperation({ open: true, status: 'error', title: 'Dados inválidos', message: 'Preencha a descrição, o valor, a carteira, as parcelas e um horizonte entre 1 e 36 meses.', detail: '', current: 0, total: 0 })
      return
    }

    const months = Array.from({ length: horizon }, (_, index) => addMonthsToInput(form.competenciaInicial, index))
    const adjustmentsByWallet = {}
    const projectedRows = []
    setRunning(true); setResult(null)
    try {
      setOperation({ open: true, status: 'loading', title: 'Preparando projeção', message: 'Lendo suas obrigações recorrentes…', detail: `0/${months.length}`, current: 0, total: months.length })
      const recurringResponse = await callApi({ action: 'listarRecorrentes' })
      const recurringRules = (recurringResponse.recorrentes || []).filter((rule) => rule.status === 'Ativa' && rule.periodicidade === 'Mensal')

      for (let index = 0; index < months.length; index += 1) {
        const month = months[index]
        setOperation({ open: true, status: 'loading', title: 'Calculando horizonte', message: `Analisando ${formatMonthInput(month)}`, detail: `${index + 1}/${months.length}`, current: index + 1, total: months.length })
        const dashboard = await callApi({ action: 'obterDashboard', competencia: toCompetence(month) })
        const launches = dashboard.lancamentos || []
        const missingRecurring = recurringRules.filter((rule) => (
          compareMonthInputs(fromCompetence(rule.competenciaInicial), month) <= 0
          && !launches.some((launch) => launch.recurringId && launch.recurringId === rule.recurringId)
        ))
        const monthAdjustments = []
        missingRecurring.forEach((rule) => {
          const value = rule.tipo === 'Saída' ? -Math.abs(Number(rule.valor) || 0) : Math.abs(Number(rule.valor) || 0)
          monthAdjustments.push({ wallet: rule.carteira, value, kind: 'recurring', description: rule.descricao })
        })
        simulationEntries.filter((entry) => entry.month === month).forEach((entry) => {
          monthAdjustments.push({ wallet: form.carteira, value: entry.value, kind: 'simulation', description: form.descricao, ...entry })
        })
        monthAdjustments.forEach((entry) => { adjustmentsByWallet[entry.wallet] = (adjustmentsByWallet[entry.wallet] || 0) + entry.value })

        const balances = Object.fromEntries((dashboard.saldosCarteiras || []).map((wallet) => [wallet.name, wallet.balance]))
        Object.entries(adjustmentsByWallet).forEach(([wallet, value]) => { balances[wallet] = (balances[wallet] || 0) + value })
        const cashBalance = Object.entries(balances).reduce((total, [wallet, value]) => wallet.trim().toLocaleLowerCase('pt-BR') === 'dinheiro' ? total + value : total, 0)
        const cardBalances = Object.entries(balances).filter(([wallet]) => wallet.trim().toLocaleLowerCase('pt-BR') !== 'dinheiro')
        const cardDebt = cardBalances.reduce((total, [, value]) => total + (value < 0 ? Math.abs(value) : 0), 0)
        const cardCredit = cardBalances.reduce((total, [, value]) => total + (value > 0 ? value : 0), 0)
        const simulatedMonthValue = monthAdjustments.reduce((total, entry) => total + entry.value, 0)
        const baseSummary = dashboard.resumo || { income: 0, expenses: 0, balance: 0 }
        projectedRows.push({
          month, cashBalance, cardDebt, netPosition: cashBalance - cardDebt + cardCredit,
          income: baseSummary.income + monthAdjustments.reduce((total, entry) => total + (entry.value > 0 ? entry.value : 0), 0),
          expenses: baseSummary.expenses + monthAdjustments.reduce((total, entry) => total + (entry.value < 0 ? Math.abs(entry.value) : 0), 0),
          monthlyBalance: baseSummary.balance + simulatedMonthValue,
          missingRecurringCount: missingRecurring.length,
          simulation: monthAdjustments.find((entry) => entry.kind === 'simulation') || null,
        })
      }
      setResult({ rows: projectedRows, totalPurchase: Math.abs(simulationEntries.reduce((total, entry) => total + entry.value, 0)), description: form.descricao.trim() })
      setOperation({ open: true, status: 'success', title: 'Projeção concluída', message: `${months.length} competência(s) analisada(s), considerando lançamentos, cartões, caixa e recorrências pendentes.`, detail: 'Nenhum dado foi salvo na planilha.', current: months.length, total: months.length })
    } catch (error) {
      setOperation({ open: true, status: 'error', title: 'Erro ao calcular projeção', message: error.message, detail: 'Nenhuma informação da simulação foi salva.', current: 0, total: 0 })
    } finally { setRunning(false) }
  }

  return <main className="shell projectionShell">
    <header className="brand"><button className="backButton" onClick={onBack} aria-label="Sair da projeção">←</button><div><p className="eyebrow">ANÁLISE TEMPORÁRIA</p><h1>Projeção financeira</h1></div><span className="temporaryBadge">NÃO SALVA</span></header>
    <section className="projectionHero"><div><p className="kicker">SIMULAÇÃO</p><h2>Antes de comprar.<br/><em>Veja o impacto.</em></h2><p className="lead">Teste uma compra, financiamento ou empréstimo contra seu caixa, cartões, parcelas e obrigações recorrentes.</p></div></section>
    <section className="panel projectionPanel"><div className="panelHeading"><div><span>P</span><h3>Nova hipótese</h3></div><p>Ao sair desta tela, tudo será apagado.</p></div>
      <form className="projectionForm" onSubmit={runProjection}>
        <label className="fieldFull">O que você quer simular?<input required maxLength="100" placeholder="Ex.: Financiamento da moto" value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })}/></label>
        <label>Carteira de impacto<select value={form.carteira} onChange={(event) => setForm({ ...form, carteira: event.target.value })}>{settings.carteiras.map((wallet) => <option key={wallet}>{wallet}</option>)}</select><small className="fieldHint">Dinheiro reduz o caixa; qualquer outra carteira aumenta ou reduz o cartão.</small></label>
        <label>Pagamento<select value={form.tipoPagamento} onChange={(event) => setForm({ ...form, tipoPagamento: event.target.value })}><option>À vista</option><option>Parcelado</option></select></label>
        <label>Competência inicial<input required type="month" value={form.competenciaInicial} onChange={(event) => setForm({ ...form, competenciaInicial: event.target.value })}/></label>
        {form.tipoPagamento === 'Parcelado' && <label>Como informar o valor?<select value={form.modoValor} onChange={(event) => setForm({ ...form, modoValor: event.target.value })}><option value="valorParcela">Valor de cada parcela</option><option value="valorTotal">Valor total da compra</option></select></label>}
        <label>{form.tipoPagamento === 'Parcelado' && form.modoValor === 'valorParcela' ? 'Valor da parcela (R$)' : form.tipoPagamento === 'Parcelado' ? 'Valor total (R$)' : 'Valor (R$)'}<input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.valor} onChange={(event) => setForm({ ...form, valor: event.target.value })}/></label>
        {form.tipoPagamento === 'Parcelado' && <label>Parcelas<input required min="1" max="120" type="number" inputMode="numeric" value={form.parcelas} onChange={(event) => setForm({ ...form, parcelas: event.target.value })}/></label>}
        <label>Horizonte analisado<input required min="1" max="36" type="number" inputMode="numeric" value={form.horizonte} onChange={(event) => setForm({ ...form, horizonte: event.target.value })}/><small className="fieldHint">Quantidade de meses exibidos, de 1 a 36.</small></label>
        <button className="submitButton fieldFull" disabled={running || !settings.carteiras.length} type="submit">{running ? 'Calculando projeção…' : 'Calcular impacto'} <span>→</span></button>
      </form>
    </section>
    {result && <section className="projectionResults"><div className="sectionTitle"><div><span>RESULTADO TEMPORÁRIO</span><h3>Horizonte com “{result.description}”</h3></div><p>Total simulado: {formatMoney(result.totalPurchase)}</p></div><div className="projectionTimeline">{result.rows.map((month) => <article key={month.month} className={month.netPosition < 0 ? 'projectionDanger' : ''}><span>{formatMonthInput(month.month)}</span><strong className={month.netPosition < 0 ? 'negativeText' : 'positiveText'}>{formatMoney(month.netPosition)}</strong><small>Posição líquida</small><dl><div><dt>Dinheiro</dt><dd>{formatMoney(month.cashBalance)}</dd></div><div><dt>Cartões</dt><dd>{formatMoney(month.cardDebt)}</dd></div><div><dt>Entradas</dt><dd>{formatMoney(month.income)}</dd></div><div><dt>Saídas</dt><dd>{formatMoney(month.expenses)}</dd></div></dl>{month.simulation && <p>Simulação: parcela {month.simulation.installment}/{month.simulation.installmentCount} · {formatMoney(month.simulation.value)}</p>}{month.missingRecurringCount > 0 && <em>+ {month.missingRecurringCount} recorrência(s) ainda não processada(s)</em>}</article>)}</div></section>}
    <OperationModal operation={operation} onClose={() => setOperation(CLOSED_OPERATION)}/>
    <footer><span>PROJEÇÃO · SOMENTE MEMÓRIA</span><p>Nenhum lançamento é criado ou alterado.</p><span>V0.7</span></footer>
  </main>
}

function HomeScreen({ user, onNavigate, onSignOut }) {
  return <main className="shell homeShell">
    <header className="brand dashboardBrand"><span className="brandMark">C$</span><div><p className="eyebrow">CENTRAL FINANCEIRA</p><h1>Cash Of Anarchy</h1></div><button className="accountButton" onClick={onSignOut}><span>{user.email}</span><strong>Sair</strong></button></header>
    <section className="dashboardIntro homeIntro"><div><p className="kicker">INÍCIO</p><h2>O que vamos<br/><em>fazer agora?</em></h2><p className="lead">O dashboard só busca os dados financeiros quando você pedir.</p></div></section>
    <nav className="homeActions">
      <button className="primaryAction" onClick={() => onNavigate('dashboard')}><span>▦</span><strong>Carregar dashboard</strong><small>Visão completa, extrato e horizonte</small></button>
      <button onClick={() => onNavigate('launch')}><span>＋</span><strong>Novo lançamento</strong><small>Entrada, saída ou parcelas</small></button>
      <button onClick={() => onNavigate('cards')}><span>▣</span><strong>Cartões</strong><small>Consultar e pagar faturas</small></button>
      <button onClick={() => onNavigate('recurring')}><span>↻</span><strong>Recorrências</strong><small>Obrigações mensais</small></button>
      <button onClick={() => onNavigate('projection')}><span>◫</span><strong>Projeção</strong><small>Simular sem salvar</small></button>
    </nav>
  </main>
}

function CardsScreen({ settings, onBack }) {
  const [form, setForm] = useState({ cartao: settings.cartoes?.[0]?.nome || '', carteira: settings.contas?.[0] || '', valor: '', competencia: localMonthValue(), dataPagamento: localDateValue() })
  const [operation, setOperation] = useState(CLOSED_OPERATION)
  async function submit(event) {
    event.preventDefault(); setOperation({ open: true, status: 'loading', title: 'Pagando cartão', message: 'Criando a saída na conta e a entrada no cartão…', detail: '', current: 0, total: 0 })
    try { const result = await callApi({ action: 'pagarCartao', ...form, valor: Number(form.valor), competencia: toCompetence(form.competencia) }); setOperation({ open: true, status: 'success', title: 'Fatura paga', message: result.message, detail: 'As duas movimentações usam o mesmo identificador.', current: 0, total: 0 }); setForm((current) => ({ ...current, valor: '' })) }
    catch (error) { setOperation({ open: true, status: 'error', title: 'Não foi possível pagar', message: error.message, detail: '', current: 0, total: 0 }) }
  }
  return <main className="shell"><header className="brand"><button className="backButton" onClick={onBack}>←</button><div><p className="eyebrow">CARTÕES</p><h1>Pagamento de fatura</h1></div></header>
    <section className="hero compactHero"><div><p className="kicker">TRANSFERÊNCIA</p><h2>Quite a fatura.<br/><em>Acerte os saldos.</em></h2><p className="lead">O valor sai de uma conta e entra no cartão, zerando a dívida sem inventar renda.</p></div></section>
    <section className="panel"><form className="launchForm" onSubmit={submit}>
      <label>Cartão<select required value={form.cartao} onChange={(e) => setForm({...form, cartao:e.target.value})}>{(settings.cartoes || []).map((item) => <option key={item.nome}>{item.nome}</option>)}</select></label>
      <label>Conta de origem<select required value={form.carteira} onChange={(e) => setForm({...form, carteira:e.target.value})}>{(settings.contas || []).map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Valor pago (R$)<input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.valor} onChange={(e) => setForm({...form, valor:e.target.value})}/></label>
      <label>Data do pagamento<input required type="date" value={form.dataPagamento} onChange={(e) => setForm({...form, dataPagamento:e.target.value})}/></label>
      <label>Competência da fatura<input required type="month" value={form.competencia} onChange={(e) => setForm({...form, competencia:e.target.value})}/></label>
      <button className="submitButton fieldFull" disabled={!settings.cartoes?.length || !settings.contas?.length}>Confirmar pagamento <span>→</span></button>
    </form>{!settings.cartoes?.length && <div className="notice error">Configure ao menos uma linha como “Cartão” na aba Configuracoes.</div>}</section>
    <OperationModal operation={operation} onClose={() => setOperation(CLOSED_OPERATION)}/>
  </main>
}

function DashboardScreen({ user, onNavigate, onSettingsUpdate, onSignOut, valuesVisible, onToggleValues }) {
  const [competence, setCompetence] = useState(localMonthValue)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState('dashboard')
  const [loadingContext, setLoadingContext] = useState('initial')
  const [message, setMessage] = useState({ kind: '', text: '' })
  const [extractFilters, setExtractFilters] = useState({ description: '', category: '', wallet: '' })
  const [effecting, setEffecting] = useState(null)

  async function loadDashboard(selectedCompetence = competence, clearMessage = true, context = loadingContext) {
    setLoadingContext(context)
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
    setLoadingContext('sync')
    setLoading('planilha'); setMessage({ kind: '', text: '' })
    try {
      const result = await callApi({ action: 'inicializar' })
      onSettingsUpdate(result.configuracoes || { carteiras: [], categorias: [] })
      await loadDashboard(competence, false, 'sync')
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
  const position = data?.posicao || { cashBalance: 0, cashPrevious: 0, cashMovement: 0, cardDebt: 0, cardCredit: 0, netPosition: 0, cardCount: 0 }
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
  const walletBalances = data?.saldosCarteiras || []
  const walletTotal = position.netPosition
  const money = (value) => valuesVisible ? formatMoney(value) : 'R$ ••••'

  async function confirmRecurring(event) {
    event.preventDefault()
    try { await callApi({ action: 'efetivarRecorrente', recurringId: effecting.recurringId, competencia: effecting.competence, dataLancamento: effecting.date, valor: Number(effecting.amount) }); setEffecting(null); await loadDashboard(competence, false, 'sync') }
    catch (error) { setMessage({ kind: 'error', text: error.message }) }
  }

  return <main className={`shell dashboardShell ${valuesVisible ? '' : 'valuesMasked'}`}>
    <header className="brand dashboardBrand"><span className="brandMark" aria-hidden="true">C$</span><div><p className="eyebrow">CENTRAL FINANCEIRA</p><h1>Cash Of Anarchy</h1></div><button className="accountButton" onClick={onSignOut} aria-label={`Sair da conta ${user.email}`}><span>{user.email}</span><strong>Sair</strong></button></header>
    <div className="privacyToolbar"><button type="button" className="privacyButton" aria-pressed={valuesVisible} onClick={onToggleValues}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3"/>{!valuesVisible && <path className="privacySlash" d="M4 4 20 20"/>}</svg><span>{valuesVisible ? 'Valores visíveis' : 'Valores ocultos'}</span></button></div>

    <section className="dashboardIntro"><div><p className="kicker">VISÃO GERAL</p><h2>Seu dinheiro.<br /><em>Sem neblina.</em></h2></div><label className="dashboardMonth">Mês analisado<input type="month" value={competence} disabled={loading === 'dashboard' || loading === 'planilha'} onChange={(event) => { setLoadingContext('month'); setCompetence(event.target.value) }} /></label></section>

    <nav className="dashboardActions" aria-label="Ações principais">
      <button className="primaryAction" onClick={() => onNavigate('launch')}><span>＋</span><strong>Novo lançamento</strong><small>Entrada, saída ou parcela</small></button>
      <button className="projectionAction" onClick={() => onNavigate('projection')}><span>◫</span><strong>Nova projeção</strong><small>Simule uma compra sem salvar</small></button>
      <button onClick={() => onNavigate('cards')}><span>▣</span><strong>Cartões</strong><small>Pagar fatura</small></button>
      <button onClick={() => onNavigate('recurring')}><span>↻</span><strong>Recorrências</strong><small>Regras e processamento mensal</small></button>
      <button disabled={Boolean(loading)} onClick={syncSpreadsheet}><span>⇅</span><strong>{loading === 'planilha' ? 'Sincronizando…' : 'Sync planilha'}</strong><small>Estrutura e lançamentos</small></button>
      <button disabled={Boolean(loading)} onClick={syncSettings}><span>⚙</span><strong>{loading === 'configuracoes' ? 'Sincronizando…' : 'Sync configuração'}</strong><small>Carteiras e categorias</small></button>
    </nav>

    {data?.totalRecorrenciasPendentes > 0 && <div className="pendingAlert" role="status"><strong>{data.totalRecorrenciasPendentes} recorrência(s) pendente(s) nesta competência</strong><span>Elas já entram nos cálculos. Efetive cada uma pelo extrato quando souber a data e o valor real.</span></div>}

    {message.text && <div className={`notice dashboardNotice ${message.kind}`} role="status">{message.text}</div>}
    <SheetLoadingOverlay visible={loading === 'dashboard' || loading === 'planilha'} context={loadingContext} competence={competence} />
    {loading === 'dashboard' && !data ? <section className="dashboardLoading">Lendo sua planilha…</section> : <>
      <section className="metricGrid">
        <article className="metricCard"><span>ENTRADAS</span><strong className="positiveText">{money(summary.income)}</strong><small>{summary.count} lançamentos no mês</small></article>
        <article className="metricCard"><span>SAÍDAS</span><strong className="negativeText">{money(summary.expenses)}</strong><small>{valuesVisible ? (summary.income ? Math.round((summary.expenses / summary.income) * 100) : 0) : '••'}% das entradas</small></article>
        <article className={`metricCard balanceCard ${position.cashBalance < 0 ? 'negative' : ''}`}><span>DINHEIRO DISPONÍVEL</span><strong>{money(position.cashBalance)}</strong><small>Anterior: {money(position.cashPrevious)} · {position.cashMovement < 0 ? 'saiu' : 'entrou'} no mês: {money(position.cashMovement)}</small></article>
        <article className="metricCard"><span>DÍVIDA NOS CARTÕES</span><strong className={position.cardDebt > 0 ? 'negativeText' : 'positiveText'}>{money(position.cardDebt)}</strong><small>{position.cardCount} carteira(s) · posição líquida {position.netPosition < 0 ? 'negativa' : 'positiva'}: {money(position.netPosition)}</small></article>
      </section>

      <section className="dashboardSection"><div className="sectionTitle"><div><span>MACRO</span><h3>Horizonte financeiro</h3></div><p>Caixa acumulado e dívidas dos cartões por competência.</p></div>
        <div className="monthTimeline">{(data?.planejamento || []).length ? data.planejamento.map((month) => <article key={month.competence} className={month.netPosition < 0 ? 'monthNegative' : ''}><span>{formatCompetenceLabel(month.competence)}</span><strong className={month.cashBalance < 0 ? 'negativeText' : 'positiveText'}>{money(month.cashBalance)}</strong><small>Dinheiro disponível · cartões {money(month.cardDebt)}</small><div><i style={{ width: `${Math.min(100, month.cardDebt ? (month.cardDebt / Math.max(1, month.cashBalance)) * 100 : 0)}%` }} /></div><p className={month.netPosition < 0 ? 'negativeText' : 'positiveText'}>Posição líquida {money(month.netPosition)}</p></article>) : <div className="dashboardEmpty">Nenhum lançamento futuro encontrado.</div>}</div>
      </section>

      <section className="dashboardSection"><div className="sectionTitle"><div><span>CONTAS E CARTÕES</span><h3>Posição por carteira</h3></div><p>Classificação lida da aba Configuracoes.</p></div><div className="walletList">{walletBalances.length ? <>{walletBalances.map((item) => <div key={item.name}><span>{item.name}</span><strong className={item.balance < 0 ? 'negativeText' : 'positiveText'}>{money(item.balance)}</strong><small>{item.balance < 0 ? 'Saldo devedor acumulado' : 'Saldo positivo acumulado'}</small></div>)}<div className="walletTotal"><span>Posição líquida</span><strong className={walletTotal < 0 ? 'negativeText' : 'positiveText'}>{money(walletTotal)}</strong></div></> : <div className="dashboardEmpty">Sem movimentação por carteira.</div>}</div></section>

      <div className="dashboardDetailGrid"><section className="dashboardSection"><div className="sectionTitle"><div><span>PARCELAS DO MÊS</span><h3>Pagamentos parcelados</h3></div><p>Parcela atual e valor total da compra.</p></div><div className="futureTable installmentTable">{installmentPayments.length ? <>{installmentPayments.map((item) => <article key={item.id || `${item.groupId}-${item.installment}`}><div><span>{item.category}</span><strong>{item.description}</strong><small>{item.wallet} · Parcela {item.installment}/{item.installmentCount} · Compra total: {money(item.purchaseTotal)}</small></div><b className={item.value < 0 ? 'negativeText' : 'positiveText'}>{money(item.value)}</b></article>)}<div className="listTotal"><span>Somatório das parcelas do mês</span><strong className={installmentTotal < 0 ? 'negativeText' : 'positiveText'}>{money(installmentTotal)}</strong></div></> : <div className="dashboardEmpty">Nenhum pagamento parcelado nesta competência.</div>}</div></section>

      <section className="dashboardSection"><div className="sectionTitle"><div><span>{formatCompetenceLabel(toCompetence(competence)).toUpperCase()}</span><h3>Extrato do mês</h3></div><p>Tudo que entrou e saiu de todas as contas.</p></div>
        <div className="extractFilters">
          <label>Descrição<input type="search" inputMode="search" placeholder="Buscar parte da descrição" value={extractFilters.description} onChange={(event) => setExtractFilters((current) => ({ ...current, description: event.target.value }))} /></label>
          <label>Categoria<select value={extractFilters.category} onChange={(event) => setExtractFilters((current) => ({ ...current, category: event.target.value }))}><option value="">Todas</option>{availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label>Carteira<select value={extractFilters.wallet} onChange={(event) => setExtractFilters((current) => ({ ...current, wallet: event.target.value }))}><option value="">Todas</option>{availableWallets.map((wallet) => <option key={wallet} value={wallet}>{wallet}</option>)}</select></label>
        </div>
        <div className="futureTable currentLaunches">{filteredLaunches.length ? <>{filteredLaunches.map((item) => <article className={item.pending ? 'pendingLaunch' : ''} key={item.id || `${item.description}-${item.value}`}><div><span>{item.pending ? 'AGENDADO · ' : ''}{item.category}</span><strong>{item.description}</strong><small>{item.wallet}{item.installmentCount > 1 ? ` · Parcela ${item.installment}/${item.installmentCount}` : ''}</small></div><b className={item.value < 0 ? 'negativeText' : 'positiveText'}>{money(item.value)}</b>{item.pending && <button className="effectButton" onClick={() => setEffecting({ ...item, date: localDateValue(), amount: String(Math.abs(item.value)) })}>Efetivar</button>}</article>)}<div className="listTotal"><span>Total do extrato filtrado · {filteredLaunches.length} registro(s)</span><strong className={extractTotal < 0 ? 'negativeText' : 'positiveText'}>{money(extractTotal)}</strong></div></> : <div className="dashboardEmpty">Nenhum lançamento encontrado com esses filtros.</div>}</div></section></div>
      <section className="dashboardSection categoriesAfterExtract"><div className="sectionTitle"><div><span>CATEGORIAS</span><h3>Para onde vai</h3></div><p>Saídas do mês por categoria.</p></div><div className="breakdownList">{categories.length ? <>{categories.map((item) => <div key={item.name}><div><span>{item.name}</span><strong>{money(item.expenses)}</strong></div><i><b style={{ width: `${(item.expenses / biggestCategory) * 100}%` }} /></i></div>)}<div className="listTotal"><span>Total das saídas</span><strong className="negativeText">{money(categoryTotal)}</strong></div></> : <div className="dashboardEmpty">Sem despesas nesta competência.</div>}</div></section>
    </>}
    {effecting && <div className="operationOverlay"><section className="operationModal"><p className="kicker">EFETIVAR RECORRÊNCIA</p><h3>{effecting.description}</h3><form className="effectForm" onSubmit={confirmRecurring}><label>Data real<input required type="date" value={effecting.date} onChange={(e) => setEffecting({...effecting, date:e.target.value})}/></label><label>Valor real (R$)<input required min="0.01" step="0.01" type="number" inputMode="decimal" value={effecting.amount} onChange={(e) => setEffecting({...effecting, amount:e.target.value})}/></label><div><button type="button" className="cancelButton" onClick={() => setEffecting(null)}>Cancelar</button><button className="submitButton">Efetivar <span>→</span></button></div></form></section></div>}
    <footer><span>DASHBOARD FINANCEIRO</span><p>Dados lidos diretamente do Google Sheets.</p><span>V0.6</span></footer>
  </main>
}

function App() {
  const [user, setUser] = useState(storedGoogleUser)
  const [form, setForm] = useState(createInitialForm)
  const [settings, setSettings] = useState({ carteiras: [], contas: [], cartoes: [], categorias: [] })
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [status, setStatus] = useState({ kind: '', message: '' })
  const [loading, setLoading] = useState('')
  const [operation, setOperation] = useState(CLOSED_OPERATION)
  const [view, setView] = useState('home')
  const [valuesVisible, setValuesVisible] = useState(() => sessionStorage.getItem(VALUES_VISIBLE_KEY) === 'true')
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
    sessionStorage.setItem(VALUES_VISIBLE_KEY, 'false'); setValuesVisible(false); setView('home')
  }

  function signOut() {
    clearAuthToken(); sessionStorage.removeItem(USER_KEY); sessionStorage.removeItem(VALUES_VISIBLE_KEY); setValuesVisible(false); setUser(null); setSettingsLoaded(false); setView('home')
    window.google?.accounts?.id?.disableAutoSelect()
  }

  async function handleSubmit(event) {
    event.preventDefault(); setLoading('adicionar'); setStatus({ kind: '', message: '' })
    setOperation({ open: true, status: 'loading', title: isInstallment ? 'Criando parcelas' : 'Salvando lançamento', message: isInstallment ? `Gerando ${form.parcelas} parcelas e enviando para a planilha…` : 'Enviando o lançamento para sua planilha…', detail: '', current: 0, total: 0 })
    try {
      const result = await callApi({
        action: 'adicionar', ...form, valor: Number(form.valor), parcelas: isInstallment ? Number(form.parcelas) : 1,
        competencia: toCompetence(form.competencia),
      })
      setStatus({ kind: 'success', message: result.message })
      setForm((current) => ({ ...createInitialForm(), categoria: current.categoria, carteira: current.carteira }))
      setOperation({ open: true, status: 'success', title: isInstallment ? 'Parcelas criadas' : 'Lançamento salvo', message: result.message, detail: 'Os dados já estão disponíveis na sua planilha.', current: 0, total: 0 })
    } catch (error) {
      setStatus({ kind: 'error', message: error.message })
      setOperation({ open: true, status: 'error', title: 'Erro ao salvar lançamento', message: error.message, detail: 'Revise os dados e tente novamente.', current: 0, total: 0 })
    }
    finally { setLoading('') }
  }

  if (!user) return <AccessGate onAccess={grantAccess} />
  if (view === 'home') return <HomeScreen user={user} onSignOut={signOut} onNavigate={setView}/>
  if (view === 'dashboard') return <DashboardScreen user={user} onSignOut={signOut} onNavigate={setView} valuesVisible={valuesVisible} onToggleValues={() => setValuesVisible((visible) => { sessionStorage.setItem(VALUES_VISIBLE_KEY, String(!visible)); return !visible })} onSettingsUpdate={(nextSettings) => { setSettings(nextSettings); setSettingsLoaded(true) }} />
  if (view === 'cards') return <CardsScreen settings={settings} onBack={() => setView('home')}/>
  if (view === 'recurring') return <RecurringScreen settings={settings} onBack={() => setView('home')} />
  if (view === 'projection') return <ProjectionScreen settings={settings} onBack={() => setView('home')} />

  return <main className="shell">
    <header className="brand"><button className="backButton" onClick={() => setView('home')} aria-label="Voltar ao início">←</button><div><p className="eyebrow">NOVO LANÇAMENTO</p><h1>Cash Of Anarchy</h1></div>
      <span className={`connection ${configured ? 'online' : ''}`}><i /> {configured ? 'Sheets conectado' : 'Modo demonstração'}</span></header>

    <section className="hero compactHero"><div><p className="kicker">NOVO LANÇAMENTO</p><h2>Lance agora.<br /><em>Controle sempre.</em></h2><p className="lead">Registre receitas, despesas e lançamentos parcelados. Entradas ficam positivas; saídas, negativas.</p></div>
      </section>

    <section className="settingsStrip"><div><span>CARTEIRAS</span><strong>{settings.carteiras.length}</strong></div><div><span>CATEGORIAS</span><strong>{settings.categorias.length}</strong></div><p>Edite a aba “Configuracoes” no Google Sheets e toque em recarregar.</p></section>

    <section className="panel"><div className="panelHeading"><div><span>01</span><h3>Dados do lançamento</h3></div><p>Todos os campos são obrigatórios.</p></div>
      <form className="launchForm" onSubmit={handleSubmit}>
        <label className="fieldFull">Descrição<input required maxLength="100" autoCapitalize="sentences" enterKeyHint="next" placeholder="Ex.: Mercado do mês" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label>
        <label>Movimento<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option>Saída</option><option>Entrada</option></select></label>
        <label>Categoria<select required value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>{settings.categorias.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Conta ou cartão<select required value={form.carteira} onChange={(e) => { const wallet=e.target.value; const card=settings.cartoes?.find((item)=>item.nome===wallet); setForm({ ...form, carteira: wallet, competencia: card ? cardCompetence(form.dataLancamento, card.fechamento) : form.competencia }) }}>{settings.carteiras.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Data do lançamento<input required type="date" value={form.dataLancamento} onChange={(e) => { const card=settings.cartoes?.find((item)=>item.nome===form.carteira); setForm({ ...form, dataLancamento:e.target.value, competencia:card ? cardCompetence(e.target.value, card.fechamento) : form.competencia }) }} /></label>
        <label>Competência inicial<input required type="month" value={form.competencia} disabled={Boolean(settings.cartoes?.some((item)=>item.nome===form.carteira))} onChange={(e) => setForm({ ...form, competencia: e.target.value })} /><small className="fieldHint">{settings.cartoes?.some((item)=>item.nome===form.carteira) ? 'Calculada pelo fechamento do cartão.' : `Referência: ${competenceReference(form.competencia)}`}</small></label>
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
    <OperationModal operation={operation} onClose={() => setOperation(CLOSED_OPERATION)} />
    <footer><span>REACT · APPS SCRIPT · SHEETS</span><p>groupId agrupa parcelas do mesmo lançamento.</p><span>V0.5</span></footer>
  </main>
}

export default App
