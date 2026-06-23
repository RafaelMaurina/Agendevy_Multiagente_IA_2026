// ---- BOOTSTRAP DA APLICAÇÃO ----

window.addEventListener('DOMContentLoaded', () => {
  navigate('dashboard');
  loadAll();
});

// Permite filtrar a tabela de profissionais pelo campo de busca.
// (Pacientes e Consultas têm seus próprios sistemas de filtro dedicados -
// ver filtrarPacientes() em pacientes.js e FILTROS_CONSULTAS em consultas.js)
function filterTable(type) {
  const q = document.getElementById('search-' + type).value.toLowerCase();

  if (type === 'profissionais') {
    renderProfissionais(DATA.profissionais.filter(p => p.nome.toLowerCase().includes(q) || (p.especialidade || '').toLowerCase().includes(q)));
  }
}
