// ---- DASHBOARD ----

async function renderDashboard() {
  // Garante dados carregados
  try {
    const [pacientes, profissionais, consultas, comandas] = await Promise.all([
      DATA.pacientes?.length     ? Promise.resolve(DATA.pacientes)     : apiFetch('/pacientes'),
      DATA.profissionais?.length ? Promise.resolve(DATA.profissionais) : apiFetch('/profissionais'),
      DATA.consultas?.length     ? Promise.resolve(DATA.consultas)     : apiFetch('/consultas'),
      apiFetch('/comanda'),
    ]);
    DATA.pacientes     = pacientes;
    DATA.profissionais = profissionais;
    DATA.consultas     = consultas;
    DATA.comandas      = comandas;
  } catch(e) {
    document.getElementById('dash-consultas-list').innerHTML = errorState(e.message);
    return;
  }

  const agora = agoraFusoLocal();
  const anoAtual = agora.getUTCFullYear();
  const mesAtual = agora.getUTCMonth();
  // Limite exclusivo (início do mês seguinte) em -03:00 fixo - evita o problema de calcular
  // "23:59:59 do último dia", que é mais fácil de errar perto de viradas de mês.
  const inicioMes = construirDataFusoLocal(anoAtual, mesAtual, 1);
  const fimMes    = construirDataFusoLocal(anoAtual, mesAtual + 1, 1);

  // Indicadores do mês atual
  const consultasMes      = DATA.consultas.filter(c => {
    const d = new Date(c.data_hora);
    return d >= inicioMes && d < fimMes;
  });
  const realizadasMes     = consultasMes.filter(c => c.status === 'realizada').length;
  const agendadasMes      = consultasMes.filter(c => c.status === 'agendada').length;

  const comandasMes       = (DATA.comandas||[]).filter(i => {
    if (!i.data_pgto) return false;
    const d = new Date(i.data_pgto + 'T00:00:00-03:00');
    return d >= inicioMes && d < fimMes;
  });
  const receitaMes        = comandasMes
    .filter(i => !i.is_credito && i.status_pgto !== 'pendente')
    .reduce((a,i) => a + Number(i.valor), 0);
  const pendenteMes       = (DATA.comandas||[])
    .filter(i => !i.is_credito && i.status_pgto === 'pendente' &&
      (() => { if (!i.data_pgto) return true; const d = new Date(i.data_pgto+'T00:00:00-03:00'); return d >= inicioMes && d < fimMes; })()
    )
    .reduce((a,i) => a + Number(i.valor), 0);

  const mes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][mesAtual];

  // Cards de indicadores
  document.getElementById('stat-pacientes').textContent     = DATA.pacientes.length;
  document.getElementById('stat-profissionais').textContent = DATA.profissionais.length;
  document.getElementById('stat-consultas').textContent     = DATA.consultas.length;

  // Bloco de indicadores do mês
  const indicadoresEl = document.getElementById('dash-indicadores-mes');
  if (indicadoresEl) {
    indicadoresEl.innerHTML = `
      <div class="card-header" style="margin-bottom:12px">
        <span class="card-title">Resumo de ${mes}/${anoAtual}</span>
      </div>
      <div class="dash-summary">
        <div class="stat-card">
          <div class="stat-label">Receita do mês</div>
          <div class="stat-value stat-accent">R$ ${receitaMes.toFixed(2)}</div>
          <div class="stat-sub">pagamentos confirmados</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Em aberto</div>
          <div class="stat-value" style="color:var(--red-600,#dc2626)">R$ ${pendenteMes.toFixed(2)}</div>
          <div class="stat-sub">pendente de pagamento</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Consultas realizadas</div>
          <div class="stat-value">${realizadasMes}</div>
          <div class="stat-sub">neste mês</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Agendadas</div>
          <div class="stat-value">${agendadasMes}</div>
          <div class="stat-sub">próximas consultas</div>
        </div>
      </div>`;
  }

  // Próximas consultas - separadas em "Hoje" e "Próximos dias"
  const agora2    = new Date(); // momento real, usado só para comparação (timezone-agnóstico)
  const hojeBase  = agoraFusoLocal();
  const fimHojeExclusivo = construirDataFusoLocal(
    hojeBase.getUTCFullYear(), hojeBase.getUTCMonth(), hojeBase.getUTCDate() + 1
  );

  const futuras = DATA.consultas
    .filter(c => c.status !== 'cancelada' && new Date(c.data_hora) >= agora2)
    .sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

  const deHoje   = futuras.filter(c => new Date(c.data_hora) < fimHojeExclusivo);
  const proximas = futuras.filter(c => new Date(c.data_hora) >= fimHojeExclusivo).slice(0, 6);

  const el = document.getElementById('dash-consultas-list');
  if (!futuras.length) {
    el.innerHTML = emptyState('Nenhuma consulta futura encontrada');
    return;
  }

  function tabelaConsultas(lista) {
    return `<table>
      <thead><tr><th>Consulta</th><th>Paciente</th><th>Profissional</th><th>Hora</th><th>Status</th></tr></thead>
      <tbody>${lista.map(c => `
        <tr>
          <td>${escapeHtml(c.tipo_consulta?.nome || c.nome_consulta || '-')}</td>
          <td><span class="td-name" style="gap:6px">
            <span class="mini-avatar">${escapeHtml((c.paciente?.nome||'?')[0].toUpperCase())}</span>
            ${escapeHtml(c.paciente?.nome||'-')}
          </span></td>
          <td>${escapeHtml(c.profissional?.nome||'-')}</td>
          <td style="white-space:nowrap">${fmtDate(c.data_hora)}</td>
          <td>${statusBadge(c.status)}</td>
        </tr>`).join('')}
      </tbody></table>`;
  }

  let html = '';

  if (deHoje.length) {
    html += `
      <div style="padding:14px 20px 6px;display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;font-weight:600;color:var(--blue-600)">Hoje</span>
        <span style="background:var(--blue-100);color:var(--blue-800);font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px">${deHoje.length}</span>
      </div>
      <div style="background:var(--blue-50);border-radius:0">${tabelaConsultas(deHoje)}</div>`;
  } else {
    html += `<div style="padding:14px 20px 6px;font-size:13px;color:var(--gray-400)">Nenhuma consulta para hoje 🎉</div>`;
  }

  if (proximas.length) {
    html += `
      <div style="padding:18px 20px 6px;display:flex;align-items:center;gap:8px;border-top:0.5px solid #f1f5f9;margin-top:4px">
        <span style="font-size:13px;font-weight:500;color:var(--gray-600)">Próximos dias</span>
      </div>
      ${tabelaConsultas(proximas)}`;
  }

  el.innerHTML = html;
}