// ---- TOAST (sistema único) ----
// API: toast('msg', 'success'|'error'|'warning')
// ou:  toast.ok / toast.erro / toast.aviso

(function () {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.style.cssText =
      'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none';
    document.body.appendChild(container);
  }

  const VARIANTS = {
    success: { bg:'#EAF3DE', border:'#C0DD97', text:'#3B6D11', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>' },
    error:   { bg:'#FCEBEB', border:'#F7C1C1', text:'#A32D2D', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' },
    warning: { bg:'#FAEEDA', border:'#FAC775', text:'#854F0B', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' },
  };

  function show(msg, type = 'success', duration = 3500) {
    const v = VARIANTS[type] || VARIANTS.success;
    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.style.cssText = `background:${v.bg};border:1px solid ${v.border};color:${v.text};border-radius:8px;padding:10px 14px;font-size:13px;line-height:1.5;max-width:320px;pointer-events:auto;display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);opacity:0;transition:opacity 0.2s ease`;
    el.innerHTML = `<span style="flex-shrink:0">${v.icon}</span><span>${escapeHtml ? escapeHtml(msg) : msg}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    const remove = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); };
    const timer = setTimeout(remove, duration);
    el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  }

  // Compatibilidade com chamadas antigas: toast('msg', 'success')
  window.toast = function (msg, type) { show(msg, type || 'success'); };
  // API nova: toast.ok / toast.erro / toast.aviso
  window.toast.ok    = (msg, ms) => show(msg, 'success', ms);
  window.toast.erro  = (msg, ms) => show(msg, 'error',   ms);
  window.toast.aviso = (msg, ms) => show(msg, 'warning', ms);
})();


// ---- MODAL ----

function openModal(title, body, buttons, opts = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = buttons.map(b =>
    `<button class="btn ${b.cls}" ${b.id ? `id="${b.id}"` : ''} onclick="${b.fn}">${b.label}</button>`
  ).join('');
  document.getElementById('modal').classList.toggle('modal--lg', opts.size === 'lg');
  document.getElementById('modal-overlay').classList.add('open');
  // Auto-foca o primeiro campo
  setTimeout(() => document.querySelector('#modal-body input, #modal-body select, #modal-body textarea')?.focus(), 60);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function closeModalOnOverlay(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

// ESC fecha modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('modal-overlay')?.classList.contains('open')) {
    closeModal();
  }
});


// ---- BOTÃO DE SUBMIT COM LOADING ----
// Uso: const restore = setBtnLoading('btn-id');  ...await fetch...  restore();

function setBtnLoading(btnId, loadingLabel = 'Salvando…') {
  const btn = document.getElementById(btnId) || document.querySelector(`[onclick*="${btnId}"]`);
  if (!btn) return () => {};
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = loadingLabel;
  return () => { btn.disabled = false; btn.textContent = original; };
}


// ---- CONFIRMAÇÃO DE EXCLUSÃO ----

const DELETE_LABELS = {
  pacientes: 'paciente', profissionais: 'profissional', consultas: 'consulta',
  agendas: 'agenda', 'tipos-consulta': 'tipo de atendimento',
  'anamnese/perguntas': 'pergunta', comanda: 'lançamento',
};

function confirmDelete(resource, id, name) {
  const aviso = resource === 'pacientes'
    ? '<strong>Todas as consultas, histórico financeiro e anamnese</strong> serão excluídos.'
    : resource === 'profissionais'
    ? '<strong>Todas as consultas</strong> deste profissional serão excluídas.'
    : resource === 'consultas'
    ? 'O lançamento financeiro vinculado será mantido, mas <strong>perderá o vínculo</strong> com esta consulta.'
    : 'Esta ação não pode ser desfeita.';

  openModal('Confirmar exclusão', `
    <div class="confirm-dialog">
      <div class="confirm-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </div>
      <p>Tem certeza que deseja excluir ${DELETE_LABELS[resource] ? 'o ' + DELETE_LABELS[resource] : ''} <strong>${escapeHtml ? escapeHtml(decodeURIComponent(name)) : name}</strong>?<br>
      <span style="color:var(--gray-400);font-size:12px">${aviso}</span></p>
    </div>
  `, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Excluir',  cls: 'btn-danger',    fn: `doDelete('${resource}', ${id})`, id: 'btn-confirm-delete' },
  ]);
}

async function doDelete(resource, id) {
  const restore = setBtnLoading('btn-confirm-delete', 'Excluindo…');
  try {
    await apiFetch('/' + resource + '/' + id, { method: 'DELETE' });
    closeModal();
    toast('Excluído com sucesso!', 'success');
    if (resource === 'pacientes')          loadPacientes();
    else if (resource === 'profissionais') loadProfissionais();
    else if (resource === 'agendas')       loadAgendas();
    else if (resource === 'tipos-consulta') loadTiposConsulta();
    else if (resource === 'consultas' || resource === 'comanda') syncAfterPagamento();
    else if (resource === 'anamnese/perguntas') loadAnamneseConfig();
  } catch (e) {
    restore();
    toast(e.message, 'error');
  }
}