# Configuração do Cash Of Anarchy v0.2

Esta versão usa Login com Google e duas categorias de planilha:

- **Planilha da aplicação:** pertence ao administrador e guarda a associação entre usuário e última planilha escolhida.
- **Planilhas dos usuários:** recebem a aba `Lancamentos` e os registros financeiros.

## 1. Criar a planilha da aplicação

1. Crie uma planilha Google chamada, por exemplo, `Cash Of Anarchy - Aplicação`.
2. Copie o ID localizado entre `/d/` e `/edit` na URL.
3. Não crie abas: `Usuarios` será criada automaticamente.

Ela terá as colunas `Google ID`, `E-mail`, `Nome`, `ID da planilha` e `Atualizado em`.

## 2. Criar o Login com Google

1. Abra o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie ou selecione um projeto.
3. Em **Google Auth Platform**, configure a tela de consentimento.
4. Em **Clients**, crie um cliente do tipo **Web application**.
5. Em **Authorized JavaScript origins**, adicione `http://localhost:5173` e `https://dyegohbb.github.io`.
6. Não inclua `/cash-of-anarchy/` na origem.
7. Copie o Client ID terminado em `.apps.googleusercontent.com`.

## 3. Configurar o Apps Script

1. Substitua `Code.gs` pelo arquivo `apps-script/Code.gs` desta versão.
2. Abra **Configurações do projeto → Propriedades do script**.
3. Cadastre:

| Propriedade | Valor |
| --- | --- |
| `APP_SPREADSHEET_ID` | ID da planilha central criada no passo 1 |
| `GOOGLE_CLIENT_ID` | Client ID criado no passo 2 |

`SPREADSHEET_ID` não é mais utilizado.

4. Em **Implantar → Gerenciar implantações**, edite a implantação.
5. Selecione **Nova versão**, execute como **Eu** e permita acesso para **Qualquer pessoa**.
6. Implante e copie novamente a URL `/exec`.

## 4. Configurar o frontend local

Crie ou atualize `.env`:

```env
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec
VITE_GOOGLE_CLIENT_ID=SEU_CLIENT_ID.apps.googleusercontent.com
```

Reinicie `npm run dev` depois de alterar `.env`.

## 5. Configurar o GitHub Pages

Em **Settings → Secrets and variables → Actions → Variables → Repository variables**, cadastre:

| Nome | Valor |
| --- | --- |
| `VITE_APPS_SCRIPT_URL` | URL `/exec` da implantação |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Login com Google |

Depois execute novamente o workflow de publicação.

## 6. Preparar uma planilha de usuário

O Apps Script executa com a conta do administrador. Portanto, cada planilha escolhida precisa estar acessível para essa conta:

1. O usuário abre sua planilha e clica em **Compartilhar**.
2. Adiciona o e-mail da conta proprietária do Apps Script como **Editor**.
3. No Cash Of Anarchy, cola o ID ou a URL da planilha e clica em **Conectar planilha**.

O sistema verifica o acesso, cria `Lancamentos` e salva a associação na planilha da aplicação. No próximo login, o último ID será carregado automaticamente, mas continuará editável.

## Segurança implementada

- Toda escrita exige um ID Token válido do Google.
- A API confere público, emissor, validade e e-mail verificado.
- A identidade é vinculada pelo `sub` estável da conta Google.
- Um lançamento usa somente a planilha previamente salva para o usuário.
- IDs e campos financeiros são validados.
- Tokens não são gravados em planilhas nem persistidos no navegador.

## Limitação importante

Compartilhar como editor concede à conta do Apps Script acesso completo à planilha. Para eliminar esse compartilhamento no futuro, será necessário OAuth individual para a Google Sheets API, uma arquitetura mais complexa.
