// ---- PROFISSIONAIS ----

async function loadProfissionais() {
  const el = document.getElementById('profissionais-content');
  el.innerHTML = loading();
  try {
    DATA.profissionais = await apiFetch('/profissionais');
    renderProfissionais(DATA.profissionais);
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

function renderProfissionais(list) {
  document.getElementById('profissionais-count').textContent = `${list.length} profissional${list.length !== 1 ? 'is' : ''}`;
  const el = document.getElementById('profissionais-content');

  if (!list.length) {
    el.innerHTML = emptyState('Nenhum profissional cadastrado');
    return;
  }

  el.innerHTML = `<table>
    <thead><tr><th>Nome</th><th>Especialidade</th><th>Registro</th><th>Cadastrado em</th><th></th></tr></thead>
    <tbody>${list.map(p => {
      const registro = p.registro_conselho
        ? `${escapeHtml(p.registro_conselho)}${p.registro_numero ? ' ' + escapeHtml(p.registro_numero) : ''}`
        : '<span style="color:var(--text-secondary,#9ca3af)">-</span>';
      return `
      <tr>
        <td><div class="td-name"><div class="mini-avatar alt">${initials(p.nome)}</div>${p.nome}</div></td>
        <td><span class="badge badge-blue-deep">${p.especialidade}</span></td>
        <td style="font-size:12px;color:var(--text-secondary)">${registro}</td>
        <td>${fmtDateShort(p.created_at)}</td>
        <td><div class="actions-cell">
          <button class="icon-btn" onclick="openEditProfissional(${p.id})" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" onclick="confirmDelete('profissionais', ${p.id}, '${encodeURIComponent(p.nome)}')" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div></td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
}

// HTML do formulário, compartilhado entre criação e edição. `p` é o profissional ao editar,
// ou null/undefined ao criar.
function _profissionalFormHTML(p) {
  const v = campo => p && p[campo] != null ? escapeHtml(String(p[campo])) : '';
  return `
    <div class="form-group"><label class="form-label">Nome *</label>
      <input class="form-input" id="prof-nome" placeholder="Nome completo" value="${v('nome')}" /></div>
    <div class="form-group"><label class="form-label">Especialidade *</label>
      <input class="form-input" id="prof-espec" placeholder="Ex: Cardiologia, Clínica Geral..." value="${v('especialidade')}" /></div>
    <div class="form-row">
      <div class="form-group" style="flex:0 0 38%">
        <label class="form-label">Registro</label>
        <input class="form-input" id="prof-registro-conselho" placeholder="Ex: CREFITO, CREA" value="${v('registro_conselho')}" />
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Nº de registro</label>
        <input class="form-input" id="prof-registro-numero" placeholder="Ex: 123456-F" value="${v('registro_numero')}" />
      </div>
    </div>
    ${p ? `<input type="hidden" id="prof-id" value="${p.id}" />` : ''}
  `;
}

function openCreateProfissional() {
  openModal('Novo profissional', _profissionalFormHTML(null), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar profissional', cls: 'btn-primary', fn: 'saveProfissional()', id: 'btn-modal-submit' },
  ]);
}

function openEditProfissional(id) {
  const p = (DATA.profissionais || []).find(x => x.id === id);
  if (!p) return toast('Profissional não encontrado', 'error');
  openModal('Editar profissional', _profissionalFormHTML(p), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar alterações', cls: 'btn-primary', fn: 'saveProfissional()', id: 'btn-modal-submit' },
  ]);
}

async function saveProfissional() {
  const restore = setBtnLoading('btn-modal-submit', 'Salvando…');
  const nome = document.getElementById('prof-nome').value.trim();
  const especialidade = document.getElementById('prof-espec').value.trim();
  const registro_conselho = document.getElementById('prof-registro-conselho').value.trim();
  const registro_numero = document.getElementById('prof-registro-numero').value.trim();
  const id = document.getElementById('prof-id')?.value;

  if (!nome || !especialidade) { restore(); return toast('Nome e especialidade são obrigatórios', 'error'); }

  const payload = { nome, especialidade, registro_conselho, registro_numero };

  try {
    if (id) await apiFetch('/profissionais/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiFetch('/profissionais', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    toast(id ? 'Profissional atualizado!' : 'Profissional criado!', 'success');
    loadProfissionais();
  } catch (e) {
    restore();
    toast(e.message, 'error');
  }
}