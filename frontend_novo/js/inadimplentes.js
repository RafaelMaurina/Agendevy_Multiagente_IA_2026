// ---- INADIMPLÊNCIA ----

async function loadInadimplentes() {
  const el = document.getElementById('inadimplentes-content');
  el.innerHTML = loading();
  try {
    const data = await apiFetch('/comanda/inadimplentes');
    renderInadimplentes(data);
  } catch (e) {
    el.innerHTML = errorState(e.message);
  }
}

function renderInadimplentes(data) {
  const el = document.getElementById('inadimplentes-content');

  const totalGeral = data.reduce((a, p) => a + p.total_em_aberto, 0);
  const totalPacientes = data.length;

  if (!data.length) {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Inadimplência</span></div>
        <div style="padding:32px;text-align:center;color:var(--text-secondary)">
          <div style="font-size:32px;margin-bottom:8px">✅</div>
          <div style="font-size:14px">Nenhum pagamento pendente. Tudo em dia!</div>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="fluxo-summary" style="margin-bottom:16px">
      <div class="stat-card">
        <div class="stat-label">Total em aberto</div>
        <div class="stat-value" style="color:var(--red-600,#dc2626)">R$ ${totalGeral.toFixed(2)}</div>
        <div class="stat-sub">soma de pendências</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pacientes inadimplentes</div>
        <div class="stat-value stat-accent">${totalPacientes}</div>
        <div class="stat-sub">com pagamento em aberto</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Pacientes com pendências</span>
        <span style="font-size:13px;color:var(--text-secondary)">${totalPacientes} paciente${totalPacientes !== 1 ? 's' : ''}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Paciente</th>
            <th>Pendências</th>
            <th style="text-align:right">Total em aberto</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${data.map(p => {
            const rows = p.lancamentos.map(l => {
              const label = l.consulta?.tipo_consulta?.nome || l.consulta?.nome_consulta || 'Lançamento avulso';
              const data_ref = l.consulta?.data_hora ? new Date(l.consulta.data_hora).toLocaleDateString('pt-BR') : '-';
              return `<tr class="inadim-detalhe" style="display:none" data-pac="${p.paciente.id}">
                <td style="padding-left:32px;color:var(--text-secondary);font-size:12px">↳ ${escapeHtml(label)}</td>
                <td style="font-size:12px;color:var(--text-secondary)">${data_ref}</td>
                <td style="text-align:right;font-size:12px;color:var(--red-600,#dc2626)">R$ ${Number(l.valor).toFixed(2)}</td>
                <td>
                  <button class="btn btn-sm btn-secondary" style="font-size:11px;padding:3px 8px"
                    onclick="openEditComanda(${l.id})">Registrar pgto</button>
                </td>
              </tr>`;
            }).join('');

            return `
              <tr style="cursor:pointer" onclick="toggleInadimDetalhe(${p.paciente.id}, this)">
                <td>
                  <div class="td-name">
                    <div class="mini-avatar">${initials(p.paciente.nome)}</div>
                    ${escapeHtml(p.paciente.nome)}
                  </div>
                </td>
                <td>
                  <span class="badge badge-red">${p.lancamentos.length} pendência${p.lancamentos.length !== 1 ? 's' : ''}</span>
                </td>
                <td style="text-align:right;font-weight:600;color:var(--red-600,#dc2626)">
                  R$ ${p.total_em_aberto.toFixed(2)}
                </td>
                <td>
                  <svg style="width:14px;height:14px;color:var(--text-secondary);transition:transform .2s" class="inadim-chevron-${p.paciente.id}"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </td>
              </tr>
              ${rows}`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function toggleInadimDetalhe(pacId, row) {
  const detalhes = document.querySelectorAll(`.inadim-detalhe[data-pac="${pacId}"]`);
  const chevron  = document.querySelector(`.inadim-chevron-${pacId}`);
  const aberto   = detalhes[0]?.style.display !== 'none';
  detalhes.forEach(r => r.style.display = aberto ? 'none' : '');
  if (chevron) chevron.style.transform = aberto ? '' : 'rotate(180deg)';
}