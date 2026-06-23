// ---- FLUXO DE CAIXA ----

const FORMAS_PGTO = [
  { value: 'dinheiro',        label: 'Dinheiro' },
  { value: 'cartao_credito',  label: 'Cartão de crédito' },
  { value: 'cartao_debito',   label: 'Cartão de débito' },
  { value: 'pix',             label: 'Pix' },
  { value: 'credito_saldo',   label: 'Crédito (saldo R$)' },
  { value: 'credito_sessoes', label: 'Crédito (sessões)' },
];

const FILTROS_FLUXO = {
  periodo: '',
  dataInicio: '',
  dataFim: '',
  tipo: '',
  forma: '',
  status: '',
  paciente: '',
  incluirCreditos: false,
};

let _graficoReceitaInstance = null;
let _graficoPeriodo = 'mensal'; // diario | semanal | mensal | anual
let _lastFluxoList  = [];

async function loadFluxoCaixa() {
  const el = document.getElementById('fluxo-content');
  el.innerHTML = loading();
  try {
    const [entradas, pacientes] = await Promise.all([
      apiFetch('/comanda'),
      DATA.pacientes?.length ? Promise.resolve(DATA.pacientes) : apiFetch('/pacientes'),
    ]);
    DATA.pacientes = pacientes;
    DATA.comandas  = entradas;
    renderFluxoCaixa();
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

function renderFluxoCaixa() {
  const el = document.getElementById('fluxo-content');
  const list = aplicarFiltrosFluxo(DATA.comandas || []);

  const totalRecebido = list.filter(i => !i.is_credito && i.status_pgto !== 'pendente')
    .reduce((a,i) => a + Number(i.valor), 0);
  const totalPendente = list.filter(i => !i.is_credito && i.status_pgto === 'pendente')
    .reduce((a,i) => a + Number(i.valor), 0);
  const creditosPrevisao = FILTROS_FLUXO.incluirCreditos
    ? list.reduce((acc, i) => {
        if (i.is_credito && i.tipo_credito === 'monetario') return acc + Number(i.valor || 0);
        // Subtrai créditos já consumidos como pagamento
        if (i.forma_pgto === 'credito_saldo' && i.status_pgto !== 'pendente') return acc - Number(i.valor || 0);
        return acc;
      }, 0)
    : 0;
  const totalPrevisao = list
    .filter(i => !i.is_credito && i.consulta != null && i.consulta?.status !== 'cancelada')
    .reduce((a, i) => a + Number(i.valor || 0), 0) + creditosPrevisao;
  // Usa DATA.comandas (total) em vez de list (filtrado)
  const totalCredito = (DATA.comandas || []).reduce((acc, i) => {
    if (i.is_credito && i.tipo_credito === 'monetario') return acc + Number(i.valor);
    if (!i.is_credito && i.forma_pgto === 'credito_saldo' && i.status_pgto !== 'pendente') return acc - Number(i.valor);
    return acc;
  }, 0);

  const totalSessoes = (DATA.comandas || []).reduce((acc, i) => {
    if (i.is_credito && i.tipo_credito === 'sessoes') return acc + (i.sessoes_qty || 0);
    if (!i.is_credito && i.forma_pgto === 'credito_sessoes' && i.status_pgto !== 'pendente') return acc - (i.sessoes_consumidas || 0);
    return acc;
  }, 0);

  const periodoLabel = FILTROS_FLUXO.periodo === '7' ? 'Últimos 7 dias'
    : FILTROS_FLUXO.periodo === '30' ? 'Últimos 30 dias'
    : FILTROS_FLUXO.periodo === 'custom' ? `${fmtDateOnly(FILTROS_FLUXO.dataInicio||'')} → ${fmtDateOnly(FILTROS_FLUXO.dataFim||'')}`
    : 'Todos os períodos';

  const formaOpts = FORMAS_PGTO.map(f =>
    `<option value="${f.value}" ${FILTROS_FLUXO.forma===f.value?'selected':''}>${f.label}</option>`
  ).join('');

  const pacOpts = (DATA.pacientes || []).map(p =>
    `<option value="${p.id}" ${FILTROS_FLUXO.paciente == p.id ? 'selected':''}>${escapeHtml(p.nome)}</option>`
  ).join('');

  el.innerHTML = `
    <div class="filtros-bar" style="flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:16px">
      <div class="filtros-grupo">
        <span class="filtros-label">Período:</span>
        <button class="btn btn-sm ${FILTROS_FLUXO.periodo==='7'?'btn-primary':'btn-secondary'}" onclick="setFiltroPeriodo('7')">7 dias</button>
        <button class="btn btn-sm ${FILTROS_FLUXO.periodo==='30'?'btn-primary':'btn-secondary'}" onclick="setFiltroPeriodo('30')">30 dias</button>
        <button class="btn btn-sm ${FILTROS_FLUXO.periodo===''?'btn-primary':'btn-secondary'}" onclick="setFiltroPeriodo('')">Todos</button>
        <button class="btn btn-sm ${FILTROS_FLUXO.periodo==='custom'?'btn-primary':'btn-secondary'}" onclick="setFiltroPeriodo('custom')">Personalizado</button>
        ${FILTROS_FLUXO.periodo==='custom' ? `
        <input class="form-input filtro-sm" type="date" value="${FILTROS_FLUXO.dataInicio}"
          onchange="FILTROS_FLUXO.dataInicio=this.value;renderFluxoCaixa()" />
        <span style="color:var(--text-secondary)">até</span>
        <input class="form-input filtro-sm" type="date" value="${FILTROS_FLUXO.dataFim}"
          onchange="FILTROS_FLUXO.dataFim=this.value;renderFluxoCaixa()" />` : ''}
      </div>
      <div class="filtros-grupo" style="flex-wrap:nowrap">
        <select class="form-select filtro-sm" onchange="FILTROS_FLUXO.tipo=this.value;renderFluxoCaixa()">
          <option value="">Todos os tipos</option>
          <option value="pagamento" ${FILTROS_FLUXO.tipo==='pagamento'?'selected':''}>Pagamentos</option>
          <option value="credito_monetario" ${FILTROS_FLUXO.tipo==='credito_monetario'?'selected':''}>Crédito R$</option>
          <option value="credito_sessoes" ${FILTROS_FLUXO.tipo==='credito_sessoes'?'selected':''}>Crédito sessões</option>
        </select>
        <select class="form-select filtro-sm" onchange="FILTROS_FLUXO.forma=this.value;renderFluxoCaixa()">
          <option value="">Todas as formas</option>${formaOpts}
        </select>
        <select class="form-select filtro-sm" onchange="FILTROS_FLUXO.status=this.value;renderFluxoCaixa()">
          <option value="">Todos os status</option>
          <option value="pago" ${FILTROS_FLUXO.status==='pago'?'selected':''}>Pago</option>
          <option value="pendente" ${FILTROS_FLUXO.status==='pendente'?'selected':''}>Pendente</option>
        </select>
        <select class="form-select filtro-sm" onchange="FILTROS_FLUXO.paciente=this.value;renderFluxoCaixa()">
          <option value="">Todos os pacientes</option>${pacOpts}
        </select>
        <select class="form-select filtro-sm" onchange="FILTROS_FLUXO.incluirCreditos=this.value==='sim';renderFluxoCaixa()">
          <option value="nao" ${!FILTROS_FLUXO.incluirCreditos?'selected':''}>Previsão sem créditos</option>
          <option value="sim" ${FILTROS_FLUXO.incluirCreditos?'selected':''}>Previsão + créditos</option>
        </select>
        <button class="btn btn-secondary btn-sm" onclick="limparFiltrosFluxo()">Limpar</button>
      </div>
    </div>

    <div class="fluxo-summary">
      <div class="stat-card">
        <div class="stat-label">Recebido</div>
        <div class="stat-value stat-accent">R$ ${totalRecebido.toFixed(2)}</div>
        <div class="stat-sub">${periodoLabel}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pendente</div>
        <div class="stat-value" style="color:var(--red-600,#dc2626)">R$ ${totalPendente.toFixed(2)}</div>
        <div class="stat-sub">em aberto</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Créditos R$</div>
        <div class="stat-value">R$ ${totalCredito.toFixed(2)}</div>
        <div class="stat-sub">saldo a consumir</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sessões vendidas</div>
        <div class="stat-value">${totalSessoes}</div>
        <div class="stat-sub">crédito em sessões</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Previsto</div>
        <div class="stat-value">R$ ${totalPrevisao.toFixed(2)}</div>
        <div class="stat-sub">a receber total</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <span class="card-title">Receita</span>
        <div class="grafico-tabs">
          <button class="grafico-tab ${_graficoPeriodo==='diario'  ?'active':''}" onclick="document.querySelectorAll('.grafico-tab').forEach(b=>b.classList.remove('active'));this.classList.add('active');_graficoPeriodo='diario';  renderGraficoReceita(_lastFluxoList)">Diário</button>
          <button class="grafico-tab ${_graficoPeriodo==='semanal' ?'active':''}" onclick="document.querySelectorAll('.grafico-tab').forEach(b=>b.classList.remove('active'));this.classList.add('active');_graficoPeriodo='semanal'; renderGraficoReceita(_lastFluxoList)">Semanal</button>
          <button class="grafico-tab ${_graficoPeriodo==='mensal'  ?'active':''}" onclick="document.querySelectorAll('.grafico-tab').forEach(b=>b.classList.remove('active'));this.classList.add('active');_graficoPeriodo='mensal';  renderGraficoReceita(_lastFluxoList)">Mensal</button>
          <button class="grafico-tab ${_graficoPeriodo==='anual'   ?'active':''}" onclick="document.querySelectorAll('.grafico-tab').forEach(b=>b.classList.remove('active'));this.classList.add('active');_graficoPeriodo='anual';   renderGraficoReceita(_lastFluxoList)">Anual</button>
        </div>
      </div>
      <div style="padding:20px 20px 12px;height:280px;position:relative">
        <canvas id="grafico-receita"></canvas>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <span class="card-title">Lançamentos</span>
        <span style="font-size:13px;color:var(--text-secondary)">${list.length} registro${list.length!==1?'s':''}</span>
      </div>
      ${list.length ? `
      <table>
        <thead><tr><th>Paciente</th><th>Tipo</th><th>Valor</th><th>Forma</th><th>Status</th><th>Data pgto</th><th>Obs.</th><th>Consulta</th><th></th></tr></thead>
        <tbody>${list.map(i => {
          const isCredito  = i.is_credito;
          const tipoLabel  = isCredito ? (i.tipo_credito==='sessoes' ? `Sessões (${i.sessoes_qty??0})` : 'Crédito R$') : 'Pagamento';
          const valorLabel = isCredito && i.tipo_credito==='sessoes' ? `${i.sessoes_qty??0} sessões` : `R$ ${Number(i.valor).toFixed(2)}`;
          const formaLabel = FORMAS_PGTO.find(f => f.value===i.forma_pgto)?.label || i.forma_pgto || '-';
          const statusLabel = isCredito ? '-'
            : (i.status_pgto==='pendente'
              ? '<span class="badge badge-red">Pendente</span>'
              : '<span class="badge badge-green">Pago</span>');
          let vinculo = '-';
          if (!isCredito && i.consulta) {
            const nomeConsulta = i.consulta.tipo_consulta?.nome || i.consulta.nome_consulta || 'Consulta';
            const dataConsulta = i.consulta.data_hora ? fmtDateShort(i.consulta.data_hora) : '';
            const sessaoTag = i.forma_pgto === 'credito_sessoes'
              ? ' <span style="color:var(--text-secondary)">(1 sessão usada)</span>' : '';
            vinculo = `${escapeHtml(nomeConsulta)}${dataConsulta ? ` · ${dataConsulta}` : ''}${sessaoTag}`;
          }
          return `<tr>
            <td style="font-weight:500">${escapeHtml(i.paciente?.nome||'-')}</td>
            <td>${tipoLabel}</td>
            <td>${valorLabel}</td>
            <td>${formaLabel}</td>
            <td>${statusLabel}</td>
            <td style="white-space:nowrap">${i.data_pgto ? fmtDateOnly(i.data_pgto) : '-'}</td>
            <td style="color:var(--text-secondary);font-size:13px">${escapeHtml(i.observacao||'')}</td>
            <td style="font-size:12px;color:var(--text-secondary)">${vinculo}</td>
            <td><div class="actions-cell">
              <button class="icon-btn" onclick="openEditComanda(${i.id})" title="Editar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="icon-btn danger" onclick="confirmDelete('comanda',${i.id},'lançamento')" title="Excluir">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : emptyState('Nenhum lançamento encontrado')}
    </div>`;

  requestAnimationFrame(() => renderGraficoReceita(list));
}

function aplicarFiltrosFluxo(list) {
  const hojeLocal = agoraFusoLocal(); // só para extrair ano/mês/dia atuais em -03:00

  if (FILTROS_FLUXO.periodo === '7' || FILTROS_FLUXO.periodo === '30') {
    const dias = FILTROS_FLUXO.periodo === '7' ? 7 : 30;
    const limite = construirDataFusoLocal(hojeLocal.getUTCFullYear(), hojeLocal.getUTCMonth(), hojeLocal.getUTCDate() - dias);
    list = list.filter(i => {
      if (!i.data_pgto) return i.status_pgto === 'pendente'; // pendentes sem data sempre incluídos
      return new Date(i.data_pgto+'T00:00:00-03:00') >= limite;
    });
  } else if (FILTROS_FLUXO.periodo === 'custom') {
    if (FILTROS_FLUXO.dataInicio)
      list = list.filter(i => i.data_pgto && i.data_pgto >= FILTROS_FLUXO.dataInicio);
    if (FILTROS_FLUXO.dataFim)
      list = list.filter(i => i.data_pgto && i.data_pgto <= FILTROS_FLUXO.dataFim);
  }

  if (FILTROS_FLUXO.tipo === 'pagamento')
    list = list.filter(i => !i.is_credito);
  else if (FILTROS_FLUXO.tipo === 'credito_monetario')
    list = list.filter(i => i.is_credito && i.tipo_credito === 'monetario');
  else if (FILTROS_FLUXO.tipo === 'credito_sessoes')
    list = list.filter(i => i.is_credito && i.tipo_credito === 'sessoes');

  if (FILTROS_FLUXO.forma)
    list = list.filter(i => i.forma_pgto === FILTROS_FLUXO.forma);

  if (FILTROS_FLUXO.status)
    list = list.filter(i => i.status_pgto === FILTROS_FLUXO.status);

  if (FILTROS_FLUXO.paciente)
    list = list.filter(i => String(i.paciente?.id) === String(FILTROS_FLUXO.paciente));

  return list;
}

function setFiltroPeriodo(p) {
  FILTROS_FLUXO.periodo = p;
  if (p !== 'custom') { FILTROS_FLUXO.dataInicio = ''; FILTROS_FLUXO.dataFim = ''; }
  renderFluxoCaixa();
}

function _calcGraficoDados(todosDados, periodo) {
  const now   = agoraFusoLocal(); // só para extrair ano/mês/dia "hoje" em -03:00
  const labels = [], recebido = [], pendente = [], previsao = [];

  const prevDate = item =>
    item.data_pgto || (item.consulta?.data_hora ? item.consulta.data_hora.split('T')[0] : null);

  // Acumula o valor previsto de um bucket de itens, respeitando créditos consumidos
  const calcPrevBucket = items => items.reduce((acc, item) => {
    if (FILTROS_FLUXO.incluirCreditos) {
      if (item.is_credito && item.tipo_credito === 'monetario') return acc + Number(item.valor || 0);
      // Subtrai créditos monetários já consumidos como pagamento
      if (item.forma_pgto === 'credito_saldo' && item.status_pgto !== 'pendente')
        return acc - Number(item.valor || 0);
    }
    // Consultas normais (para todos os modos)
    if (!item.is_credito && item.consulta != null && item.consulta?.status !== 'cancelada')
      return acc + Number(item.valor || 0);
    return acc;
  }, 0);

  // Formata um {ano,mes,dia} (já normalizado em -03:00) como label pt-BR, sem depender do
  // fuso do navegador - usa o componente UTC do real instante -03:00 correspondente.
  const fmtLabel = (ano, mes, dia, opts) =>
    construirDataFusoLocal(ano, mes, dia).toLocaleDateString('pt-BR', { ...opts, timeZone: 'America/Sao_Paulo' });

  if (periodo === 'diario') {
    for (let i = 29; i >= 0; i--) {
      const { ano, mes, dia } = normalizarDataCalendarioFusoLocal(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i);
      const key = `${ano}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
      labels.push(fmtLabel(ano, mes, dia, { day: '2-digit', month: 'short' }));
      const itens = todosDados.filter(item => !item.is_credito && item.data_pgto === key);
      recebido.push(itens.filter(x => x.status_pgto !== 'pendente').reduce((a,x) => a + Number(x.valor), 0));
      pendente.push(itens.filter(x => x.status_pgto === 'pendente').reduce((a,x) => a + Number(x.valor), 0));
      previsao.push(calcPrevBucket(todosDados.filter(item => prevDate(item) === key)));
    }
  } else if (periodo === 'semanal') {
    for (let i = 11; i >= 0; i--) {
      const fimSemana = normalizarDataCalendarioFusoLocal(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i * 7);
      const inicioSemana = normalizarDataCalendarioFusoLocal(fimSemana.ano, fimSemana.mes, fimSemana.dia - 6);
      const s = ({ano,mes,dia}) => `${ano}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
      const sk = s(inicioSemana), ek = s(fimSemana);
      labels.push(fmtLabel(inicioSemana.ano, inicioSemana.mes, inicioSemana.dia, { day: '2-digit', month: 'short' }));
      const itens = todosDados.filter(item => !item.is_credito && item.data_pgto >= sk && item.data_pgto <= ek);
      recebido.push(itens.filter(x => x.status_pgto !== 'pendente').reduce((a,x) => a + Number(x.valor), 0));
      pendente.push(itens.filter(x => x.status_pgto === 'pendente').reduce((a,x) => a + Number(x.valor), 0));
      previsao.push(calcPrevBucket(todosDados.filter(item => { const rd = prevDate(item); return rd >= sk && rd <= ek; })));
    }
  } else if (periodo === 'anual') {
    for (let i = 3; i >= 0; i--) {
      const ano = now.getUTCFullYear() - i;
      labels.push(String(ano));
      const itens = todosDados.filter(item => {
        if (!item.data_pgto || item.is_credito) return false;
        return Number(item.data_pgto.slice(0,4)) === ano; // "YYYY-MM-DD" - comparação por string, sem Date
      });
      recebido.push(itens.filter(x => x.status_pgto !== 'pendente').reduce((a,x) => a + Number(x.valor), 0));
      pendente.push(itens.filter(x => x.status_pgto === 'pendente').reduce((a,x) => a + Number(x.valor), 0));
      previsao.push(calcPrevBucket(todosDados.filter(item => {
        const rd = prevDate(item); if (!rd) return false;
        return Number(rd.slice(0,4)) === ano;
      })));
    }
  } else {
    // mensal - últimos 6 meses
    for (let i = 5; i >= 0; i--) {
      const { ano, mes } = normalizarDataCalendarioFusoLocal(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
      labels.push(fmtLabel(ano, mes, 1, { month: 'short', year: '2-digit' }));
      const chaveAnoMes = `${ano}-${String(mes+1).padStart(2,'0')}`;
      const itens = todosDados.filter(item => {
        if (!item.data_pgto || item.is_credito) return false;
        return item.data_pgto.slice(0,7) === chaveAnoMes; // "YYYY-MM-DD" - comparação por string
      });
      recebido.push(itens.filter(x => x.status_pgto !== 'pendente').reduce((a,x) => a + Number(x.valor), 0));
      pendente.push(itens.filter(x => x.status_pgto === 'pendente').reduce((a,x) => a + Number(x.valor), 0));
      previsao.push(calcPrevBucket(todosDados.filter(item => {
        const rd = prevDate(item); if (!rd) return false;
        return rd.slice(0,7) === chaveAnoMes;
      })));
    }
  }

  return { labels, recebido, pendente, previsao };
}

function renderGraficoReceita(todosDados) {
  const canvas = document.getElementById('grafico-receita');
  if (!canvas) return;

  _lastFluxoList = todosDados;
  const { labels, recebido, pendente, previsao } = _calcGraficoDados(todosDados, _graficoPeriodo);

  if (_graficoReceitaInstance) {
    _graficoReceitaInstance.destroy();
    _graficoReceitaInstance = null;
  }

  const ctx = canvas.getContext('2d');

  // Gradiente verde para Recebido
  const gradRecebido = ctx.createLinearGradient(0, 0, 0, 280);
  gradRecebido.addColorStop(0, 'rgba(16,185,129,0.95)');
  gradRecebido.addColorStop(1, 'rgba(5,150,105,0.75)');

  // Gradiente vermelho para Pendente
  const gradPendente = ctx.createLinearGradient(0, 0, 0, 280);
  gradPendente.addColorStop(0, 'rgba(239,68,68,0.85)');
  gradPendente.addColorStop(1, 'rgba(220,38,38,0.65)');

  _graficoReceitaInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Recebido',
          data: recebido,
          backgroundColor: gradRecebido,
          hoverBackgroundColor: 'rgba(5,150,105,1)',
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false,
          order: 2,
        },
        {
          label: 'Pendente',
          data: pendente,
          backgroundColor: gradPendente,
          hoverBackgroundColor: 'rgba(220,38,38,1)',
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false,
          order: 3,
        },
        {
          label: 'Previsto',
          data: previsao,
          type: 'line',
          borderColor: 'rgba(99,102,241,0.9)',
          backgroundColor: 'rgba(99,102,241,0.07)',
          borderWidth: 2.5,
          borderDash: [],
          pointBackgroundColor: 'white',
          pointBorderColor: 'rgba(99,102,241,0.9)',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: 'rgba(99,102,241,1)',
          fill: true,
          tension: 0.35,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 450, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { size: 12, family: 'system-ui' },
            usePointStyle: true,
            pointStyle: 'rectRounded',
            pointStyleWidth: 14,
            padding: 24,
            color: '#64748b',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.93)',
          titleFont: { size: 12, weight: '600', family: 'system-ui' },
          bodyFont: { size: 12, family: 'system-ui' },
          padding: 14,
          cornerRadius: 10,
          boxPadding: 5,
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          callbacks: {
            title: items => items[0]?.label || '',
            label: ctx => {
              const v = ctx.parsed.y;
              const sym = ctx.dataset.type === 'line' ? '◆' : '■';
              return `  ${sym} ${ctx.dataset.label}: R$ ${v.toFixed(2)}`;
            },
            afterBody: items => {
              const rec = items.find(i => i.dataset.label === 'Recebido')?.parsed.y || 0;
              const pen = items.find(i => i.dataset.label === 'Pendente')?.parsed.y || 0;
              if (rec + pen === 0) return [];
              return [``, `  Total realiz.: R$ ${(rec + pen).toFixed(2)}`];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            font: { size: 11, family: 'system-ui' },
            color: '#94a3b8',
            maxRotation: _graficoPeriodo === 'diario' ? 45 : 0,
            minRotation: _graficoPeriodo === 'diario' ? 45 : 0,
            autoSkip: true,
            maxTicksLimit: _graficoPeriodo === 'diario' ? 15 : undefined,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(241,245,249,1)', drawBorder: false },
          border: { display: false },
          ticks: {
            font: { size: 11, family: 'system-ui' },
            color: '#94a3b8',
            maxTicksLimit: 5,
            callback: v => v >= 1000 ? `R$ ${(v/1000).toFixed(1)}k` : `R$ ${v}`,
          },
        },
      },
    },
  });
}

function limparFiltrosFluxo() {
  FILTROS_FLUXO.periodo = '';
  FILTROS_FLUXO.dataInicio = '';
  FILTROS_FLUXO.dataFim = '';
  FILTROS_FLUXO.tipo = '';
  FILTROS_FLUXO.forma = '';
  FILTROS_FLUXO.status = '';
  FILTROS_FLUXO.paciente = '';
  FILTROS_FLUXO.incluirCreditos = false;
  renderFluxoCaixa();
}

function _comandaFormHTML(i = null) {
  const todayStr = (() => { const n = agoraFusoLocal(); return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}-${String(n.getUTCDate()).padStart(2,'0')}`; })();
  const pacOpts = (DATA.pacientes||[]).map(p =>
    `<option value="${p.id}" ${i?.paciente?.id===p.id?'selected':''}>${escapeHtml(p.nome)}</option>`
  ).join('');
  const formaOpts = FORMAS_PGTO.map(f =>
    `<option value="${f.value}" ${i?.forma_pgto===f.value?'selected':''}>${f.label}</option>`
  ).join('');
  const isCredito   = i?.is_credito || false;
  const tipoCredito = i?.tipo_credito || 'monetario';

  return `
    <div class="form-group">
      <label class="form-label">Paciente *</label>
      <select class="form-select" id="cm-pac"><option value="">Selecione...</option>${pacOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Tipo de lançamento *</label>
      <select class="form-select" id="cm-tipo" onchange="onComandaTipoChange(this)">
        <option value="pagamento" ${!isCredito?'selected':''}>Pagamento de consulta</option>
        <option value="credito_monetario" ${isCredito&&tipoCredito==='monetario'?'selected':''}>Adicionar crédito (R$)</option>
        <option value="credito_sessoes" ${isCredito&&tipoCredito==='sessoes'?'selected':''}>Adicionar crédito (sessões)</option>
      </select>
    </div>
    <div id="cm-valor-wrap" class="form-row">
      <div class="form-group">
        <label class="form-label" id="cm-valor-label">Valor (R$) *</label>
        <input class="form-input" id="cm-valor" type="number" min="0" step="0.01" value="${i?.valor??''}" placeholder="0,00" />
      </div>
      <div class="form-group" id="cm-sessoes-wrap" style="display:${isCredito&&tipoCredito==='sessoes'?'block':'none'}">
        <label class="form-label">Qtd. de sessões *</label>
        <input class="form-input" id="cm-sessoes" type="number" min="1" step="1" value="${i?.sessoes_qty??''}" placeholder="Ex: 10" />
      </div>
    </div>
    <div class="form-row" id="cm-pgto-wrap" style="display:${!isCredito?'flex':'none'}">
      <div class="form-group">
        <label class="form-label">Forma de pagamento</label>
        <select class="form-select" id="cm-forma">${formaOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Data do pagamento</label>
        <input class="form-input" id="cm-data" type="date" value="${escapeHtml(i?.data_pgto || todayStr)}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Observação</label>
      <input class="form-input" id="cm-obs" placeholder="Opcional" value="${escapeHtml(i?.observacao||'')}" />
    </div>
    ${i?.id ? `<input type="hidden" id="cm-id" value="${i.id}" />` : ''}`;
}

function onComandaTipoChange(sel) {
  const tipo = sel.value;
  document.getElementById('cm-pgto-wrap').style.display    = tipo==='pagamento' ? 'flex' : 'none';
  document.getElementById('cm-sessoes-wrap').style.display = tipo==='credito_sessoes' ? 'block' : 'none';
  document.getElementById('cm-valor-label').textContent    = tipo==='credito_sessoes' ? 'Valor cobrado (R$) *' : 'Valor (R$) *';
}

function openCreateComanda() {
  openModal('Novo lançamento', _comandaFormHTML(), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar', cls: 'btn-primary', fn: 'saveComanda()', id: 'btn-modal-submit' },
  ]);
}

async function openEditComanda(id) {
  let i;
  try {
    i = await apiFetch('/comanda/' + id);
  } catch(e) {
    // fallback to cache if route unavailable
    i = (DATA.comandas||[]).find(x => x.id === id) || { id };
  }
  openModal('Editar lançamento', _comandaFormHTML(i), [
    { label: 'Cancelar', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Salvar', cls: 'btn-primary', fn: 'saveComanda()', id: 'btn-modal-submit' },
  ]);
}

async function saveComanda() {
  const restore = setBtnLoading('btn-modal-submit', 'Salvando…');
  const paciente_id = document.getElementById('cm-pac').value;
  const tipo        = document.getElementById('cm-tipo').value;
  const valor       = document.getElementById('cm-valor').value;
  const sessoes_qty = document.getElementById('cm-sessoes')?.value;
  const forma_pgto  = document.getElementById('cm-forma')?.value || null;
  const data_pgto   = document.getElementById('cm-data')?.value || null;
  const observacao  = document.getElementById('cm-obs').value.trim() || null;
  const id          = document.getElementById('cm-id')?.value;

  if (!paciente_id) { restore(); return toast('Selecione um paciente', 'error'); }
  if ((!valor || Number(valor) <= 0) && tipo !== 'credito_sessoes') { restore(); return toast('Informe o valor', 'error'); }
  if (tipo === 'credito_sessoes' && !sessoes_qty) { restore(); return toast('Informe a quantidade de sessões', 'error'); }

  const is_credito   = tipo !== 'pagamento';
  const tipo_credito = tipo==='credito_sessoes' ? 'sessoes' : tipo==='credito_monetario' ? 'monetario' : null;

  const body = {
    paciente_id: +paciente_id,
    valor: Number(valor)||0,
    is_credito,
    tipo_credito,
    sessoes_qty: tipo==='credito_sessoes' ? Number(sessoes_qty) : null,
    forma_pgto: !is_credito ? forma_pgto : null,
    data_pgto:  !is_credito ? data_pgto  : null,
    observacao,
  };

  try {
    if (id) await apiFetch('/comanda/'+id, { method:'PUT', body:JSON.stringify(body) });
    else     await apiFetch('/comanda',     { method:'POST', body:JSON.stringify(body) });
    closeModal();
    toast(id ? 'Lançamento atualizado!' : 'Lançamento salvo!', 'success');
    await syncAfterPagamento();
  } catch (e) {
    restore();
    toast(e.message, 'error');
  }
}

function fmtDateOnly(dateStr) {
  if (!dateStr) return '-';
  const [y,m,d] = dateStr.split('-');
  if (!y||!m||!d) return dateStr;
  return `${d}/${m}/${y}`;
}