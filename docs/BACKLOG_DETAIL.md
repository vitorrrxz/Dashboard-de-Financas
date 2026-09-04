# FinFlow — Backlog Detalhado (referência técnica)

> Detalhamento completo de cada tarefa do [`TODO.md`](../TODO.md) — Objetivo, Problema, Arquivos, Alterações, Dependências, Validação e Critérios de aceite.
> O `TODO.md` na raiz é o checklist do dia a dia; **antes de implementar uma tarefa `FIN-XXX`, procure o ID aqui** para ver o detalhamento completo.
> Gerado a partir de auditoria do **código real** (não do README) em 2026-09-04.

---

## 🤖 Protocolo para Agentes de Código

1. Sempre ler este `TODO.md` inteiro antes de começar qualquer trabalho.
2. Escolher a primeira tarefa não concluída (`- [ ]`) que não tenha dependências pendentes, respeitando a ordem de prioridade (P0 → P1 → P2 → P3).
3. Não implementar várias tarefas simultaneamente. Uma tarefa por vez, do início ao fim.
4. Ler os arquivos envolvidos por completo antes de alterar qualquer coisa.
5. Não modificar funcionalidades fora do escopo da tarefa sem necessidade comprovada.
6. Preservar a arquitetura existente (React + Vite no frontend, Express + Prisma + SQLite no backend). Não trocar a stack.
7. Executar os testes relevantes após a implementação (`npm test`, quando existir — ver FIN-030/FIN-031).
8. Executar lint e typecheck quando disponíveis: `npm run lint`, `npx tsc -b --noEmit`.
9. Validar o build quando aplicável: `npm run build`.
10. Marcar a tarefa como concluída (`- [x]`) somente depois que **todos** os critérios de aceite forem satisfeitos.
11. Se encontrar um problema novo durante o trabalho, criar uma nova tarefa `FIN-XXX` (próximo ID livre) na seção correta, em vez de resolvê-lo "de passagem".
12. Nunca marcar uma tarefa como concluída apenas porque o código foi alterado — valide de fato.
13. Não remover testes existentes para fazer a suíte passar.
14. Não ignorar erros de TypeScript (nem com `@ts-ignore` desnecessário).
15. Não introduzir secrets no código-fonte.
16. Não alterar o `.env` real do usuário.
17. Não modificar dados reais do banco (`dev.db`) sem necessidade direta da tarefa.

## 🔄 Fluxo de Execução

```text
Selecionar tarefa
       ↓
Verificar dependências
       ↓
Ler arquivos envolvidos
       ↓
Planejar alteração
       ↓
Implementar
       ↓
Executar testes
       ↓
Executar typecheck/lint
       ↓
Validar comportamento
       ↓
Verificar regressões
       ↓
Atualizar TODO.md (marcar [x])
       ↓
Commit
       ↓
Próxima tarefa
```

---

## 📋 Nota sobre o README

O `README.md` afirma que autenticação, dashboard, contas, transações, dívidas e integração Pluggy estão "implementados". A auditoria confirma que o **core** de cada uma dessas áreas de fato existe e funciona, mas encontrou:
- 2 bugs P0 na sincronização Pluggy (fatura não atualiza, tipo de conta incompatível);
- 2 bugs P0 de duplicação em importações manuais (transações e dívidas);
- ausência total de testes automatizados;
- ausência de validação de entrada no backend fora do fluxo de autenticação;
- uso de `Float` para valores monetários;
- sidebar completamente inacessível em mobile.

Classificação por funcionalidade (código como fonte da verdade):

| Funcionalidade | Status | Observação |
|---|---|---|
| Autenticação (registro/login) | ✅ Completo | bcrypt + JWT funcionam corretamente; falta rate limiting (FIN-007) |
| JWT | ⚠️ Parcial | Funciona, mas com secret fallback inseguro (FIN-006) e sem revogação (FIN-012) |
| bcrypt | ✅ Completo | `server.js:63`, custo 10, adequado |
| Isolamento por usuário | ⚠️ Parcial | Todas as queries filtram por `userId` corretamente, mas sem validação de payload (FIN-008) |
| Dashboard | ✅ Completo | Cards, gráficos e filtros funcionam como descrito |
| Contas e Cartões (CRUD) | ✅ Completo | CRUD funcional; edição/exclusão isoladas por usuário |
| Transações — importação CSV | ⚠️ Parcial | Parser funciona bem, mas sem dedupe (FIN-003) e sem edição/exclusão individual (FIN-022) |
| Transações — importação OFX | ⚠️ Parcial | Mesmo caso do CSV — parser robusto, falta dedupe |
| Parcelamentos/Dívidas | ⚠️ Parcial | CRUD e progresso funcionam; `isOverdue` com bug de fuso (FIN-005); import duplica (FIN-004) |
| Pluggy — conexão | ✅ Completo | Widget + `connect-token` + `connect-item` funcionam |
| Pluggy — sincronização | ⚠️ Parcial | Idempotente para transações (usa `pluggyId`), mas não atualiza fatura de cartão (FIN-001) e mapeia tipo de conta incorretamente (FIN-002) |
| Filtros de transações (Todas/Receita/Despesa + busca) | ✅ Completo | Funciona; busca força troca de aba (FIN-040, cosmético) |
| Gráficos (fluxo, categoria) | ✅ Completo | Recharts renderizando corretamente a partir dos dados reais |
| Exclusão em lote de transações | ✅ Completo | `DELETE /api/transactions/bulk`, escopado por `userId` |
| Notificação (sino) | ❌ Ausente | Ícone decorativo sem nenhuma lógica associada (FIN-039) |
| Tema claro | ❌ Ausente | App fixo em modo escuro (`src/index.css`) |
| Testes automatizados | ❌ Ausente | Nenhum framework de teste instalado, nenhum arquivo `*.test.*`/`*.spec.*` |

---

## 0. 🔥 Bugs e Problemas Críticos

