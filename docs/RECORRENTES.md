# Lançamentos recorrentes

## Modelo

A aba `Recorrentes` representa regras persistentes. A aba `Lancamentos` continua armazenando eventos financeiros efetivos.

Cabeçalhos de `Recorrentes`:

```text
recurringId
Descrição
Valor
Tipo
Categoria
Carteira
Data de início
Competência inicial
Periodicidade
Status
Data de criação
Data de atualização
```

`recurringId`, datas de criação e atualização são controlados pelo backend.

## Interface

Na tela principal, **Lançamentos recorrentes** abre uma área com:

- listagem completa;
- status ativa/inativa;
- criação;
- edição;
- retorno para novo lançamento.

Categorias e carteiras usam a mesma aba `Configuracoes` do restante do aplicativo.

## API

### Listar

```json
{ "action": "listarRecorrentes" }
```

### Criar

```json
{
  "action": "adicionarRecorrente",
  "descricao": "Netflix",
  "valor": 59.9,
  "tipo": "Saída",
  "categoria": "Lazer",
  "carteira": "Cartão de crédito 1",
  "dataInicio": "2026-08-10",
  "competenciaInicial": "08/2026",
  "periodicidade": "Mensal",
  "status": "Ativa"
}
```

### Atualizar

Usa os mesmos campos da criação, adicionando:

```json
{
  "action": "atualizarRecorrente",
  "recurringId": "UUID-DA-REGRA"
}
```

### Processar uma competência

```json
{
  "action": "processarRecorrentes",
  "competencia": "08/2026"
}
```

Esta ação não é chamada automaticamente pela tela de cadastro. Ela está preparada para um futuro fluxo de consulta, fechamento ou processamento mensal.

Para cada regra ativa e aplicável à competência:

- verifica `recurringId + competência` em `Lancamentos`;
- ignora a regra se a combinação já existir;
- cria um lançamento à vista se estiver ausente;
- gera um `ID` novo;
- gera um `purchaseId` novo para aquela ocorrência;
- mantém o `recurringId` da regra.

Uma recorrência inativa permanece listada, mas não gera novos lançamentos.

## Periodicidade

Somente `Mensal` é aceita atualmente. A validação usa uma lista própria para permitir novas periodicidades futuramente.

## Compatibilidade

A coluna `recurringId` é acrescentada ao final de `Lancamentos` quando ausente. Registros manuais, compras à vista, compras parceladas e linhas antigas permanecem com o campo vazio.
