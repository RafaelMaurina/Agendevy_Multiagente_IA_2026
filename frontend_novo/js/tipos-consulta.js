// ---- TIPOS DE ATENDIMENTO ----

async function loadTiposConsulta() {
  const el = document.getElementById('tipos-consulta-content');
  el.innerHTML = loading();
  try {
    DATA.tiposConsulta = await apiFetch('/tipos-consulta');
    renderTiposConsulta(DATA.tiposConsulta);
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

function renderTiposConsulta(list) {
  document.getElementById('tipos-consulta-count').textContent =
    `${list.length} tipo${list.length !== 1 ? 's' : ''}`;
  const el = document.getElementById('tipos-consulta-content');

  if (!list.length) {
    el.innerHTML = emptyState('Nenhum tipo de atendimento cadastrado');
    return;
  }

  el.innerHTML = `<table>
    <thead><tr><th>Nome</th><th>Duração</th><th>Valor padrão</th><th></th></tr></thead>
    <tbody>${list.map(t => `
      <tr>
        <td style="font-weight:500;color:var(--gray-900)">${escapeHtml(t.nome)}</td>
        <td>${t.duracao_minutos ?? 30} min</td>
        <td>${t.valor_padrao != null ? `R$ ${Number(t.valor_padrao).toFixed(2)}` : '-'}</td>
        <td><div class="actions-cell">
          <button class="icon-btn" onclick="openEditTipoConsulta(${t.id})" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" onclick="confirmDelete('tipos-consulta', ${t.id}, '${encodeURIComponent(t.nome)}')" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div></td>
      </tr>`).join('')}
    </tbody></table>`;
}

function _tipoFormHTML(t = null) {
  return `
    <div class="form-group">
      <label class="form-label">Nome do tipo *</label>
      <input class="form-input" id="tc-nome" placeholder="Ex: Consulta de rotina, Retorno, Avaliação" value="${escapeHtml(t?.nome || '')}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Duração (minutos) *</label>
        <input class="form-input" id="tc-duracao" type="number" min="1" step="1"
          placeholder="Ex: 30" value="${t?.duracao_minutos ?? 30}" />
      </div>
      <div class="form-group">
        <label class="form-label">Valor padrão (R$)</label>
        <input class="form-input" id="tc-valor" type="number" min="0" step="0.01" placeholder="0,00" value="${t?.valor_padrao ?? ''}" />
      </div>
    </div>
    ${t ? `<input type="hidden" id="tc-id" value="${t.id}" />` : ''}
  `;
}

function openCreateTipoConsulta() {
  openModal('Novo tipo de atendimento', _tipoFormHTML(), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Criar tipo', cls: 'btn-primary', fn: 'saveTipoConsulta()', id: 'btn-modal-submit' },
  ]);
}

async function openEditTipoConsulta(id) {
  const t = (DATA.tiposConsulta || []).find(x => x.id === id)
    || await apiFetch('/tipos-consulta/' + id);
  openModal('Editar tipo de atendimento', _tipoFormHTML(t), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar', cls: 'btn-primary', fn: 'saveTipoConsulta()', id: 'btn-modal-submit' },
  ]);
}

async function saveTipoConsulta() {
  const restore = setBtnLoading('btn-modal-submit', 'Salvando…');
  const nome        = document.getElementById('tc-nome').value.trim();
  const valorRaw    = document.getElementById('tc-valor').value;
  const valor_padrao = valorRaw !== '' ? Number(valorRaw) : null;
  const duracaoRaw  = document.getElementById('tc-duracao').value;
  const duracao_minutos = duracaoRaw !== '' ? parseInt(duracaoRaw, 10) : 30;
  const id          = document.getElementById('tc-id')?.value;

  if (!nome) { restore(); return toast('Nome é obrigatório', 'error'); }
  if (!Number.isInteger(duracao_minutos) || duracao_minutos < 1) {
    restore(); return toast('Duração deve ser um número inteiro maior que zero', 'error');
  }

  try {
    if (id) await apiFetch('/tipos-consulta/' + id, { method: 'PUT',  body: JSON.stringify({ nome, valor_padrao, duracao_minutos }) });
    else     await apiFetch('/tipos-consulta',       { method: 'POST', body: JSON.stringify({ nome, valor_padrao, duracao_minutos }) });
    closeModal();
    toast(id ? 'Tipo atualizado!' : 'Tipo criado!', 'success');
    loadTiposConsulta();
  } catch (e) {
    restore();
    // toast já exibido pelo apiFetch
  }
}
