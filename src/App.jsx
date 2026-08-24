import { useState } from 'react'
import { callApi, isApiConfigured } from './api.js'

const initialForm = { descricao: '', valor: '', formaPagamento: 'Pix', tipo: 'Entrada' }

function App() {
  const [form, setForm] = useState(initialForm)
  const [status, setStatus] = useState({ kind: '', message: '' })
  const [loading, setLoading] = useState('')
  const configured = isApiConfigured()

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
    } finally {
      setLoading('')
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const saved = await run('adicionar', { ...form, valor: Number(form.valor) })
    if (saved) setForm(initialForm)
  }

  return (
    <main className="shell">
      <header className="brand">
        <span className="brandMark" aria-hidden="true">C$</span>
        <div>
          <p className="eyebrow">FINANÇAS SEM BUROCRACIA</p>
          <h1>Cash Of Anarchy</h1>
        </div>
        <span className={`connection ${configured ? 'online' : ''}`}>
          <i /> {configured ? 'Sheets conectado' : 'Modo demonstração'}
        </span>
      </header>

      <section className="hero">
        <div>
          <p className="kicker">MVP · R$ 0 / MÊS</p>
          <h2>Seu dinheiro.<br /><em>Suas regras.</em></h2>
          <p className="lead">Registre entradas e saídas em segundos. Os dados ficam organizados no seu próprio Google Sheets.</p>
        </div>
        <button className="setupButton" disabled={Boolean(loading)} onClick={() => run('inicializar')}>
          <span>{loading === 'inicializar' ? 'Preparando…' : 'Inicializar planilha'}</span>
          <small>Cria a aba “Lancamentos” e a tabela</small>
        </button>
      </section>

      <section className="panel">
        <div className="panelHeading">
          <div><span>01</span><h3>Novo lançamento</h3></div>
          <p>Os campos marcados são obrigatórios.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="wide">Descrição
            <input required maxLength="100" placeholder="Ex.: Venda para João" value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
          </label>
          <label>Valor (R$)
            <input required min="0.01" step="0.01" type="number" inputMode="decimal" placeholder="150,00" value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          </label>
          <label>Tipo
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              <option>Entrada</option><option>Saída</option>
            </select>
          </label>
          <label>Forma de pagamento
            <select value={form.formaPagamento} onChange={(e) => setForm({ ...form, formaPagamento: e.target.value })}>
              <option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option><option>Outro</option>
            </select>
          </label>
          <button className="submitButton" disabled={Boolean(loading)} type="submit">
            {loading === 'adicionar' ? 'Salvando…' : 'Salvar no Google Sheets'} <span>→</span>
          </button>
        </form>

        {status.message && <div className={`notice ${status.kind}`} role="status">{status.message}</div>}
      </section>

      <footer><span>HTML · CSS · REACT</span><p>Seus dados permanecem na sua conta Google.</p><span>V0.1</span></footer>
    </main>
  )
}

export default App
