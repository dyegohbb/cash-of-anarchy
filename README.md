# Cash Of Anarchy

MVP gratuito para registrar entradas e saídas em uma planilha Google por uma interface React. O Google Apps Script funciona como a API serverless; nenhuma credencial privada fica no navegador.

## O que já funciona

- botão para criar a aba `Lancamentos` com cabeçalhos e formatação;
- formulário de lançamentos com validação;
- gravação no Google Sheets via Apps Script;
- modo demonstração enquanto a API não está configurada;
- layout responsivo pronto para GitHub Pages ou Vercel.

## Rodar o frontend

Requer Node.js 20 ou mais recente.

```bash
npm install
copy .env.example .env
npm run dev
```

## Configurar Google Sheets + Apps Script

1. Crie uma planilha no Google Sheets e copie o ID da URL (o texto entre `/d/` e `/edit`).
2. Na planilha, abra **Extensões → Apps Script**.
3. Copie o conteúdo de `apps-script/Code.gs` para o editor e salve.
4. Em **Configurações do projeto → Propriedades do script**, crie `SPREADSHEET_ID` com o ID da planilha.
5. Clique em **Implantar → Nova implantação → Aplicativo da Web**.
6. Execute como **você** e escolha quem pode acessar. Para um frontend público sem login, use **Qualquer pessoa**.
7. Copie a URL terminada em `/exec`, crie `.env` a partir de `.env.example` e preencha `VITE_APPS_SCRIPT_URL`.
8. Reinicie o frontend e clique em **Inicializar planilha**.

> Atenção: um site estático público não consegue guardar um segredo. Este MVP limita as ações e valida os campos, mas qualquer pessoa que descubra o endpoint poderá enviar lançamentos. Antes de uso real, adicione autenticação (por exemplo, login Google validado no Apps Script) ou restrinja a implantação à sua conta.

## Publicar

### Vercel (mais simples para este MVP)

Importe o repositório, mantenha o preset Vite e cadastre `VITE_APPS_SCRIPT_URL` nas variáveis do projeto. O comando de build é `npm run build` e a pasta de saída é `dist`.

### GitHub Pages

O projeto também gera arquivos estáticos. Configure uma GitHub Action para executar `npm ci && npm run build` e publicar a pasta `dist`. Para repositório de projeto, defina a opção `base` do Vite com `/cash-of-anarchy/`.

## Próximos passos sugeridos

1. Validar o fluxo frontend → Apps Script → Sheets.
2. Adicionar autenticação antes de expor dados reais.
3. Criar o webhook e os comandos do Telegram no mesmo Apps Script.
4. Só depois adicionar listagem, edição, exclusão e dashboard.

Não coloque token do Telegram, ID secreto ou credenciais em arquivos `VITE_*`: essas variáveis são públicas no navegador.
