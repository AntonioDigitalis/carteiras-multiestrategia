# Carteiras Multiestratégia — Diretrizes de Desenvolvimento

## Karpathy Guidelines

Diretrizes comportamentais para reduzir erros comuns em codificação com LLMs.

**Tradeoff:** Estas diretrizes privilegiam cautela sobre velocidade. Para tarefas triviais, use o bom senso.

### 1. Pense Antes de Codificar

**Não assuma. Não esconda confusão. Explicite os tradeoffs.**

Antes de implementar:
- Declare suas suposições explicitamente. Se incerto, pergunte.
- Se houver múltiplas interpretações, apresente-as — não escolha silenciosamente.
- Se existir uma abordagem mais simples, diga. Questione quando justificado.
- Se algo estiver pouco claro, pare. Nomeie o que está confuso. Pergunte.

### 2. Simplicidade Primeiro

**Código mínimo que resolve o problema. Nada especulativo.**

- Sem features além do que foi pedido.
- Sem abstrações para código de uso único.
- Sem "flexibilidade" ou "configurabilidade" não solicitadas.
- Sem tratamento de erros para cenários impossíveis.
- Se você escreveu 200 linhas e poderia ser 50, reescreva.

Pergunte-se: "Um engenheiro sênior diria que isso está complicado demais?" Se sim, simplifique.

### 3. Mudanças Cirúrgicas

**Toque apenas o que é necessário. Limpe apenas a sua própria bagunça.**

Ao editar código existente:
- Não "melhore" código, comentários ou formatação adjacentes.
- Não refatore o que não está quebrado.
- Combine o estilo existente, mesmo que você faria diferente.
- Se notar código morto não relacionado, mencione — não delete.

Quando suas mudanças criarem órfãos:
- Remova imports/variáveis/funções que AS SUAS mudanças tornaram não utilizados.
- Não remova código morto pré-existente sem ser solicitado.

O teste: cada linha alterada deve ser rastreável diretamente à solicitação do usuário.

### 4. Execução Orientada a Objetivos

**Defina critérios de sucesso. Itere até verificar.**

Transforme tarefas em metas verificáveis:
- "Adicionar validação" → "Escrever testes para entradas inválidas, então fazer passarem"
- "Corrigir o bug" → "Escrever um teste que reproduz, então fazer passar"
- "Refatorar X" → "Garantir que os testes passem antes e depois"

Para tarefas com múltiplos passos, declare um plano breve:
```
1. [Passo] → verificar: [check]
2. [Passo] → verificar: [check]
3. [Passo] → verificar: [check]
```
