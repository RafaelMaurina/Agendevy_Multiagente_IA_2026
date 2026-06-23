// ---- CONSULTAS ----

// Converte ISO para "YYYY-MM-DDTHH:mm" em -03:00 fixo (não no fuso do navegador/SO)
function toDatetimeLocalValue(dt) {
  const d = paraFusoLocal(dt);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Converte "YYYY-MM-DDTHH:mm" (sempre interpretado como horário de Brasília, -03:00 fixo) para
// ISO com offset. ANTES usava d.getTimezoneOffset() - o fuso do navegador/SO de quem está
// usando o sistema, que pode não ser -03:00. O valor digitado/selecionado no formulário é
// sempre a hora de parede pretendida em Brasília, então o offset tem que ser sempre -03:00,
// nunca derivado do ambiente de quem está rodando.
function datetimeLocalToISOWithOffset(value) {
  if (!value) return value;
  return `${value}:00${FUSO_OFFSET_STRING}`;
}

// ── Estado dos filtros ─────────────────────────────────
const FILTROS_CONSULTAS = { busca: '', paciente: '', profissional: '', tipo: '', status: '', dataInicio: '', dataFim: '' };

async function loadConsultas() {
  const el = document.getElementById('consultas-content');
  el.innerHTML = loading();
  try {
    [DATA.consultas, DATA.tiposConsulta, DATA.pacientes, DATA.profissionais] = await Promise.all([
      apiFetch('/consultas'),
      DATA.tiposConsulta?.length  ? Promise.resolve(DATA.tiposConsulta)  : apiFetch('/tipos-consulta'),
      DATA.pacientes?.length      ? Promise.resolve(DATA.pacientes)      : apiFetch('/pacientes'),
      DATA.profissionais?.length  ? Promise.resolve(DATA.profissionais)  : apiFetch('/profissionais'),
    ]);
    renderFiltrosConsultas();
    aplicarFiltrosConsultas();
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

function renderFiltrosConsultas() {
  const wrap = document.getElementById('consultas-filtros');
  if (!wrap) return;

  const tipoOpts = DATA.tiposConsulta.map(t =>
    `<option value="${t.id}" ${FILTROS_CONSULTAS.tipo == t.id ? 'selected':''}>${escapeHtml(t.nome)}</option>`
  ).join('');
  const pacOpts = DATA.pacientes.map(p =>
    `<option value="${p.id}" ${FILTROS_CONSULTAS.paciente == p.id ? 'selected':''}>${escapeHtml(p.nome)}</option>`
  ).join('');
  const profOpts = DATA.profissionais.map(p =>
    `<option value="${p.id}" ${FILTROS_CONSULTAS.profissional == p.id ? 'selected':''}>${escapeHtml(p.nome)}</option>`
  ).join('');
  const statusOpts = ['aberta','agendada','realizada','cancelada'].map(s =>
    `<option value="${s}" ${FILTROS_CONSULTAS.status === s ? 'selected':''}>${s}</option>`
  ).join('');

  wrap.innerHTML = `
    <div class="filtros-bar">
      <input class="form-input filtro-sm" type="search" placeholder="Buscar paciente, profissional ou tipo…"
        value="${escapeHtml(FILTROS_CONSULTAS.busca)}"
        oninput="FILTROS_CONSULTAS.busca=this.value;aplicarFiltrosConsultas()" />
      <select class="form-select filtro-sm" onchange="FILTROS_CONSULTAS.paciente=this.value;aplicarFiltrosConsultas()">
        <option value="">Todos os pacientes</option>${pacOpts}
      </select>
      <select class="form-select filtro-sm" onchange="FILTROS_CONSULTAS.profissional=this.value;aplicarFiltrosConsultas()">
        <option value="">Todos os profissionais</option>${profOpts}
      </select>
      <select class="form-select filtro-sm" onchange="FILTROS_CONSULTAS.tipo=this.value;aplicarFiltrosConsultas()">
        <option value="">Todos os tipos</option>${tipoOpts}
      </select>
      <select class="form-select filtro-sm" onchange="FILTROS_CONSULTAS.status=this.value;aplicarFiltrosConsultas()">
        <option value="">Todos os status</option>${statusOpts}
      </select>
      <input class="form-input filtro-sm" type="date" placeholder="De" value="${FILTROS_CONSULTAS.dataInicio}"
        onchange="FILTROS_CONSULTAS.dataInicio=this.value;aplicarFiltrosConsultas()" />
      <input class="form-input filtro-sm" type="date" placeholder="Até" value="${FILTROS_CONSULTAS.dataFim}"
        onchange="FILTROS_CONSULTAS.dataFim=this.value;aplicarFiltrosConsultas()" />
      <button class="btn btn-secondary btn-sm" onclick="limparFiltrosConsultas()">Limpar</button>
    </div>`;
}

function limparFiltrosConsultas() {
  FILTROS_CONSULTAS.busca = '';
  FILTROS_CONSULTAS.paciente = '';
  FILTROS_CONSULTAS.profissional = '';
  FILTROS_CONSULTAS.tipo = '';
  FILTROS_CONSULTAS.status = '';
  FILTROS_CONSULTAS.dataInicio = '';
  FILTROS_CONSULTAS.dataFim = '';
  renderFiltrosConsultas();
  aplicarFiltrosConsultas();
}

function aplicarFiltrosConsultas() {
  let list = DATA.consultas || [];
  if (FILTROS_CONSULTAS.busca) {
    const q = FILTROS_CONSULTAS.busca.toLowerCase();
    list = list.filter(c =>
      (c.paciente?.nome || '').toLowerCase().includes(q) ||
      (c.profissional?.nome || '').toLowerCase().includes(q) ||
      (c.nome_consulta || '').toLowerCase().includes(q) ||
      (c.tipo_consulta?.nome || '').toLowerCase().includes(q)
    );
  }
  if (FILTROS_CONSULTAS.paciente)
    list = list.filter(c => String(c.paciente?.id) === String(FILTROS_CONSULTAS.paciente));
  if (FILTROS_CONSULTAS.profissional)
    list = list.filter(c => String(c.profissional?.id) === String(FILTROS_CONSULTAS.profissional));
  if (FILTROS_CONSULTAS.tipo)
    list = list.filter(c => String(c.tipo_consulta?.id) === String(FILTROS_CONSULTAS.tipo));
  if (FILTROS_CONSULTAS.status)
    list = list.filter(c => c.status === FILTROS_CONSULTAS.status);
  if (FILTROS_CONSULTAS.dataInicio)
    list = list.filter(c => c.data_hora && toLocalDateKey(c.data_hora) >= FILTROS_CONSULTAS.dataInicio);
  if (FILTROS_CONSULTAS.dataFim)
    list = list.filter(c => c.data_hora && toLocalDateKey(c.data_hora) <= FILTROS_CONSULTAS.dataFim);
  renderConsultas(list);
}

// Esta era a causa mais provável de consultas "desaparecerem" do calendário: usava
// getFullYear/getMonth/getDate (fuso do navegador/SO) pra decidir em qual dia a consulta
// aparece. Se o sistema não estiver em -03:00, uma consulta perto da meia-noite UTC pode
// cair num dia diferente do que foi realmente agendado em horário de Brasília.
function toLocalDateKey(isoStr) {
  const d = paraFusoLocal(isoStr);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function renderConsultas(list) {
  document.getElementById('consultas-count').textContent = `${list.length} consulta${list.length !== 1 ? 's' : ''}`;
  const el = document.getElementById('consultas-content');
  if (!list.length) { el.innerHTML = emptyState('Nenhuma consulta encontrada'); return; }

  el.innerHTML = `<table>
    <thead><tr><th>Tipo / Nome</th><th>Paciente</th><th>Profissional</th><th>Data / Hora</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.map(c => {
      const label = c.tipo_consulta?.nome || c.nome_consulta || '-';
      return `<tr>
        <td style="font-weight:500;color:var(--gray-900)">${escapeHtml(label)}</td>
        <td>${escapeHtml(c.paciente?.nome || '-')}</td>
        <td>${escapeHtml(c.profissional?.nome || '-')}</td>
        <td style="white-space:nowrap">${fmtDate(c.data_hora)}</td>
        <td>${statusBadge(c.status)}</td>
        <td><div class="actions-cell">
          <button class="icon-btn" onclick="openEditConsulta(${c.id})" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" onclick="confirmDelete('consultas',${c.id},'${encodeURIComponent(label)}')" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

const STATUS_OPTIONS = ['aberta','agendada','realizada','cancelada'];

function _consultaFormHTML(c = null, lancamento = null) {
  const tipos   = DATA.tiposConsulta || [];
  const tipoOpts = tipos.map(t =>
    `<option value="${t.id}" ${c?.tipo_consulta?.id === t.id ? 'selected':''}>${escapeHtml(t.nome)}${t.valor_padrao ? ` - R$ ${Number(t.valor_padrao).toFixed(2)}`:''}</option>`
  ).join('');
  const pacOpts  = DATA.pacientes.map(p =>
    `<option value="${p.id}" ${c?.paciente?.id === p.id ? 'selected':''}>${escapeHtml(p.nome)}</option>`
  ).join('');
  const profOpts = DATA.profissionais.map(p =>
    `<option value="${p.id}" ${c?.profissional?.id === p.id ? 'selected':''}>${escapeHtml(p.nome)} - ${escapeHtml(p.especialidade)}</option>`
  ).join('');
  const statusOpts = STATUS_OPTIONS.map(s =>
    `<option value="${s}" ${s===(c?.status||'aberta')?'selected':''}>${s}</option>`
  ).join('');
  const dtLocal = c?.data_hora ? toDatetimeLocalValue(c.data_hora) : '';

  let pagamentoHTML = '';
  if (c && lancamento) {
    const formaOpts = (typeof FORMAS_PGTO !== 'undefined' ? FORMAS_PGTO : []).map(f =>
      `<option value="${f.value}" ${lancamento.forma_pgto===f.value?'selected':''}>${f.label}</option>`
    ).join('');
    const statusLabel = lancamento.status_pgto === 'pendente'
      ? '<span class="badge badge-red">Pendente</span>'
      : '<span class="badge badge-green">Pago</span>';
    pagamentoHTML = `
      <div class="form-group" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--gray-200,#e5e7eb)">
        <label class="form-label">Pagamento ${statusLabel}</label>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Valor (R$)</label>
            <input class="form-input" id="con-pgto-valor" type="number" min="0" step="0.01" value="${Number(lancamento.valor).toFixed(2)}" />
          </div>
          <div class="form-group">
            <label class="form-label">Forma de pagamento</label>
            <select class="form-select" id="con-pgto-forma">
              <option value="">- Em aberto -</option>${formaOpts}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Data do pagamento</label>
          <input class="form-input" id="con-pgto-data" type="date" value="${escapeHtml(lancamento.data_pgto||'')}" />
        </div>
      </div>
      <input type="hidden" id="con-lancamento-id" value="${lancamento.id}" />`;
  }

  return `
    <div class="form-group">
      <label class="form-label">Tipo de atendimento *</label>
      <select class="form-select" id="con-tipo" onchange="onTipoConsultaChange(this)">
        <option value="">Selecione o tipo...</option>${tipoOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Nome personalizado (opcional)</label>
      <input class="form-input" id="con-nome" placeholder="Deixe em branco para usar o nome do tipo" value="${escapeHtml(c?.nome_consulta||'')}" />
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Paciente *</label><select class="form-select" id="con-pac"><option value="">Selecione...</option>${pacOpts}</select></div>
      <div class="form-group"><label class="form-label">Profissional *</label><select class="form-select" id="con-prof"><option value="">Selecione...</option>${profOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Data e hora *</label>
        <div class="data-hora-par">
          <input class="form-input" id="con-data-dia" type="date" value="${dtLocal.split('T')[0] || ''}" oninput="atualizarHorarioFimConsulta()" />
          ${htmlInputHora24h('con-data-hora', dtLocal.split('T')[1] || '', 'atualizarHorarioFimConsulta()')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Horário de fim (calculado)</label>
        <input class="form-input" id="con-horario-fim" type="text" readonly placeholder="-"
          style="background:var(--gray-50,#f9fafb);cursor:default;color:var(--text-secondary,#6b7280)" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Status</label>
      <select class="form-select" id="con-status">${statusOpts}</select>
    </div>
    ${pagamentoHTML}
    ${c?.id ? `<input type="hidden" id="con-id" value="${c.id}" />` : ''}`;
}

// Recalcula o horário de fim com base no tipo selecionado e no datetime de início.
function atualizarHorarioFimConsulta() {
  const dtVal   = getDataHoraInputs('con-data-dia', 'con-data-hora');
  const tipoEl  = document.getElementById('con-tipo');
  const fimEl   = document.getElementById('con-horario-fim');
  if (!fimEl) return;

  const tipoId = tipoEl ? +tipoEl.value : 0;
  const tipo   = (DATA.tiposConsulta || []).find(t => t.id === tipoId);

  if (!dtVal || !tipo?.duracao_minutos) {
    fimEl.value = '';
    return;
  }

  const inicio = new Date(dtVal);
  const fim    = new Date(inicio.getTime() + tipo.duracao_minutos * 60_000);
  const pad    = n => String(n).padStart(2, '0');
  fimEl.value  = `${pad(fim.getHours())}:${pad(fim.getMinutes())}`;
}

function onTipoConsultaChange(sel) {
  const tipo = (DATA.tiposConsulta||[]).find(t => t.id === +sel.value);
  if (!tipo) return;
  const nomeEl = document.getElementById('con-nome');
  if (nomeEl && !nomeEl.value) nomeEl.placeholder = tipo.nome;
  atualizarHorarioFimConsulta();

  // Sincroniza o valor do pagamento com o valor padrão do novo tipo -
  // mas só se o usuário ainda não tiver customizado o campo manualmente
  // (ou seja, o valor atual ainda é igual ao último valor preenchido automaticamente).
  const valorEl = document.getElementById('con-pgto-valor');
  if (valorEl && tipo.valor_padrao != null) {
    const novoValor = Number(tipo.valor_padrao).toFixed(2);
    if (valorEl.dataset.lastAuto === undefined || valorEl.value === valorEl.dataset.lastAuto) {
      valorEl.value = novoValor;
    }
    valorEl.dataset.lastAuto = novoValor;
  }
}

function openCreateConsulta() {
  openModal('Nova consulta', _consultaFormHTML(), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Criar consulta', cls: 'btn-primary', fn: 'saveConsulta()', id: 'btn-modal-submit' },
  ]);
  setTimeout(() => atualizarHorarioFimConsulta(), 80);
}

async function openEditConsulta(idOrObj) {
  let c = typeof idOrObj === 'object' ? idOrObj : null;
  if (!c) {
    try { c = await apiFetch('/consultas/' + idOrObj); } catch (e) { return toast(e.message, 'error'); }
  }
  if (!DATA.tiposConsulta?.length) DATA.tiposConsulta = await apiFetch('/tipos-consulta');
  let lancamento = null;
  try { lancamento = await apiFetch('/comanda/consulta/' + c.id, {}, { silent: true }); } catch(_) {}

  openModal('Editar consulta', _consultaFormHTML(c, lancamento), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar alterações', cls: 'btn-primary', fn: 'saveConsulta()', id: 'btn-modal-submit' },
  ]);
  setTimeout(() => atualizarHorarioFimConsulta(), 80);
}

async function saveConsulta() {
  const restore = setBtnLoading('btn-modal-submit', 'Salvando…');
  const tipo_consulta_id = document.getElementById('con-tipo')?.value;
  const nome_consulta    = document.getElementById('con-nome')?.value.trim() || null;
  const paciente_id      = document.getElementById('con-pac').value;
  const profissional_id  = document.getElementById('con-prof').value;
  const data_hora        = getDataHoraInputs('con-data-dia', 'con-data-hora');
  const status           = document.getElementById('con-status').value;
  const id               = document.getElementById('con-id')?.value;
  const lancamentoId     = document.getElementById('con-lancamento-id')?.value;
  const pgtoForma        = document.getElementById('con-pgto-forma')?.value || null;
  const pgtoData         = document.getElementById('con-pgto-data')?.value || null;
  const pgtoValorRaw     = document.getElementById('con-pgto-valor')?.value;

  if (!tipo_consulta_id) { restore(); return toast('Selecione o tipo de atendimento', 'error'); }
  if (!paciente_id || !profissional_id || !data_hora) { restore(); return toast('Preencha todos os campos obrigatórios', 'error'); }

  const body = {
    tipo_consulta_id: +tipo_consulta_id,
    nome_consulta,
    paciente_id:     +paciente_id,
    profissional_id: +profissional_id,
    data_hora:       datetimeLocalToISOWithOffset(data_hora),
    status,
  };

  try {
    if (id) await apiFetch('/consultas/' + id, { method: 'PUT',  body: JSON.stringify(body) });
    else     await apiFetch('/consultas',       { method: 'POST', body: JSON.stringify(body) });

    if (lancamentoId) {
      await apiFetch('/comanda/' + lancamentoId, {
        method: 'PUT',
        body: JSON.stringify({
          valor:      (pgtoValorRaw !== undefined && pgtoValorRaw !== '') ? Number(pgtoValorRaw) : undefined,
          forma_pgto: pgtoForma || null,
          data_pgto:  pgtoForma ? (pgtoData || (() => { const n = agoraFusoLocal(); return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}-${String(n.getUTCDate()).padStart(2,'0')}`; })()) : null,
        }),
      });
    }

    closeModal();
    toast(id ? 'Consulta atualizada!' : 'Consulta criada!', 'success');
    await syncAfterPagamento();
  } catch (e) {
    restore();
    // Modal permanece aberto. Toast de erro já exibido pelo apiFetch (incluindo 409).
  }
}
