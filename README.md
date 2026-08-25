# Cash Of Anarchy

MVP gratuito para registrar entradas e saídas em uma planilha Google por uma interface React. O Google Apps Script funciona como a API serverless; nenhuma credencial privada fica no navegador.

## O que já funciona

- botão para criar a aba `Lancamentos` com cabeçalhos e formatação;
- formulário de lançamentos com validação;
- gravação no Google Sheets via Apps Script;
- modo demonstração enquanto a API não está configurada;
- layout responsivo pronto para GitHub Pages ou Vercel.
- tela de acesso por senha, com três tentativas e bloqueio de 15 minutos por navegador;
- inicialização automática da planilha após a senha correta.
- categorias e carteiras carregadas dinamicamente da aba `Configuracoes`;
- competência e data do lançamento;
- lançamentos à vista e parcelados por valor total ou valor da parcela;
- `groupId` único por lançamento, compartilhado por todas as parcelas;
- entradas armazenadas como valores positivos e saídas como valores negativos;
- gerenciamento de recorrências mensais com criação, listagem, edição e status;
- geração incremental protegida pela combinação `recurringId + competência`.

## Rodar o frontend

Requer Node.js 20 ou mais recente.

```bash
npm install
copy .env.example .env
npm run dev
```

No `.env`, configure também a senha de acesso:

```env
VITE_ACCESS_PASSWORD=uma-senha-diferente
```

No GitHub, cadastre `VITE_ACCESS_PASSWORD` em **Settings → Secrets and variables → Actions → Secrets → Repository secrets**. A Action usa esse valor durante a compilação.

> Esta senha é uma barreira de interface, não autenticação segura. Como todo valor `VITE_*` é incorporado ao JavaScript público, uma pessoa com conhecimento técnico consegue descobri-la e também limpar o bloqueio local. Proteção real exige validação no backend.

## Configurar Google Sheets + Apps Script

1. Crie uma planilha no Google Sheets e copie o ID da URL (o texto entre `/d/` e `/edit`).
2. Na planilha, abra **Extensões → Apps Script**.
3. Copie o conteúdo de `apps-script/Code.gs` para o editor e salve.
4. Em **Configurações do projeto → Propriedades do script**, crie `SPREADSHEET_ID` com o ID da planilha.
5. Clique em **Implantar → Nova implantação → Aplicativo da Web**.
6. Execute como **você** e escolha quem pode acessar. Para um frontend público sem login, use **Qualquer pessoa**.
7. Copie a URL terminada em `/exec`, crie `.env` a partir de `.env.example` e preencha `VITE_APPS_SCRIPT_URL`.
8. Reinicie o frontend e entre com a senha. A aplicação inicializará automaticamente as abas `Lancamentos`, `Configuracoes` e `Recorrentes`.

### Aba Configuracoes

A aplicação cria duas colunas:

```text
Carteiras | Categorias
```

Edite as linhas dessa aba para controlar as opções do formulário. Depois, use **Atualizar configurações** no frontend. Carteiras e categorias não ficam hardcoded no navegador.

### Aba Lancamentos

As novas colunas são adicionadas preservando os registros antigos. `Data` é migrada para `Data de inserção`, `Data da compra` para `Data do lançamento` e `purchaseId` para `groupId`. Entradas existentes são normalizadas como positivas e saídas como negativas. Lançamentos parcelados geram uma linha por parcela e reutilizam o mesmo `groupId`.

### Aba Recorrentes

Armazena as regras mensais separadamente dos lançamentos efetivos. Cada regra possui `recurringId`, dados financeiros, início, competência inicial, periodicidade, status e datas de auditoria. Criar uma recorrência não gera lançamentos futuros antecipadamente.

O backend disponibiliza `processarRecorrentes` para processar uma competência quando houver um fluxo de consulta ou fechamento. A chave lógica `recurringId + competência` impede duplicação. Lançamentos gerados têm `ID` e `groupId` próprios e compartilham o `recurringId` da regra.

> Atenção: um site estático público não consegue guardar um segredo. Este MVP limita as ações e valida os campos, mas qualquer pessoa que descubra o endpoint poderá enviar lançamentos. Antes de uso real, adicione autenticação (por exemplo, login Google validado no Apps Script) ou restrinja a implantação à sua conta.

## Publicar

### Vercel (mais simples para este MVP)

Importe o repositório, mantenha o preset Vite e cadastre `VITE_APPS_SCRIPT_URL` nas variáveis do projeto. O comando de build é `npm run build` e a pasta de saída é `dist`.

### GitHub Pages

O projeto já inclui uma GitHub Action que gera e publica o site. No GitHub:

1. Abra **Settings → Secrets and variables → Actions → Variables**.
2. Crie `VITE_APPS_SCRIPT_URL` com a URL `/exec` do Apps Script.
3. Abra **Settings → Pages** e selecione **GitHub Actions** em *Source*.
4. Envie uma alteração para `develop` ou `main`, ou execute manualmente a ação **Publicar no GitHub Pages**.

O endereço padrão será `https://SEU_USUARIO.github.io/cash-of-anarchy/`.

## Próximos passos sugeridos

1. Validar o fluxo frontend → Apps Script → Sheets.
2. Adicionar autenticação antes de expor dados reais.
3. Criar o webhook e os comandos do Telegram no mesmo Apps Script.
4. Só depois adicionar listagem, edição, exclusão e dashboard.

Não coloque token do Telegram, ID secreto ou credenciais em arquivos `VITE_*`: essas variáveis são públicas no navegador.
