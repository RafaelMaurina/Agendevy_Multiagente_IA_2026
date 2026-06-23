"""Interface de terminal do assistente de agenda do Agendevy.

Orquestra os 4 agentes em sequência fixa: planejador -> recuperador -> executor -> revisor.
Não há nenhuma lógica de negócio aqui - só o loop de leitura/exibição, os comandos especiais do
terminal (ajuda, listagens) e a sequência de chamadas aos agentes.

Rodar a partir da raiz do repositório:
    python -m agents.main             # modo normal
    python -m agents.main --verbose   # mostra o raciocínio de cada agente
"""
from __future__ import annotations

import sys
from collections import deque
from typing import Callable

from colorama import Fore, Style
from colorama import init as _colorama_init

from .agentes import executor, planejador, recuperador, revisor
from .tools import agendevy_tools as tools

_colorama_init(autoreset=True)

# Quantos pares (usuário, assistente) manter como histórico de conversa e repassar ao
# planejador, para resolver pedidos de esclarecimento (ver agentes/planejador.py - ex: o turno
# anterior perguntou "qual paciente?" e o atual só responde o nome). Limitado para não inflar o
# prompt indefinidamente numa sessão de terminal longa.
HISTORICO_MAX_TURNOS = 4

COMANDOS_SAIR = {"sair", "exit", "quit"}
COMANDOS_AJUDA = {"ajuda", "help", "menu", "?"}


def _cor(texto: str, cor: str) -> str:
    return f"{cor}{texto}{Style.RESET_ALL}"


def _vprint(*partes: object) -> None:
    """Print de uma linha do modo --verbose - sempre esmaecida, para não competir visualmente
    com a resposta real do assistente."""
    print(_cor(" ".join(str(p) for p in partes), Style.DIM))


def _print_verbose(plano, contexto, execucao, resultado_revisor) -> None:
    _vprint("\n  [planejador] intenção:", plano.intencao)
    if plano.paciente_id:
        _vprint("  [planejador] paciente_id:", plano.paciente_id)
    if plano.profissional_id:
        _vprint("  [planejador] profissional_id:", plano.profissional_id)
    if plano.tipo_consulta_id:
        _vprint("  [planejador] tipo_consulta_id:", plano.tipo_consulta_id, f"({plano.tipo_consulta_nome})")
    if plano.data_hora_iso:
        _vprint("  [planejador] data_hora_iso:", plano.data_hora_iso)
    if plano.erro:
        _vprint("  [planejador] erro:", plano.erro)

    _vprint("  [recuperador] trechos do paciente:", len(contexto.trechos_paciente))
    for t in contexto.trechos_paciente:
        _vprint(f"      score={t['score']:.3f}  {t['texto'][:80]}...")
    _vprint("  [recuperador] trechos de conhecimento clínico:", len(contexto.trechos_conhecimento))
    for t in contexto.trechos_conhecimento:
        _vprint(f"      score={t['score']:.3f}  {t['texto'][:80]}...")

    _vprint("  [executor] sucesso:", execucao.sucesso, "| tipo_erro:", execucao.tipo_erro)

    if resultado_revisor.sugestoes_horario:
        _vprint("  [revisor] horários alternativos sugeridos:", resultado_revisor.sugestoes_horario)
    if resultado_revisor.aviso_financeiro:
        _vprint("  [revisor] aviso financeiro:", resultado_revisor.aviso_financeiro)
    print()


def processar_pedido(
    texto_usuario: str,
    verbose: bool = False,
    historico: list[dict] | None = None,
    cliente_planejador=None,
    cliente_revisor=None,
) -> str:
    """Roda o pipeline completo para um único pedido e devolve a resposta final em texto.

    `historico` é a lista de turnos "user"/"assistant" anteriores desta conversa (mais antigo
    primeiro) - repassada ao planejador para resolver pedidos de esclarecimento. `main()` é
    quem mantém esse histórico entre chamadas; esta função em si é sem estado.
    `cliente_planejador`/`cliente_revisor` permitem injetar clientes Ollama (ou substitutos)
    para testes, no mesmo padrão de injeção já usado dentro de cada agente.
    """
    plano = planejador.interpretar_pedido(texto_usuario, cliente=cliente_planejador, historico=historico)

    if plano.erro:
        if verbose:
            print("\n  [planejador] erro de resolução, parando antes do recuperador/executor:", plano.erro)
        return plano.erro

    contexto = recuperador.recuperar_contexto(plano)
    execucao = executor.executar(plano)
    resultado = revisor.revisar(plano, execucao, contexto, cliente=cliente_revisor)

    if verbose:
        _print_verbose(plano, contexto, execucao, resultado)

    return resultado.resposta_final


