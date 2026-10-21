# sandbox-pluggy/ — protótipo isolado (não é o backend do FinFlow)

> ⚠️ Este diretório **não faz parte do aplicativo principal**. É um protótipo de referência,
> mantido separado para testar a integração com a Pluggy (Open Finance) isoladamente,
> antes de portar qualquer coisa para `server.js` na raiz do projeto.

## Diferenças em relação ao backend principal

| | `server.js` (raiz) | `sandbox-pluggy/server.js` |
|---|---|---|
| Porta | 3001 | 3002 |
| Banco de dados | `dev.db` (Prisma + schema versionado) | `sandbox.db` (SQLite direto, via `better-sqlite3`, sem Prisma) |
| Autenticação | JWT real, por usuário (registro/login) | **Nenhuma** — usa um `MOCK_USER_ID` fixo, hardcoded |
| Uso pretendido | Aplicação real | Experimentação/depuração da SDK da Pluggy |

## Por que existe

Serviu para prototipar o fluxo de conexão bancária via Pluggy (Connect Token → widget →
`connect-item` → sync) antes de integrá-lo ao app principal. As rotas de Open Finance de
`server.js` (`/api/pluggy/*`) já incorporam o que foi validado aqui.

## Não use isto

- Em produção.
- Como referência de como a autenticação/autorização deveria funcionar (não há nenhuma).
- Achando que é o servidor que o `npm run dev` sobe — esse é `server.js` na raiz.

Para rodar este protótipo isoladamente (fora do fluxo normal do projeto): `npm run sandbox`
(script definido em `package.json`, sobe só este servidor na porta 3002).
