// ---- HELPERS GERAIS ----

function initials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ---- FUSO HORÁRIO FIXO (-03:00, América/São Paulo) ----
// O Agendevy assume sempre horário de Brasília, independente do fuso configurado no sistema
// operacional/navegador de quem está usando a aplicação. NUNCA use .getHours()/.getDate()/etc.
// direto numa Date vinda da API (sempre em UTC) - esses acessores leem o fuso do sistema, que
// pode não ser -03:00. Em vez disso: paraFusoLocal(data) e leia com os acessores .getUTC*().
const FUSO_OFFSET_MINUTOS = -180; // -03:00
const FUSO_OFFSET_STRING = '-03:00';

function paraFusoLocal(dataOuIso) {
  const d = dataOuIso instanceof Date ? dataOuIso : new Date(dataOuIso);
  return new Date(d.getTime() + FUSO_OFFSET_MINUTOS * 60000);
}

function agoraFusoLocal() {
  return paraFusoLocal(new Date());
}

// Constrói o instante absoluto real correspondente a um "relógio de parede" em -03:00 fixo.
// Use isso (em vez de `new Date(ano, mes, dia, ...)`, que usa o fuso do navegador/SO) sempre
// que precisar de um limite de dia/mês pra comparar contra datas vindas da API.
function construirDataFusoLocal(ano, mes, dia, hora = 0, min = 0, seg = 0) {
  return new Date(Date.UTC(ano, mes, dia, hora, min, seg) - FUSO_OFFSET_MINUTOS * 60000);
}

// ---- INPUT DE HORA SEMPRE EM 24H (independente do idioma/locale do navegador) ----
// <input type="time"> e a parte de hora de <input type="datetime-local"> são renderizados
// pelo NAVEGADOR, não pela página - em navegadores configurados em inglês (EUA), isso mostra
// seletor AM/PM mesmo com <html lang="pt-BR">, porque essa decisão de exibição é do
// navegador (idioma da interface dele), não da página. Por isso usamos um <input type="text">
// mascarado em vez do time picker nativo: assim controlamos 100% da exibição.

function htmlInputHora24h(id, valorHHMM, onInputExtra = '') {
  return `<input class="form-input input-hora-24h" id="${id}" type="text" inputmode="numeric"
    placeholder="HH:MM" maxlength="5" autocomplete="off"
    value="${escapeHtml(valorHHMM || '')}"
    oninput="mascararHora24h(this);${onInputExtra}" onblur="normalizarHora24h(this)" />`;
}

// Vai formatando "HHMM" -> "HH:MM" enquanto o usuário digita.
function mascararHora24h(el) {
  const digitos = el.value.replace(/[^0-9]/g, '').slice(0, 4);
  el.value = digitos.length >= 3 ? `${digitos.slice(0,2)}:${digitos.slice(2)}` : digitos;
}

// No blur: corrige valores fora do range (horas > 23, minutos > 59) e preenche com zero.
function normalizarHora24h(el) {
  const m = el.value.match(/^(\d{1,2}):?(\d{0,2})$/);
  if (!m || el.value === '') { el.value = ''; return; }
  const h  = Math.min(parseInt(m[1] || '0', 10), 23);
  const mi = Math.min(parseInt(m[2] || '0', 10), 59);
  el.value = `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
}

// Combina um par de inputs (data + hora-24h) num único valor "YYYY-MM-DDTHH:mm" - o mesmo
// formato que <input type="datetime-local"> produzia, então o resto do código que espera essa
// string não precisa mudar, só a forma como ela é montada.
function getDataHoraInputs(idData, idHora) {
  const data = document.getElementById(idData)?.value || '';
  const hora = document.getElementById(idHora)?.value || '';
  if (!data || !hora) return '';
  return `${data}T${hora}`;
}

function setDataHoraInputs(idData, idHora, valorCombinado) {
  const [data, hora] = (valorCombinado || '').split('T');
  const elData = document.getElementById(idData);
  const elHora = document.getElementById(idHora);
  if (elData) elData.value = data || '';
  if (elHora) elHora.value = hora || '';
}

// Normaliza (ano, mes, dia) - aceita valores fora do range normal (dia negativo, mes > 11
// etc.) e devolve o resultado já com o "vai um"/"empresta um" correto, sempre em -03:00 fixo.
// Útil para aritmética de calendário ("hoje menos 7 dias", "6 meses atrás") sem depender do
// fuso do navegador/SO.
function normalizarDataCalendarioFusoLocal(ano, mes, dia) {
  const shifted = paraFusoLocal(construirDataFusoLocal(ano, mes, dia));
  return { ano: shifted.getUTCFullYear(), mes: shifted.getUTCMonth(), dia: shifted.getUTCDate() };
}

// Sempre dd/mm/yyyy HH:mm (24h), em -03:00 fixo - independente de locale/fuso do navegador
function fmtDate(dt) {
  if (!dt) return '-';
  const d = paraFusoLocal(dt);
  if (isNaN(d.getTime())) return '-';
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

// Sempre dd/mm/yyyy, em -03:00 fixo
function fmtDateShort(dt) {
  if (!dt) return '-';
  const d = paraFusoLocal(dt);
  if (isNaN(d.getTime())) return '-';
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function statusBadge(status) {
  const map = { aberta: 'badge-blue', agendada: 'badge-blue-deep', realizada: 'badge-green', cancelada: 'badge-red' };
  return `<span class="badge ${map[status] || 'badge-gray'}">${escapeHtml(status) || 'aberta'}</span>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- ESTADOS DE LISTA (loading / vazio / erro) ----

function loading() {
  return `<div class="loading-indicator"><div class="spinner"></div> Carregando...</div>`;
}

function emptyState(msg) {
  return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M9 17H7A5 5 0 017 7h1M15 7h1a5 5 0 015 5v0a5 5 0 01-5 5h-1"/>
      <line x1="11" y1="12" x2="13" y2="12"/>
    </svg>
    <p>${msg}</p>
  </div>`;
}

function errorState(msg) {
  return `<div class="empty-state" style="color:var(--red-600)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <p>Erro ao carregar: ${escapeHtml(msg)}</p>
  </div>`;
}
