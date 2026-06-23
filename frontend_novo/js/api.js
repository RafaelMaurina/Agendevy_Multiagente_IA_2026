// ---- CONFIGURAÇÃO DA API ----
const API = (window.APP_CONFIG?.apiUrl) || 'http://localhost:3000/api';

// Estado global com os dados carregados da API
const DATA = {
  pacientes: [],
  profissionais: [],
  consultas: [],
  agendas: [],
  tiposConsulta: [],
  comandas: [],
  perguntas: [],
};

/**
 * Faz uma requisição à API e retorna o JSON.
 *
 * Em caso de erro HTTP, exibe automaticamente um toast e lança o erro para
 * que o chamador possa tratar fluxos específicos se necessário (ex: 409 de
 * conflito de horário mostra mensagem diferente).
 *
 * @param {string} path       Caminho relativo à base da API (ex: '/consultas/1')
 * @param {RequestInit} opts  Opções do fetch (method, body etc.)
 * @param {object} toastOpts
 * @param {boolean} toastOpts.silent  Se true, não exibe toast de erro automaticamente.
 */
async function apiFetch(path, opts = {}, { silent = false } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
  } catch (networkErr) {
    const msg = 'Sem conexão com o servidor. Verifique se o backend está rodando.';
    if (!silent) toast.erro(msg);
    const e = new Error(msg);
    e.status = 0;
    throw e;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: res.statusText }));
    const msg = data.message || res.statusText;
    if (!silent) toast.erro(msg);
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Carrega todos os recursos em paralelo.
 * Usado no boot da aplicação e ao trocar para o dashboard.
 */
async function loadAll() {
  await Promise.allSettled([
    loadPacientes(),
    loadProfissionais(),
    loadConsultas(),
    loadAgendas(),
  ]);
  if (currentPage === 'dashboard') renderDashboard();
}

/**
 * Sincroniza todos os dados afetados por um lançamento financeiro salvo
 * (pagamento criado ou editado em qualquer tela).
 * Atualiza: DATA.comandas, DATA.consultas, calendário, fluxo de caixa e inadimplentes.
 */
async function syncAfterPagamento() {
  // Busca dados frescos - cada um independente para não bloquear o outro
  const [comandasResult, consultasResult] = await Promise.allSettled([
    apiFetch('/comanda'),
    apiFetch('/consultas'),
  ]);

  if (comandasResult.status === 'fulfilled') DATA.comandas  = comandasResult.value;
  if (consultasResult.status === 'fulfilled') DATA.consultas = consultasResult.value;

  // Atualiza o calendário se estiver montado na DOM
  if (typeof CAL !== 'undefined' && document.getElementById('calendar-wrap')) {
    CAL.consultas = CAL.profissionalId
      ? DATA.consultas.filter(c => c.profissional?.id === CAL.profissionalId)
      : DATA.consultas;
    try { renderCalendar(); } catch(_) {}
  }

  // Atualiza a tela ativa
  try {
    if (currentPage === 'fluxo') {
      const el = document.getElementById('fluxo-content');
      if (el) renderFluxoCaixa();
    } else if (currentPage === 'inadimplentes') {
      // Re-fetch do endpoint específico para garantir dados corretos
      const data = await apiFetch('/comanda/inadimplentes');
      const el = document.getElementById('inadimplentes-content');
      if (el && typeof renderInadimplentes === 'function') renderInadimplentes(data);
    } else if (currentPage === 'consultas') {
      aplicarFiltrosConsultas();
    } else if (currentPage === 'dashboard') {
      renderDashboard();
    } else if (currentPage === 'agendas') {
      // Calendário já atualizado acima; nada mais a fazer
    }
  } catch(e) {
    console.error('syncAfterPagamento render error:', e);
  }
}
