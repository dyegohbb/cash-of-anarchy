# Feature Improvement — competências, configurações e parcelamento

## Estrutura no Google Sheets

O `SPREADSHEET_ID` continua apontando para um único arquivo Google Sheets. O Apps Script administra duas abas nesse arquivo:

- `Lancamentos`: registros financeiros e parcelas.
- `Configuracoes`: carteiras e categorias utilizadas pelo frontend.

Na primeira entrada com a senha, as duas abas são criadas ou atualizadas automaticamente.

## Configurações dinâmicas

A aba `Configuracoes` possui:

| Carteiras | Categorias |
| --- | --- |
| Carteira | Alimentação |
| Cartão de crédito 1 | Lazer |

É permitido adicionar, editar ou remover linhas diretamente no Google Sheets. O botão **Atualizar configurações** recarrega as opções no frontend.

## Lançamentos

Novos registros usam as colunas:

```text
ID
groupId
Descrição
Valor
Tipo
Categoria
Carteira
Tipo de pagamento
Parcela
Total de parcelas
Competência
Data do lançamento
Data de inserção
Origem
```

`Data de inserção`, `ID` e `groupId` são gerados no backend e não aparecem como campos editáveis. Valores de entrada são positivos e valores de saída são negativos.

## Parcelamento

- À vista: uma linha e um `groupId` exclusivo.
- Parcelado: uma linha por parcela e um único `groupId` compartilhado.
- Valor da parcela: o valor informado é repetido em todas as parcelas.
- Valor total: o backend divide em centavos e distribui o resto nas primeiras parcelas, garantindo soma exata.
- A competência avança mês a mês, inclusive na troca de ano.

## Compatibilidade

A migração acrescenta colunas ausentes sem descartar registros antigos. `Data` é consolidada em `Data de inserção`, `Data da compra` em `Data do lançamento` e `purchaseId` em `groupId`. Quando as duas versões de uma coluna existem, valores ausentes são recuperados antes da remoção da duplicata. Valores antigos são normalizados pelo campo `Tipo`: `Entrada` positiva e `Saída` negativa. A coluna legada `Forma de pagamento` continua sendo preenchida quando já existir.

## Atualização do Apps Script

Depois do push:

1. Copie novamente `apps-script/Code.gs` para o editor do Apps Script.
2. Salve.
3. Abra **Implantar → Gerenciar implantações**.
4. Edite a implantação e selecione **Nova versão**.
5. Implante novamente mantendo execução como você e acesso para qualquer pessoa.
6. Não altere `SPREADSHEET_ID` nem a URL do frontend se a implantação mantiver a mesma URL `/exec`.
