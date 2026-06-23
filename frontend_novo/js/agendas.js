// ---- AGENDAS - CALENDÁRIO GERAL ----

const CAL = {
  year:  agoraFusoLocal().getUTCFullYear(),
  month: agoraFusoLocal().getUTCMonth(),
  view: 'mensal',      // 'mensal' | 'semanal'
  weekOffset: 0,       // semanas a partir da semana atual
  profissionalId: null,
  consultas: [],
  bloqueios: [],
};

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

async function loadAgendas() {
  const el = document.getElementById('agendas-content');
  el.innerHTML = loading();
  try {
    DATA.consultas     = await apiFetch('/consultas');
    DATA.profissionais = DATA.profissionais.length ? DATA.profissionais : await apiFetch('/profissionais');
    CAL.consultas      = DATA.consultas;
    CAL.bloqueios      = await apiFetch('/bloqueios');
    renderAgendaPage();
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

function renderAgendaPage() {
  const el = document.getElementById('agendas-content');

  const profOpts = DATA.profissionais.map(p =>
    `<option value="${p.id}" ${p.id === CAL.profissionalId ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`
  ).join('');

  el.innerHTML = `
    <div class="agenda-page">
      <div class="agenda-toolbar">
        <select id="agenda-prof-select" class="agenda-prof-select" onchange="onFiltrarProfissional(this.value)">
          <option value="">- Todos -</option>
          ${profOpts}
        </select>

        <div class="agenda-nav">
          <button class="agenda-nav-btn" onclick="calPrev()">&#8249;</button>
          <span class="agenda-nav-month" id="cal-month-label"></span>
          <button class="agenda-nav-btn" onclick="calNext()">&#8250;</button>
          <button class="btn btn-secondary btn-sm" onclick="calGoToday()">Hoje</button>
        </div>

        <div class="agenda-view-sep"></div>

        <div class="agenda-view-group">
          <button class="agenda-view-btn${CAL.view === 'semanal' ? ' active' : ''}" data-view="semanal" onclick="setView('semanal')">Semanal</button>
          <button class="agenda-view-btn${CAL.view === 'mensal' ? ' active' : ''}" data-view="mensal" onclick="setView('mensal')">Mensal</button>
        </div>

        <button class="btn btn-secondary btn-sm" onclick="openCriarBloqueio()">
          Bloqueio de horário
        </button>
      </div>
      <div id="calendar-wrap"></div>
    </div>`;

  updateCalLabel();
  renderCalendar();
}

function onFiltrarProfissional(val) {
  CAL.profissionalId = val ? +val : null;
  CAL.consultas = CAL.profissionalId
    ? DATA.consultas.filter(c => c.profissional?.id === CAL.profissionalId)
    : DATA.consultas;
  renderCalendar();
}

async function syncAgendasConsultas() {
  try {
    const result = await apiFetch('/consultas/sync-agendas', { method: 'POST' });
    DATA.consultas = await apiFetch('/consultas');
    CAL.consultas  = CAL.profissionalId
      ? DATA.consultas.filter(c => c.profissional?.id === CAL.profissionalId)
      : DATA.consultas;
    renderCalendar();
    toast(`Sincronizado! ${result.vinculos_criados} vínculo(s) criado(s).`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function calPrev() {
  if (CAL.view === 'semanal') { CAL.weekOffset--; }
  else {
    if (CAL.month === 0) { CAL.month = 11; CAL.year--; }
    else CAL.month--;
  }
  updateCalLabel(); renderCalendar();
}
function calNext() {
  if (CAL.view === 'semanal') { CAL.weekOffset++; }
  else {
    if (CAL.month === 11) { CAL.month = 0; CAL.year++; }
    else CAL.month++;
  }
  updateCalLabel(); renderCalendar();
}
function calGoToday() {
  const hoje = agoraFusoLocal();
  if (CAL.view === 'semanal') { CAL.weekOffset = 0; }
  else {
    CAL.year  = hoje.getUTCFullYear();
    CAL.month = hoje.getUTCMonth();
  }
  updateCalLabel(); renderCalendar();
}
function updateCalLabel() {
  const el = document.getElementById('cal-month-label');
  if (!el) return;
  if (CAL.view === 'semanal') {
    const now = agoraFusoLocal();
    const sun = new Date(now);
    sun.setUTCDate(now.getUTCDate() - now.getUTCDay() + CAL.weekOffset * 7);
    sun.setUTCHours(0, 0, 0, 0);
    const sat = new Date(sun);
    sat.setUTCDate(sun.getUTCDate() + 6);
    const fmt = d => `${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0,3)}`;
    el.textContent = `${fmt(sun)} – ${fmt(sat)} ${sat.getUTCFullYear()}`;
  } else {
    el.textContent = `${MESES[CAL.month]} ${CAL.year}`;
  }
}

function renderCalendar() {
  if (CAL.view === 'semanal') { renderWeekView(); return; }
  renderMonthView();
}

function renderMonthView() {
  const wrap = document.getElementById('calendar-wrap');
  if (!wrap) return;

  const map = {};
  CAL.consultas.forEach(c => {
    if (!c.data_hora) return;
    const key = toLocalDateKey(c.data_hora);
    if (!map[key]) map[key] = [];
    map[key].push(c);
  });

  const bloqueioMap = {};
  (CAL.bloqueios || []).forEach(b => {
    // mark all days covered by this bloqueio (em -03:00 fixo, não no fuso do navegador)
    const start  = paraFusoLocal(b.inicio);
    const end    = paraFusoLocal(b.fim);
    const cur    = new Date(start);
    cur.setUTCHours(0,0,0,0);
    const endDay = new Date(end);
    endDay.setUTCHours(23,59,59,999);
    while (cur <= endDay) {
      const y = cur.getUTCFullYear();
      const m = String(cur.getUTCMonth()+1).padStart(2,'0');
      const d = String(cur.getUTCDate()).padStart(2,'0');
      const key = `${y}-${m}-${d}`;
      if (!bloqueioMap[key]) bloqueioMap[key] = [];
      bloqueioMap[key].push(b);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  });

  const firstDay    = new Date(CAL.year, CAL.month, 1).getDay();
  const daysInMonth = new Date(CAL.year, CAL.month + 1, 0).getDate();
  const prevMonthDays = new Date(CAL.year, CAL.month, 0).getDate();
  const todayKey    = toLocalDateKey(new Date().toISOString());

  const weekHeader = DIAS.map(d => `<div class="cal-day-name">${d}</div>`).join('');
  const cells = [];

  for (let i = firstDay - 1; i >= 0; i--)
    cells.push(calCell(prevMonthDays - i, CAL.month - 1, CAL.year, [], true, ''));

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${CAL.year}-${String(CAL.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push(calCell(d, CAL.month, CAL.year, map[key] || [], false, key === todayKey ? 'today' : '', bloqueioMap[key] || [], key));
  }

  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++)
    cells.push(calCell(d, CAL.month + 1, CAL.year, [], true, ''));

  wrap.innerHTML = `
    <div class="agenda-calendar">
      <div class="cal-week-header">${weekHeader}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>`;
}

function calCell(day, month, year, consultas, otherMonth, extraClass, bloqueios = [], dateKey = '') {
  const MAX_VISIBLE = 3;
  const sorted  = consultas.slice().sort((a,b) => new Date(a.data_hora) - new Date(b.data_hora));
  const visible = sorted.slice(0, MAX_VISIBLE);
  const hidden  = sorted.length - MAX_VISIBLE;
  const chips   = visible.map(c => calChip(c)).join('');
  const more    = hidden > 0 ? `<div class="cal-more" onclick="expandDiaPopup(event,'${dateKey}')">+${hidden} mais</div>` : '';
  const bloqChips = bloqueios.map(b => `
    <div class="cal-event cal-bloqueio" onclick="showBloqueioPopup(event,${b.id})" title="${escapeHtml(b.motivo||'Bloqueado')}">
      <span class="cal-event-time">🚫</span>
      <div class="cal-event-body">
        <div class="cal-event-name">${escapeHtml(b.motivo||'Bloqueado')}</div>
        <div class="cal-event-pac">${escapeHtml(b.profissional?.nome||'Todos')}</div>
      </div>
    </div>`).join('');
  const clickAttr = (!otherMonth && dateKey)
    ? ` onclick="openNovaConsultaNoDia('${dateKey}')"` : '';
  return `<div class="cal-cell ${otherMonth ? 'other-month' : ''} ${extraClass}"${clickAttr}>
    <div class="cal-day-num">${day}</div>${bloqChips}${chips}${more}
  </div>`;
}

function calChip(c) {
  const time  = c.data_hora ? fmtTime(c.data_hora) : '';
  const label = escapeHtml(c.tipo_consulta?.nome || c.nome_consulta || '-');
  const pac   = escapeHtml(c.paciente?.nome || '');
  const prof  = escapeHtml(c.profissional?.nome || '');
  const STATUS_CLS = { aberta: 'status-aberta', agendada: 'status-agendada', realizada: 'status-realizada', cancelada: 'status-cancelada' };
  const stCls = STATUS_CLS[c.status] || 'status-aberta';
  return `<div class="cal-event ${stCls}" onclick="showEventPopup(event,${c.id})">
    <span class="cal-event-time">${time}</span>
    <div class="cal-event-body">
      <div class="cal-event-name">${label}</div>
      <div class="cal-event-pac">${pac}${prof ? ` · ${prof}` : ''}</div>
    </div>
  </div>`;
}

async function showEventPopup(e, consultaId) {
  e.stopPropagation();
  closeEventPopup();
  const popup = document.createElement('div');
  popup.className = 'event-popup';
  popup.id = 'event-popup';
  popup.innerHTML = `<div style="padding:16px;color:var(--text-secondary);font-size:13px">Carregando...</div>`;
  document.body.appendChild(popup);
  positionPopup(popup, e);
  try {
    const c = await apiFetch('/consultas/' + consultaId);
    let lancamento = null;
    try { lancamento = await apiFetch('/comanda/consulta/' + consultaId, {}, { silent: true }); } catch(_) {}

    const tipoNome = c.tipo_consulta?.nome || c.nome_consulta || '-';

    let pgtoRowHTML = '';
    let pgtoBtnLabel = 'Adicionar pagamento';
    if (lancamento) {
      const valorFmt = `R$ ${Number(lancamento.valor).toFixed(2)}`;
      const statusChip = lancamento.status_pgto === 'pendente'
        ? '<span class="badge badge-red">Pendente</span>'
        : '<span class="badge badge-green">Pago</span>';
      const formaLabel = (typeof FORMAS_PGTO !== 'undefined' ? FORMAS_PGTO : []).find(f => f.value === lancamento.forma_pgto)?.label;
      pgtoRowHTML = `<div class="event-popup-row"><span>${valorFmt} ${statusChip}${formaLabel ? ` · ${escapeHtml(formaLabel)}` : ''}</span></div>`;
      if (lancamento.status_pgto !== 'pendente') pgtoBtnLabel = 'Pagamento';
    } else {
      pgtoRowHTML = `<div class="event-popup-row"><span style="color:var(--text-secondary)">Sem pagamento</span> <span class="badge badge-red">Pendente</span></div>`;
    }
    const pgtoRemoveBtn = (lancamento && lancamento.status_pgto !== 'pendente')
      ? `<button class="btn btn-danger btn-sm" onclick="closeEventPopup();confirmDelete('comanda',${lancamento.id},'pagamento')">Remover pagamento</button>`
      : '';

    popup.innerHTML = `
      <div class="event-popup-header">
        <div class="event-popup-title">${escapeHtml(tipoNome)}</div>
        <div class="event-popup-header-actions">
          <button class="event-popup-delete" onclick="closeEventPopup();confirmDelete('consultas',${c.id},'${encodeURIComponent(tipoNome)}')" title="Excluir consulta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <button class="event-popup-close" onclick="closeEventPopup()">×</button>
        </div>
      </div>
      <div class="event-popup-row">🕐 <span>${fmtDate(c.data_hora)}</span></div>
      <div class="event-popup-row">
        👤 <span>${escapeHtml(c.paciente?.nome || '-')}</span>
        ${c.paciente?.id ? `<button class="event-popup-link" onclick="closeEventPopup();openEditPaciente(${c.paciente.id})" title="Ver ficha do paciente">
          ver paciente <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>` : ''}
      </div>
      <div class="event-popup-row">🩺 <span>${escapeHtml(c.profissional?.nome || '-')}</span></div>
      <div class="event-popup-row">📌 <span>${statusBadge(c.status)}</span></div>
      ${pgtoRowHTML}
      <div class="event-popup-actions">
        <button class="btn btn-primary btn-sm" onclick="openEditConsulta(${c.id});closeEventPopup()">Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="openReagendarConsulta(${c.id});closeEventPopup()">Reagendar</button>
        <button class="btn btn-secondary btn-sm" onclick="openPagamentoConsulta(${c.id});closeEventPopup()">${pgtoBtnLabel}</button>
        ${pgtoRemoveBtn}
      </div>`;
    positionPopup(popup, e);
    setTimeout(() => document.addEventListener('click', closeEventPopup, { once: true }), 50);
  } catch (err) {
    popup.innerHTML = `<div style="padding:16px;color:var(--danger)">Erro ao carregar consulta</div>`;
  }
}

// ── Pagamento rápido direto pelo card da agenda ────────
async function openPagamentoConsulta(consultaId) {
  let c, lancamento = null;
  try {
    c = await apiFetch('/consultas/' + consultaId);
    try { lancamento = await apiFetch('/comanda/consulta/' + consultaId, {}, { silent: true }); } catch(_) {}
  } catch(e) { return toast(e.message, 'error'); }

  const tipoNome = c.tipo_consulta?.nome || c.nome_consulta || '-';
  const valorPadrao = c.tipo_consulta?.valor_padrao ?? lancamento?.valor ?? '';

  const formaOpts = (typeof FORMAS_PGTO !== 'undefined' ? FORMAS_PGTO : []).map(f =>
    `<option value="${f.value}" ${lancamento?.forma_pgto === f.value ? 'selected' : ''}>${f.label}</option>`
  ).join('');

  const todayStr = (() => { const n = agoraFusoLocal(); return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}-${String(n.getUTCDate()).padStart(2,'0')}`; })();

  openModal('Pagamento da consulta', `
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">
      <strong style="color:var(--gray-900)">${escapeHtml(tipoNome)}</strong> · ${escapeHtml(c.paciente?.nome || '-')}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Valor (R$) *</label>
        <input class="form-input" id="pg-valor" type="number" min="0" step="0.01" value="${valorPadrao}" />
      </div>
      <div class="form-group">
        <label class="form-label">Forma de pagamento</label>
        <select class="form-select" id="pg-forma">
          <option value="">- Em aberto -</option>${formaOpts}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Data do pagamento</label>
      <input class="form-input" id="pg-data" type="date" value="${escapeHtml(lancamento?.data_pgto || todayStr)}" />
    </div>
    <input type="hidden" id="pg-consulta-id" value="${consultaId}" />
    <input type="hidden" id="pg-lancamento-id" value="${lancamento?.id || ''}" />
    <input type="hidden" id="pg-paciente-id" value="${c.paciente?.id || ''}" />
  `, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar pagamento', cls: 'btn-primary', fn: 'salvarPagamentoConsulta()', id: 'btn-modal-submit' },
  ]);
}

async function salvarPagamentoConsulta() {
  const restore = setBtnLoading('btn-modal-submit', 'Salvando…');
  const consultaId   = document.getElementById('pg-consulta-id').value;
  const lancamentoId = document.getElementById('pg-lancamento-id').value;
  const pacienteId   = document.getElementById('pg-paciente-id').value;
  const valor        = document.getElementById('pg-valor').value;
  const forma_pgto   = document.getElementById('pg-forma').value || null;
  const data_pgto    = document.getElementById('pg-data').value || null;

  if (!valor || Number(valor) <= 0) { restore(); return toast('Informe o valor', 'error'); }

  try {
    if (lancamentoId) {
      await apiFetch('/comanda/' + lancamentoId, {
        method: 'PUT',
        body: JSON.stringify({ valor: Number(valor), forma_pgto, data_pgto: forma_pgto ? data_pgto : null }),
      });
    } else {
      await apiFetch('/comanda', {
        method: 'POST',
        body: JSON.stringify({
          paciente_id: Number(pacienteId),
          consulta_id: Number(consultaId),
          valor: Number(valor),
          is_credito: false,
          forma_pgto,
          data_pgto: forma_pgto ? data_pgto : null,
        }),
      });
    }
    closeModal();
    toast('Pagamento atualizado!', 'success');
    await syncAfterPagamento();
  } catch(e) {
    restore();
    toast(e.message, 'error');
  }
}

function positionPopup(popup, e) {
  const chip = e.target.closest('.cal-event, .cal-more, .week-apt');
  const rect = chip ? chip.getBoundingClientRect() : { right: e.clientX, left: e.clientX, top: e.clientY };
  const pw = 290, ph = popup.offsetHeight || 200;
  let left = rect.right + 8, top = rect.top;
  if (left + pw > window.innerWidth - 16)  left = rect.left - pw - 8;
  if (left < 8) left = 8;
  if (top + ph > window.innerHeight - 16)  top = window.innerHeight - ph - 16;
  if (top < 8) top = 8;
  popup.style.cssText = `position:fixed;left:${left}px;top:${top}px;z-index:1000;`;
}

async function showBloqueioPopup(e, bloqueioId) {
  e.stopPropagation();
  closeEventPopup();
  const b = (CAL.bloqueios || []).find(x => x.id === bloqueioId);
  if (!b) return;

  const popup = document.createElement('div');
  popup.className = 'event-popup';
  popup.id = 'event-popup';
  popup.innerHTML = `
    <div class="event-popup-header">
      <div class="event-popup-title">🚫 ${escapeHtml(b.motivo || 'Bloqueio')}</div>
      <button class="event-popup-close" onclick="closeEventPopup()">×</button>
    </div>
    <div class="event-popup-row">📅 <span>${fmtDate(b.inicio)} → ${fmtDate(b.fim)}</span></div>
    <div class="event-popup-row">👤 <span>${escapeHtml(b.profissional?.nome || 'Todos os profissionais')}</span></div>
    <div class="event-popup-actions">
      <button class="btn btn-secondary btn-sm" onclick="closeEventPopup()">Fechar</button>
      <button class="btn btn-sm" id="btn-remover-bloqueio" style="background:var(--red-50);color:var(--red-600);border:1px solid var(--red-200)" onclick="excluirBloqueio(${b.id})">Remover</button>
    </div>`;
  document.body.appendChild(popup);
  positionPopup(popup, e);
  setTimeout(() => document.addEventListener('click', closeEventPopup, { once: true }), 50);
}

async function excluirBloqueio(id) {
  const restore = setBtnLoading('btn-remover-bloqueio', 'Removendo…');
  try {
    await apiFetch('/bloqueios/' + id, { method: 'DELETE' });
    closeEventPopup();
    CAL.bloqueios = await apiFetch('/bloqueios');
    renderCalendar();
    toast('Bloqueio removido', 'success');
  } catch(e) {
    restore();
    toast(e.message, 'error');
  }
}

function openCriarBloqueio() {
  const profOpts = (DATA.profissionais || []).map(p =>
    `<option value="${p.id}">${escapeHtml(p.nome)}</option>`
  ).join('');

  openModal('Bloquear horário', `
    <div class="form-group">
      <label class="form-label">Motivo</label>
      <input class="form-input" id="bloq-motivo" placeholder="Ex: Almoço, Férias, Folga..." />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Início *</label>
        <div class="data-hora-par">
          <input class="form-input" id="bloq-inicio-dia" type="date" />
          ${htmlInputHora24h('bloq-inicio-hora', '')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Fim *</label>
        <div class="data-hora-par">
          <input class="form-input" id="bloq-fim-dia" type="date" />
          ${htmlInputHora24h('bloq-fim-hora', '')}
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Profissional (opcional)</label>
      <select class="form-select" id="bloq-prof">
        <option value="">- Todos -</option>${profOpts}
      </select>
    </div>
  `, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar bloqueio', cls: 'btn-primary', fn: 'salvarBloqueio()', id: 'btn-modal-submit' },
  ]);
}

async function salvarBloqueio() {
  const restore = setBtnLoading('btn-modal-submit', 'Salvando…');
  const inicio = getDataHoraInputs('bloq-inicio-dia', 'bloq-inicio-hora');
  const fim    = getDataHoraInputs('bloq-fim-dia', 'bloq-fim-hora');
  const motivo = document.getElementById('bloq-motivo')?.value.trim() || null;
  const profId = document.getElementById('bloq-prof')?.value || null;

  if (!inicio || !fim) { restore(); return toast('Informe início e fim', 'error'); }
  if (new Date(inicio) >= new Date(fim)) { restore(); return toast('Fim deve ser após o início', 'error'); }

  try {
    await apiFetch('/bloqueios', {
      method: 'POST',
      body: JSON.stringify({
        inicio: datetimeLocalToISOWithOffset(inicio),
        fim:    datetimeLocalToISOWithOffset(fim),
        motivo,
        profissional_id: profId ? Number(profId) : null,
      }),
    });
    closeModal();
    CAL.bloqueios = await apiFetch('/bloqueios');
    renderCalendar();
    toast('Bloqueio criado!', 'success');
  } catch(e) {
    restore();
    toast(e.message, 'error');
  }
}

function closeEventPopup() {
  document.getElementById('event-popup')?.remove();
}

// ── Lista de consultas do dia (quando há mais de MAX_VISIBLE) ─────────
function expandDiaPopup(e, dateKey) {
  e.stopPropagation();
  closeEventPopup();
  closeDiaPopup();

  const consultas = (CAL.consultas || [])
    .filter(c => c.data_hora && toLocalDateKey(c.data_hora) === dateKey)
    .sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

  const [y, m, d] = dateKey.split('-').map(Number);
  const dataLabel = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });

  const popup = document.createElement('div');
  popup.className = 'dia-popup';
  popup.id = 'dia-popup';
  popup.innerHTML = `
    <div class="event-popup-header">
      <div class="event-popup-title">Consultas - ${escapeHtml(dataLabel)}</div>
      <button class="event-popup-close" onclick="closeDiaPopup()">×</button>
    </div>
    <div class="dia-popup-list">${consultas.map(c => calChip(c)).join('')}</div>`;
  document.body.appendChild(popup);
  positionPopup(popup, e);
  setTimeout(() => document.addEventListener('click', closeDiaPopup, { once: true }), 50);
}

function closeDiaPopup() {
  document.getElementById('dia-popup')?.remove();
}

// ── Nova consulta a partir de dia vazio do calendário ─────────
async function openNovaConsultaNoDia(dateKey) {
  try {
    const loads = [];
    if (!DATA.tiposConsulta?.length) loads.push(apiFetch('/tipos-consulta').then(d => { DATA.tiposConsulta = d; }));
    if (!DATA.pacientes?.length)     loads.push(apiFetch('/pacientes').then(d => { DATA.pacientes = d; }));
    if (!DATA.profissionais?.length) loads.push(apiFetch('/profissionais').then(d => { DATA.profissionais = d; }));
    if (loads.length) await Promise.all(loads);
  } catch(e) { return toast('Erro ao carregar dados: ' + e.message, 'error'); }

  // Pré-preenche com o dia clicado às 09:00 (horário local)
  const preFilledConsulta = { data_hora: dateKey + 'T09:00:00' };
  openModal('Nova consulta', _consultaFormHTML(preFilledConsulta), [
    { label: 'Cancelar',       cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Criar consulta', cls: 'btn-primary',   fn: 'saveConsulta()', id: 'btn-modal-submit' },
  ]);
  setTimeout(() => atualizarHorarioFimConsulta(), 80);
}

// ── Reagendar - modal com duas opções ─────────────────────────
async function openReagendarConsulta(consultaId) {
  let c;
  try { c = await apiFetch('/consultas/' + consultaId); } catch(e) { return toast(e.message, 'error'); }

  const dtLocal   = c.data_hora ? toDatetimeLocalValue(c.data_hora) : '';
  const label     = c.tipo_consulta?.nome || c.nome_consulta || '-';
  const horaAtual = dtLocal ? dtLocal.slice(11, 16) : '09:00';
  const dataAtual = dtLocal ? dtLocal.slice(0, 10) : '';

  openModal('Reagendar consulta', `
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px">
      <strong style="color:var(--gray-900)">${escapeHtml(label)}</strong> · ${escapeHtml(c.paciente?.nome||'-')}
    </div>

    <div style="display:flex;gap:8px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--gray-100)">
      <button id="tab-btn-simples"    class="btn btn-primary btn-sm"   onclick="switchReagendarTab('simples')">📅 Uma vez</button>
      <button id="tab-btn-recorrente" class="btn btn-secondary btn-sm" onclick="switchReagendarTab('recorrente')">🔄 Recorrente</button>
    </div>

    <div id="tab-simples">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Nova data e hora *</label>
          <div class="data-hora-par">
            <input class="form-input" id="reagendar-data-dia" type="date" value="${dtLocal.split('T')[0] || ''}" oninput="atualizarHorarioFimReagendar()" />
            ${htmlInputHora24h('reagendar-data-hora', dtLocal.split('T')[1] || '', 'atualizarHorarioFimReagendar()')}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Horário de fim (calculado)</label>
          <input class="form-input" id="reagendar-horario-fim" type="text" readonly placeholder="-"
            style="background:var(--gray-50,#f9fafb);cursor:default;color:var(--text-secondary,#6b7280)" />
        </div>
      </div>
    </div>

    <div id="tab-recorrente" style="display:none">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Frequência</label>
          <select class="form-select" id="reagendar-freq-tipo" onchange="atualizarLabelsRecorrencia();previewRecorrencia()">
            <option value="semanal">Semanal</option>
            <option value="mensal">Mensal</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">A cada</label>
          <div style="display:flex;align-items:center;gap:6px">
            <input class="form-input" id="reagendar-freq-n" type="number" min="1" max="12" value="1"
              style="width:70px" oninput="previewRecorrencia()" />
            <span id="reagendar-freq-unidade" style="font-size:13px;color:var(--text-secondary);white-space:nowrap">semana(s)</span>
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">A partir de *</label>
          <input class="form-input" id="reagendar-recorr-inicio" type="date" value="${dataAtual}" oninput="previewRecorrencia()" />
        </div>
        <div class="form-group">
          <label class="form-label">Horário *</label>
          ${htmlInputHora24h('reagendar-recorr-hora', horaAtual, 'previewRecorrencia()')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Quantas consultas criar</label>
        <input class="form-input" id="reagendar-repeticoes" type="number" min="1" max="52" value="4" oninput="previewRecorrencia()" />
      </div>
      <div id="reagendar-preview"
        style="margin-top:8px;font-size:12px;color:var(--text-secondary);max-height:130px;overflow-y:auto;
               background:var(--gray-50);border-radius:6px;padding:8px 12px;line-height:1.8"></div>
    </div>

    <input type="hidden" id="reagendar-id"      value="${c.id}" />
    <input type="hidden" id="reagendar-tipo-id"  value="${c.tipo_consulta?.id || ''}" />
    <input type="hidden" id="reagendar-duracao"  value="${c.tipo_consulta?.duracao_minutos || 30}" />
    <input type="hidden" id="reagendar-pac-id"   value="${c.paciente?.id || ''}" />
    <input type="hidden" id="reagendar-prof-id"  value="${c.profissional?.id || ''}" />
  `, [
    { label: 'Cancelar',  cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Confirmar', cls: 'btn-primary',   fn: 'salvarReagendamentoModal()', id: 'btn-modal-submit' },
  ]);

  setTimeout(() => { previewRecorrencia(); atualizarHorarioFimReagendar(); }, 60);
}

function switchReagendarTab(tab) {
  const tabSimples    = document.getElementById('tab-simples');
  const tabRecorrente = document.getElementById('tab-recorrente');
  const btnSimples    = document.getElementById('tab-btn-simples');
  const btnRecorrente = document.getElementById('tab-btn-recorrente');
  if (!tabSimples) return;

  if (tab === 'simples') {
    tabSimples.style.display    = '';
    tabRecorrente.style.display = 'none';
    btnSimples.className    = 'btn btn-primary btn-sm';
    btnRecorrente.className = 'btn btn-secondary btn-sm';
  } else {
    tabSimples.style.display    = 'none';
    tabRecorrente.style.display = '';
    btnSimples.className    = 'btn btn-secondary btn-sm';
    btnRecorrente.className = 'btn btn-primary btn-sm';
    previewRecorrencia();
  }
}

function atualizarLabelsRecorrencia() {
  const tipo = document.getElementById('reagendar-freq-tipo')?.value;
  const el   = document.getElementById('reagendar-freq-unidade');
  if (el) el.textContent = tipo === 'mensal' ? 'mês(es)' : 'semana(s)';
}

function gerarDatasRecorrencia(inicioDate, hora, tipo, freqN, qtd) {
  // Retorna array de strings "YYYY-MM-DDTHH:mm" em horário local
  const pad = x => String(x).padStart(2, '0');
  const [y, mo, d] = inicioDate.split('-').map(Number);
  const [h, mi]    = hora.split(':').map(Number);
  const dates = [];
  let cur = new Date(y, mo - 1, d, h, mi, 0);

  for (let i = 0; i < qtd; i++) {
    dates.push(
      `${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}T${pad(cur.getHours())}:${pad(cur.getMinutes())}`
    );
    if (tipo === 'semanal') {
      cur.setDate(cur.getDate() + 7 * freqN);
    } else {
      cur.setMonth(cur.getMonth() + freqN);
    }
  }
  return dates;
}

function previewRecorrencia() {
  const preview = document.getElementById('reagendar-preview');
  if (!preview) return;
  atualizarLabelsRecorrencia();

  const tipo  = document.getElementById('reagendar-freq-tipo')?.value || 'semanal';
  const freqN = parseInt(document.getElementById('reagendar-freq-n')?.value) || 1;
  const inicio = document.getElementById('reagendar-recorr-inicio')?.value;
  const hora  = document.getElementById('reagendar-recorr-hora')?.value || '09:00';
  const qtd   = Math.min(parseInt(document.getElementById('reagendar-repeticoes')?.value) || 4, 52);

  if (!inicio) {
    preview.innerHTML = '<em>Informe a data de início para visualizar as datas.</em>';
    return;
  }

  const dates = gerarDatasRecorrencia(inicio, hora, tipo, freqN, qtd);
  preview.innerHTML =
    `<strong style="color:var(--gray-700)">${dates.length} consulta(s) a criar:</strong><br>` +
    dates.map((dt, i) => `${i + 1}. ${fmtDate(dt)}`).join('<br>');
}

async function salvarReagendamentoModal() {
  const tabSimples = document.getElementById('tab-simples');
  // se o painel "uma vez" estiver visível (ou não existir o tab), usa fluxo simples
  if (!tabSimples || tabSimples.style.display !== 'none') {
    return salvarReagendamento();
  }
  return salvarReagendamentoRecorrente();
}

async function salvarReagendamentoRecorrente() {
  const restore = setBtnLoading('btn-modal-submit', 'Criando…');

  const tipo   = document.getElementById('reagendar-freq-tipo')?.value || 'semanal';
  const freqN  = parseInt(document.getElementById('reagendar-freq-n')?.value) || 1;
  const inicio = document.getElementById('reagendar-recorr-inicio')?.value;
  const hora   = document.getElementById('reagendar-recorr-hora')?.value || '09:00';
  const qtd    = Math.min(parseInt(document.getElementById('reagendar-repeticoes')?.value) || 4, 52);
  const tipoId = document.getElementById('reagendar-tipo-id')?.value;
  const pacId  = document.getElementById('reagendar-pac-id')?.value;
  const profId = document.getElementById('reagendar-prof-id')?.value;

  if (!inicio) { restore(); return toast('Informe a data de início da recorrência', 'error'); }
  if (!pacId || !profId) { restore(); return toast('Consulta sem paciente ou profissional vinculado', 'error'); }

  const dates = gerarDatasRecorrencia(inicio, hora, tipo, freqN, qtd);

  try {
    let criadas = 0, conflitos = 0;
    for (const dtStr of dates) {
      try {
        await apiFetch('/consultas', {
          method: 'POST',
          body: JSON.stringify({
            tipo_consulta_id: tipoId ? +tipoId : undefined,
            paciente_id:     +pacId,
            profissional_id: +profId,
            data_hora:       datetimeLocalToISOWithOffset(dtStr),
            status:          'agendada',
          }),
        });
        criadas++;
      } catch(err) {
        if (err.status === 409) conflitos++;
        else throw err;
      }
    }

    closeModal();
    let msg = `${criadas} consulta(s) criada(s) com sucesso!`;
    if (conflitos) msg += ` ${conflitos} ignorada(s) por conflito de horário.`;
    toast(msg, 'success');

    DATA.consultas = await apiFetch('/consultas');
    CAL.consultas  = CAL.profissionalId
      ? DATA.consultas.filter(c => c.profissional?.id === CAL.profissionalId)
      : DATA.consultas;
    renderCalendar();
  } catch(e) {
    restore();
    toast(e.message, 'error');
  }
}

async function salvarReagendamento() {
  const restore = setBtnLoading('btn-modal-submit', 'Reagendando…');
  const id       = document.getElementById('reagendar-id')?.value;
  const dataVal  = getDataHoraInputs('reagendar-data-dia', 'reagendar-data-hora');
  if (!dataVal) { restore(); return toast('Informe a nova data e hora', 'error'); }

  try {
    await apiFetch('/consultas/' + id, {
      method: 'PUT',
      body: JSON.stringify({ data_hora: datetimeLocalToISOWithOffset(dataVal), status: 'agendada' }),
    });
    closeModal();
    toast('Consulta reagendada!', 'success');
    DATA.consultas = await apiFetch('/consultas');
    CAL.consultas = CAL.profissionalId
      ? DATA.consultas.filter(c => c.profissional?.id === CAL.profissionalId)
      : DATA.consultas;
    renderCalendar();
  } catch(e) {
    restore();
    // Modal permanece aberto. Toast de erro já exibido pelo apiFetch (incluindo 409).
  }
}

// Recalcula o horário de fim no modal de reagendamento.
function atualizarHorarioFimReagendar() {
  const duracaoEl = document.getElementById('reagendar-duracao');
  const fimEl     = document.getElementById('reagendar-horario-fim');
  if (!fimEl) return;

  const dtVal   = getDataHoraInputs('reagendar-data-dia', 'reagendar-data-hora');
  const duracao = parseInt(duracaoEl?.value || '30', 10) || 30;

  if (!dtVal) { fimEl.value = ''; return; }

  const inicio = new Date(dtVal);
  const fim    = new Date(inicio.getTime() + duracao * 60_000);
  const pad    = n => String(n).padStart(2, '0');
  fimEl.value  = `${pad(fim.getHours())}:${pad(fim.getMinutes())}`;
}

function fmtTime(isoStr) {
  if (!isoStr) return '';
  const d = paraFusoLocal(isoStr);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
// ── Troca de visão (Mensal / Semanal) ─────────────────────────
function setView(v) {
  CAL.view = v;
  document.querySelectorAll('.agenda-view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === v);
  });
  updateCalLabel();
  renderCalendar();
}

// ── Visão Semanal ──────────────────────────────────────────────
function renderWeekView() {
  const wrap = document.getElementById('calendar-wrap');
  if (!wrap) return;

  const PPM = 1.6;       // pixels por minuto
  const SH = 7, EH = 20; // hora início / fim visível
  const TMIN = (EH - SH) * 60;
  const gH = TMIN * PPM;
  const COL = '50px repeat(7, minmax(0, 1fr))';

  // Datas da semana atual + offset (em -03:00 fixo, não no fuso do navegador/SO)
  const now = agoraFusoLocal();
  const sun = new Date(now);
  sun.setUTCDate(now.getUTCDate() - now.getUTCDay() + CAL.weekOffset * 7);
  sun.setUTCHours(0, 0, 0, 0);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sun);
    d.setUTCDate(sun.getUTCDate() + i);
    return d;
  });

  const todayKey = toLocalDateKey(new Date().toISOString());
  const pad = n => String(n).padStart(2, '0');
  const dKey = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;

  // Helper: minutos desde SH para uma ISO string (em -03:00 fixo)
  const isoToMin = iso => {
    if (!iso) return -1;
    const d = paraFusoLocal(iso);
    return d.getUTCHours() * 60 + d.getUTCMinutes() - SH * 60;
  };

  // ── Cabeçalho dos dias ─────────────────────────────────────
  let header = `<div class="week-header" style="display:grid;grid-template-columns:${COL}">`;
  header += '<div class="week-corner"></div>';
  weekDates.forEach((d, i) => {
    const isToday = dKey(d) === todayKey;
    header += `<div class="week-day-header${isToday ? ' week-today-header' : ''}">
      <span class="week-day-name">${DIAS[i]}</span>
      <span class="week-day-num${isToday ? ' week-today-num' : ''}">${d.getUTCDate()}</span>
    </div>`;
  });
  header += '</div>';

  // ── Coluna de horários ─────────────────────────────────────
  let timeCol = `<div class="week-time-col" style="position:relative;height:${gH}px">`;
  for (let h = SH; h < EH; h++) {
    timeCol += `<div class="week-time-label" style="top:${(h - SH) * 60 * PPM}px">${pad(h)}:00</div>`;
  }
  timeCol += '</div>';

  // ── Colunas dos dias ───────────────────────────────────────
  let dayCols = '';
  weekDates.forEach(wd => {
    const wKey = dKey(wd);
    const isToday = wKey === todayKey;

    const dayConsultas = (CAL.consultas || [])
      .filter(c => c.data_hora && toLocalDateKey(c.data_hora) === wKey)
      .sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

    const dayBloqueios = (CAL.bloqueios || []).filter(b => {
      const bs = paraFusoLocal(b.inicio), be = paraFusoLocal(b.fim);
      const ds = new Date(wd); ds.setUTCHours(0, 0, 0, 0);
      const de = new Date(wd); de.setUTCHours(23, 59, 59, 999);
      return bs <= de && be >= ds;
    });

    let col = `<div class="week-day-col${isToday ? ' week-today-col' : ''}" style="position:relative;height:${gH}px" onclick="openNovaConsultaNoDia('${wKey}')">`;

    // Linhas de grade
    for (let h = 0; h <= EH - SH; h++) {
      col += `<div class="week-hour-line" style="top:${h * 60 * PPM}px"></div>`;
      if (h < EH - SH)
        col += `<div class="week-half-line" style="top:${(h * 60 + 30) * PPM}px"></div>`;
    }

    // Bloqueios
    dayBloqueios.forEach(b => {
      const bs = paraFusoLocal(b.inicio), be = paraFusoLocal(b.fim);
      const ds = new Date(wd); ds.setUTCHours(0, 0, 0, 0);
      const de = new Date(wd); de.setUTCHours(23, 59, 59, 999);

      // Se o bloqueio começou antes deste dia, ele começa no topo da grade.
      // Se ele termina depois (ou exatamente à meia-noite) deste dia, ele vai até o fim da grade.
      const startMin = bs < ds
        ? 0
        : Math.max(bs.getUTCHours() * 60 + bs.getUTCMinutes() - SH * 60, 0);
      const endMin = be > de
        ? TMIN
        : Math.min(be.getUTCHours() * 60 + be.getUTCMinutes() - SH * 60, TMIN);

      if (endMin <= startMin) return;
      const ht = Math.max((endMin - startMin) * PPM, 20);
      col += `<div class="week-apt week-apt-bloqueio" style="top:${startMin * PPM}px;height:${ht}px"
        onclick="event.stopPropagation();showBloqueioPopup(event,${b.id})">
        <div class="week-apt-name">🚫 ${escapeHtml(b.motivo || 'Bloqueado')}</div>
      </div>`;
    });

    // Consultas
    dayConsultas.forEach(c => {
      const rawStartMin = isoToMin(c.data_hora);
      const dur = c.tipo_consulta?.duracao_minutos || 30;
      const rawEndMin = rawStartMin + dur;

      // Descarta apenas se a consulta termina antes do início da grade
      // ou começa depois do fim da grade. Caso contrário, recorta (clamp)
      // para os limites visíveis, permitindo exibição parcial.
      if (rawEndMin <= 0 || rawStartMin >= TMIN) return;

      const startMin = Math.max(rawStartMin, 0);
      const endMin   = Math.min(rawEndMin, TMIN);
      const ht  = Math.max((endMin - startMin) * PPM, 22);
      const STATUS_CLS = {
        aberta:    'week-apt-aberta',
        agendada:  'week-apt-agendada',
        realizada: 'week-apt-realizada',
        cancelada: 'week-apt-cancelada',
      };
      const aptCls = STATUS_CLS[c.status] || 'week-apt-aberta';
      const time   = fmtTime(c.data_hora);
      col += `<div class="week-apt ${aptCls}" style="top:${startMin * PPM}px;height:${ht}px"
        onclick="event.stopPropagation();showEventPopup(event,${c.id})">
        <div class="week-apt-time">${time}</div>
        <div class="week-apt-name">${escapeHtml(c.tipo_consulta?.nome || c.nome_consulta || '-')}</div>
        ${ht > 50 ? `<div class="week-apt-pac">${escapeHtml(c.paciente?.nome || '')}</div>` : ''}
      </div>`;
    });

    col += '</div>';
    dayCols += col;
  });

  wrap.innerHTML = `
    <div class="week-calendar agenda-calendar">
      ${header}
      <div class="week-scroll-body">
        <div style="display:grid;grid-template-columns:${COL}">
          ${timeCol}${dayCols}
        </div>
      </div>
    </div>`;

  // Scroll para 07:30
  setTimeout(() => {
    const scrollEl = wrap.querySelector('.week-scroll-body');
    if (scrollEl) scrollEl.scrollTop = 30 * PPM;
  }, 50);
}