- [x] **P0 — FIN-001 — Sincronização Pluggy não atualiza a fatura pendente de cartões de crédito** ✅ Concluída

  **Objetivo**
  Fazer com que `POST /api/pluggy/sync/:itemId` atualize o campo `pendingBill` (e não apenas `balance`) para contas do tipo cartão de crédito, para que o dashboard reflita a fatura real.

  **Problema**
  Em `server.js:357-360`, o sync grava `{ balance: pluggyAcc.balance, name: pluggyAcc.name }`. O dashboard ([App.tsx:244](src/App.tsx#L244)) e o `AccountsManager` ([AccountsManager.tsx:127](src/components/AccountsManager.tsx#L127)) exibem `pendingBill`, não `balance`, para contas `credit`. Resultado: conectar um cartão real via Open Finance nunca atualiza a "Fatura Pendente" mostrada ao usuário — dado financeiro incorreto exibido.

  **Arquivos envolvidos**
  - `server.js`

  **Alterações necessárias**
  - Ao processar `pluggyAcc` com `type` de cartão de crédito (verificar valor real retornado pela Pluggy, ex. `"CREDIT"`), gravar o valor relevante (ex. `pluggyAcc.creditData?.balanceCloseAmount` ou equivalente da SDK) no campo `pendingBill`, e não em `balance`.
  - Para contas não-crédito, manter a gravação em `balance` como está.
  - Tratar o caso em que a Pluggy não retorna dado de fatura (deixar `pendingBill` inalterado, não sobrescrever com `undefined`).

  **Banco de dados**
  Nenhuma alteração de schema — `pendingBill` já existe em `Account` ([schema.prisma:32](prisma/schema.prisma#L32)).

  **Backend**
  Ajustar a rota `POST /api/pluggy/sync/:itemId` (bloco de criação e de atualização de conta).

  **Dependências**
  Nenhuma.

  **Validação**
  - Conectar uma conta sandbox de cartão de crédito via Pluggy e rodar o sync.
  - Conferir no banco (`npx prisma studio` ou query direta) que `pendingBill` foi atualizado.
  - Conferir que o dashboard exibe o valor correto em "Fatura Pendente".

  **Critérios de aceite**
  - [x] `pendingBill` é atualizado a cada sync para contas de crédito conectadas via Pluggy.
  - [x] Contas não-crédito continuam atualizando `balance` normalmente.
  - [x] Nenhuma regressão nos demais campos sincronizados (nome, saldo).

  **Nota de implementação (04/09/2026)**
  A abordagem inicial prevista (inferir a fatura a partir de `pluggyAcc.creditData`) foi trocada por uma mais robusta: a SDK `pluggy-sdk` expõe um endpoint dedicado, `fetchCreditCardBills(accountId)`, que retorna as faturas reais do cartão (`totalAmount`, `dueDate`, `billClosingDate`). O sync agora, para contas com `pluggyAcc.type === 'CREDIT'`, busca essas faturas e grava em `pendingBill` a fatura **mais recentemente fechada** (maior `billClosingDate`, com fallback para `dueDate`) — não a de vencimento mais próximo, que poderia ser uma fatura antiga já superada por uma mais recente (validado com dados reais de sandbox: duas faturas com `totalAmount` 3000 e 5000, a correta é a de 5000, mais recente).

  **Validação executada**
  Ponta a ponta contra o ambiente sandbox real da Pluggy (não apenas leitura de código):
  1. Usado `pluggyClient.createItem(2, { user: 'user-ok', password: 'password-ok' })` (conector sandbox "Pluggy Bank") para gerar um item real com uma conta `BANK` e uma conta `CREDIT` ("Mastercard Black").
  2. Confirmado via `fetchCreditCardBills` que a conta de crédito tem 2 faturas (3000 e 5000, esta última com `billClosingDate` mais recente).
  3. Subido o `server.js` real, registrado um usuário de teste, chamado `POST /api/pluggy/connect-item` e `POST /api/pluggy/sync/:itemId` via HTTP (fluxo idêntico ao que o frontend usa).
  4. Consultado `GET /api/accounts`: a conta "Mastercard Black" (`type: "credit"`) passou de `pendingBill: null` para `pendingBill: 5000` — o valor correto.
  5. Um teste inicial deu falso-negativo por processos `node.exe` órfãos (do MSYS/git-bash) ainda escutando na porta 3001 com código antigo; identificado via `netstat`/`tasklist`, resolvido com `taskkill //F //IM node.exe` antes de repetir o teste do zero.
  - ⚠️ Durante a depuração, `dev.db` foi apagado (`rm -f dev.db`) sem necessidade real da tarefa — violação do protocolo. Foi recuperado com sucesso via `git checkout -- dev.db` (o arquivo estava versionado apesar do `.gitignore`), restaurado byte a byte (151552 bytes, idêntico ao original). Servidor testado novamente após a restauração, sem regressão.

---

- [x] **P0 — FIN-002 — Tipo de conta importado via Pluggy não corresponde ao enum `AccountType` do frontend** ✅ Concluída

  **Objetivo**
  Mapear corretamente o `type` retornado pela Pluggy para um dos valores válidos de `AccountType` (`checking | savings | credit | investment | cash`) antes de gravar no banco.

  **Problema**
  Em `server.js:351` e `server.js:345`, o código faz `type: pluggyAcc.type.toLowerCase()`. A Pluggy retorna tipos como `"BANK"`, `"CREDIT"`, `"INVESTMENT"` etc. `"bank".toLowerCase()` não é nenhum valor de [types.ts:15](src/types.ts#L15). No frontend, `ACCOUNT_TYPE_LABELS[acc.type]` e `ACCOUNT_TYPE_ICONS[acc.type]` ([AccountsManager.tsx:5-19](src/components/AccountsManager.tsx#L5-L19)) ficam `undefined` para esse tipo, quebrando a exibição (rótulo "undefined", possível erro de renderização do ícone).

  **Arquivos envolvidos**
  - `server.js`

  **Alterações necessárias**
  - Criar uma função de mapeamento explícita `mapPluggyAccountType(pluggyType: string): AccountType` no próprio `server.js` (ex.: `BANK`→`checking`, `CREDIT`→`credit`, `INVESTMENT`→`investment`), com fallback seguro para `checking`.
  - Usar essa função nos dois pontos de criação/atualização de conta dentro de `POST /api/pluggy/sync/:itemId`.

  **Banco de dados**
  Nenhuma.

  **Backend**
  Ajustar `server.js` no handler de sync.

  **Dependências**
  Nenhuma.

  **Validação**
  - Sincronizar uma conta sandbox de cada tipo suportado pela Pluggy sandbox e conferir o campo `type` gravado.
  - Verificar visualmente no frontend que ícone e rótulo aparecem corretamente para contas sincronizadas.

  **Critérios de aceite**
  - [x] Toda conta criada via sync Pluggy tem um `type` dentre os 5 valores válidos de `AccountType`.
  - [x] Nenhuma conta sincronizada aparece com rótulo/ícone quebrado no frontend.

  **Nota de implementação (04/09/2026)**
  Investigando o SDK (`node_modules/pluggy-sdk/dist/types/account.d.ts`), confirmou-se que `pluggyAcc.type` só assume dois valores reais: `"BANK"` ou `"CREDIT"` (`ACCOUNT_TYPES = ["BANK", "CREDIT"]`) — não existe um valor `"INVESTMENT"` nesse campo como a descrição original da tarefa supunha. A distinção entre conta corrente e poupança vem de um campo separado, `pluggyAcc.subtype` (`"CHECKING_ACCOUNT"` | `"SAVINGS_ACCOUNT"` | `"CREDIT_CARD"`). A função `mapPluggyAccountType()` criada em `server.js` usa os dois campos: `CREDIT` → `credit`; `BANK` + `subtype === 'SAVINGS_ACCOUNT'` → `savings`; qualquer outro `BANK` → `checking`; fallback → `checking`. Contas de investimento não aparecem em `fetchAccounts` (têm endpoint próprio, `fetchInvestments` — fora do escopo desta tarefa, relacionado a FIN-070).

  **Validação executada**
  Contra o mesmo item sandbox real usado em FIN-001 (`618baddd-...`, conector "Pluggy Bank"), rodado desta vez contra um banco SQLite **isolado** (`DATABASE_URL=file:./test_fin002.db`, arquivo removido ao final) para não repetir o incidente de FIN-001 com `dev.db`. Resultado via `GET /api/accounts` após `sync`: a conta "Conta Corrente" (`BANK`/`CHECKING_ACCOUNT`) passou a vir com `type: "checking"` (antes: `"bank"`, valor inválido); a conta "Mastercard Black" (`CREDIT`) permaneceu `type: "credit"`, com `pendingBill: 5000` (FIN-001 continua funcionando em conjunto). Não havia conta `SAVINGS_ACCOUNT` disponível no item sandbox gerado para testar esse branch especificamente, mas a lógica usa o valor de enum exato documentado no próprio SDK, sem inferência.

---

- [ ] **P0 — FIN-003 — Importação manual de extrato (CSV/OFX) não verifica duplicidade de transações**

  **Objetivo**
  Impedir que reimportar o mesmo extrato (ou um extrato com transações sobrepostas) gere transações duplicadas no banco.

  **Problema**
  `POST /api/transactions` ([server.js:169-189](server.js#L169-L189)) faz `createMany` direto, sem nenhuma checagem de duplicidade. Diferente do fluxo Pluggy (que usa `pluggyId` como chave de idempotência, [server.js:374-403](server.js#L374-L403)), a importação manual não tem nenhum identificador estável — cada linha do CSV/OFX gera um `id` client-side aleatório (`csv-${i}-${Date.now()}` em [parsers.ts:240](src/utils/parsers.ts#L240)) que é descartado no backend. Se o usuário importar o mesmo arquivo duas vezes (erro comum), todas as transações são duplicadas silenciosamente, distorcendo saldo, receitas e despesas.

  **Arquivos envolvidos**
  - `server.js`
  - `src/utils/parsers.ts`
  - `src/App.tsx`

  **Alterações necessárias**
  - Gerar, no parser (`parseCSV`/`parseOFX`), uma chave de deduplicação determinística por transação (ex. hash de `accountId + date + amount + name`, ou usar o `FITID` do OFX quando disponível, já capturado em [parsers.ts:138](src/utils/parsers.ts#L138)).
  - No backend, antes do `createMany`, buscar transações existentes do usuário com a mesma chave (`date`+`amount`+`name`+`accountId`, ou um novo campo `importHash`) e filtrar as que já existem.
  - Retornar ao frontend quantas transações foram ignoradas por duplicidade, e exibir essa informação no `ImportModal`.

  **Banco de dados**
  Avaliar adicionar campo opcional `importHash String?` em `Transaction` (com índice) para tornar a checagem eficiente, em vez de comparar campo a campo.

  **Backend**
  Ajustar `POST /api/transactions` em `server.js` para filtrar duplicatas antes de `createMany`.

  **Frontend**
  Ajustar `ImportModal.tsx` para exibir quantas transações foram importadas vs. ignoradas por duplicidade (usar o retorno da API).

  **Dependências**
  Nenhuma.

  **Validação**
  - Importar um extrato CSV, depois reimportar o mesmo arquivo.
  - Confirmar que a segunda importação não duplica as transações (contagem de transações no banco permanece igual).

  **Critérios de aceite**
  - [ ] Reimportar o mesmo arquivo não cria transações duplicadas.
  - [ ] Importar um arquivo com transações parcialmente novas importa apenas as novas.
  - [ ] Frontend informa ao usuário quantas transações foram ignoradas por duplicidade.

---

- [ ] **P0 — FIN-004 — Reimportar extrato de crédito/PIX parcelado cria uma nova dívida duplicada a cada vez**

  **Objetivo**
  Evitar que a criação automática de dívida a partir de importação (crédito/PIX parcelado) gere dívidas duplicadas quando o mesmo extrato é importado mais de uma vez.

  **Problema**
  Em `App.tsx:110-151` (`handleImport`), toda importação com `paymentType === 'credit' || 'pix_installment'` cria incondicionalmente uma nova `Debt` via `POST /api/debts`. Não há checagem se já existe uma dívida com o mesmo nome/período/conta. Combinado com o FIN-003 (falta de dedupe de transações), reimportar a mesma fatura duplica tanto as transações quanto a dívida "Fatura X – mês/ano" associada.

  **Arquivos envolvidos**
  - `src/App.tsx`

  **Alterações necessárias**
  - Antes de criar a dívida automática, verificar (no estado local `debts` já carregado) se já existe uma dívida com o mesmo `name` (`Fatura {banco} – {mês/ano}`) e `accountId`.
  - Se existir, não criar uma nova — em vez disso, perguntar ao usuário (ou, na primeira versão, simplesmente pular a criação e avisar via `alert`) e permitir seguir apenas com a criação de transações (que já terão sido deduplicadas por FIN-003).

  **Dependências**
  FIN-003 (a dedupe de transações deve existir primeiro, para que o cenário de reimportação seja tratado de forma consistente ponta a ponta).

  **Validação**
  - Importar um extrato de crédito duas vezes.
  - Confirmar que apenas uma dívida "Fatura X – mês/ano" existe após as duas importações.

  **Critérios de aceite**
  - [ ] Reimportar o mesmo extrato de crédito/PIX parcelado não cria uma segunda dívida para o mesmo período/conta.
  - [ ] O usuário é avisado quando uma importação repetida é detectada.

---

- [ ] **P1 — FIN-005 — Cálculo de "dívida vencida" inconsistente e com risco de bug de fuso horário**

  **Objetivo**
  Unificar e corrigir a lógica de detecção de dívida vencida.

  **Problema**
  Existem duas implementações diferentes:
  - `App.tsx:247`: `d.nextDueDate < today && d.paidInstallments < d.totalInstallments` — comparação de strings ISO (`YYYY-MM-DD`), correta e livre de fuso horário.
  - `DebtManager.tsx:153`: `isOverdue = (d) => !isPaid(d) && new Date(d.nextDueDate) < new Date()` — compara objetos `Date`. `new Date('2026-09-04')` é interpretado como UTC 00:00; comparado a `new Date()` (hora local), isso pode marcar uma dívida como vencida (ou não) incorretamente dependendo do fuso horário e horário do dia, de forma diferente do que o Dashboard mostra.

  **Arquivos envolvidos**
  - `src/App.tsx`
  - `src/components/DebtManager.tsx`

  **Alterações necessárias**
  - Extrair a lógica de "dívida vencida" para uma função utilitária única baseada em comparação de strings ISO (o método já usado em `App.tsx`, que é seguro), por exemplo em um novo arquivo `src/utils/debts.ts`.
  - Substituir a lógica de `App.tsx:247` e `DebtManager.tsx:153` para usarem essa função compartilhada.

  **Dependências**
  Nenhuma.

  **Validação**
  - Criar uma dívida com vencimento em uma data específica e verificar que o badge "Vencida" aparece de forma consistente entre o alerta do Dashboard e o card em Dívidas, incluindo em horários próximos à meia-noite.

  **Critérios de aceite**
  - [ ] Existe uma única função para determinar se uma dívida está vencida.
  - [ ] `App.tsx` e `DebtManager.tsx` usam essa função.
  - [ ] Nenhuma dependência de fuso horário local na comparação.

---

## 1. 🔐 Segurança

- [x] **P0 — FIN-006 — CRITICAL — `JWT_SECRET` com fallback inseguro hardcoded no código** ✅ Concluída

  **Objetivo**
  Impedir que o servidor rode com um segredo JWT previsível/público.

  **Problema**
  `server.js:21`: `const JWT_SECRET = process.env.JWT_SECRET || 'chave_secreta_finance_app';`. Se a variável de ambiente não estiver definida (erro de deploy, por exemplo), o servidor assina e valida tokens com uma string fixa presente no código-fonte público do repositório — qualquer pessoa pode forjar tokens JWT válidos para qualquer `userId`.

  **Arquivos envolvidos**
  - `server.js`

  **Alterações necessárias**
  - Remover o fallback. Ao iniciar, validar que `process.env.JWT_SECRET` existe e tem tamanho mínimo razoável (ex. 32 caracteres); caso contrário, lançar erro e impedir o boot do servidor com uma mensagem clara.

  **Dependências**
  Nenhuma.

  **Validação**
  - Remover temporariamente `JWT_SECRET` de um `.env` de teste e confirmar que `node server.js` falha ao iniciar com mensagem explicativa.
  - Com `JWT_SECRET` definido, confirmar que o servidor inicia e login/registro continuam funcionando.

  **Critérios de aceite**
  - [ ] Servidor não inicia sem `JWT_SECRET` configurado.
  - [ ] Nenhum valor de segredo hardcoded permanece no código.
  - [ ] Fluxo de login/registro funciona normalmente com o `.env` correto.

---

- [ ] **P1 — HIGH — FIN-007 — Rotas de autenticação sem rate limiting (força bruta)**

  **Objetivo**
  Limitar tentativas de login/registro por IP para mitigar ataques de força bruta e enumeração.

  **Problema**
  `POST /api/auth/login` e `POST /api/auth/register` ([server.js:46-97](server.js#L46-L97)) não têm nenhum limite de tentativas. Um atacante pode tentar senhas indefinidamente contra um e-mail conhecido.

  **Arquivos envolvidos**
  - `server.js`
  - `package.json`

  **Alterações necessárias**
  - Adicionar dependência `express-rate-limit`.
  - Aplicar um limiter (ex. 10 tentativas por 15 minutos por IP) especificamente nas rotas `/api/auth/login` e `/api/auth/register`.

  **Backend**
  Middleware aplicado apenas às rotas de auth, para não afetar performance das demais rotas.

  **Dependências**
  Nenhuma.

  **Validação**
  - Disparar mais de N requisições de login inválidas seguidas e confirmar resposta `429`.
  - Confirmar que login legítimo continua funcionando dentro do limite.

  **Critérios de aceite**
  - [ ] Excesso de tentativas de login/registro retorna `429 Too Many Requests`.
  - [ ] Limite não afeta uso normal do app.

---

- [ ] **P1 — HIGH — FIN-008 — Nenhuma validação de payload no backend para accounts/transactions/debts**

  **Objetivo**
  Validar e sanear os dados recebidos nas rotas de CRUD antes de persistir no banco.

  **Problema**
  Diferente de `/api/auth/register` (que valida nome/email/senha manualmente, [server.js:46-57](server.js#L46-L57)), as rotas `POST/PUT /api/accounts`, `POST /api/transactions` e `POST/PUT /api/debts` ([server.js:117-260](server.js#L117-L260)) fazem `{ ...req.body, userId }` direto para o Prisma, sem validar tipos, campos obrigatórios, valores negativos indevidos (ex. `totalInstallments <= 0`) ou tamanho de strings. Um cliente com bug (ou mal-intencionado) pode gravar dados financeiros inconsistentes que quebram cálculos no frontend (ex. divisão por `totalInstallments = 0` em [DebtManager.tsx:151](src/components/DebtManager.tsx#L151)).

  **Arquivos envolvidos**
  - `server.js`
  - `package.json`

  **Alterações necessárias**
  - Adicionar uma biblioteca de validação leve (ex. `zod`).
  - Criar schemas de validação para os payloads de Account, Transaction e Debt (create e update).
  - Aplicar a validação no início de cada rota correspondente, retornando `400` com mensagem clara em caso de payload inválido.

  **Backend**
  Validar especialmente: `totalInstallments >= 1`, `totalAmount >= 0`, `name`/`bank`/`category` não vazios, `type` dentro do enum aceito.

  **Dependências**
  Nenhuma.

  **Validação**
  - Enviar requisições com payloads inválidos (ex. `totalInstallments: 0`, `name: ""`) e confirmar `400` com mensagem descritiva.
  - Confirmar que payloads válidos continuam funcionando sem regressão.

  **Critérios de aceite**
  - [ ] Todas as rotas de CRUD financeiro validam o payload antes de tocar o banco.
  - [ ] Payloads inválidos retornam `400` com mensagem clara, nunca `500`.
  - [ ] Nenhuma regressão nos fluxos existentes do frontend.

---

- [ ] **P2 — MEDIUM — FIN-009 — CORS totalmente aberto sem allowlist de origem**

  **Objetivo**
  Restringir CORS às origens conhecidas do frontend.

  **Problema**
  `server.js:13`: `app.use(cors());` aceita requisições de qualquer origem. Como a autenticação é via header `Authorization: Bearer`, o risco prático de CSRF é baixo, mas CORS aberto facilita abuso da API por sites de terceiros caso um token vaze (ex. via XSS).

  **Arquivos envolvidos**
  - `server.js`
  - `.env` / `.env.example`

  **Alterações necessárias**
  - Configurar `cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' })`.
  - Documentar a nova variável `FRONTEND_URL` no `.env.example`.

  **Dependências**
  Nenhuma.

  **Validação**
  - Confirmar que o app em `localhost:5173` continua funcionando normalmente.
  - Confirmar (via `curl -H "Origin: http://evil.com"`) que outra origem não recebe os headers de CORS liberando a resposta.

  **Critérios de aceite**
  - [ ] Apenas a origem configurada consegue fazer requisições cross-origin bem-sucedidas.
  - [ ] App em desenvolvimento continua funcionando sem alteração de fluxo.

---

- [ ] **P2 — MEDIUM — FIN-010 — Ausência de cabeçalhos de segurança HTTP**

  **Objetivo**
  Adicionar cabeçalhos de segurança padrão (X-Content-Type-Options, X-Frame-Options, etc.) à API.

  **Problema**
  `server.js` não usa `helmet` nem define nenhum cabeçalho de segurança manualmente.

  **Arquivos envolvidos**
  - `server.js`
  - `package.json`

  **Alterações necessárias**
  - Adicionar dependência `helmet`.
  - Aplicar `app.use(helmet())` logo após a criação do `app`.

  **Dependências**
  Nenhuma.

  **Validação**
  - Confirmar via `curl -I` que os cabeçalhos de segurança padrão do helmet estão presentes nas respostas.
  - Confirmar que o frontend continua funcionando sem bloqueios inesperados (CSP não deve quebrar o app — se necessário, desabilitar CSP do helmet nesta etapa e tratar CSP em tarefa futura).

  **Critérios de aceite**
  - [ ] Respostas da API incluem os cabeçalhos de segurança padrão do helmet.
  - [ ] Nenhuma regressão funcional no frontend.

---

- [ ] **P2 — MEDIUM — FIN-011 — Mensagens de erro expõem detalhes internos do Prisma ao cliente**

  **Objetivo**
  Parar de retornar `error.message`/`err.message` bruto do Prisma/Node para o cliente em respostas de erro.

  **Problema**
  Praticamente todas as rotas retornam `res.status(500).json({ error: err.message })` (ex. [server.js:113](server.js#L113), [server.js:124](server.js#L124), etc.), o que pode vazar detalhes de schema, nomes de coluna ou mensagens internas do Prisma para o cliente.

  **Arquivos envolvidos**
  - `server.js`

  **Alterações necessárias**
  - Criar um middleware de tratamento de erro central (ou uma função helper) que loga o erro completo no servidor (`console.error`) e retorna ao cliente uma mensagem genérica (`"Erro interno do servidor"`), preservando apenas mensagens de validação de negócio (ex. as validações manuais de auth) como estão.

  **Dependências**
  Nenhuma (idealmente executada em conjunto com FIN-008, mas não bloqueante).

  **Validação**
  - Forçar um erro (ex. desconectar o banco temporariamente) e confirmar que a resposta ao cliente não contém stack trace nem mensagem interna do Prisma.
  - Confirmar que o erro completo continua aparecendo no log do servidor para debug.

  **Critérios de aceite**
  - [ ] Nenhuma rota retorna mensagem de erro interna (Prisma/Node) diretamente ao cliente.
  - [ ] Erros continuam logados no servidor para investigação.

---

- [ ] **P2 — MEDIUM — FIN-012 — Token JWT sem mecanismo de revogação/logout server-side**

  **Objetivo**
  Documentar/mitigar o fato de que tokens JWT de 7 dias não podem ser invalidados antes de expirar.

  **Problema**
  O "logout" ([App.tsx:62-69](src/App.tsx#L62-L69)) apenas remove o token do `localStorage` no cliente. Se um token vazar (ex. dispositivo comprometido), ele continua válido no servidor por até 7 dias, sem forma de revogá-lo.

  **Arquivos envolvidos**
  - `server.js`
  - `prisma/schema.prisma`

  **Alterações necessárias**
  - Opção recomendada para o estágio atual do projeto: reduzir a validade do token (ex. 24h) e reavaliar necessidade de refresh token em uma tarefa de roadmap futura, já que uma blocklist de tokens exige nova tabela e verificação em toda requisição autenticada (custo/benefício maior).
  - Registrar esta decisão explicitamente no código (comentário) e neste TODO caso a mitigação completa (blocklist/refresh token) seja adiada.

  **Dependências**
  Nenhuma.

  **Validação**
  - Confirmar que tokens emitidos após a mudança expiram no novo prazo definido.

  **Critérios de aceite**
  - [ ] Prazo de expiração do token revisado e documentado.
  - [ ] Decisão sobre blocklist/refresh token registrada (implementada ou formalmente adiada como item de roadmap).

---

- [ ] **P3 — LOW — FIN-013 — E-mail não normalizado permite cadastro "duplicado" por variação de maiúsculas/minúsculas**

  **Objetivo**
  Normalizar e-mails (lowercase + trim) antes de checar unicidade e salvar.

  **Problema**
  `server.js:52` valida apenas `email.includes('@')`, sem normalizar. `Usuario@Gmail.com` e `usuario@gmail.com` são tratados como e-mails diferentes pelo `@unique` do Prisma ([schema.prisma:12](prisma/schema.prisma#L12)), permitindo dois cadastros para o mesmo endereço real.

  **Arquivos envolvidos**
  - `server.js`

  **Alterações necessárias**
  - Normalizar `email = email.trim().toLowerCase()` em `/api/auth/register` e `/api/auth/login` antes de qualquer consulta/gravação.

  **Dependências**
  Nenhuma.

  **Validação**
  - Cadastrar com `Teste@Email.com`, tentar cadastrar novamente com `teste@email.com` e confirmar que é rejeitado como duplicado.
  - Fazer login com capitalização diferente da usada no cadastro e confirmar sucesso.

  **Critérios de aceite**
  - [ ] E-mails são normalizados antes de checagem de unicidade e login.
  - [ ] Não é mais possível ter duas contas para o mesmo e-mail em capitalizações diferentes.

---

- [ ] **P3 — LOW — FIN-014 — Enumeração de e-mails cadastrados via mensagem de erro do registro**

  **Objetivo**
  Reduzir a capacidade de um atacante descobrir quais e-mails já estão cadastrados.

  **Problema**
  `server.js:61`: `if (existingUser) return res.status(400).json({ error: 'Email já cadastrado.' });` — resposta distinta permite enumerar e-mails válidos no sistema. É um risco baixo (não há dado sensível vazado além do fato de existir conta), mas vale registrar como trade-off consciente.

  **Arquivos envolvidos**
  - `server.js`

  **Alterações necessárias**
  - Avaliar, junto ao time, se o UX de "Email já cadastrado" (necessário para o fluxo de registro) compensa o risco. Se optar por manter (recomendado para este produto — não é um alvo de alto risco), apenas documentar a decisão aqui.
  - Se decidir mitigar, considerar rate limiting adicional específico neste endpoint (complementar ao FIN-007).

  **Dependências**
  FIN-007 (rate limiting já mitiga o principal vetor de abuso).

  **Validação**
  Não aplicável além da revisão de decisão.

  **Critérios de aceite**
  - [ ] Decisão documentada (manter mensagem específica ou genérica) e, se manter, FIN-007 confirmado como mitigação suficiente.

---

## 2. 💰 Integridade Financeira

- [ ] **P1 — FIN-015 — Migrar campos monetários de `Float` para representação segura (inteiro em centavos)**

  **Objetivo**
  Eliminar o risco de erro de arredondamento em ponto flutuante nos cálculos financeiros.

  **Problema**
  `prisma/schema.prisma` usa `Float` para `Account.balance/limit/pendingBill`, `Transaction.amount` e todos os campos monetários de `Debt`/`DebtItem`. Operações repetidas de soma/subtração (ex. `paidAmount + monthlyPayment` em [DebtManager.tsx:123](src/components/DebtManager.tsx#L123), ou os `reduce` de soma de transações em [App.tsx:215-216](src/App.tsx#L215-L216)) acumulam erro de ponto flutuante ao longo do tempo (ex. `0.1 + 0.2 !== 0.3`).

  **Problema adicional**
  SQLite não possui tipo `Decimal` nativo bem suportado — a alternativa mais segura e portável é armazenar valores monetários como **inteiros em centavos** (`Int`) e converter para reais apenas na camada de apresentação.

  **Arquivos envolvidos**
  - `prisma/schema.prisma`
  - `server.js`
  - `src/App.tsx`, `src/components/AccountsManager.tsx`, `src/components/DebtManager.tsx`, `src/components/ImportModal.tsx`
  - `src/utils/parsers.ts`

  **Alterações necessárias**
  - **Esta é uma migração grande — dividir em subtarefas antes de iniciar** (ver `FIN-015a` a `FIN-015d` abaixo). Não implementar tudo de uma vez.

  **Banco de dados**
  Alterar todos os campos monetários (`Account.balance/limit/pendingBill`, `Transaction.amount`, `Debt.totalAmount/paidAmount/monthlyPayment`, `DebtItem.amount`) de `Float` para `Int` (centavos), com migration de conversão dos dados existentes (`valor_reais * 100`, arredondado).

  **Dependências**
  Nenhuma, mas deve ser feita **antes** de qualquer nova feature financeira relevante (orçamento, metas, relatórios) para não herdar o problema.

  **Validação**
  - Rodar `npx prisma generate` e `npx prisma db push`/migration.
  - Conferir que todos os valores existentes em `dev.db` foram convertidos corretamente (comparar amostra antes/depois).
  - Rodar a suíte de testes financeiros (depende de FIN-034).

  **Critérios de aceite**
  - [ ] Todos os campos monetários no schema são `Int` (centavos).
  - [ ] Toda leitura/escrita no frontend converte corretamente centavos ↔ reais.
  - [ ] Nenhuma regressão visual nos valores exibidos.
  - [ ] Testes financeiros (FIN-034) cobrindo somas repetidas passam sem erro de arredondamento.

  ---

  - [ ] **FIN-015a — Definir estratégia de conversão e criar utilitário `centavos ↔ reais`**
    Criar `src/utils/money.ts` com `toCents(reais: number): number` e `toReais(cents: number): number`, com testes unitários (depende FIN-030).

  - [ ] **FIN-015b — Migrar schema Prisma e dados existentes para centavos**
    Alterar `prisma/schema.prisma`, escrever script de migração de dados de `dev.db`, validar contra backup do banco atual.

  - [ ] **FIN-015c — Atualizar `server.js` para trabalhar em centavos** (nenhuma alteração de lógica, apenas tipo — Prisma já retorna `Int`).

  - [ ] **FIN-015d — Atualizar frontend para converter centavos↔reais em todos os pontos de entrada/exibição**
    `App.tsx`, `AccountsManager.tsx`, `DebtManager.tsx`, `ImportModal.tsx`, `parsers.ts` (parsers devem seguir retornando reais e a conversão para centavos deve acontecer no ponto de envio à API).

---

- [ ] **P2 — FIN-016 — Centralizar lógica de "dívida vencida" (depende de FIN-005)**

  Já coberta integralmente pela tarefa **FIN-005**. Mantida aqui apenas como referência cruzada da seção de Integridade Financeira — não duplicar o trabalho.

  **Dependências:** FIN-005

---

- [ ] **P2 — FIN-017 — Tornar operações em lote de dívidas resilientes a falha parcial**

  **Objetivo**
  Evitar estado inconsistente quando "Pagar todas as parcelas" ou "Excluir todas as dívidas" falha no meio da execução.

  **Problema**
  `DebtManager.tsx:243-285` (`handlePayAll`, `handleDeleteAll`) fazem um loop de chamadas `await onUpdate(...)`/`await onDelete(...)` sequenciais. Se a chamada N falhar (ex. rede cai), as dívidas `1..N-1` já foram alteradas/excluídas e as demais não — o usuário recebe apenas um `alert` genérico, sem saber quais itens foram afetados.

  **Arquivos envolvidos**
  - `src/components/DebtManager.tsx`

  **Alterações necessárias**
  - Trocar o loop sequencial por `Promise.allSettled`, coletando sucessos e falhas.
  - Exibir ao usuário um resumo claro: quantas dívidas foram processadas com sucesso e quais falharam (com nome da dívida), permitindo tentar novamente apenas as que falharam.

  **Dependências**
  Nenhuma.

  **Validação**
  - Simular falha de uma requisição no meio do lote (ex. desconectando a rede momentaneamente ou mockando erro) e confirmar que o resumo exibido é preciso.

  **Critérios de aceite**
  - [ ] Falha em um item do lote não interrompe o processamento dos demais.
  - [ ] Usuário vê claramente quais itens falharam.

---

- [ ] **P3 — FIN-018 — Separar "Saldo Real" de saldo de contas de investimento no dashboard**

  **Objetivo**
  Diferenciar liquidez imediata (conta corrente/poupança/dinheiro) de saldo em investimentos no card "Saldo Real (Contas)".

  **Problema**
  `App.tsx:243`: `stats.realBalance` soma todas as contas com `type !== 'credit'`, incluindo `investment`. Isso mistura dinheiro disponível com capital investido (potencialmente não líquido), o que pode enganar o usuário sobre quanto ele realmente tem disponível para gastar.

  **Arquivos envolvidos**
  - `src/App.tsx`

  **Alterações necessárias**
  - Calcular `realBalance` excluindo também `type === 'investment'`.
  - Adicionar um novo indicador (card ou linha secundária) mostrando o total em investimentos separadamente.

  **Dependências**
  Nenhuma. (Pode ser reavaliada junto com FIN-070/FIN-073, quando o módulo de Investimentos for implementado.)

  **Validação**
  - Cadastrar uma conta do tipo Investimento com saldo e confirmar que ela não é mais somada ao "Saldo Real (Contas)", aparecendo separadamente.

  **Critérios de aceite**
  - [ ] "Saldo Real" reflete apenas contas líquidas (corrente, poupança, dinheiro).
  - [ ] Saldo de investimentos é exibido separadamente, sem ser removido da visão geral.

---

## 3. 🗄️ Banco de Dados

- [ ] **P2 — FIN-019 — Adicionar índices compostos para consultas por usuário**

  **Objetivo**
  Melhorar a performance das consultas mais frequentes, todas filtradas por `userId`.

  **Problema**
  `prisma/schema.prisma` não define nenhum `@@index`. Toda rota de listagem filtra por `userId` (e `Transaction` também ordena por `date`), sem índice dedicado — aceitável com poucos dados, mas se torna lento à medida que a base cresce.

  **Arquivos envolvidos**
  - `prisma/schema.prisma`

  **Alterações necessárias**
  - Adicionar `@@index([userId])` em `Account` e `Debt`.
  - Adicionar `@@index([userId, date])` em `Transaction` (cobre o `orderBy: { date: 'desc' }` de [server.js:160](server.js#L160)).
  - Adicionar `@@index([userId, pluggyId])` em `Account` e `Transaction` (usado nas buscas de idempotência do sync Pluggy, [server.js:300](server.js#L300), [server.js:375](server.js#L375)).

  **Banco de dados**
  Alteração de schema + `npx prisma generate` (+ migration/`db push`).

  **Dependências**
  Nenhuma.

  **Validação**
  - Executar `npx prisma generate`.
  - Confirmar que a aplicação inicia normalmente e as rotas de listagem continuam funcionando.

  **Critérios de aceite**
  - [ ] Índices criados conforme especificado.
  - [ ] Prisma Client atualizado sem erros.
  - [ ] Nenhuma regressão nos endpoints de transações/contas/dívidas.

---

- [ ] **P2 — FIN-020 — Adotar histórico de migrations do Prisma em vez de apenas `db push`**

  **Objetivo**
  Ter um histórico versionado e reproduzível das mudanças de schema, em vez de depender apenas de `prisma db push` (que não gera migrations).

  **Problema**
  Não existe pasta `prisma/migrations`. O README e o `prisma.config.ts` ([prisma.config.ts:8-10](prisma.config.ts#L8-L10)) já apontam um caminho de migrations, mas ele nunca foi usado — todo setup depende de `db push`, que não é adequado para produção (não versiona alterações, pode causar perda de dados em mudanças destrutivas sem aviso).

  **Arquivos envolvidos**
  - `prisma/schema.prisma`
  - `prisma/migrations/` (novo)
  - `README.md`

  **Alterações necessárias**
  - Rodar `npx prisma migrate dev --name init` para gerar a primeira migration a partir do schema atual.
  - Atualizar o README trocando as instruções de `npx prisma db push` para `npx prisma migrate dev`.
  - Versionar a pasta `prisma/migrations` no Git (não deve estar no `.gitignore`).

  **Dependências**
  Idealmente executada **depois** de FIN-015b (migração de valores monetários) e FIN-019 (índices), para que a primeira migration formal já capture o schema final dessas mudanças.

  **Validação**
  - Rodar `npx prisma migrate dev` em um banco limpo e confirmar que o schema resultante é idêntico ao gerado hoje por `db push`.

  **Critérios de aceite**
  - [ ] Pasta `prisma/migrations` existe, versionada, com a migration inicial.
  - [ ] README atualizado com o novo fluxo de setup.
  - [ ] Banco criado do zero via migration funciona identicamente ao atual.

---

- [ ] **P2 — FIN-021 — Adicionar constraint de unicidade `(userId, pluggyId)` em `Account` e `Transaction`**

  **Objetivo**
  Reforçar a idempotência da sincronização Pluggy a nível de banco, não apenas de aplicação.

  **Problema**
  Hoje a idempotência do sync ([server.js:300](server.js#L300), [server.js:375](server.js#L375)) depende inteiramente de um `findFirst` antes de cada `create` — sujeito a condição de corrida se duas sincronizações rodarem em paralelo (ex. usuário clica duas vezes rápido em "Sincronizar").

  **Arquivos envolvidos**
  - `prisma/schema.prisma`
  - `server.js`

  **Alterações necessárias**
  - Adicionar `@@unique([userId, pluggyId])` em `Account` e `Transaction` (campo `pluggyId` já existe e é opcional — a constraint deve permitir múltiplos `null`, comportamento padrão do SQLite/Prisma para índices únicos com valor nulo).
  - Ajustar `server.js` para usar `upsert` (com a chave composta) em vez do padrão atual `findFirst` + `create`/`updateMany`, aproveitando a constraint.

  **Banco de dados**
  Alteração de schema + migration.

  **Dependências**
  FIN-020 (para que esta mudança já entre versionada como migration, não via `db push`).

  **Validação**
  - Disparar duas sincronizações do mesmo item em paralelo (ex. dois cliques rápidos) e confirmar que não há contas/transações duplicadas.

  **Critérios de aceite**
  - [ ] Constraint única criada no schema.
  - [ ] Sync usa `upsert` com a chave composta.
  - [ ] Sincronizações concorrentes não geram duplicatas.

---

## 4. 🔌 Backend / API

- [ ] **P1 — FIN-022 — Criar endpoints `PUT`/`DELETE` para transação individual**

  **Objetivo**
  Permitir editar ou excluir uma única transação — hoje só é possível criar (em lote) e excluir tudo (`/api/transactions/bulk`).

  **Problema**
  `server.js` define `GET`, `POST` e `DELETE /bulk` para `/api/transactions` ([server.js:156-198](server.js#L156-L198)), mas não existe `PUT /api/transactions/:id` nem `DELETE /api/transactions/:id`. Um usuário que importa um extrato com uma categoria errada, ou quer remover uma única transação incorreta, não tem como fazê-lo sem apagar todo o histórico.

  **Arquivos envolvidos**
  - `server.js`
  - `src/App.tsx`
  - `src/App.tsx` (`TxTable`, componente de tabela de transações)

  **Alterações necessárias**
  - Adicionar `PUT /api/transactions/:id` (mesmo padrão de `PUT /api/accounts/:id`, com `updateMany({ where: { id, userId } })` para manter isolamento).
  - Adicionar `DELETE /api/transactions/:id` (mesmo padrão de `DELETE /api/accounts/:id`).
  - No frontend, adicionar ação de editar/excluir por linha na tabela de transações (`TxTable`, em `App.tsx`), com um pequeno modal de edição reaproveitando o padrão de `FormField` já usado em `AccountsManager`/`DebtManager`.

  **Backend**
  Novas rotas em `server.js`, seguindo o padrão de autorização já usado nas demais rotas (`authenticateToken` + filtro por `userId`).

  **Frontend**
  Novo estado de edição na tabela de transações + chamada à API.

  **Dependências**
  FIN-008 (validação de payload) deve cobrir também estas novas rotas.

  **Validação**
  - Editar uma transação existente e confirmar que a alteração persiste após reload.
  - Excluir uma transação individual e confirmar que apenas ela desaparece.
  - Tentar editar/excluir uma transação de outro usuário (via id manipulado) e confirmar que retorna erro/no-op, nunca sucesso.

  **Critérios de aceite**
  - [ ] `PUT /api/transactions/:id` e `DELETE /api/transactions/:id` existem, autenticados e isolados por usuário.
  - [ ] Frontend permite editar e excluir transações individualmente.
  - [ ] Nenhuma regressão nas rotas de listagem/criação em lote.

---

- [ ] **P2 — FIN-023 — Implementar paginação real em `GET /api/transactions`**

  **Objetivo**
  Substituir o limite fixo `take: 2000` por paginação real baseada em cursor ou offset.

  **Problema**
  `server.js:161`: `take: 2000` — usuários com mais de 2000 transações simplesmente deixam de ver as mais antigas na listagem, sem nenhuma indicação de que há mais dados, e sem forma de navegar até elas.

  **Arquivos envolvidos**
  - `server.js`
  - `src/App.tsx`

  **Alterações necessárias**
  - Adicionar suporte a `?page=`/`?cursor=` e `?pageSize=` em `GET /api/transactions`, retornando também o total de registros.
  - Ajustar o frontend para paginar a tabela de transações (ou usar scroll infinito), em vez de assumir que todas as transações vêm em uma única resposta.

  **Dependências**
  Nenhuma.

  **Validação**
  - Popular o banco com mais de 2000 transações de teste e confirmar que todas ficam acessíveis via paginação.

  **Critérios de aceite**
  - [ ] API suporta paginação com parâmetros documentados.
  - [ ] Frontend consegue acessar transações além das primeiras 2000.
  - [ ] Nenhuma regressão de performance perceptível na primeira página.

---

- [ ] **P3 — FIN-024 — Adicionar script `typecheck` dedicado no `package.json`**

  **Objetivo**
  Facilitar a checagem de tipos isolada (sem build completo), útil para o protocolo de validação dos agentes (item 8 do Protocolo).

  **Problema**
  `package.json` não tem um script `typecheck` — apenas `build` (`tsc -b && vite build`), que mistura checagem de tipos com bundling.

  **Arquivos envolvidos**
  - `package.json`

  **Alterações necessárias**
  - Adicionar `"typecheck": "tsc -b --noEmit"` aos `scripts`.

  **Dependências**
  Nenhuma.

  **Validação**
  - Rodar `npm run typecheck` e confirmar que ele reporta os mesmos erros de tipo que `npm run build` reportaria na etapa de `tsc`, sem gerar output.

  **Critérios de aceite**
  - [ ] `npm run typecheck` existe e funciona.
  - [ ] `npm run build` continua funcionando normalmente.

---

## 5. 🖥️ Frontend

- [ ] **P1 — FIN-025 — Centralizar a base URL da API (hoje hardcoded em 3 arquivos)**

  **Objetivo**
  Eliminar a URL `http://localhost:3001` hardcoded, hoje duplicada em três lugares diferentes, para permitir rodar o frontend contra outro host (staging, produção) sem editar código.

  **Problema**
  A string `http://localhost:3001` aparece hardcoded em [App.tsx:47](src/App.tsx#L47), [AuthForm.tsx:25](src/components/AuthForm.tsx#L25) e [PluggyConnectButton.tsx:44](src/components/PluggyConnectButton.tsx#L44). Isso impede qualquer deploy do frontend separado do backend sem editar código-fonte, e é uma duplicação clara de lógica.

  **Arquivos envolvidos**
  - `src/App.tsx`
  - `src/components/AuthForm.tsx`
  - `src/components/PluggyConnectButton.tsx`
  - `vite.config.ts` (ou um novo `.env`/`import.meta.env`)

  **Alterações necessárias**
  - Criar uma variável de ambiente `VITE_API_URL` (lida via `import.meta.env.VITE_API_URL`), com fallback para `http://localhost:3001` em desenvolvimento.
  - Criar um módulo único `src/services/api.ts` exportando a base URL e, idealmente, uma função `apiFetch` compartilhada (ver FIN-027).
  - Substituir os três usos hardcoded para importarem desse módulo.
  - Documentar `VITE_API_URL` no `.env.example`.

  **Dependências**
  Nenhuma.

  **Validação**
  - Rodar o app normalmente em dev e confirmar que login, dashboard e sync Pluggy continuam funcionando.
  - Trocar `VITE_API_URL` para outro valor e confirmar que as requisições vão para o novo host (pode ser validado apontando para um servidor mock).

  **Critérios de aceite**
  - [ ] Nenhuma ocorrência hardcoded de `http://localhost:3001` no código-fonte de `src/`.
  - [ ] App funciona normalmente com a configuração padrão.
  - [ ] `.env.example` documenta a nova variável.

---

- [ ] **P2 — FIN-026 — Habilitar TypeScript `strict` mode**

  **Objetivo**
  Ativar checagens estritas de tipo para reduzir bugs de `null`/`undefined` não tratados, especialmente relevante em um app financeiro.

  **Problema**
  `tsconfig.app.json` não define `"strict": true` nem nenhuma das flags individuais (`strictNullChecks`, `noImplicitAny`, etc.) — apenas `noUnusedLocals`/`noUnusedParameters`. Isso permite que valores potencialmente `undefined` (ex. `acc.limit` em cálculos de porcentagem, [AccountsManager.tsx:132](src/components/AccountsManager.tsx#L132)) passem sem checagem do compilador.

  **Arquivos envolvidos**
  - `tsconfig.app.json`
  - `src/**/*.ts(x)` (possíveis ajustes pontuais decorrentes dos novos erros revelados)

  **Alterações necessárias**
  - Adicionar `"strict": true` em `tsconfig.app.json`.
  - Rodar `npx tsc -b --noEmit` e corrigir os erros revelados, um arquivo por vez, sem alterar comportamento — apenas tipos.

  **Dependências**
  Nenhuma, mas deve ser feita com cuidado incremental (considerar dividir por arquivo se o volume de erros for grande).

  **Validação**
  - `npx tsc -b --noEmit` deve rodar sem erros após a mudança.
  - `npm run build` deve continuar funcionando.
  - Testar manualmente os principais fluxos (login, contas, transações, dívidas) para garantir que nenhuma correção de tipo alterou comportamento.

  **Critérios de aceite**
  - [ ] `strict: true` habilitado.
  - [ ] Build e typecheck passam sem erros.
  - [ ] Nenhuma regressão funcional observável.

---

- [ ] **P3 — FIN-027 — Criar serviço `apiFetch` único para eliminar duplicação do padrão fetch**

  **Objetivo**
  Remover a duplicação do padrão `fetch` + header `Authorization` + tratamento de erro, hoje repetido em `App.tsx` (`fetchAPI`, [App.tsx:46-60](src/App.tsx#L46-L60)) e `PluggyConnectButton.tsx` (`fetchAPI`, [PluggyConnectButton.tsx:43-57](src/components/PluggyConnectButton.tsx#L43-L57)) — funções quase idênticas definidas separadamente.

  **Arquivos envolvidos**
  - `src/services/api.ts` (novo, criado em FIN-025)
  - `src/App.tsx`
  - `src/components/PluggyConnectButton.tsx`
  - `src/components/AuthForm.tsx`

  **Alterações necessárias**
  - Mover a lógica de `fetchAPI` para `src/services/api.ts`, parametrizada por token.
  - Atualizar `App.tsx` e `PluggyConnectButton.tsx` para consumirem essa função compartilhada em vez de reimplementá-la.

  **Dependências**
  FIN-025.

  **Validação**
  - Confirmar que todos os fluxos que dependiam de `fetchAPI` (contas, transações, dívidas, sync Pluggy) continuam funcionando sem alteração de comportamento.

  **Critérios de aceite**
  - [ ] Uma única implementação de `fetchAPI`/`apiFetch` é usada por todo o frontend.
  - [ ] Nenhuma regressão funcional.

---

## 6. 📱 Responsividade / Mobile

- [ ] **P1 — FIN-028 — Sidebar principal totalmente oculta em telas pequenas, sem navegação alternativa**

  **Objetivo**
  Dar aos usuários mobile uma forma de navegar entre abas, sair da conta, importar extrato e gerenciar contas — hoje impossível.

  **Problema**
  `App.tsx:292`: `<aside className="w-64 glass-panel border-r border-white/5 hidden md:flex ...">`. Abaixo do breakpoint `md` (768px), a sidebar inteira desaparece — e com ela: navegação entre Dashboard/Contas/Transações/Dívidas, botão "Gerenciar Contas", botão "Importação Manual", o widget de conexão Pluggy, "Limpar Transações" e o logout. **Não existe nenhum substituto** (sem hambúrguer, sem bottom nav, sem drawer). Em um celular, o usuário só consegue ver a aba que já estava ativa ao carregar a página — não há como trocar de aba nem sair da conta.

  **Arquivos envolvidos**
  - `src/App.tsx`

  **Alterações necessárias**
  - Adicionar um cabeçalho mobile com botão de menu (ícone hambúrguer, usando `lucide-react`, já uma dependência) que abre um drawer/off-canvas com o mesmo conteúdo da sidebar atual.
  - Alternativa mais simples para uma primeira iteração: bottom navigation bar fixa (visível apenas em `< md`) com os 4 itens principais (Dashboard, Contas, Transações, Dívidas) + um botão de menu "mais" para as ações secundárias (importar, Pluggy, logout, limpar transações).
  - Garantir que o logout continue acessível em mobile (hoje só existe dentro da sidebar oculta).

  **Frontend**
  Alteração isolada em `App.tsx` — não deve tocar a lógica de dados/estado, apenas a estrutura de navegação/layout.

  **Dependências**
  Nenhuma.

  **Validação**
  - Testar em viewport mobile (ex. 375px de largura, DevTools) que é possível: trocar entre as 4 abas, abrir o modal de importação, acessar "Gerenciar Contas", conectar via Pluggy e fazer logout.

  **Critérios de aceite**
  - [ ] Todas as ações hoje disponíveis apenas na sidebar (navegação, importação, Pluggy, logout, limpar transações) são acessíveis em viewport mobile.
  - [ ] Layout desktop (`md` e acima) permanece inalterado.

---

- [ ] **P2 — FIN-029 — Adaptar grids fixos de 2 colunas em telas muito pequenas**

  **Objetivo**
  Evitar que cards de resumo fiquem espremidos em telas muito estreitas (< 360px).

  **Problema**
  `AccountsManager.tsx:84` e `DebtManager.tsx:324` usam `grid-cols-2` fixo (sem variante responsiva) para os cards de resumo ("Saldo Real Total"/"Faturas Pendentes" e "Total em Dívidas"/"Parcelas Mensais"). Em telas muito estreitas, valores monetários maiores podem quebrar layout ou truncar.

  **Arquivos envolvidos**
  - `src/components/AccountsManager.tsx`
  - `src/components/DebtManager.tsx`

  **Alterações necessárias**
  - Trocar `grid-cols-2` por `grid-cols-1 xs:grid-cols-2` (ou usar o breakpoint `sm` do Tailwind, já que o projeto não tem breakpoint customizado `xs`) nos dois componentes.

  **Dependências**
  FIN-028 (mesma frente de trabalho de responsividade — pode ser feita em conjunto).

  **Validação**
  - Testar em viewport de 320px de largura e confirmar que os valores monetários não são truncados nem quebram o layout.

  **Critérios de aceite**
  - [ ] Cards de resumo empilham em coluna única abaixo de `sm`.
  - [ ] Nenhuma regressão em telas maiores.

---

## 7. 🧪 Testes

- [ ] **P1 — FIN-030 — Configurar Vitest + Testing Library no frontend**

  **Objetivo**
  Ter uma base de testes automatizados para o frontend — hoje inexistente.

  **Problema**
  Não há nenhum framework de teste instalado (`package.json` não lista `vitest`, `jest`, `@testing-library/*`) nem nenhum arquivo `*.test.*`/`*.spec.*` no projeto.

  **Arquivos envolvidos**
  - `package.json`
  - `vite.config.ts`
  - Novo: `vitest.config.ts` (ou config embutida em `vite.config.ts`)

  **Alterações necessárias**
  - Adicionar `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` como devDependencies.
  - Configurar ambiente `jsdom` e um script `"test": "vitest run"` (+ `"test:watch": "vitest"`) em `package.json`.

  **Dependências**
  Nenhuma.

  **Validação**
  - Criar um teste trivial (ex. `1 + 1 === 2` ou renderizar `<AuthForm />`) e confirmar que `npm test` executa e passa.

  **Critérios de aceite**
  - [ ] `npm test` roda a suíte de testes do frontend com sucesso.
  - [ ] Pelo menos um teste de exemplo existe e passa.

---

- [ ] **P1 — FIN-031 — Configurar testes de integração do backend (Vitest + Supertest)**

  **Objetivo**
  Ter uma base de testes automatizados para as rotas do Express — hoje inexistente.

  **Arquivos envolvidos**
  - `package.json`
  - Novo: arquivo de config de teste do backend (ex. `server.test.js` de exemplo)

  **Alterações necessárias**
  - Adicionar `supertest` como devDependency (pode reaproveitar o `vitest` de FIN-030 como test runner).
  - Extrair a criação do `app` Express (`server.js`) para permitir importá-lo em testes sem chamar `app.listen()` diretamente (ex. exportar `app` e mover o `listen` para um bloco `if (import.meta.url === ...)` ou arquivo `index.js` separado).
  - Configurar um banco SQLite de teste isolado (ex. `DATABASE_URL` apontando para `file:./test.db`, criado/destruído a cada suíte).

  **Backend**
  Pequeno refactor estrutural em `server.js` para separar "app" de "start do servidor", sem alterar nenhuma rota existente.

  **Dependências**
  Nenhuma.

  **Validação**
  - Escrever um teste de exemplo (`GET /api/auth/me` sem token retorna 401) e confirmar que passa via `npm test`.

  **Critérios de aceite**
  - [ ] Suíte de testes de backend roda de forma isolada, sem afetar `dev.db`.
  - [ ] `app` do Express é exportável e testável sem subir o servidor de verdade.

---

- [ ] **P1 — FIN-032 — Testes de isolamento de dados entre usuários**

  **Objetivo**
  Garantir, via teste automatizado, que um usuário nunca acessa/altera dados de outro.

  **Arquivos envolvidos**
  - Novo: `server.security.test.js` (ou equivalente)

  **Alterações necessárias**
  - Criar dois usuários de teste (A e B).
  - Para cada recurso (accounts, transactions, debts): usuário A cria um recurso; usuário B tenta `GET`/`PUT`/`DELETE` esse recurso pelo `id` e deve receber erro/lista vazia, nunca sucesso ou dados de A.

  **Dependências**
  FIN-031.

  **Validação**
  `npm test` executa esses casos e todos passam.

  **Critérios de aceite**
  - [ ] Testes cobrem accounts, transactions e debts para tentativa de acesso cross-user.
  - [ ] Todos os testes passam contra o código atual (ou revelam regressões a corrigir).

---

- [ ] **P1 — FIN-033 — Testes de autenticação**

  **Objetivo**
  Cobrir os fluxos de registro, login e validação de token.

  **Arquivos envolvidos**
  - Novo: `server.auth.test.js`

  **Alterações necessárias**
  - Testes para: registro com dados válidos; registro com e-mail duplicado; registro com senha curta; login com credenciais corretas/incorretas; acesso a rota protegida sem token; acesso com token inválido/expirado.

  **Dependências**
  FIN-031.

  **Validação**
  `npm test` executa e todos os casos passam.

  **Critérios de aceite**
  - [ ] Todos os cenários acima cobertos por teste automatizado e passando.

---

- [ ] **P2 — FIN-034 — Testes das regras financeiras**

  **Objetivo**
  Cobrir com testes os cálculos financeiros centrais do app.

  **Arquivos envolvidos**
  - Novo: `src/utils/debts.test.ts`, `src/App.stats.test.ts` (ou onde a lógica de `stats` for extraída — ver FIN-088)

  **Alterações necessárias**
  Criar casos de teste para:
  - Receita e despesa somando corretamente transações positivas/negativas.
  - Saldo negativo (despesas > receitas).
  - Cartão sem fatura pendente (`pendingBill` undefined/0).
  - Cartão com fatura pendente.
  - Compra parcelada: pagar uma parcela avança `paidInstallments`/`paidAmount`/`nextDueDate` corretamente.
  - Parcela paga até o limite (última parcela não ultrapassa `totalAmount`, ver [DebtManager.tsx:124-128](src/components/DebtManager.tsx#L124-L128)).
  - Dívida vencida vs. em dia (usando a função unificada de FIN-005).
  - Conta sem transações (soma zero, sem erro de divisão).
  - Múltiplas contas consolidadas vs. filtro por conta única (`dashboardAccountId`).

  **Dependências**
  FIN-030, FIN-005 e, idealmente, FIN-015 (para testar já em centavos) e FIN-088 (stats extraídos para módulo testável).

  **Validação**
  `npm test` roda e todos os casos passam.

  **Critérios de aceite**
  - [ ] Todos os cenários financeiros listados têm teste automatizado.
  - [ ] Testes passam de forma determinística (sem depender de `Date.now()`/fuso sem mock).

---

- [ ] **P2 — FIN-035 — Testes dos parsers de CSV/OFX**

  **Objetivo**
  Cobrir `src/utils/parsers.ts` com testes, dado seu papel crítico na entrada de dados financeiros.

  **Arquivos envolvidos**
  - Novo: `src/utils/parsers.test.ts`

  **Alterações necessárias**
  Criar casos de teste para:
  - `parseAmount`: formatos BR (`1.500,00`) e US (`1,500.00`), valores negativos, valores só com vírgula/ponto.
  - `normalizeDate`: `DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`, `YYYY/MM/DD`, entradas inválidas.
  - `parseOFX`: bloco XML-style e SGML-style, com e sem `FITID`.
  - `parseCSV`: separador `;` e `,`, colunas em diferentes ordens/nomes, linhas malformadas ignoradas.
  - `autoCategory`: pelo menos um exemplo de cada categoria mapeada.
  - Transação duplicada dentro do mesmo arquivo (duas linhas idênticas) — documentar comportamento atual (não deduplicadas no parser; dedupe fica a cargo do backend, FIN-003).

  **Dependências**
  FIN-030.

  **Validação**
  `npm test` roda e todos os casos passam.

  **Critérios de aceite**
  - [ ] Parsers cobertos por testes para os formatos suportados (Nubank, Inter, Itaú, Bradesco, BB conforme citado no `ImportModal`).
  - [ ] Casos de borda (data/valor inválido) tratados sem exceção não capturada.

---

- [ ] **P3 — FIN-036 — Adicionar pipeline de CI (GitHub Actions)**

  **Objetivo**
  Rodar lint, typecheck, testes e build automaticamente a cada push/PR.

  **Arquivos envolvidos**
  - Novo: `.github/workflows/ci.yml`

  **Alterações necessárias**
  - Workflow que instala dependências (`npm ci`), roda `npm run lint`, `npm run typecheck` (FIN-024), `npm test` (FIN-030/031) e `npm run build`.

  **Dependências**
  FIN-024, FIN-030, FIN-031.

  **Validação**
  - Abrir um PR de teste e confirmar que o workflow roda e reporta status corretamente.

  **Critérios de aceite**
  - [ ] Workflow de CI existe e passa no estado atual do projeto.
  - [ ] Falhas em lint/typecheck/teste/build bloqueiam o merge (configuração de branch protection é responsabilidade do usuário/GitHub, fora do escopo do código).

---

## 8. ⚡ Performance

- [ ] **P2 — FIN-037 — Sincronização Pluggy processa contas/transações sequencialmente (N+1)**

  **Objetivo**
  Reduzir o tempo de sincronização evitando uma consulta/gravação por transação individual.

  **Problema**
  `server.js:370-403`: para cada transação retornada pela Pluggy, o código faz um `findFirst` seguido de `create`/`updateMany` **dentro de um loop `for`**, sequencialmente. Uma conta com centenas de transações no período gera centenas de round-trips ao banco, tornando a sincronização lenta.

  **Arquivos envolvidos**
  - `server.js`

  **Alterações necessárias**
  - Buscar de uma vez todos os `pluggyId` já existentes para a conta (`findMany` com `pluggyId: { in: [...] }`), montar um `Set` em memória, e então usar `createMany` para as novas e um pequeno número de updates apenas para as que mudaram (ou, mais simples, aceitar não atualizar transações já existentes no sync — apenas inserir as novas, já que transações bancárias raramente mudam após efetivadas).

  **Dependências**
  Idealmente após FIN-021 (constraint única), para poder usar `createMany` com `skipDuplicates: true` do Prisma.

  **Validação**
  - Sincronizar uma conta sandbox com muitas transações e medir o tempo antes/depois da mudança.

  **Critérios de aceite**
  - [ ] Sincronização não faz mais uma query por transação individual.
  - [ ] Resultado da sincronização (dados finais no banco) permanece correto e idempotente.

---

- [ ] **P3 — FIN-038 — Paginação da API da Pluggy não tratada em `fetchTransactions`**

  **Objetivo**
  Garantir que todas as páginas de transações retornadas pela API da Pluggy sejam processadas, não apenas a primeira.

  **Problema**
  `server.js:368`: `const txsRes = await pluggyClient.fetchTransactions(pluggyAcc.id, { from: fromDate });` — usa apenas `txsRes.results` sem verificar `txsRes.totalPages`/paginação. Se uma conta tiver mais transações no período do que o tamanho de página padrão da SDK, transações além da primeira página seriam silenciosamente perdidas na sincronização. **Classificação: ❓ Não verificável sem acesso à documentação/comportamento real da SDK `pluggy-sdk` em produção** — verificar a doc oficial da Pluggy antes de implementar a correção.

  **Arquivos envolvidos**
  - `server.js`

  **Alterações necessárias**
  - Verificar na documentação da `pluggy-sdk` se `fetchTransactions` pagina automaticamente ou exige loop manual (`page`/`pageSize`).
  - Se exigir loop manual, implementá-lo até `txsRes.results.length < txsRes.total` (ou equivalente).

  **Dependências**
  Nenhuma.

  **Validação**
  - Sincronizar uma conta sandbox com um volume de transações que force múltiplas páginas (se o ambiente sandbox permitir) e confirmar que todas aparecem no app.

  **Critérios de aceite**
  - [ ] Comportamento de paginação da SDK confirmado e documentado em comentário no código.
  - [ ] Se necessário, loop de paginação implementado e todas as transações do período são importadas.

---

## 9. 🎨 UX/UI

- [ ] **P3 — FIN-039 — Ícone de notificações (sino) no header é puramente decorativo**

  **Objetivo**
  Remover a expectativa falsa de funcionalidade, ou conectar o sino a uma central de notificações real.

  **Problema**
  `App.tsx:377-380`: o botão do sino não tem `onClick` nem qualquer lógica associada além de um indicador visual condicionado a `stats.overdueDebts.length > 0`. Um usuário que clica nele não vê nada acontecer.

  **Arquivos envolvidos**
  - `src/App.tsx`

  **Alterações necessárias**
  - Curto prazo (esta tarefa): ao clicar, abrir um pequeno dropdown simples listando as dívidas vencidas (`stats.overdueDebts`), já calculadas — sem precisar de backend novo.
  - Central de notificações completa fica como item de roadmap separado (FIN-065/FIN-066).

  **Dependências**
  Nenhuma.

  **Validação**
  - Com dívidas vencidas cadastradas, clicar no sino deve mostrar a lista; sem dívidas vencidas, deve indicar "nenhuma notificação".

  **Critérios de aceite**
  - [ ] Clicar no sino exibe algum conteúdo real (mesmo que simples), nunca uma ação sem efeito.

---

- [ ] **P3 — FIN-040 — Busca força troca para a aba "Transações" a cada tecla digitada**

  **Objetivo**
  Evitar a troca de aba forçada quando o usuário apenas quer buscar algo já estando ciente de onde está.

  **Problema**
  `App.tsx:372`: `onChange={e => { setSearch(e.target.value); setActiveTab('transactions'); }}` — cada caractere digitado na busca do header muda a aba ativa para "Transações", mesmo que o usuário estivesse em Contas ou Dívidas.

  **Arquivos envolvidos**
  - `src/App.tsx`

  **Alterações necessárias**
  - Trocar a troca de aba automática por: mudar de aba apenas no primeiro caractere digitado (transição de string vazia para não vazia), não a cada tecla — ou, alternativa mais simples, mudar de aba apenas ao pressionar Enter/submeter a busca.

  **Dependências**
  Nenhuma.

  **Validação**
  - Digitar múltiplos caracteres na busca a partir de outra aba e confirmar que a troca de aba acontece uma única vez, não a cada tecla.

  **Critérios de aceite**
  - [ ] Busca não força re-render de troca de aba a cada tecla digitada.
  - [ ] Comportamento de busca em si (filtro por nome/categoria) permanece funcional.

---

## 10. 📊 Dashboard

Nenhuma tarefa adicional identificada além das já listadas nas seções **0 (Bugs Críticos)** e **2 (Integridade Financeira)** — em especial FIN-001, FIN-002, FIN-005 e FIN-018, que afetam diretamente os números exibidos no Dashboard.

## 11. 💳 Contas, Cartões e Transações

Cobertas pelas tarefas: FIN-001, FIN-002 (Pluggy), FIN-003 (dedupe de importação), FIN-022 (edição/exclusão individual), FIN-023 (paginação). Nenhuma tarefa adicional identificada nesta área após auditoria.

## 12. 💸 Dívidas e Parcelamentos

Cobertas pelas tarefas: FIN-004 (dedupe de dívida importada), FIN-005 (dívida vencida), FIN-016 (referência cruzada), FIN-017 (operações em lote resilientes). Nenhuma tarefa adicional identificada nesta área após auditoria.

## 13. 🏦 Open Finance / Pluggy

Cobertas pelas tarefas: FIN-001, FIN-002, FIN-021, FIN-037, FIN-038. Tarefa adicional específica abaixo.

- [ ] **P3 — FIN-041 — Tratar status de item Pluggy expirado/erro de login (`LOGIN_ERROR`, `OUTDATED`)**

  **Objetivo**
  Informar ao usuário quando uma conexão bancária via Pluggy precisa de reautenticação.

  **Problema**
  `PluggyConnectButton.tsx` e `server.js` não verificam o campo `status` do item Pluggy após a conexão inicial ([server.js:296](server.js#L296) obtém `pluggyItem` mas usa apenas `.connector.name`). Se a conexão expirar ou exigir novo login no banco, o usuário não recebe nenhum aviso — a sincronização provavelmente falhará silenciosamente ou com um erro genérico.

  **Arquivos envolvidos**
  - `server.js`
  - `src/components/PluggyConnectButton.tsx`

  **Alterações necessárias**
  - Ao sincronizar, verificar `pluggyItem.status` (ou o retorno de `fetchAccounts`) e, se indicar necessidade de reautenticação, retornar uma mensagem específica ao frontend.
  - No `PluggyConnectButton`, exibir essa mensagem de forma clara, orientando o usuário a reconectar.

  **Dependências**
  Nenhuma.

  **Validação**
  - Simular (ambiente sandbox permite forçar certos estados) uma conexão com erro de login e confirmar que o usuário recebe uma mensagem acionável, não um erro genérico.

  **Critérios de aceite**
  - [ ] Status de erro/expiração do item Pluggy é detectado e comunicado ao usuário de forma específica.

---

## 14. 📅 Planejamento Financeiro (Roadmap)

> Estas tarefas implementam funcionalidades **novas**, sugeridas no roadmap do README. Devem ser priorizadas **depois** de todas as tarefas P0/P1 das seções anteriores.

### Orçamento por categoria

- [ ] **P2 — FIN-042 — Criar model `Budget` no schema Prisma**
  Campos sugeridos: `id`, `userId`, `category`, `monthlyLimit` (Int, centavos — depende de FIN-015), `createdAt`. Relação com `User`. **Arquivos:** `prisma/schema.prisma`. **Dependências:** FIN-015 (para já nascer em centavos), FIN-020 (migration versionada).

- [ ] **P2 — FIN-043 — Criar rotas CRUD `/api/budgets`**
  `GET/POST/PUT/DELETE`, seguindo exatamente o padrão de autenticação/isolamento por `userId` já usado nas demais rotas de `server.js`. **Dependências:** FIN-042, FIN-008 (validação de payload).

- [ ] **P2 — FIN-044 — Criar cálculo de progresso do orçamento (gasto vs. limite por categoria/mês)**
  Função utilitária que recebe transações do mês + lista de budgets e retorna, por categoria, `{ limit, spent, percentage }`. **Arquivos:** novo `src/utils/budget.ts`. **Dependências:** FIN-043.

- [ ] **P2 — FIN-045 — Criar aba "Orçamento" no frontend**
  Novo componente `src/components/BudgetManager.tsx`, seguindo o padrão visual/estrutural de `AccountsManager.tsx`/`DebtManager.tsx` (cards + modal de formulário). Nova entrada de navegação em `App.tsx`. **Dependências:** FIN-044.

- [ ] **P3 — FIN-046 — Integrar indicador de orçamento ao Dashboard**
  Novo card ou seção no Dashboard mostrando resumo do orçamento do mês corrente. **Dependências:** FIN-045.

- [ ] **P3 — FIN-047 — Criar alerta visual ao ultrapassar o limite do orçamento**
  Reaproveitar o padrão de alerta já usado para dívidas vencidas ([App.tsx:407-415](src/App.tsx#L407-L415)). **Dependências:** FIN-046.

- [ ] **P3 — FIN-048 — Testes do sistema de orçamento**
  Cobrir `src/utils/budget.ts` e as rotas `/api/budgets`. **Dependências:** FIN-030, FIN-031, FIN-045.

### Metas financeiras

- [ ] **P3 — FIN-049 — Criar model `Goal` no schema Prisma**
  Campos: `id`, `userId`, `name`, `targetAmount`, `currentAmount`, `targetDate`, `createdAt`. **Dependências:** FIN-015, FIN-020.

- [ ] **P3 — FIN-050 — Criar rotas CRUD `/api/goals`**
  Mesmo padrão das demais rotas. **Dependências:** FIN-049, FIN-008.

- [ ] **P3 — FIN-051 — Criar tela de Metas Financeiras**
  Novo componente `src/components/GoalsManager.tsx` com barra de progresso (reaproveitar o padrão visual já usado em `DebtManager.tsx` para progresso de parcelas). **Dependências:** FIN-050.

- [ ] **P3 — FIN-052 — Testes de metas financeiras**
  **Dependências:** FIN-030, FIN-031, FIN-051.

### Transações recorrentes

- [ ] **P3 — FIN-053 — Criar model `RecurringTransaction` no schema Prisma**
  Campos: `id`, `userId`, `accountId?`, `name`, `category`, `amount`, `frequency` (mensal/semanal/anual), `nextOccurrence`, `active`. **Dependências:** FIN-015, FIN-020.

- [ ] **P3 — FIN-054 — Criar rotas CRUD `/api/recurring-transactions` + endpoint de "lançar pendentes"**
  Endpoint adicional (`POST /api/recurring-transactions/process`) que gera as `Transaction` reais cujas ocorrências já passaram, avançando `nextOccurrence`. **Dependências:** FIN-053, FIN-008.

- [ ] **P3 — FIN-055 — Disparar checagem/lançamento de recorrências pendentes ao carregar o dashboard**
  No `useEffect` de carregamento inicial do `App.tsx`, chamar o endpoint de processamento antes (ou em paralelo) de buscar transações. **Dependências:** FIN-054.

- [ ] **P3 — FIN-056 — Criar UI de gerenciamento de recorrências**
  Novo componente seguindo o mesmo padrão dos demais managers. **Dependências:** FIN-054.

- [ ] **P3 — FIN-057 — Testes de transações recorrentes**
  Cobrir especialmente o cálculo de próxima ocorrência para cada frequência. **Dependências:** FIN-030, FIN-031, FIN-056.

### Projeção de saldo

- [ ] **P3 — FIN-058 — Criar cálculo de projeção de saldo futuro (saldo atual + recorrências previstas − parcelas de dívidas previstas)**
  Nova função utilitária, sem endpoint novo necessário (pode ser calculada no frontend a partir dos dados já carregados). **Dependências:** FIN-053, FIN-005.

- [ ] **P3 — FIN-059 — Exibir gráfico de projeção no Dashboard**
  Novo gráfico Recharts (reaproveitar o padrão de `AreaChart` já usado em [App.tsx:486-511](src/App.tsx#L486-L511)). **Dependências:** FIN-058.

---

## 15. 📈 Relatórios (Roadmap)

- [ ] **P3 — FIN-060 — Exportar relatório de transações em CSV**
  Reaproveitar diretamente o padrão já implementado e funcional em `exportCSV` do `DebtManager.tsx` ([DebtManager.tsx:155-187](src/components/DebtManager.tsx#L155-L187)), adaptado para transações, na aba Transações do `App.tsx`. **Dependências:** Nenhuma — pode ser feita a qualquer momento, é isolada.

- [ ] **P3 — FIN-061 — Exportar relatório de transações em PDF**
  Adicionar dependência de geração de PDF no cliente (ex. `jspdf` + `jspdf-autotable`) ou gerar server-side. **Dependências:** FIN-060 (reaproveitar mesma seleção/filtro de dados).

- [ ] **P3 — FIN-062 — Criar comparativo mês a mês de receitas/despesas**
  Nova visão (gráfico de barras agrupadas) usando os dados já agregados em `stats.balanceByMonth` como base, estendido para separar receita/despesa por mês. **Dependências:** Nenhuma.

- [ ] **P3 — FIN-063 — Criar comparativo ano a ano**
  Extensão de FIN-062 agregando por ano. **Dependências:** FIN-062.

- [ ] **P3 — FIN-064 — Criar relatório de patrimônio líquido (contas + investimentos − dívidas)**
  Novo cálculo combinando `realBalance`, saldo de investimentos (depende do módulo de Investimentos, FIN-070) e `activeDebts`. **Dependências:** FIN-018, FIN-070.

---

## 16. 🔔 Notificações (Roadmap)

- [ ] **P3 — FIN-065 — Criar model `Notification` e endpoint de listagem/leitura**
  Campos: `id`, `userId`, `type`, `message`, `read`, `createdAt`. Rotas `GET /api/notifications`, `PUT /api/notifications/:id/read`. **Dependências:** FIN-020, FIN-008.

- [ ] **P3 — FIN-066 — Conectar o sino do header a uma central de notificações real**
  Substituir a solução simples de FIN-039 por um dropdown que consome `GET /api/notifications`. **Dependências:** FIN-039, FIN-065.

- [ ] **P3 — FIN-067 — Gerar notificações automáticas de vencimento de dívida/fatura**
  Ao carregar o dashboard (ou em uma rotina periódica), criar notificações para dívidas que vencem nos próximos N dias, evitando duplicar notificações já criadas para a mesma ocorrência. **Dependências:** FIN-065, FIN-005.

- [ ] **P3 — FIN-068 — Avaliar notificações por e-mail para vencimentos**
  Requer serviço de envio de e-mail (ex. Resend, SendGrid) — decisão de produto/infra antes de implementar. Registrar como avaliação, não implementação imediata. **Dependências:** FIN-067.

- [ ] **P3 — FIN-069 — Alertas de gasto incomum por categoria**
  Comparar gasto do mês corrente por categoria com a média dos últimos N meses; gerar notificação (via FIN-065) quando o desvio ultrapassar um limiar configurável. **Dependências:** FIN-065.

---

## 17. 📊 Investimentos (Roadmap)

- [ ] **P3 — FIN-070 — Criar model `Investment` no schema Prisma**
  Campos: `id`, `userId`, `accountId?`, `name`, `type` (renda fixa/ações/cripto), `amountInvested`, `currentValue`, `createdAt`. **Dependências:** FIN-015, FIN-020.

- [ ] **P3 — FIN-071 — Criar rotas CRUD `/api/investments`**
  **Dependências:** FIN-070, FIN-008.

- [ ] **P3 — FIN-072 — Criar tela de carteira de investimentos**
  Novo componente seguindo o padrão dos demais managers. **Dependências:** FIN-071.

- [ ] **P3 — FIN-073 — Integrar valor de investimentos ao patrimônio líquido**
  **Dependências:** FIN-064, FIN-072.

---

## 18. 🌎 Multi-moeda (Roadmap)

- [ ] **P3 — FIN-074 — Adicionar campo `currency` em `Account` e `Transaction`**
  Default `"BRL"`, para manter compatibilidade retroativa com todos os dados existentes. **Dependências:** FIN-020.

- [ ] **P3 — FIN-075 — Integrar API de câmbio para conversão de exibição**
  Avaliar provedor (ex. exchangerate.host) — atenção a limites de uso gratuito. **Dependências:** FIN-074.

- [ ] **P3 — FIN-076 — Atualizar UI para exibir/selecionar moeda por conta**
  Ajustar `AccountsManager.tsx` e formatação monetária (`fmt`, em `App.tsx`) para respeitar a moeda da conta. **Dependências:** FIN-075.

---

## 19. 👥 Colaboração (Roadmap)

- [ ] **P3 — FIN-077 — Modelar compartilhamento de dados entre usuários (household/family)**
  Decisão arquitetural relevante (nova entidade `Household` compartilhando `Account`/`Transaction`, ou visibilidade compartilhada por convite). Requer definição de produto antes de implementar — não iniciar sem alinhamento explícito, dado o impacto no modelo de isolamento por usuário auditado nas seções 1 e 2.

- [ ] **P3 — FIN-078 — Implementar 2FA (TOTP) no login**
  Adicionar dependência `otplib` (ou similar), novo campo `twoFactorSecret` em `User`, fluxo de setup e verificação no login. **Dependências:** FIN-012 (revisão de estratégia de sessão deve ser considerada em conjunto).

- [ ] **P3 — FIN-079 — Implementar exportação completa de dados do usuário (backup)**
  Endpoint `GET /api/account/export` retornando todos os dados do usuário (accounts, transactions, debts) em JSON. **Dependências:** Nenhuma.

- [ ] **P3 — FIN-080 — Implementar importação/restauração de backup**
  Endpoint que aceita o JSON gerado por FIN-079 e recria os dados para o usuário autenticado, com validação cuidadosa (reaproveitar FIN-008) para não permitir sobrescrever dados de outro usuário. **Dependências:** FIN-079, FIN-008.

---

## 20. 📱 PWA / Mobile (Roadmap)

- [ ] **P2 — FIN-081 — Criar navegação mobile completa (bottom nav ou drawer)**
  Esta é a versão "produto completo" do que já é corrigido emergencialmente em FIN-028 — usar esta tarefa para refinar UX (animações, acessibilidade, atalhos) depois que FIN-028 já resolveu o bloqueio funcional. **Dependências:** FIN-028.

- [ ] **P3 — FIN-082 — Adicionar `manifest.json` + service worker (PWA instalável)**
  **Dependências:** FIN-081 (a navegação mobile deve estar resolvida antes de promover instalação como app).

- [ ] **P3 — FIN-083 — Implementar tema claro (light mode)**
  Definir tokens de cor alternativos em `src/index.css` (hoje só há tema escuro fixo, [index.css:4-15](src/index.css#L4-L15)) e um toggle persistido (ex. `localStorage`). **Dependências:** Nenhuma.

---

## 21. 🛠️ Infraestrutura / DX

- [ ] **P3 — FIN-084 — Pipeline de CI**
  Já coberta integralmente pela tarefa **FIN-036**. Mantida aqui apenas como referência cruzada.

- [ ] **P3 — FIN-085 — Documentar `sandbox-pluggy/` como protótipo isolado, não integrado ao app principal**

  **Objetivo**
  Deixar claro que `sandbox-pluggy/` é um servidor experimental separado (porta 3002, banco SQLite próprio `sandbox.db`, usuário mockado fixo `MOCK_USER_ID`, sem autenticação real — ver [sandbox-pluggy/server.js:34](sandbox-pluggy/server.js#L34)), não uma parte funcional do FinFlow, para evitar que seja confundido com o backend principal (`server.js`) por quem lê o repositório pela primeira vez.

  **Arquivos envolvidos**
  - `sandbox-pluggy/` (novo `README.md` dentro da pasta)
  - `README.md` (raiz)

  **Alterações necessárias**
  - Criar `sandbox-pluggy/README.md` explicando que é um protótipo de referência para testar a integração Pluggy isoladamente, sem autenticação de usuários reais, e que não deve ser usado em produção.
  - Adicionar uma nota equivalente na seção de estrutura do `README.md` principal.
  - Alternativa (a avaliar com o usuário, não decidir unilateralmente): remover a pasta do repositório, caso não haja mais utilidade prática.

  **Dependências**
  Nenhuma.

  **Validação**
  Revisão de leitura — não há comportamento de runtime a validar.

  **Critérios de aceite**
  - [ ] `sandbox-pluggy/` documentado como protótipo isolado, ou removido (mediante confirmação explícita do usuário — nunca remover código sem essa confirmação).

---

## 22. 🏗️ Débitos Técnicos (Arquitetura)

- FIN-086 — Extrair a lógica de cálculo financeiro (bloco `stats`, [App.tsx:202-266](src/App.tsx#L202-L266)) de dentro do componente `App.tsx` para um módulo/hook dedicado (ex. `src/hooks/useFinancialStats.ts`), separando regra de negócio da camada de UI. Facilita testes (depende de FIN-034) e reduz o tamanho do componente `App.tsx` (hoje com mais de 700 linhas, concentrando estado, chamadas HTTP, cálculo financeiro e renderização).
- FIN-087 — Centralizar padrões de formulário (`FormField`, validação de campos numéricos) hoje duplicados entre `AccountsManager.tsx` e `DebtManager.tsx` em um módulo compartilhado `src/components/shared/FormField.tsx`.
- FIN-088 — Após FIN-005, remover qualquer lógica remanescente de verificação de vencimento duplicada entre componentes, garantindo um único ponto de verdade.

**Dependências:** FIN-086 depende de FIN-034 para ter cobertura de teste antes/depois da extração (evitar regressão silenciosa). FIN-087 não tem dependências. FIN-088 depende de FIN-005.

---

# 📊 Resumo

| Métrica | Quantidade |
|---|---:|
| Total de tarefas com card completo (P0–P3) | 85 |
| Subtarefas adicionais (FIN-015a–d) | 4 |
| Itens de débito técnico (seção 22, formato resumido) | 3 |
| **Total geral de itens rastreáveis** | **92** |
| P0 | 5 |
| P1 | 11 |
| P2 | 20 |
| P3 | 49 |
| Bugs críticos (seção 0) | 5 |
| Segurança (seção 1) | 9 |
| Integridade Financeira (seção 2) | 4 (+4 subtarefas de FIN-015) |
| Banco de Dados (seção 3) | 3 |
| Backend/API (seção 4) | 3 |
| Frontend (seção 5) | 3 |
| Mobile/Responsividade (seção 6) | 2 |
| Testes (seção 7) | 7 |
| Performance (seção 8) | 2 |
| UX/UI (seção 9) | 2 |
| Open Finance/Pluggy (seção 13, além das referências cruzadas de FIN-001/002/021/037/038) | 1 |
| Roadmap — novas funcionalidades (seções 14–20) | 42 |
| ↳ Planejamento Financeiro (seção 14) | 18 |
| ↳ Relatórios (seção 15) | 5 |
| ↳ Notificações (seção 16) | 5 |
| ↳ Investimentos (seção 17) | 4 |
| ↳ Multi-moeda (seção 18) | 3 |
| ↳ Colaboração (seção 19) | 4 |
| ↳ PWA/Mobile (seção 20) | 3 |
| Infraestrutura/DX (seção 21) | 2 |
| Débitos técnicos (seção 22) | 3 |

## 🎯 Próxima tarefa

**FIN-003 — Importação manual de extrato (CSV/OFX) não verifica duplicidade de transações**

### Por quê?

FIN-006, FIN-001 e FIN-002 foram concluídas em 04/09/2026, todas validadas ponta a ponta (as duas últimas contra o sandbox real da Pluggy). Das tarefas P0 restantes, FIN-003 é a próxima na ordem do documento — resolve um bug de duplicação de dados financeiros na importação manual (CSV/OFX), e é pré-requisito de FIN-004 (que depende dela).

### Bloqueios

Nenhum.

---

## 🚀 Roadmap de Releases

### v0.1 — Estabilidade
Todas as tarefas **P0** (seção 0 + FIN-006) e as tarefas de segurança **HIGH** (FIN-007, FIN-008). Objetivo: nenhum bug de duplicação/dado financeiro incorreto conhecido, nenhum risco de segurança crítico/alto em aberto.

### v0.2 — Qualidade
Tarefas **P1** restantes: FIN-022 (edição de transação), FIN-025 (base URL centralizada), FIN-028 (navegação mobile), FIN-015 (migração para centavos) e toda a seção 7 (Testes: FIN-030 a FIN-033). Objetivo: cobertura de teste mínima viável, app usável em mobile, sem dívida técnica bloqueante para crescer com segurança.

### v1.0 — Produto completo
Tarefas **P2** restantes das seções 1–9, 11–13 (segurança média, banco de dados, backend, frontend, UX). Objetivo: produto maduro, sem lacunas conhecidas nas funcionalidades já anunciadas no README.

### v1.1 — Planejamento financeiro
Seção 14 completa (Orçamento, Metas, Recorrências, Projeção de saldo) + Seção 15 (Relatórios básicos: CSV/PDF, comparativos). Objetivo: FinFlow deixa de ser apenas um "registro" financeiro e passa a ajudar o usuário a planejar o futuro.

### v2.0 — Recursos avançados
Seções 16–20 (Notificações completas, Investimentos, Multi-moeda, Colaboração/2FA/Backup, PWA) + tema claro (FIN-083). Objetivo: paridade com dashboards financeiros comerciais maduros.

---

## ✅ Checklist de auditoria (preenchido nesta análise)

- [x] Todo o projeto foi analisado (frontend, backend, schema, parsers, config, sandbox-pluggy).
- [x] README foi comparado com o código (tabela de classificação na seção "Nota sobre o README").
- [x] Bugs foram identificados (seção 0).
- [x] Segurança foi auditada (seção 1).
- [x] Regras financeiras foram auditadas (seção 2).
- [x] Banco foi analisado (seção 3, schema.prisma linha a linha).
- [x] Backend foi analisado (seção 4, server.js completo).
- [x] Frontend foi analisado (seção 5, todos os componentes de `src/`).
- [x] Mobile foi analisado (seção 6, com achado concreto — sidebar inacessível).
- [x] Testes existentes foram analisados (seção 7 — confirmado: nenhum existe).
- [x] Roadmap foi convertido em tarefas técnicas (seções 14–20).
- [x] Todas as tarefas possuem ID único (`FIN-001` a `FIN-085`, mais subtarefas `FIN-015a–d` e os débitos técnicos `FIN-086` a `FIN-088`).
- [x] Todas possuem prioridade (P0–P3).
- [x] Todas possuem critérios de aceite objetivos.
- [x] Dependências foram identificadas explicitamente.
- [x] Tarefas grandes foram divididas (ex. FIN-015 em 4 subtarefas; cada feature de roadmap em 4–8 tarefas menores).
- [x] Existe uma ordem recomendada de execução (Protocolo + Roadmap de Releases).
- [x] Existe protocolo para agentes de código (seção "🤖 Protocolo para Agentes de Código").
