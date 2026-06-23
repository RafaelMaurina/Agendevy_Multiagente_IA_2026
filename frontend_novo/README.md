# Agendevy - Frontend

Frontend estático (HTML + CSS + JS puro, sem build step, sem framework) para o backend
Agendevy. Todo o JS é carregado via `<script>` global (sem módulos ES) - as funções de cada
arquivo ficam disponíveis no `window` e se chamam livremente entre si.

## Como rodar

1. Garanta que o backend está rodando (por padrão em `http://localhost:3000`).
2. Abra `index.html` no navegador (duplo clique já funciona - não precisa de servidor HTTP).

A URL da API é lida de `window.APP_CONFIG.apiUrl`, com fallback fixo em `js/api.js`:
```js
const API = (window.APP_CONFIG?.apiUrl) || 'http://localhost:3000/api';
```
Se o backend rodar em outra porta/endereço, defina `window.APP_CONFIG = { apiUrl: '...' }`
antes de `api.js` carregar, ou altere o fallback diretamente nessa linha.

## Páginas (módulos da aplicação)

A navegação é uma SPA simples por troca de `display` de `<div class="page">` (ver
`navigation.js`), sem roteador nem URLs distintas. Páginas disponíveis (`navigate('<page>')`):

| Página | id | Arquivo JS principal | Conteúdo |
|---|---|---|---|
| Início | `dashboard` | `dashboard.js` | Cards de estatísticas (totais de pacientes, profissionais, consultas, financeiro) |
| Agenda | `agendas` | `agendas.js` | Calendário mensal/semanal por profissional, popups de consulta/bloqueio, **reagendamento** (simples ou **recorrente** - semanal/mensal, até 52 ocorrências), criação/edição de bloqueios de horário |
| Consultas | `consultas` | `consultas.js` | Lista de consultas com filtros (paciente, profissional, status, período), criação/edição com cálculo automático de horário de fim |
| Pacientes | `pacientes` | `pacientes.js` | CRUD de pacientes + abas no modal de edição: histórico de consultas, comanda financeira e anamnese do paciente |
| Profissionais | `profissionais` | `profissionais.js` | CRUD de profissionais |
| Tipos de Atendimento | `tipos-consulta` | `tipos-consulta.js` | CRUD de tipos de consulta (nome, valor padrão, duração em minutos) |
| Perguntas Anamnese | `anamnese-config` | `anamnese.js` | CRUD de perguntas do formulário de anamnese (sim/não ou texto livre, soft delete) |
| Fluxo de Caixa | `fluxo` | `fluxo-caixa.js` | Lançamentos financeiros (pagamentos e créditos), filtros por período, gráfico de receita |
| Inadimplência | `inadimplentes` | `inadimplentes.js` | Pacientes com saldo devedor real (já descontado o crédito disponível) |

## Estrutura de pastas

```
frontend_novo/
├── index.html                 # Estrutura HTML: sidebar, topbar, todas as <div class="page">, modal e popups
├── css/
│   ├── variables.css          # Paleta de cores, tipografia (Inter), tokens de radius/shadow
│   ├── sidebar.css            # Barra lateral de navegação
│   ├── layout.css             # Topbar, botões, estrutura geral da página
│   ├── cards.css              # Cards, tabelas, badges, stats do dashboard
│   ├── modal.css              # Modal, formulários, toasts
│   └── agendas.css            # Calendário (mensal/semanal), popups de evento/bloqueio
└── js/
    ├── api.js                 # Config da API + apiFetch() + estado global DATA{} + loadAll() + syncAfterPagamento()
    ├── utils.js                # Formatação de datas (dd/mm/yyyy), badges de status, escapeHtml, estados de loading/vazio/erro
    ├── modal.js                # Sistema de toast, modal genérico, confirmação de exclusão (confirmDelete/doDelete)
    ├── navigation.js           # navigate(page) - troca de página ativa e botão de ação da topbar
    ├── dashboard.js            # Estatísticas da página Início
    ├── pacientes.js            # CRUD de Pacientes + blocos de histórico/comanda/anamnese no modal
    ├── profissionais.js        # CRUD de Profissionais
    ├── tipos-consulta.js       # CRUD de Tipos de Atendimento
    ├── consultas.js            # CRUD de Consultas + filtros + cálculo de horário de fim
    ├── agendas.js              # Calendário, bloqueios de horário, reagendamento simples/recorrente
    ├── anamnese.js             # Config de perguntas + respostas do paciente
    ├── fluxo-caixa.js          # Lançamentos financeiros + gráfico de receita
    ├── inadimplentes.js        # Relatório de inadimplência
    └── main.js                 # Bootstrap (DOMContentLoaded -> navigate('dashboard') + loadAll()) + filtro de profissionais
```

> Os arquivos JS são carregados sem módulos - a ordem no `<script>` do `index.html` importa
> (utilitários antes de quem os usa). Ao adicionar um arquivo novo, garanta que ele é incluído
> em `index.html` na posição correta.

## Convenções do código

- **Estado global**: `DATA` (em `api.js`) guarda os dados carregados (`pacientes`,
  `profissionais`, `consultas`, `agendas`, `tiposConsulta`, `comandas`, `perguntas`). As
  páginas leem/filtram esse objeto em vez de fazer fetch a cada render.
- **`apiFetch(path, opts, { silent })`**: wrapper único de `fetch` para toda a aplicação.
  Em erro HTTP, já exibe um toast automaticamente (a menos que `silent: true`) e lança a
  exceção com `.status` preenchido - o chamador trata casos específicos (ex: `409` de conflito
  de horário) no `catch`.
- **`syncAfterPagamento()`**: chamado após qualquer criação/edição de lançamento financeiro.
  Recarrega `DATA.comandas`/`DATA.consultas` e re-renderiza a tela ativa (calendário, fluxo de
  caixa, inadimplentes, consultas ou dashboard) sem precisar de um reload de página.
- **Modal genérico**: `openModal(title, bodyHTML, buttons[], opts)` / `closeModal()`. Os forms
  de cada recurso são strings HTML montadas em `_<recurso>FormHTML()` e injetadas no modal.
- **Toast**: `toast(msg, 'success'|'error'|'warning')` ou `toast.ok/erro/aviso(msg)`.
- **Exclusão**: `confirmDelete(resource, id, name)` abre o modal de confirmação;
  `doDelete(resource, id)` executa o `DELETE` e recarrega a lista correta por `resource`.
- **Datas**: sempre formatadas como `dd/mm/yyyy HH:mm` (24h) independentemente do locale do
  navegador (`fmtDate`/`fmtDateShort` em `utils.js`), para evitar ambiguidade.

## Paleta de cores (`css/variables.css`)

| Variável | Cor | Uso |
|---|---|---|
| `--blue-900` | `#172554` | Sidebar |
| `--blue-500` | `#2563EB` | Botões primários, item ativo |
| `--blue-600` | `#1D4ED8` | Hover de botões primários |
| `--blue-50` / `--blue-100` | `#EFF6FF` / `#DBEAFE` | Badges, fundos suaves |
| `--blue-800` | `#1E3A8A` | Textos em destaque (badges, cards de agenda) |
| `--green-600` | `#16A34A` | Status "realizada", sucesso |
| `--red-600` | `#DC2626` | Status "cancelada", erro, exclusão |
| `--amber-600` | `#D97706` | Avisos |

Radius (`--radius-sm` a `--radius-xl`) e shadows (`--shadow-xs` a `--shadow-lg`) também são
tokens centralizados em `variables.css` - preferir essas variáveis a valores soltos ao estilizar
novos componentes.
