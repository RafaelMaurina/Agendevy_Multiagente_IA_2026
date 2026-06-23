// ---- PACIENTES ----

async function loadPacientes() {
  const el = document.getElementById('pacientes-content');
  el.innerHTML = loading();
  try {
    DATA.pacientes = await apiFetch('/pacientes');
    renderBuscaPacientes();
    renderPacientes(DATA.pacientes);
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

function renderBuscaPacientes() {
  const wrap = document.getElementById('pacientes-busca');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="filtros-bar">
      <input class="form-input filtro-sm" id="busca-paciente" type="text"
        placeholder="Buscar por nome..."
        oninput="filtrarPacientes(this.value)" />
    </div>`;
}

function filtrarPacientes(termo) {
  const t = termo.toLowerCase().trim();
  const list = t ? DATA.pacientes.filter(p => p.nome.toLowerCase().includes(t)) : DATA.pacientes;
  renderPacientes(list);
}

function renderPacientes(list) {
  document.getElementById('pacientes-count').textContent = `${list.length} paciente${list.length!==1?'s':''}`;
  const el = document.getElementById('pacientes-content');
  if (!list.length) { el.innerHTML = emptyState('Nenhum paciente encontrado'); return; }

  el.innerHTML = `<table>
    <thead><tr><th>Nome</th><th>Telefone</th><th>Cadastrado em</th><th></th></tr></thead>
    <tbody>${list.map(p => `
      <tr>
        <td><div class="td-name"><div class="mini-avatar">${initials(p.nome)}</div>${escapeHtml(p.nome)}</div></td>
        <td>${escapeHtml(p.telefone||'')||'<span style="color:var(--gray-400)">-</span>'}</td>
        <td>${fmtDateShort(p.created_at)}</td>
        <td><div class="actions-cell">
          <button class="icon-btn" onclick="openEditPaciente(${p.id})" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" onclick="confirmDelete('pacientes',${p.id},'${encodeURIComponent(p.nome)}')" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div></td>
      </tr>`).join('')}
    </tbody></table>`;
}

// ── Modal de paciente (com abas) ──────────────────────
function _pacienteFormHTML(p = null) {
  return `
    <div class="modal-tabs">
      <button class="modal-tab active" onclick="switchModalTab(this,'tab-dados')">Dados</button>
      <button class="modal-tab" onclick="switchModalTab(this,'tab-anamnese')">Anamnese</button>
      <button class="modal-tab" onclick="switchModalTab(this,'tab-historico')">Histórico</button>
      <button class="modal-tab" onclick="switchModalTab(this,'tab-comanda')">Financeiro</button>
    </div>

    <div id="tab-dados" class="modal-tab-content active">
      <div class="form-group">
        <label class="form-label">Nome completo *</label>
        <input class="form-input" id="pac-nome" value="${escapeHtml(p?.nome||'')}" placeholder="Nome do paciente" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Telefone</label>
          <input class="form-input" id="pac-tel" value="${escapeHtml(p?.telefone||'')}" placeholder="(00) 00000-0000" />
        </div>
        <div class="form-group">
          <label class="form-label">Data de nascimento</label>
          <input class="form-input" id="pac-nasc" type="date" value="${escapeHtml(p?.data_nascimento||'')}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="pac-email" type="email" value="${escapeHtml(p?.email||'')}" placeholder="email@exemplo.com" />
      </div>
      <div class="form-group">
        <label class="form-label">Observações</label>
        <textarea class="form-input" id="pac-obs" rows="3" placeholder="Anotações gerais sobre o paciente">${escapeHtml(p?.observacoes||'')}</textarea>
      </div>
    </div>

    <div id="tab-anamnese" class="modal-tab-content">
      <div id="anamnese-bloco"><div style="color:var(--text-secondary);font-size:13px;padding:8px 0">Carregando...</div></div>
    </div>

    <div id="tab-historico" class="modal-tab-content">
      <div id="historico-paciente-bloco"><div style="color:var(--text-secondary);font-size:13px;padding:8px 0">Carregando...</div></div>
    </div>

    <div id="tab-comanda" class="modal-tab-content">
      <div id="comanda-paciente-bloco"><div style="color:var(--text-secondary);font-size:13px;padding:8px 0">Carregando...</div></div>
    </div>

    ${p ? `<input type="hidden" id="pac-id" value="${p.id}" />` : ''}`;
}

function openCreatePaciente() {
  openModal('Novo paciente', _pacienteFormHTML(), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Criar paciente', cls: 'btn-primary', fn: 'savePaciente()', id: 'btn-modal-submit' },
  ], { size: 'lg' });
}

async function openEditPaciente(id) {
  let p;
  try { p = await apiFetch('/pacientes/' + id); } catch(e) { return toast(e.message, 'error'); }
  openModal('Editar paciente', _pacienteFormHTML(p), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar', cls: 'btn-primary', fn: 'savePaciente()', id: 'btn-modal-submit' },
  ], { size: 'lg' });
  loadAnamneseBloco(p.id);
  loadHistoricoPacienteBloco(p.id);
  loadComandaPacienteBloco(p.id);
}

async function savePaciente() {
  const restore = setBtnLoading('btn-modal-submit', 'Salvando…');
  const nome  = document.getElementById('pac-nome').value.trim();
  const tel   = document.getElementById('pac-tel').value.trim();
  const nasc  = document.getElementById('pac-nasc').value || null;
  const email = document.getElementById('pac-email').value.trim() || null;
  const obs   = document.getElementById('pac-obs').value.trim() || null;
  const id    = document.getElementById('pac-id')?.value;

  if (!nome) { restore(); return toast('Nome é obrigatório', 'error'); }
  const body = { nome, telefone: tel||null, data_nascimento: nasc, email, observacoes: obs };

  try {
    if (id) await apiFetch('/pacientes/'+id, { method:'PUT', body:JSON.stringify(body) });
    else     await apiFetch('/pacientes',     { method:'POST', body:JSON.stringify(body) });
    closeModal();
    toast(id ? 'Paciente atualizado!' : 'Paciente criado!', 'success');
    loadPacientes();
  } catch (e) {
    restore();
    toast(e.message, 'error');
  }
}

// ── Aba Histórico (consultas do paciente) ──────────────
async function loadHistoricoPacienteBloco(pacienteId) {
  const el = document.getElementById('historico-paciente-bloco');
  if (!el) return;
  try {
    let consultas = DATA.consultas?.length ? DATA.consultas : await apiFetch('/consultas');
    const lista = consultas
      .filter(c => c.paciente?.id === pacienteId)
      .sort((a, b) => new Date(b.data_hora) - new Date(a.data_hora));

    if (!lista.length) {
      el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;margin-top:4px">Nenhuma consulta registrada.</div>`;
      return;
    }

    el.innerHTML = `
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${lista.length} consulta${lista.length !== 1 ? 's' : ''} registrada${lista.length !== 1 ? 's' : ''}</div>
      <table style="font-size:13px">
        <thead><tr><th>Tipo</th><th>Profissional</th><th>Data</th><th>Status</th></tr></thead>
        <tbody>${lista.map(c => {
          const label = c.tipo_consulta?.nome || c.nome_consulta || '-';
          return `<tr>
            <td style="font-weight:500">${escapeHtml(label)}</td>
            <td>${escapeHtml(c.profissional?.nome || '-')}</td>
            <td style="white-space:nowrap">${fmtDate(c.data_hora)}</td>
            <td>${statusBadge(c.status)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  } catch(e) {
    el.innerHTML = `<div style="color:var(--danger);font-size:13px">Erro ao carregar histórico</div>`;
  }
}

// ── Aba Financeiro (comanda do paciente) ──────────────
async function loadComandaPacienteBloco(pacienteId) {
  const el = document.getElementById('comanda-paciente-bloco');
  if (!el) return;
  try {
    const [entradas, saldo] = await Promise.all([
      apiFetch('/comanda/paciente/'+pacienteId),
      apiFetch('/comanda/paciente/'+pacienteId+'/saldo'),
    ]);
    const total = entradas.filter(i => !i.is_credito).reduce((a,i) => a+Number(i.valor), 0);
    el.innerHTML = `
      <div class="comanda-saldo-grid">
        <div class="stat-card">
          <div class="stat-label">Total pago</div>
          <div class="stat-value stat-accent">R$ ${total.toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Saldo R$</div>
          <div class="stat-value">R$ ${Number(saldo.saldo_monetario).toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Sessões</div>
          <div class="stat-value">${saldo.sessoes_disponiveis} disp.</div>
          <div class="stat-sub">${saldo.sessoes_pagas} pagas · ${saldo.sessoes_consumidas} usadas</div>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" style="margin:8px 0" onclick="openCreateComandaForPaciente(${pacienteId})">+ Lançamento</button>
      ${entradas.length ? `
      <table style="margin-top:8px;font-size:13px">
        <thead><tr><th>Tipo</th><th>Valor</th><th>Status</th><th>Data</th><th>Consulta vinculada</th></tr></thead>
        <tbody>${entradas.slice(0,10).map(i => {
          const label  = i.is_credito ? (i.tipo_credito==='sessoes' ? `${i.sessoes_qty} sessões` : 'Crédito') : 'Pgto';
          const valor  = i.is_credito&&i.tipo_credito==='sessoes' ? `${i.sessoes_qty} sessões` : `R$ ${Number(i.valor).toFixed(2)}`;
          const status = i.is_credito ? '-' : (i.status_pgto==='pendente' ? '<span class="badge badge-red">Pendente</span>' : '<span class="badge badge-green">Pago</span>');
          let vinculo = '-';
          if (!i.is_credito && i.consulta) {
            const nomeConsulta = i.consulta.tipo_consulta?.nome || i.consulta.nome_consulta || 'Consulta';
            const dataConsulta = i.consulta.data_hora ? fmtDate(i.consulta.data_hora) : '';
            const sessaoTag = i.forma_pgto === 'credito_sessoes' ? ' <span style="color:var(--text-secondary)">(1 sessão usada)</span>' : '';
            vinculo = `${escapeHtml(nomeConsulta)}${dataConsulta ? ` · ${dataConsulta}` : ''}${sessaoTag}`;
          }
          return `<tr><td>${label}</td><td>${valor}</td><td>${status}</td><td>${i.data_pgto?i.data_pgto.slice(0,10).split('-').reverse().join('/'):'-'}</td><td style="font-size:12px;color:var(--text-secondary)">${vinculo}</td></tr>`;
        }).join('')}</tbody>
      </table>` : '<div style="color:var(--text-secondary);font-size:13px;margin-top:8px">Nenhum lançamento.</div>'}`;
  } catch(e) {
    el.innerHTML = `<div style="color:var(--danger);font-size:13px">Erro ao carregar financeiro</div>`;
  }
}

function openCreateComandaForPaciente(pacienteId) {
  openModal('Novo lançamento', _comandaFormHTML({ paciente: { id: pacienteId } }), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar', cls: 'btn-primary', fn: 'saveComanda()', id: 'btn-modal-submit' },
  ]);
}

function switchModalTab(btn, tabId) {
  document.querySelectorAll('#modal-body .modal-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.modal-tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
}