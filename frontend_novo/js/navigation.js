// ---- NAVEGAÇÃO ----

let currentPage = 'dashboard';

const PAGE_TITLES = { dashboard: 'Início', pacientes: 'Pacientes', profissionais: 'Profissionais', consultas: 'Consultas', agendas: 'Agendas', 'tipos-consulta': 'Tipos de Atendimento', 'anamnese-config': 'Anamnese', fluxo: 'Fluxo de Caixa', inadimplentes: 'Inadimplência' };

function navigate(page) {
  currentPage = page;

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));

  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.getElementById('page-' + page)?.classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[page];

  renderTopbarActions(page);

  // Recarrega os dados da página ativa
  if (page === 'pacientes') loadPacientes();
  else if (page === 'profissionais') loadProfissionais();
  else if (page === 'consultas') loadConsultas();
  else if (page === 'agendas') loadAgendas();
  else if (page === 'dashboard') renderDashboard();
  else if (page === 'tipos-consulta') loadTiposConsulta();
  else if (page === 'anamnese-config') loadAnamneseConfig();
  else if (page === 'fluxo') loadFluxoCaixa();
  else if (page === 'inadimplentes') loadInadimplentes();
}

// Recolhe/expande um grupo da sidebar. Grupos com um único item (ex: "Visão geral") não têm
// setinha no HTML, mas a função funciona para qualquer grupo de forma idêntica.
function toggleNavGroup(group) {
  const el = document.querySelector(`.nav-group[data-group="${group}"]`);
  if (el) el.classList.toggle('collapsed');
}

function renderTopbarActions(page) {
  const actions = document.getElementById('topbar-actions');
  const plusIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

  const buttons = {
    pacientes: `<button class="btn btn-primary" onclick="openCreatePaciente()">${plusIcon} Novo paciente</button>`,
    profissionais: `<button class="btn btn-primary" onclick="openCreateProfissional()">${plusIcon} Novo profissional</button>`,
    consultas: `<button class="btn btn-primary" onclick="openCreateConsulta()">${plusIcon} Nova consulta</button>`,
    agendas: ``,
    'tipos-consulta': `<button class="btn btn-primary" onclick="openCreateTipoConsulta()">${plusIcon} Novo tipo</button>`,
    'anamnese-config': `<button class="btn btn-primary" onclick="openCreatePergunta()">${plusIcon} Nova pergunta</button>`,
    fluxo: `<button class="btn btn-primary" onclick="openCreateComanda()">${plusIcon} Novo lançamento</button>`,
    inadimplentes: ``,
  };

  actions.innerHTML = buttons[page] || '';
}
