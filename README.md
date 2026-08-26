# Cash Of Anarchy

MVP gratuito para registrar entradas e saídas em uma planilha Google por uma interface React. O Google Apps Script funciona como a API serverless; nenhuma credencial privada fica no navegador.

## O que já funciona

- botão para criar a aba `Lancamentos` com cabeçalhos e formatação;
- formulário de lançamentos com validação;
- gravação no Google Sheets via Apps Script;
- modo demonstração enquanto a API não está configurada;
- layout responsivo pronto para GitHub Pages ou Vercel.
- autenticação com conta Google e validação obrigatória do token no Apps Script;
- autorização por lista de e-mails permitidos mantida nas propriedades privadas do Apps Script;
- inicialização automática da planilha após o login autorizado.
- categorias e carteiras carregadas dinamicamente da aba `Configuracoes`;
- competência e data do lançamento;
- lançamentos à vista e parcelados por valor total ou valor da parcela;
- `groupId` único por lançamento, compartilhado por todas as parcelas;
- entradas armazenadas como valores positivos e saídas como valores negativos;
- gerenciamento de recorrências mensais com criação, listagem, edição e status;
- geração incremental protegida pela combinação `recurringId + competência`.
- dashboard inicial por competência com entradas, saídas, saldo, dívidas futuras, categorias, carteiras e planejamento de até 18 competências;
- atalhos no dashboard para novo lançamento, recorrências, sincronização da planilha e sincronização das configurações.

## Rodar o frontend

Requer Node.js 20 ou mais recente.

```bash
npm install
copy .env.example .env
npm run dev
```

No `.env`, configure o Client ID público do Google Identity Services:

```env
VITE_GOOGLE_CLIENT_ID=SEU_CLIENT_ID.apps.googleusercontent.com
```

O Client ID identifica o aplicativo e pode aparecer no navegador; ele não é um segredo. A autorização real acontece no Apps Script, que valida o token assinado pelo Google e o e-mail permitido em todas as operações.

## Configurar o login Google

1. Abra o [Google Cloud Console](https://console.cloud.google.com/) e selecione ou crie um projeto.
2. Configure a **Tela de consentimento OAuth** para uso externo e adicione sua própria conta como usuário de teste, se o aplicativo estiver em modo de testes.
3. Abra **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
4. Escolha **Aplicativo da Web**.
5. Em **Origens JavaScript autorizadas**, adicione `http://localhost:5173` e a origem publicada, por exemplo `https://dyegohbb.github.io`.
6. Copie o Client ID e use o mesmo valor em `VITE_GOOGLE_CLIENT_ID` no frontend e em `GOOGLE_CLIENT_ID` nas propriedades do Apps Script.
7. Nas propriedades do Apps Script, crie `ALLOWED_GOOGLE_EMAILS` com seu e-mail. Para mais de uma conta, separe por vírgulas.

Não crie nem coloque um Client Secret no frontend. Este fluxo usa apenas o Client ID público e o token de identidade assinado pelo Google.

## Configurar Google Sheets + Apps Script

1. Crie uma planilha no Google Sheets e copie o ID da URL (o texto entre `/d/` e `/edit`).
2. Na planilha, abra **Extensões → Apps Script**.
3. Copie o conteúdo de `apps-script/Code.gs` para o editor e salve.
   Copie também `apps-script/appsscript.json` para o manifesto do projeto. Em **Configurações do projeto**, ative **Mostrar o arquivo de manifesto appsscript.json no editor** para conseguir editá-lo.
4. Em **Configurações do projeto → Propriedades do script**, crie:
   - `SPREADSHEET_ID`: ID da planilha;
   - `GOOGLE_CLIENT_ID`: o mesmo Client ID configurado no frontend;
   - `ALLOWED_GOOGLE_EMAILS`: seu e-mail Google autorizado.
5. No editor, selecione a função `authorizeApplication` e clique em **Executar**. Entre com a conta proprietária, avance pela tela de autorização e conceda acesso à planilha e a conexões externas. Essa etapa é necessária uma vez sempre que os escopos forem alterados.
6. Clique em **Implantar → Nova implantação → Aplicativo da Web**.
7. Execute como **você** e escolha **Qualquer pessoa** em quem pode acessar. O endpoint precisa receber o `fetch` do GitHub Pages; cada ação continuará bloqueada até o Apps Script validar o token Google e o e-mail permitido.
8. Copie a URL terminada em `/exec`, crie `.env` a partir de `.env.example` e preencha `VITE_APPS_SCRIPT_URL`.
9. Reinicie o frontend e entre com a conta Google autorizada. A aplicação inicializará automaticamente as abas `Lancamentos`, `Configuracoes` e `Recorrentes`.

### Aba Configuracoes

A aplicação cria duas colunas:

```text
Carteiras | Categorias
```

Edite as linhas dessa aba para controlar as opções do formulário. Depois, use **Sync configuração** no dashboard. Carteiras e categorias não ficam hardcoded no navegador.

### Aba Lancamentos

As novas colunas são adicionadas preservando os registros antigos. `Data` é migrada para `Data de inserção`, `Data da compra` para `Data do lançamento` e `purchaseId` para `groupId`. Entradas existentes são normalizadas como positivas e saídas como negativas. Lançamentos parcelados geram uma linha por parcela e reutilizam o mesmo `groupId`.

### Aba Recorrentes

Armazena as regras mensais separadamente dos lançamentos efetivos. Cada regra possui `recurringId`, dados financeiros, início, competência inicial, periodicidade, status e datas de auditoria. Criar uma recorrência não gera lançamentos futuros antecipadamente.

O backend disponibiliza `processarRecorrentes` para processar uma competência quando houver um fluxo de consulta ou fechamento. A chave lógica `recurringId + competência` impede duplicação. Lançamentos gerados têm `ID` e `groupId` próprios e compartilham o `recurringId` da regra.

> Não selecione **Somente eu** na implantação Web App usada pelo GitHub Pages. Essa opção protege a URL com a sessão web do Google e impede a chamada `fetch` entre os dois domínios. Nesta implementação, o endpoint é alcançável, mas nenhuma leitura ou escrita ocorre sem token Google válido da conta autorizada.

## Publicar

### Vercel (mais simples para este MVP)

Importe o repositório, mantenha o preset Vite e cadastre `VITE_APPS_SCRIPT_URL` e `VITE_GOOGLE_CLIENT_ID` nas variáveis do projeto. O comando de build é `npm run build` e a pasta de saída é `dist`.

### GitHub Pages

O projeto já inclui uma GitHub Action que gera e publica o site. No GitHub:

1. Abra **Settings → Secrets and variables → Actions → Variables**.
2. Crie `VITE_APPS_SCRIPT_URL` com a URL `/exec` do Apps Script e `VITE_GOOGLE_CLIENT_ID` com o Client ID OAuth. Ambas são **Repository variables**.
3. Abra **Settings → Pages** e selecione **GitHub Actions** em *Source*.
4. Envie uma alteração para `develop` ou `main`, ou execute manualmente a ação **Publicar no GitHub Pages**.

O endereço padrão será `https://SEU_USUARIO.github.io/cash-of-anarchy/`.

## Próximos passos sugeridos

1. Validar o fluxo frontend → Apps Script → Sheets.
2. Manter a lista de contas autorizadas e as origens OAuth atualizadas.
3. Criar o webhook e os comandos do Telegram no mesmo Apps Script.
4. Evoluir o dashboard com edição e exclusão de lançamentos.

Não coloque token do Telegram, ID secreto ou credenciais em arquivos `VITE_*`: essas variáveis são públicas no navegador.
