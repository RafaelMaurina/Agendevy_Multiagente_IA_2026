// ---- ANAMNESE ----

// Carrega e renderiza bloco de anamnese dentro do modal de paciente
async function loadAnamneseBloco(pacienteId) {
  const el = document.getElementById('anamnese-bloco');
  if (!el) return;
  el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:8px 0">Carregando anamnese...</div>`;

  try {
    const data = await apiFetch('/anamnese/paciente/' + pacienteId);
    renderAnamneseBloco(el, data, pacienteId);
  } catch (e) {
    el.innerHTML = `<div style="color:var(--danger);font-size:13px">${e.message}</div>`;
  }
}

function renderAnamneseBloco(el, data, pacienteId) {
  if (!data.length) {
    el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px">
      Nenhuma pergunta cadastrada. 
      <a href="#" onclick="navigate('anamnese-config');return false" style="color:var(--primary)">Configurar perguntas</a>
    </div>`;
    return;
  }

  const rows = data.map(({ pergunta, resposta }) => {
    const pid = `anamnese-${pergunta.id}`;
    if (pergunta.tipo === 'sim_nao') {
      const sim = resposta?.resposta === 'sim';
      const nao = resposta?.resposta === 'nao';
      return `<div class="anamnese-row">
        <label class="anamnese-pergunta">${escapeHtml(pergunta.texto)}</label>
        <div class="anamnese-opcoes">
          <label><input type="radio" name="${pid}" value="sim" ${sim ? 'checked' : ''}> Sim</label>
          <label><input type="radio" name="${pid}" value="nao" ${nao ? 'checked' : ''}> Não</label>
        </div>
      </div>`;
    }
    return `<div class="anamnese-row">
      <label class="anamnese-pergunta" for="${pid}">${escapeHtml(pergunta.texto)}</label>
      <input class="form-input" id="${pid}" value="${escapeHtml(resposta?.resposta || '')}" placeholder="Resposta..." />
    </div>`;
  });

  el.innerHTML = `
    <div class="anamnese-lista">${rows.join('')}</div>
    <button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="saveAnamnese(${pacienteId})">
      Salvar anamnese
    </button>
  `;
  el.dataset.perguntas = JSON.stringify(data.map(d => ({ id: d.pergunta.id, tipo: d.pergunta.tipo })));
}

async function saveAnamnese(pacienteId) {
  const el = document.getElementById('anamnese-bloco');
  const meta = JSON.parse(el.dataset.perguntas || '[]');

  const respostas = meta.map(({ id, tipo }) => {
    const pid = `anamnese-${id}`;
    let resposta = null;
    if (tipo === 'sim_nao') {
      const checked = document.querySelector(`input[name="${pid}"]:checked`);
      resposta = checked?.value || null;
    } else {
      resposta = document.getElementById(pid)?.value.trim() || null;
    }
    return { pergunta_id: id, resposta };
  });

  try {
    await apiFetch('/anamnese/paciente/' + pacienteId, {
      method: 'POST',
      body: JSON.stringify(respostas),
    });
    toast('Anamnese salva!', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Configuração de perguntas (página admin) ──────────
async function loadAnamneseConfig() {
  const el = document.getElementById('anamnese-config-content');
  if (!el) return;
  el.innerHTML = loading();
  try {
    DATA.perguntas = await apiFetch('/anamnese/perguntas');
    renderAnamneseConfig(DATA.perguntas);
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

function renderAnamneseConfig(list) {
  const el = document.getElementById('anamnese-config-content');

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Perguntas da anamnese</span>
        <button class="btn btn-primary btn-sm" onclick="openCreatePergunta()">+ Nova pergunta</button>
      </div>
      ${list.length ? `<table>
        <thead><tr><th>Pergunta</th><th>Tipo</th><th>Ordem</th><th></th></tr></thead>
        <tbody>${list.map(p => `
          <tr>
            <td>${escapeHtml(p.texto)}</td>
            <td>${p.tipo === 'sim_nao' ? 'Sim / Não' : 'Texto livre'}</td>
            <td>${p.ordem}</td>
            <td><div class="actions-cell">
              <button class="icon-btn" onclick="openEditPergunta(${p.id})" title="Editar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="icon-btn danger" onclick="confirmDelete('anamnese/perguntas', ${p.id}, '${encodeURIComponent(p.texto)}')" title="Remover">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div></td>
          </tr>`).join('')}
        </tbody></table>`
      : emptyState('Nenhuma pergunta cadastrada')}
    </div>`;
}

function _perguntaFormHTML(p = null) {
  return `
    <div class="form-group">
      <label class="form-label">Pergunta *</label>
      <input class="form-input" id="perg-texto" value="${escapeHtml(p?.texto || '')}" placeholder="Ex: Tem alergia a algum medicamento?" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Tipo de resposta</label>
        <select class="form-select" id="perg-tipo">
          <option value="sim_nao" ${p?.tipo === 'sim_nao' || !p ? 'selected' : ''}>Sim / Não</option>
          <option value="texto" ${p?.tipo === 'texto' ? 'selected' : ''}>Texto livre</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Ordem</label>
        <input class="form-input" id="perg-ordem" type="number" min="0" value="${p?.ordem ?? 0}" />
      </div>
    </div>
    ${p ? `<input type="hidden" id="perg-id" value="${p.id}" />` : ''}
  `;
}

function openCreatePergunta() {
  openModal('Nova pergunta de anamnese', _perguntaFormHTML(), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Criar', cls: 'btn-primary', fn: 'savePergunta()', id: 'btn-modal-submit' },
  ]);
}

function openEditPergunta(id) {
  const p = (DATA.perguntas || []).find(x => x.id === id);
  if (!p) return;
  openModal('Editar pergunta', _perguntaFormHTML(p), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar', cls: 'btn-primary', fn: 'savePergunta()', id: 'btn-modal-submit' },
  ]);
}

async function savePergunta() {
  const restore = setBtnLoading('btn-modal-submit', 'Salvando…');
  const texto = document.getElementById('perg-texto').value.trim();
  const tipo  = document.getElementById('perg-tipo').value;
  const ordem = Number(document.getElementById('perg-ordem').value) || 0;
  const id    = document.getElementById('perg-id')?.value;

  if (!texto) { restore(); return toast('Pergunta é obrigatória', 'error'); }

  try {
    if (id) await apiFetch('/anamnese/perguntas/' + id, { method: 'PUT', body: JSON.stringify({ texto, tipo, ordem }) });
    else     await apiFetch('/anamnese/perguntas',       { method: 'POST', body: JSON.stringify({ texto, tipo, ordem }) });
    closeModal();
    toast(id ? 'Pergunta atualizada!' : 'Pergunta criada!', 'success');
    loadAnamneseConfig();
  } catch (e) {
    restore();
    toast(e.message, 'error');
  }
}