def _texto_ajuda() -> str:
    return """Comandos especiais:
  ajuda                        mostra esta mensagem
  listar pacientes              lista os pacientes cadastrados
  listar profissionais          lista os profissionais cadastrados
  listar tipos                  lista os tipos de atendimento cadastrados
  sair                           encerra o assistente

Qualquer outro texto é interpretado como um pedido em linguagem natural. Exemplos:
  - "marca uma fisioterapia pra <paciente> com a <profissional> sexta às 14h"
  - "quais horários a <profissional> tem livres amanhã?"
  - "o que eu preciso saber antes de atender o <paciente>?"

Troque <paciente>/<profissional> por nomes reais - use "listar pacientes" / "listar
profissionais" pra ver quem está cadastrado."""


def _fmt_pacientes(pacientes: list[dict]) -> str:
    if not pacientes:
        return "  (nenhum paciente encontrado - confira se o backend está rodando)"
    linhas = []
    for p in pacientes:
        extra = f" - tel: {p['telefone']}" if p.get("telefone") else ""
        linhas.append(f"  - {p['nome']}{extra}")
    return "\n".join(linhas)


def _fmt_profissionais(profissionais: list[dict]) -> str:
    if not profissionais:
        return "  (nenhum profissional encontrado - confira se o backend está rodando)"
    return "\n".join(f"  - {p['nome']} - {p['especialidade']}" for p in profissionais)


def _fmt_tipos_consulta(tipos: list[dict]) -> str:
    if not tipos:
        return "  (nenhum tipo de atendimento encontrado - confira se o backend está rodando)"
    linhas = []
    for t in tipos:
        valor = f"R$ {float(t['valor_padrao']):.2f}" if t.get("valor_padrao") is not None else "sem valor padrão"
        linhas.append(f"  - {t['nome']} - {valor}, {t.get('duracao_minutos') or 30} min")
    return "\n".join(linhas)


# Comandos de listagem: chamam agendevy_tools direto (sem passar pelo LLM/agentes) - por isso
# funcionam mesmo com o Ollama fora do ar, e servem pro usuário descobrir nomes reais antes de
# montar um pedido em linguagem natural (ver _texto_ajuda).
_COMANDOS_LISTAGEM: dict[str, tuple[str, Callable[[], list[dict]], Callable[[list[dict]], str]]] = {
    "listar pacientes": ("Pacientes cadastrados", tools.listar_pacientes, _fmt_pacientes),
    "listar profissionais": ("Profissionais cadastrados", tools.listar_profissionais, _fmt_profissionais),
    "listar tipos": ("Tipos de atendimento cadastrados", tools.listar_tipos_consulta, _fmt_tipos_consulta),
    "listar tipos de atendimento": ("Tipos de atendimento cadastrados", tools.listar_tipos_consulta, _fmt_tipos_consulta),
}


def main() -> None:
    verbose = "--verbose" in sys.argv
    historico: deque[dict] = deque(maxlen=HISTORICO_MAX_TURNOS * 2)

    print(_cor("Agendevy Assistant - digite seu pedido ('ajuda' pra ver exemplos, 'sair' pra encerrar)", Style.BRIGHT))
    if verbose:
        print(_cor("(modo verbose ativado - mostrando o raciocínio de cada agente)", Style.DIM))

    while True:
        try:
            texto = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print(_cor("\nAté mais!", Style.BRIGHT))
            break

        if not texto:
            continue

        texto_normalizado = texto.lower()

        if texto_normalizado in COMANDOS_SAIR:
            print(_cor("Até mais!", Style.BRIGHT))
            break

        if texto_normalizado in COMANDOS_AJUDA:
            print(_cor(_texto_ajuda(), Fore.CYAN))
            continue

        if texto_normalizado in _COMANDOS_LISTAGEM:
            titulo, buscar, formatar = _COMANDOS_LISTAGEM[texto_normalizado]
            print(_cor(f"{titulo}:", Fore.CYAN))
            print(formatar(buscar()))
            continue

        print(_cor("Carregando resposta...", Style.DIM))
        try:
            resposta = processar_pedido(texto, verbose=verbose, historico=list(historico))
        except ConnectionError:
            # `ollama.Client.chat()` levanta ConnectionError quando não consegue conectar ao
            # host configurado - mesma situação (serviço local fora do ar) tratada de forma
            # amigável em agendevy_tools.py para a API do Agendevy; aqui é o equivalente pro
            # Ollama, em vez de cair na mensagem genérica de exceção abaixo.
            resposta = (
                "Não consegui falar com o modelo local (Ollama). Verifique se ele está rodando "
                "('ollama serve', ou abra o aplicativo do Ollama) e tente de novo."
            )
        except Exception as exc:  # nunca deixar o REPL morrer por uma falha de um pedido
            resposta = f"Desculpe, algo deu errado ao processar esse pedido: {exc}"

        print(_cor(resposta, Fore.GREEN))

        historico.append({"role": "user", "content": texto})
        historico.append({"role": "assistant", "content": resposta})


if __name__ == "__main__":
    main()
