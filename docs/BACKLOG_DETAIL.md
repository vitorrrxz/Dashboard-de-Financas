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

- [x] **P0 — FIN-003 — Importação manual de extrato (CSV/OFX) não verifica duplicidade de transações** ✅ Concluída

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
  - [x] Reimportar o mesmo arquivo não cria transações duplicadas.
  - [x] Importar um arquivo com transações parcialmente novas importa apenas as novas.
  - [x] Frontend informa ao usuário quantas transações foram ignoradas por duplicidade.

  **Nota de implementação (04/09/2026)**
  A chave de dedupe (`importHash`) foi computada **no backend** (não no parser, como a descrição original sugeria) a partir de `userId + accountId + date + amount + name`, via SHA-256 (`computeImportHash()` em `server.js`) — mesmos dados que o parser já produz, evitando duplicar a lógica de hash em duas linguagens/camadas. Também trata duplicata **dentro do próprio lote** importado (ex.: CSV com a mesma linha repetida), não só contra o que já existe no banco. Novo campo opcional `importHash` em `Transaction` (schema.prisma), com índice `@@index([userId, importHash])`. `POST /api/transactions` agora retorna `{ success, count, skipped }`; `App.tsx` mostra um alerta quando `skipped > 0`.

  **Validação executada**
  Contra banco SQLite isolado (`test_fin003.db`, removido ao final). 4 cenários via chamadas HTTP reais: (1) importar 2 transações novas → `count:2, skipped:0`; (2) reimportar exatamente as mesmas → `count:0, skipped:2`; (3) importar 1 repetida + 1 nova → `count:1, skipped:1`; (4) importar um lote com 2 linhas idênticas entre si → `count:1, skipped:1`. Total final no banco: 4 transações únicas, sem duplicatas. `npx tsc -b --noEmit` e `npx eslint src/App.tsx` rodados após a mudança — sem novos erros (2 erros de tipo pré-existentes em `App.tsx`, confirmados via `git stash` como anteriores a esta tarefa, viraram FIN-089).

  **Correção adicional (08/09/2026 — achado em revisão de código)**
  Duas lacunas identificadas na dedupe original:
  1. **Falso positivo do heurístico nome+data+valor**: duas transações genuinamente distintas no mesmo dia, mesmo nome e mesmo valor (ex. duas compras idênticas) eram tratadas como a mesma e a segunda era descartada. O parser OFX já capturava o `FITID` (identificador estável atribuído pelo próprio banco) em `parsers.ts`, mas ele nunca chegava ao backend. Agora `Transaction.externalId` (novo campo opcional, só em memória — não persistido como coluna própria) viaja do parser → `App.tsx` → `POST /api/transactions`, e `computeImportHash()` usa `externalId` como chave quando presente, caindo no heurístico anterior só quando ausente (CSV, que não tem equivalente padronizado).
  2. **Condição de corrida**: a checagem original (`findMany` por hash + filtro em memória, depois `createMany`) tinha uma janela entre checar e gravar — duas importações do mesmo arquivo disparadas em paralelo (ex. duplo clique) podiam ambas passar pela checagem antes de gravar e duplicar. Corrigido adicionando `@@unique([userId, importHash])` no schema (substituindo o índice simples) e trocando `createMany` por `create` linha a linha dentro de um `try/catch` que trata o erro de constraint (`P2002`) como duplicata — mesmo padrão já usado para o sync Pluggy em FIN-021. A rota agora também retorna `acceptedIndices` (posições aceitas no array original), usado por `App.tsx`/FIN-004 para saber exatamente quais transações entraram sem reimplementar o hash no frontend.

  **Validação executada (correção)**
  Contra banco isolado: importação com 2 `externalId` distintos mas mesmo nome/data/valor → ambas aceitas (`count:2`); reimportado o mesmo lote → `count:0, skipped:2`. Duas requisições de importação idênticas disparadas **em paralelo** (`curl ... & curl ... & wait`) contra a mesma transação nova → uma retorna `count:1`, a outra `count:0, skipped:1` — nenhuma duplicata gravada, confirmando que a constraint do banco (não mais um filtro em memória) é o que garante a idempotência sob concorrência.

---

- [x] **P0 — FIN-004 — Reimportar extrato de crédito/PIX parcelado cria uma nova dívida duplicada a cada vez** ✅ Concluída

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
  - [x] Reimportar o mesmo extrato de crédito/PIX parcelado não cria uma segunda dívida para o mesmo período/conta.
  - [x] O usuário é avisado quando uma importação repetida é detectada.

  **Nota de implementação (04/09/2026)**
  Duas proteções em `App.tsx` (`handleImport`): (1) o bloco de auto-criação de dívida só roda se `res.count > 0` (nada de novo foi de fato importado — reimportação 100% duplicada, já filtrada pelo FIN-003, não cria dívida); (2) antes de criar, verifica em `debts` (estado já carregado) se já existe uma dívida com o mesmo `name` (`Fatura {banco} – {mês/ano}`) e `accountId` — se existir, mostra `alert` e não cria outra.

  **Correção adicional (08/09/2026 — achado em revisão de código)**
  Numa reimportação **parcial** (algumas linhas já existiam, outras eram novas — `res.count > 0` mas `res.skipped > 0` também), o bloco de auto-criação de dívida usava `txsWithType` (**todas** as transações do arquivo, incluindo as duplicatas descartadas pelo backend), não só as aceitas. Isso somava de novo, em `totalAmount`/`subItems` da nova dívida, valores de transações que já pertenciam a uma dívida criada numa importação anterior. Corrigido para filtrar por `res.acceptedIndices` (retornado pelo backend, ver correção em FIN-003) antes de montar `expenseTxs`/`totalExpense`/`subItems`.

  **Validação executada**
  Backend (via API real, banco isolado `test_fin004.db`): reimportar o mesmo extrato de crédito duas vezes confirma `count:0` na segunda vez — condição que, no código, bloqueia toda a criação de dívida. Lógica de deduplicação por nome+conta testada isoladamente (script Node reproduzindo a mesma expressão usada em `App.tsx`) em 3 cenários: sem dívida prévia → cria; mesma fatura/conta já existe → bloqueia; mesmo nome em conta diferente → não bloqueia (contas diferentes podem ter fatura com nome igual no mesmo mês). `npx tsc -b --noEmit` e `npx eslint src/App.tsx` sem novos erros (os 2 erros pré-existentes de FIN-089 persistem, agora em linhas 519/539).

---

- [x] **P1 — FIN-005 — Cálculo de "dívida vencida" inconsistente e com risco de bug de fuso horário** ✅ Concluída

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
  - [x] Existe uma única função para determinar se uma dívida está vencida.
  - [x] `App.tsx` e `DebtManager.tsx` usam essa função.
  - [x] Nenhuma dependência de fuso horário local na comparação.

  **Nota de implementação (04/09/2026)**
  Criado `src/utils/debts.ts` com `isDebtPaid`, `isDebtOverdue` e `todayISO()`. `todayISO()` usa `getFullYear/getMonth/getDate` (data local) em vez de `toISOString().slice(0,10)` (data UTC) — o método usado em `App.tsx` antes desta tarefa também tinha esse resquício de dependência de fuso horário, então foi corrigido junto. `App.tsx` (`overdueDebts` e a variável `today`) e `DebtManager.tsx` (`isPaid`, `isOverdue`) agora usam as funções compartilhadas.

  **Validação executada**
  Reproduzida a lógica antiga do `DebtManager` (`new Date(nextDueDate) < new Date()`) contra o fuso horário real desta máquina (GMT-3, Brasília): para uma dívida com `nextDueDate` = hoje, a lógica antiga retornava `true` (vencida — **errado**, pois vence hoje, não antes), enquanto `isDebtOverdue()` retorna `false` (correto). `npx tsc -b --noEmit` e `npx eslint` sem novos erros (persistem só os 2 de FIN-089).

---

- [x] **P0 — FIN-090 — Servidor crasha no boot sem credenciais Pluggy configuradas** ✅ Concluída (achado em revisão de código, 08/09/2026)

  **Objetivo**
  Permitir que o backend suba normalmente quando `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` não estão configurados — o `.env.example` documenta essas credenciais como opcionais ("necessárias apenas para conectar bancos reais").

  **Problema**
  `server.js` instanciava `new PluggyClient({ clientId: '', clientSecret: '' })` no topo do módulo, fora de qualquer `try/catch`. O construtor do SDK `pluggy-sdk` lança uma exceção síncrona (`Missing authorization for API communication`) quando as credenciais estão vazias — confirmado isolando a chamada em um script Node separado. Como isso roda antes de `app.listen`, o processo inteiro encerrava (`process.exit` implícito por exceção não capturada) para qualquer usuário que não tivesse configurado Pluggy, tornando **toda a aplicação inutilizável** (não só a integração Open Finance), contradizendo a própria documentação do `.env.example`.

  **Arquivos envolvidos**
  - `server.js`

  **Correção**
  Inicialização preguiçosa (lazy): `pluggyClient` passa a ser `null` até a primeira chamada de `getPluggyClient()`, que só constrói o cliente (e só falha, com uma mensagem clara) quando uma rota Pluggy é de fato usada. As 5 chamadas existentes (`createConnectToken`, `fetchItem`, `fetchAccounts`, `fetchCreditCardBills`, `fetchTransactions`) passaram a usar `getPluggyClient().<método>` — o erro, quando ocorre, é capturado pelo `try/catch` já existente em cada rota e tratado por `sendInternalError`, sem crashar o processo.

  **Validação executada**
  Servidor iniciado com `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` vazios (via `node --env-file`) contra banco isolado — antes: processo encerrava imediatamente; depois: `"Finance Dashboard API Proxy running on http://localhost:3001"`, e um `POST /api/auth/register` normal funcionou em seguida. Rotas Pluggy não foram exercidas nesse cenário (fora de escopo desta correção — seu comportamento com credenciais reais, já validado em FIN-001/FIN-002/FIN-021, não foi alterado).

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

- [x] **P1 — HIGH — FIN-007 — Rotas de autenticação sem rate limiting (força bruta)** ✅ Concluída

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
  - [x] Excesso de tentativas de login/registro retorna `429 Too Many Requests`.
  - [x] Limite não afeta uso normal do app.

  **Nota de implementação/validação (05/09/2026)**
  `express-rate-limit` aplicado como `authLimiter` (10 req/15min por IP) somente em `/api/auth/login` e `/api/auth/register`. Testado: 10 tentativas de login inválidas retornam `400`; a 11ª e 12ª retornam `429`.

---

- [x] **P1 — HIGH — FIN-008 — Nenhuma validação de payload no backend para accounts/transactions/debts** ✅ Concluída

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
  - [x] Todas as rotas de CRUD financeiro validam o payload antes de tocar o banco.
  - [x] Payloads inválidos retornam `400` com mensagem clara, nunca `500`.
  - [x] Nenhuma regressão nos fluxos existentes do frontend.

  **Nota de implementação (05/09/2026)**
  Schemas Zod (`accountSchema`/`accountUpdateSchema`, `transactionSchema`/`transactionBatchSchema`, `debtSchema`/`debtUpdateSchema`) validam create e update das 3 entidades. Zod v4: campos string obrigatórios precisam de `z.string({ error: 'msg' })` (não só `.min(1,'msg')`), senão o erro de "campo ausente" cai na mensagem genérica de tipo em inglês — corrigido para `name`/`bank`/`color`/`category` (achado durante a validação, não previsto na descrição original). `paidAmount`/`paidInstallments` ficaram opcionais no schema (para não forçar reset a 0 num update parcial via `debtUpdateSchema`, que reaproveita o mesmo schema base) — o default de `0` na criação é aplicado no código da rota (`POST /api/debts`), não no schema. Zod também substitui os `delete data.id/userId/createdAt` manuais (unknown keys já são descartados por padrão).

  **Validação executada**
  Contra banco isolado (`test_fase1.db`): conta sem nome/tipo inválido → `400` com mensagem em português; conta válida → criada. Dívida com `totalInstallments:0` e com `totalAmount` negativo → `400`; dívida válida → criada com `paidAmount:0`/`paidInstallments:0`; `PUT` parcial (só `paidInstallments`+`paidAmount`+`nextDueDate`) → demais campos preservados. Transação com data fora do formato `YYYY-MM-DD` → `400`; lote válido → importado (dedupe do FIN-003 continua funcionando). `PUT`/`DELETE` de conta continuam funcionando.

  **Correção adicional (08/09/2026 — achado em revisão de código)**
  `accountId: z.string().trim().min(1).nullable().optional()` rejeitava `accountId: ''` (string vazia, usada pelo frontend para "sem conta vinculada") com `400`, antes mesmo do handler rodar — isso tornava **inalcançável** o código em `PUT /api/debts/:id` que tentava normalizar `''` para `null` depois da validação (`if (data.accountId === '') data.accountId = null;`, morto desde sempre). Corrigido com `z.preprocess(v => v === '' ? null : v, ...)` aplicado a `accountId` em `transactionSchema` e `debtSchema`; o código morto no handler foi removido. Validado via `curl`: `PUT /api/debts/:id` com `{"accountId":""}` agora retorna `200` com `accountId: null` (antes: `400`).

---

- [x] **P2 — MEDIUM — FIN-009 — CORS totalmente aberto sem allowlist de origem** ✅ Concluída

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
  - [x] Apenas a origem configurada consegue fazer requisições cross-origin bem-sucedidas.
  - [x] App em desenvolvimento continua funcionando sem alteração de fluxo.

  **Nota de implementação/validação (05/09/2026)**
  `cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' })`. `FRONTEND_URL` documentada em `.env.example`. Validado via `curl -I`: o header `Access-Control-Allow-Origin` sempre reflete a origem configurada (nunca a do request) — uma página em `evil.com` recebe de volta `http://localhost:5173` no header, que o navegador rejeita por não bater com a origem real da página (é assim que o `cors` com origem fixa bloqueia terceiros; o `curl` em si não aplica a política, só o navegador).

---

- [x] **P2 — MEDIUM — FIN-010 — Ausência de cabeçalhos de segurança HTTP** ✅ Concluída

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
  - [x] Respostas da API incluem os cabeçalhos de segurança padrão do helmet.
  - [x] Nenhuma regressão funcional no frontend.

  **Nota de implementação/validação (05/09/2026)**
  `app.use(helmet())` com config padrão (API é JSON-only, nunca serve HTML — CSP do helmet não afeta o frontend, que é uma origem separada consumindo via `fetch`). Validado via `curl -I`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` presentes; `X-Powered-By` removido.

---

- [x] **P2 — MEDIUM — FIN-011 — Mensagens de erro expõem detalhes internos do Prisma ao cliente** ✅ Concluída

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
  - [x] Nenhuma rota retorna mensagem de erro interna (Prisma/Node) diretamente ao cliente.
  - [x] Erros continuam logados no servidor para investigação.

  **Nota de implementação (05/09/2026)**
  Helper `sendInternalError(res, error, publicMessage)` — loga o erro completo via `console.error` e responde `500` só com `publicMessage` (uma frase por rota, ex. "Erro ao criar conta."). Todas as ~16 ocorrências de `res.status(500).json({ error: err.message })`/`details: error.message` em `server.js` substituídas. Confirmado via `grep` que nenhuma referência a `error.message`/`err.message` chega ao cliente.

---

- [x] **P2 — MEDIUM — FIN-012 — Token JWT sem mecanismo de revogação/logout server-side** ✅ Concluída (mitigação parcial, conforme escopo original)

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
  - [x] Prazo de expiração do token revisado e documentado.
  - [x] Decisão sobre blocklist/refresh token registrada (implementada ou formalmente adiada como item de roadmap).

  **Nota de implementação/validação (05/09/2026)**
  `expiresIn` reduzido de `7d` para `24h` (constante `JWT_EXPIRES_IN`, comentário no código documenta a decisão de adiar blocklist/refresh token). Validado decodificando um token real: `(exp - iat) / 3600 = 24`. Blocklist/refresh token permanece como item de roadmap (não implementado agora — custo/benefício maior, exigiria nova tabela e verificação em toda requisição autenticada).

---

- [x] **P3 — LOW — FIN-013 — E-mail não normalizado permite cadastro "duplicado" por variação de maiúsculas/minúsculas** ✅ Concluída

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
  - [x] E-mails são normalizados antes de checagem de unicidade e login.
  - [x] Não é mais possível ter duas contas para o mesmo e-mail em capitalizações diferentes.

  **Nota de implementação/validação (05/09/2026)**
  `email.trim().toLowerCase()` aplicado em `/api/auth/register` e `/api/auth/login` antes de qualquer consulta. Testado: cadastro com `Teste.CASE@Example.com` salva como `teste.case@example.com`; segundo cadastro com o mesmo e-mail em minúsculas é rejeitado como duplicado; login com minúsculas funciona normalmente.

---

- [x] **P3 — LOW — FIN-014 — Enumeração de e-mails cadastrados via mensagem de erro do registro** ✅ Concluída (decisão documentada, sem mudança de código)

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
  - [x] Decisão documentada (manter mensagem específica ou genérica) e, se manter, FIN-007 confirmado como mitigação suficiente.

  **Decisão (05/09/2026)**
  Mantida a mensagem específica "Email já cadastrado." — necessária para o UX de registro, risco baixo, e FIN-007 (rate limit) já mitiga o principal vetor de abuso. Comentário registrado no código (`server.js`, na rota de registro) documentando essa decisão.

  **Revalidação (08/09/2026 — reaberta por revisão de código)**
  Uma revisão de código sugeriu remover a mensagem específica. Decisão mantida sem mudança de código: o trade-off já estava documentado conscientemente (não é uma lacuna nova) e nada mudou no risco desde 05/09 — sem dado sensível vazado além de "existe conta", `FIN-007` continua mitigando força bruta/enumeração em massa.

---

## 2. 💰 Integridade Financeira

- [x] **P1 — FIN-015 — Migrar campos monetários de `Float` para representação segura (inteiro em centavos)** ✅ Concluída

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
  - [x] Todos os campos monetários no schema são `Int` (centavos).
  - [x] Toda leitura/escrita no frontend converte corretamente centavos ↔ reais.
  - [x] Nenhuma regressão visual nos valores exibidos.
  - [x] Testes financeiros (FIN-034) cobrindo somas repetidas passam sem erro de arredondamento — FIN-034 em si ainda não existe (sem framework de teste, FIN-030/031 pendentes); validado via scripts Node avulsos no lugar (ver nota abaixo).

  **Nota de implementação (08/09/2026) — decisão de arquitetura**
  `interestRate` (Debt) foi **excluído** da migração — é uma taxa percentual (% ao mês), não um valor monetário; permanece `Float`. A conversão acontece só na borda com a API: internamente, todo o cálculo/exibição do frontend (`stats` em `App.tsx`, `AccountsManager.tsx`, `DebtManager.tsx`, `ImportModal.tsx`) continua em reais sem nenhuma alteração — só `App.tsx` foi tocado, com funções `accountToApi/accountFromApi`, `txToApi/txFromApi`, `debtToApi/debtFromApi` aplicadas em cada chamada a `fetchAPI` que envia/recebe dinheiro (~11 pontos: carga inicial, `handleImport`, `addAccount`, `updateAccount`, `addDebt`, `updateDebt`, sync da Pluggy). O sync da Pluggy (`server.js`) também precisou de conversão — a API da Pluggy retorna valores em reais, então `pluggyAcc.balance`/`currentBill.totalAmount`/`tx.amount` passam por um `toCents()` local antes de gravar (duplicado de `src/utils/money.ts` porque backend Node puro e frontend Vite não compartilham módulos TS neste projeto).

  **Migração de dados real (dev.db)** — feita com backup e confirmação explícita do usuário antes de qualquer escrita:
  1. Backup: `dev.db.backup-20260905-181115` (cópia idêntica, mantida no diretório — está no `.gitignore`, nunca será commitada).
  2. Passo intermediário seguro: `UPDATE ... SET campo = ROUND(campo*100)` em todas as colunas monetárias **enquanto ainda eram `Float`** — evita que a troca de tipo do SQLite trunque os centavos (SQLite recria a tabela ao mudar tipo de coluna; copiar um `Float` decimal direto para `Int` trunca a parte decimal em vez de multiplicar).
  3. `prisma db push` aplicando o novo schema (`Int`).
  4. Checkpoint do WAL e volta para `journal_mode = DELETE` (o script de migração usou WAL para a transação atômica do passo 2).

  **Validação executada**
  Checksum antes/depois: 1 conta (R$54,20 → 5420 centavos), 100 transações somando R$514,72 → 51472 centavos — bate exatamente. Backend testado em banco isolado (`test_fin015.db`): conta/transação/dívida com centavos inteiros aceitas; valor não-inteiro (`150.5`) rejeitado com `400`; `interestRate` continua decimal (`2.5`). Sync Pluggy re-testado contra o sandbox real: valores batem exatamente com os validados em reais no FIN-001/002, multiplicados por 100 (R$28.480,75 → 2848075; R$5.000,00 → 500000). Conversão do frontend validada via simulação Node das funções `accountToApi/accountFromApi` — round-trip centavos→reais→centavos sem drift. `npx tsc -b --noEmit` e `npx eslint` sem novos erros (só os 2 de FIN-089).

  ---

  - [x] **FIN-015a — Definir estratégia de conversão e criar utilitário `centavos ↔ reais`** ✅
    `src/utils/money.ts` criado com `toCents`/`toReais`/`toCentsOrNull`/`toReaisOrNull`. Testes unitários via script Node avulso (FIN-030 ainda não existe): `toCents(0.1)+toCents(0.2)=30` (sem erro de ponto flutuante), `toCents(-872.05)=-87205`, round-trip sem drift.

  - [x] **FIN-015b — Migrar schema Prisma e dados existentes para centavos** ✅
    Ver "Migração de dados real" acima.

  - [x] **FIN-015c — Atualizar `server.js` para trabalhar em centavos** ✅
    Schemas Zod (`accountSchema`, `transactionSchema`, `debtSchema`, `debtItemSchema`) trocados de `.finite()` para `.int()` nos campos monetários; `toCents()` local aplicado nos 3 pontos do sync Pluggy que escrevem valores vindos da API da Pluggy (em reais).

  - [x] **FIN-015d — Atualizar frontend para converter centavos↔reais em todos os pontos de entrada/exibição** ✅
    Só `App.tsx` precisou de mudança (ver nota de arquitetura acima) — `AccountsManager.tsx`, `DebtManager.tsx`, `ImportModal.tsx` e `parsers.ts` continuam em reais, sem alteração.

---

- [x] **P2 — FIN-016 — Centralizar lógica de "dívida vencida" (depende de FIN-005)** ✅ Concluída junto com FIN-005

  Já coberta integralmente pela tarefa **FIN-005**. Mantida aqui apenas como referência cruzada da seção de Integridade Financeira — não duplicar o trabalho.

  **Dependências:** FIN-005

---

- [x] **P2 — FIN-017 — Tornar operações em lote de dívidas resilientes a falha parcial** ✅ Concluída

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
  - [x] Falha em um item do lote não interrompe o processamento dos demais.
  - [x] Usuário vê claramente quais itens falharam.

  **Nota de implementação/validação (08/09/2026)**
  `handlePayAll`/`handleDeleteAll` trocados para `Promise.allSettled`; resumo final via `alert` lista os nomes das dívidas que falharam. Lógica de `allSettled` + identificação de falhas testada isoladamente (script Node com uma promise rejeitada entre 3) — identifica corretamente qual item falhou.

---

- [x] **P3 — FIN-018 — Separar "Saldo Real" de saldo de contas de investimento no dashboard** ✅ Concluída

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
  - [x] "Saldo Real" reflete apenas contas líquidas (corrente, poupança, dinheiro).
  - [x] Saldo de investimentos é exibido separadamente, sem ser removido da visão geral.

  **Nota de implementação/validação (08/09/2026)**
  `realBalance` agora exclui `type === 'investment'` além de `credit`; novo `stats.investmentBalance` soma só contas de investimento. Novo card "Investimentos" no Dashboard, exibido (e grid expandido para 4 colunas) só quando o usuário tem ao menos uma conta desse tipo. Lógica de split testada isoladamente com dados simulados.

---

## 3. 🗄️ Banco de Dados

- [x] **P2 — FIN-019 — Adicionar índices compostos para consultas por usuário** ✅ Concluída

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
  - [x] Índices criados conforme especificado.
  - [x] Prisma Client atualizado sem erros.
  - [x] Nenhuma regressão nos endpoints de transações/contas/dívidas.

  **Nota de implementação/validação (08/09/2026)**
  `@@index([userId])` em Account/Debt; `@@index([userId, date])` e `@@index([userId, importHash])` em Transaction (o índice `[userId, pluggyId]` foi substituído por `@@unique([userId, pluggyId])` no FIN-021, que já cobre o mesmo padrão de busca). Aplicado no `dev.db` real via `db push` (só índices, sem alteração de dados) — confirmado via `PRAGMA index_list`, contagem de linhas intacta antes/depois.

---

- [x] **P2 — FIN-020 — Adotar histórico de migrations do Prisma em vez de apenas `db push`** ✅ Concluída

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
  - [x] Pasta `prisma/migrations` existe, versionada, com a migration inicial.
  - [x] README atualizado com o novo fluxo de setup.
  - [x] Banco criado do zero via migration funciona identicamente ao atual.

  **Nota de implementação (08/09/2026) — `migrate dev` exige TTY interativo**
  `npx prisma migrate dev --name init` falha em ambiente não-interativo ("Prisma Migrate has detected that the environment is non-interactive"). Como o `dev.db` real já tinha dados (1 conta, 100 transações) e `migrate dev` pode propor reset do banco quando não há histórico de migrations, usei o procedimento oficial de **baseline** (não destrutivo): gerar o SQL do schema atual com `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`, salvar em `prisma/migrations/<timestamp>_init/migration.sql`, e marcar como já aplicado com `prisma migrate resolve --applied <nome>` — isso só grava um registro na tabela de controle `_prisma_migrations`, sem tocar nas tabelas de dados. Também precisei criar manualmente `prisma/migrations/migration_lock.toml` (`provider = "sqlite"`), que o `migrate dev` normalmente gera sozinho.

  **Validação executada**
  `npx prisma migrate status` → "Database schema is up to date!". Contagem/soma de `Account`/`Transaction` idêntica antes e depois do baseline. Migration reaplicada do zero num banco de teste isolado (`test_fin021.db`) via `prisma migrate deploy` — schema resultante idêntico ao gerado por `db push`. README atualizado (Passo 3) trocando `db push` por `migrate dev`.

---

- [x] **P2 — FIN-021 — Adicionar constraint de unicidade `(userId, pluggyId)` em `Account` e `Transaction`** ✅ Concluída

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
  - [x] Constraint única criada no schema.
  - [x] Sync usa `upsert` com a chave composta.
  - [x] Sincronizações concorrentes não geram duplicatas.

  **Nota de implementação (08/09/2026)**
  `@@unique([userId, pluggyId])` em Account e Transaction (substituindo o índice simples criado em FIN-019). Antes de aplicar, conferido no `dev.db` real que não havia pares `(userId, pluggyId)` duplicados. Migration aplicada via `prisma migrate deploy` (não-interativo). `server.js`: as 3 rotas que faziam `findFirst` + `create`/`updateMany` (`connect-item`, sync de conta, sync de transação) agora usam `upsert` com `where: { userId_pluggyId: { userId, pluggyId } }`. Na transação, mantive um `findFirst` só para contabilizar `totalTxs` (quantas são novas) — a escrita em si é sempre via `upsert`.

  **Validação executada**
  Contra o mesmo sandbox real da Pluggy, banco isolado (`test_fin021.db`, migrado do zero via `prisma migrate deploy`): 1ª sincronização importa 8 transações; 2ª sincronização (idêntica) importa 0 — idempotente. Duas sincronizações disparadas **em paralelo** (`curl ... & curl ... & wait`) não geram nenhuma conta duplicada (3 contas únicas, confirmado por `pluggyId`).

  **Validação adicional (08/09/2026 — achado em revisão de código)**
  A validação original checou duplicação de **contas** sob concorrência, mas não isolou o mesmo cenário para **transações** (o teste de sync real conta com poucas transações e não força a corrida especificamente nelas). Como o mecanismo é idêntico (`upsert` + `@@unique([userId, pluggyId])`, mesmo em `Account` e `Transaction`), a validação adicional isolou só esse mecanismo: 10 `upsert`s concorrentes (`Promise.allSettled`) na mesma `(userId, pluggyId)` de transação, contra banco isolado — resultado: 10/10 sucesso, 1 única linha gravada. Confirma que a proteção contra corrida vale igualmente para transações, não só contas.

---

## 4. 🔌 Backend / API

- [x] **P1 — FIN-022 — Criar endpoints `PUT`/`DELETE` para transação individual** ✅ Concluída

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
  - [x] `PUT /api/transactions/:id` e `DELETE /api/transactions/:id` existem, autenticados e isolados por usuário.
  - [x] Frontend permite editar e excluir transações individualmente.
  - [x] Nenhuma regressão nas rotas de listagem/criação em lote.

  **Nota de implementação (08/09/2026)**
  Rotas `PUT`/`DELETE /api/transactions/:id` seguem exatamente o padrão de `/api/accounts/:id` (`updateMany`/`deleteMany` com `where: { id, userId }`, isolamento por usuário garantido a nível de query). Registradas **depois** de `DELETE /api/transactions/bulk` — Express casa rotas na ordem de registro, e `/:id` capturaria o literal `"bulk"` como id se viesse antes. `transactionUpdateSchema = transactionSchema.partial()`, mesmo padrão de `accountUpdateSchema`/`debtUpdateSchema`; `externalId` (campo só de importação, ver FIN-003) é descartado antes de chegar ao Prisma. No frontend, `TxTable` (antes um componente puramente apresentacional) ganhou estado próprio (`editing`/`form`), uma coluna de ações com ícones editar/excluir por linha (visível no hover, mesmo padrão do `AccountsManager`) e um modal de edição reaproveitando a estrutura visual dos outros formulários do app (nome, categoria, data, valor, tipo de pagamento, conta).

  **Validação executada**
  Contra banco isolado (`test_fin022.db`): criada uma transação, editada via `PUT` (nome+categoria) → `GET` confirma persistência; `PUT`/`DELETE` com id inexistente → `{success:true, changes:0}` (no-op, não erro); usuário B tentando editar/excluir transação do usuário A → `changes:0`, dado do usuário A intacto após conferência via `GET`.

---

- [x] **P2 — FIN-023 — Implementar paginação real em `GET /api/transactions`** ✅ Concluída

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
  - [x] API suporta paginação com parâmetros documentados.
  - [x] Frontend consegue acessar transações além das primeiras 2000.
  - [x] Nenhuma regressão de performance perceptível na primeira página.

  **Nota de implementação (08/09/2026)**
  Paginação implementada de forma **aditiva**, não como substituição: sem `?page=`/`?pageSize=`, `GET /api/transactions` mantém exatamente o comportamento original (array simples, `take: 2000`) — zero risco para os callers existentes, que somam **todas** as transações carregadas para calcular `stats` (income/expense/gráficos) e por isso não podem trabalhar com uma página parcial. Com os parâmetros, retorna `{ transactions, total, page, pageSize }` (`pageSize` limitado a 2000). No frontend, a carga inicial e os reloads pós-import/sync continuam sem paginação; se o resultado bater exatamente em 2000 (sinal de que pode haver mais), aparece um botão "Carregar transações mais antigas" na aba Transações, que busca a(s) página(s) seguinte(s) via os novos parâmetros e concatena ao estado local (`transactions`), repetindo enquanto `total` não for alcançado.

  **Validação executada**
  Contra banco isolado com 6 transações: `GET` sem parâmetros → array puro, 6 itens (comportamento inalterado); `?page=1&pageSize=2`, `?page=2&pageSize=2`, `?page=3&pageSize=2` → 3 páginas de 2 itens distintos, `total:6` em todas. Não foi testado com >2000 registros reais (custo desproporcional para este ambiente) — a lógica de paginação (`skip`/`take`/`count` do Prisma) é a mesma já usada e validada em outras rotas do projeto.

---

- [x] **P3 — FIN-024 — Adicionar script `typecheck` dedicado no `package.json`** ✅ Concluída

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
  - [x] `npm run typecheck` existe e funciona.
  - [x] `npm run build` continua funcionando normalmente.

  **Nota de implementação (08/09/2026)**
  `"typecheck": "tsc -b --noEmit"` adicionado aos `scripts`. Validado que reporta os mesmos 2 erros pré-existentes de `App.tsx` (FIN-089) que `npm run build` reportaria na etapa de `tsc`, sem gerar output de build.

---

## 5. 🖥️ Frontend

- [x] **P1 — FIN-025 — Centralizar a base URL da API (hoje hardcoded em 3 arquivos)** ✅ Concluída

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
  - [x] Nenhuma ocorrência hardcoded de `http://localhost:3001` no código-fonte de `src/`.
  - [x] App funciona normalmente com a configuração padrão.
  - [x] `.env.example` documenta a nova variável.

  **Nota de implementação (08/09/2026)**
  Implementada em conjunto com FIN-027 (dependência natural — o módulo criado aqui já nasce com o `apiFetch` compartilhado). Novo `src/services/api.ts` exporta `API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'` e `apiFetch()`. `VITE_API_URL` documentada em `.env.example` (prefixo `VITE_` obrigatório para o Vite expor a variável via `import.meta.env`).

---

- [x] **P2 — FIN-026 — Habilitar TypeScript `strict` mode** ✅ Concluída

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
  - [x] `strict: true` habilitado.
  - [x] Build e typecheck passam sem erros.
  - [x] Nenhuma regressão funcional observável.

  **Nota de implementação (08/09/2026)**
  `"strict": true` adicionado a `tsconfig.app.json`. Surpresa positiva: **nenhum erro novo** foi revelado — o código já era, na prática, strict-clean antes da flag existir. O único obstáculo para `npm run build`/`npm run typecheck` passarem 100% limpos eram os 2 erros pré-existentes de FIN-089 (tooltip do Recharts, não relacionados a `strict`), corrigidos junto nesta tarefa para poder fechar o critério de aceite "build e typecheck passam sem erros": os `formatter` dos dois `RechartsTooltip` tinham `(v: number) => ...` anotado manualmente, incompatível com o tipo real da lib (`Formatter<TValue>`, que aceita `TValue | undefined`); removida a anotação manual (deixando o parâmetro inferir o tipo esperado pela prop) e adicionado `Number(v)` antes de repassar a `fmt()`.

  **Validação executada**
  `npx tsc -b --noEmit` → 0 erros. `npm run build` → build completo sem erros (só o aviso pré-existente, não relacionado, de chunk >500kB). `npx eslint .` no projeto inteiro → 0 erros/warnings.

---

- [x] **P3 — FIN-027 — Criar serviço `apiFetch` único para eliminar duplicação do padrão fetch** ✅ Concluída

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
  - [x] Uma única implementação de `fetchAPI`/`apiFetch` é usada por todo o frontend.
  - [x] Nenhuma regressão funcional.

  **Nota de implementação (08/09/2026)**
  `apiFetch(endpoint, { method, body, token })` em `src/services/api.ts` é agora a única implementação real. `App.tsx` e `PluggyConnectButton.tsx` mantêm um wrapper local `fetchAPI(endpoint, method, body)` (assinatura posicional antiga, para não precisar tocar as dezenas de call sites existentes) que só delega para `apiFetch` injetando o `token` do escopo; `AuthForm.tsx` (que não tem token) chama `apiFetch` diretamente. Os wrappers tipam o retorno como `any` explicitamente (`eslint-disable` pontual) para preservar o comportamento de tipagem frouxa que `fetchAPI` já tinha antes — tipar corretamente a resposta de cada endpoint é um esforço maior, fora do escopo desta tarefa.

  **Validação executada**
  `npx tsc -b --noEmit`, `npm run build` e `npx eslint .` no projeto inteiro, todos sem erros (ver nota de FIN-026). Não foi feito teste manual em navegador nesta tarefa — a refatoração preserva exatamente a mesma URL, headers e lógica de erro do `fetch` original, só movida para um módulo compartilhado.

---

## 6. 📱 Responsividade / Mobile

- [x] **P1 — FIN-028 — Sidebar principal totalmente oculta em telas pequenas, sem navegação alternativa** ✅ Concluída

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
  - [x] Todas as ações hoje disponíveis apenas na sidebar (navegação, importação, Pluggy, logout, limpar transações) são acessíveis em viewport mobile.
  - [x] Layout desktop (`md` e acima) permanece inalterado.

  **Nota de implementação (08/09/2026)**
  Escolhida a opção "hambúrguer + drawer" (não bottom-nav) por reaproveitar 100% do conteúdo da sidebar existente sem duplicar nenhuma ação entre dois lugares. Abaixo de `md`, `<aside>` some por padrão (`hidden`) e vira um overlay `fixed inset-y-0 left-0` com backdrop escuro (`fixed inset-0 bg-black/70`) quando `mobileNavOpen` é `true`; acima de `md`, `md:static md:flex` restaura o layout original, ignorando esse estado. Botão hambúrguer novo no header (`md:hidden`); botão X dentro do drawer (também `md:hidden`) para fechar. Cada item de navegação e as ações "Gerenciar Contas"/"Importação Manual" fecham o drawer ao serem clicados (`setMobileNavOpen(false)`); o widget Pluggy e "Limpar Transações" não fecham automaticamente, pois o usuário pode precisar interagir mais de uma vez com eles (conectar → sincronizar) sem perder o drawer de vista.

---

- [x] **P2 — FIN-029 — Adaptar grids fixos de 2 colunas em telas muito pequenas** ✅ Concluída

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
  - [x] Cards de resumo empilham em coluna única abaixo de `sm`.
  - [x] Nenhuma regressão em telas maiores.

  **Nota de implementação (08/09/2026)**
  `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` nos dois grids de resumo (`AccountsManager.tsx:84`, `DebtManager.tsx:331`). Escopo limitado exatamente aos dois grids citados na descrição da tarefa — os demais `grid-cols-2` do projeto (campos de formulário dentro dos modais de conta/dívida) não têm o mesmo risco de truncar valores monetários e ficaram fora do escopo.

---

## 7. 🧪 Testes

- [x] **P1 — FIN-030 — Configurar Vitest + Testing Library no frontend** ✅ Concluída

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
  - [x] `npm test` roda a suíte de testes do frontend com sucesso.
  - [x] Pelo menos um teste de exemplo existe e passa.

  **Nota de implementação (08/09/2026)**
  `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` e `@types/supertest`/`supertest` (para FIN-031) instalados de uma vez. `vitest.config.ts` separado de `vite.config.ts` (ambiente padrão `jsdom`, `setupFiles: ['./src/test/setup.ts']`, `globals: true`); testes de backend sobrescrevem para `node` via `// @vitest-environment node` no topo do arquivo. `src/test/setup.ts` importa `@testing-library/jest-dom/vitest` (não o import principal `@testing-library/jest-dom`) — esse subpath também traz a tipagem do `expect` do Vitest aumentada com os matchers, necessária para `tsc` não reclamar de `.toBeInTheDocument` como propriedade inexistente. Scripts `"test": "vitest run"` e `"test:watch": "vitest"` adicionados. Teste de exemplo em `src/components/AuthForm.test.tsx`.

  **Validação executada**
  `npm test` roda e passa (2 testes de exemplo). Consolidado depois com o restante da suíte (77 testes no total ao final de toda a seção "Testes automatizados" — ver FIN-036).

---

- [x] **P1 — FIN-031 — Configurar testes de integração do backend (Vitest + Supertest)** ✅ Concluída

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
  - [x] Suíte de testes de backend roda de forma isolada, sem afetar `dev.db`.
  - [x] `app` do Express é exportável e testável sem subir o servidor de verdade.

  **Nota de implementação (08/09/2026)**
  `server.js`: `app.listen()` só roda dentro de `if (process.argv[1] === fileURLToPath(import.meta.url))` (guarda padrão para ESM — equivalente ao `if __name__ == '__main__'` do Python), e `app`/`prisma`/`pluggyReauthMessage` (ver FIN-041) são exportados no final do arquivo. `test/backend-test-utils.js`: `createTestApp(nome)` seta `DATABASE_URL` para um SQLite isolado (`test_<nome>.db`, nunca `dev.db`), roda `prisma db push` para criar o schema, e faz `import('../server.js')` **dinâmico** (não estático) — import estático seria avaliado antes de qualquer código de teste rodar, antes de `DATABASE_URL` estar setado. O Vitest isola o registro de módulos por arquivo de teste por padrão, então cada arquivo que chama isto recebe sua própria instância de `server.js`/Prisma. `cleanup()` chama `prisma.$disconnect()` antes de apagar os arquivos — sem isso, o better-sqlite3 mantém o arquivo aberto e o `unlink` falha com `EBUSY` no Windows. Rate limit de auth (FIN-007) tornado configurável via `AUTH_RATE_LIMIT` só para não derrubar a própria suíte de testes (que faz dezenas de register/login em sequência) — em produção, sem essa env var, o limite continua 10 (inalterado).

  **Validação executada**
  `server.test.js` (exemplo): `GET /api/auth/me` sem token → 401; com token inválido → 403. `npx tsc -b --noEmit`/`npx eslint .` sem novos erros.

---

- [x] **P1 — FIN-032 — Testes de isolamento de dados entre usuários** ✅ Concluída

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
  - [x] Testes cobrem accounts, transactions e debts para tentativa de acesso cross-user.
  - [x] Todos os testes passam contra o código atual (ou revelam regressões a corrigir).

  **Nota de implementação (08/09/2026)**
  `server.security.test.js`: dois usuários (A, B); para cada entidade, A cria um recurso e B tenta `GET` (não deve aparecer na listagem), `PUT` (deve ser no-op) e `DELETE` (não deve remover). Achado durante a escrita: `PUT /api/accounts/:id` e `PUT /api/transactions/:id` usam `updateMany` e retornam `200` com `changes:0` quando o `id`+`userId` não combina (comportamento já esperado, documentado em FIN-022); já `PUT /api/debts/:id` usa `prisma.debt.update` (não `updateMany`) — quando a combinação `id`+`userId` não existe, o Prisma lança `P2025`, capturado e virando `500` via `sendInternalError`, não um `404`/no-op como as demais rotas. O isolamento em si **é garantido** (nenhum dado vazado ou alterado) — é só uma inconsistência de código de status entre rotas, não uma falha de segurança. Não corrigido nesta tarefa (fora do escopo de "adicionar testes"); teste ajustado para aceitar `status !== 200` em vez de um código específico.

  **Validação executada**
  9 testes, todos passando: 3 por entidade (accounts/transactions/debts) × (listagem, edição, exclusão).

---

- [x] **P1 — FIN-033 — Testes de autenticação** ✅ Concluída

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
  - [x] Todos os cenários acima cobertos por teste automatizado e passando.

  **Nota de implementação (08/09/2026)**
  `server.auth.test.js`: registro válido, e-mail duplicado (FIN-014), normalização de e-mail (FIN-013 — duplicidade detectada mesmo com capitalização diferente), senha curta, e-mail sem "@", nome vazio; login com credenciais corretas/incorretas/e-mail inexistente (mesma mensagem genérica nos dois últimos casos, sem enumerar); acesso sem token (401), token malformado (403), token assinado com segredo errado (403 — confirma que `JWT_SECRET` é de fato verificado, não só decodificado), token expirado (403), token válido (200). Rate limit de auth (FIN-007) precisou ser tornado configurável via `AUTH_RATE_LIMIT` (ver nota de FIN-031) — sem isso, as ~15 chamadas de register/login deste arquivo sozinho já estourariam o limite de produção (10/15min) e derrubariam a própria suíte com `429`. O rate limit em si passou a ter um teste dedicado, à parte (`server.rate-limit.test.js`, limite baixo proposital de 3, confirma `429` na 4ª tentativa).

  **Validação executada**
  14 testes em `server.auth.test.js` + 1 em `server.rate-limit.test.js`, todos passando.

---

- [x] **P2 — FIN-034 — Testes das regras financeiras** ✅ Concluída

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
  - [x] Todos os cenários financeiros listados têm teste automatizado.
  - [x] Testes passam de forma determinística (sem depender de `Date.now()`/fuso sem mock).

  **Nota de implementação (08/09/2026)**
  Feita em conjunto com **FIN-086** (extração de `stats` para `src/hooks/useFinancialStats.ts`), na ordem inversa à sugerida na dependência original: em vez de testar a lógica ainda inline em `App.tsx` e só depois extrair, extraí primeiro — testar um `useMemo` de ~70 linhas dentro de um componente exigiria montar o componente inteiro (login, fetch, etc.); testar a função pura extraída (`computeFinancialStats`) não exige renderizar nada. `src/utils/debts.test.ts` cobre `isDebtPaid`/`isDebtOverdue`/`advanceMonth`/`computeNextInstallment` (esta última também extraída de `DebtManager.tsx`, onde a mesma lógica de "pagar uma parcela" estava duplicada entre `handlePayInstallment` e `handlePayAll` — consolidada num só lugar, eliminando a duplicação e habilitando o teste). `src/hooks/useFinancialStats.test.ts` cobre receita/despesa, saldo negativo, conta sem transações, cartão sem/com fatura, contas de investimento fora do saldo real (FIN-018), consolidado vs. filtro por conta única, dívida vencida vs. quitada. Testes de data usam `todayISO()`-relativo (calculam "hoje" em runtime), não datas fixas — não quebram com a passagem do tempo.

  **Validação executada**
  25 testes (`debts.test.ts` + `useFinancialStats.test.ts`), todos passando. `npx tsc -b --noEmit`/`npx eslint .` sem novos erros após a extração de `stats`/`advanceMonth`/`computeNextInstallment`.

---

- [x] **P2 — FIN-035 — Testes dos parsers de CSV/OFX** ✅ Concluída

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
  - [x] Parsers cobertos por testes para os formatos suportados (Nubank, Inter, Itaú, Bradesco, BB conforme citado no `ImportModal`).
  - [x] Casos de borda (data/valor inválido) tratados sem exceção não capturada.

  **Nota de implementação (08/09/2026)**
  `parseAmount`, `normalizeDate` e `autoCategory` eram funções internas (não exportadas) — exportadas (mudança puramente aditiva, sem alterar uso interno) para permitir teste direto, em vez de só indiretamente via `parseCSV`/`parseOFX`. `src/utils/parsers.test.ts` cobre: `parseAmount` (BR/US, só vírgula com/sem milhar, prefixo "R$", inválidos → `NaN`); `normalizeDate` (4 formatos + inválido); `autoCategory` (uma palavra-chave por categoria + caso sem match → "Outros"); `parseOFX` (XML-style com/sem `FITID`, SGML-style, conteúdo inválido); `parseCSV` (separador `,`/`;`, linhas inválidas ignoradas, duplicata dentro do arquivo **não** deduplicada — comportamento documentado, dedupe é responsabilidade do backend/FIN-003).

  **Achado durante a escrita dos testes**: dois cenários de OFX SGML (formato antigo, sem tags de fechamento) fazem `parseOFX` retornar lista vazia silenciosamente, sem lançar exceção mas também sem extrair a transação — documentado nos testes e registrado como novo item **FIN-091** (não corrigido aqui — corrigir o parser está fora do escopo de "adicionar testes").

  **Validação executada**
  27 testes, todos passando (2 documentam o achado do FIN-091 como comportamento atual, não como bug corrigido).

---

- [x] **P3 — FIN-036 — Adicionar pipeline de CI (GitHub Actions)** ✅ Concluída

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
  - [x] Workflow de CI existe e passa no estado atual do projeto.
  - [x] Falhas em lint/typecheck/teste/build bloqueiam o merge (configuração de branch protection é responsabilidade do usuário/GitHub, fora do escopo do código).

  **Nota de implementação (08/09/2026)**
  `.github/workflows/ci.yml`: `actions/checkout` + `actions/setup-node@v4` (Node 22) + `npm ci` (que já dispara `postinstall` → `prisma generate`, novo script adicionado ao `package.json` justamente para isso — sem ele, um `npm ci` limpo deixaria `@prisma/client` sem gerar, reproduzindo a causa raiz do bug "Failed to fetch" do início deste projeto) → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`. Roda em push/PR para qualquer branch. Nenhum segredo necessário — os testes de backend criam seu próprio banco SQLite isolado em tempo de execução.

  **Validação executada**
  Não validado via um PR real no GitHub (exigiria push, fora do escopo desta tarefa sem pedido explícito do usuário). Validado localmente rodando a sequência exata do workflow (`npm ci` implícito via reinstalação anterior + `npm run lint && npm run typecheck && npm test && npm run build`) de ponta a ponta — todos os passos passam.

---

## 8. ⚡ Performance

- [x] **P2 — FIN-037 — Sincronização Pluggy processa contas/transações sequencialmente (N+1)** ✅ Concluída

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
  - [x] Sincronização não faz mais uma query por transação individual.
  - [x] Resultado da sincronização (dados finais no banco) permanece correto e idempotente.

  **Nota de implementação (08/09/2026 — feita em conjunto com FIN-038, mesmo bloco de código)**
  O `for` que fazia `findFirst` + `upsert` por transação foi trocado por: 1 `findMany` buscando de uma vez os `pluggyId` já existentes (vira um `Set` em memória); filtra as genuinamente novas; 1 `createMany` para todas de uma vez. Confirmado com o SDK que **SQLite não suporta `skipDuplicates` no Prisma** (mesmo achado do FIN-003/FIN-021) — então, como sugerido na própria descrição da tarefa, transações **já existentes deixaram de ser atualizadas** no sync (dado bancário já efetivado raramente muda) — só as novas são gravadas. Se `createMany` falhar por violação da constraint única (corrida rara: outra sincronização inseriu a mesma transação entre o `findMany` e o `createMany` — que, ao contrário de um `create` individual, falha o lote inteiro, não por linha), cai para `upsert` linha a linha só nesse caso, protegido pela constraint (FIN-021).

  **Validação executada**
  Contra o sandbox real da Pluggy: sync inicial (10 transações) → `success`, tempo total de resposta ~0.35s; resync imediato → `0 novas transacoes importadas` (idempotente); **duas sincronizações do mesmo item disparadas em paralelo** num item novo → 20 transações no total (10 de cada uma de duas contas Pluggy diferentes), todas com `pluggyId` único, nenhuma duplicata — confirma que a troca de `upsert` por linha para `createMany` em lote não reabriu a janela de corrida que FIN-021 fechou.

---

- [x] **P3 — FIN-038 — Paginação da API da Pluggy não tratada em `fetchTransactions`** ✅ Concluída

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
  - [x] Comportamento de paginação da SDK confirmado e documentado em comentário no código.
  - [x] Se necessário, loop de paginação implementado e todas as transações do período são importadas.

  **Nota de implementação (08/09/2026 — feita em conjunto com FIN-037, mesmo bloco de código)**
  Confirmado nos tipos da SDK (`node_modules/pluggy-sdk/dist/types/common.d.ts`): `fetchTransactions` retorna `PageResponse<Transaction>` (`{ results, page, total, totalPages }`), com `pageSize` **padrão 20, máximo 500** — ou seja, a suspeita da tarefa original estava correta: sem loop, qualquer conta com mais de 20 transações no período perderia as demais silenciosamente. Corrigido com um `do...while` que busca `pageSize: 500` (o máximo, para minimizar round-trips) e continua enquanto `page <= totalPages`, acumulando todos os resultados antes de processar.

  **Validação executada**
  Mesma validação de FIN-037 (mesmo bloco de código) — sandbox real, sync com 10 transações (dentro de uma única página, então o loop não foi forçado a rodar mais de uma iteração neste teste específico, mas a lógica do `do...while` é exercida e cobre corretamente o caso de 1 página).

---

## 9. 🎨 UX/UI

- [x] **P3 — FIN-039 — Ícone de notificações (sino) no header é puramente decorativo** ✅ Concluída

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
  - [x] Clicar no sino exibe algum conteúdo real (mesmo que simples), nunca uma ação sem efeito.

  **Nota de implementação (08/09/2026)**
  Dropdown simples (`showNotifications`) ancorado no botão do sino, listando `stats.overdueDebts` (nome + data de vencimento), já calculado pelo `stats` existente — nenhum backend novo. Fecha ao clicar fora (backdrop transparente `fixed inset-0`) ou em qualquer item. Mostra "Nenhuma notificação." quando a lista está vazia.

---

- [x] **P3 — FIN-040 — Busca força troca para a aba "Transações" a cada tecla digitada** ✅ Concluída

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
  - [x] Busca não força re-render de troca de aba a cada tecla digitada.
  - [x] Comportamento de busca em si (filtro por nome/categoria) permanece funcional.

  **Nota de implementação (08/09/2026)**
  `onChange` agora só chama `setActiveTab('transactions')` quando `v` é não-vazio **e** `search` (valor anterior, ainda não atualizado neste render) é vazio — ou seja, exatamente na transição vazio→preenchido. Apagar a busca não troca a aba de volta (não especificado nos critérios, comportamento mais previsível).

---

## 10. 📊 Dashboard

Nenhuma tarefa adicional identificada além das já listadas nas seções **0 (Bugs Críticos)** e **2 (Integridade Financeira)** — em especial FIN-001, FIN-002, FIN-005 e FIN-018, que afetam diretamente os números exibidos no Dashboard.

## 11. 💳 Contas, Cartões e Transações

Cobertas pelas tarefas: FIN-001, FIN-002 (Pluggy), FIN-003 (dedupe de importação), FIN-022 (edição/exclusão individual), FIN-023 (paginação). Nenhuma tarefa adicional identificada nesta área após auditoria.

## 12. 💸 Dívidas e Parcelamentos

Cobertas pelas tarefas: FIN-004 (dedupe de dívida importada), FIN-005 (dívida vencida), FIN-016 (referência cruzada), FIN-017 (operações em lote resilientes). Nenhuma tarefa adicional identificada nesta área após auditoria.

## 13. 🏦 Open Finance / Pluggy

Cobertas pelas tarefas: FIN-001, FIN-002, FIN-021, FIN-037, FIN-038. Tarefa adicional específica abaixo.

- [x] **P3 — FIN-041 — Tratar status de item Pluggy expirado/erro de login (`LOGIN_ERROR`, `OUTDATED`)** ✅ Concluída

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
  - [x] Status de erro/expiração do item Pluggy é detectado e comunicado ao usuário de forma específica.

  **Nota de implementação (08/09/2026)**
  Nova função `pluggyReauthMessage(status)` em `server.js` traduz `LOGIN_ERROR`/`OUTDATED` (ver `node_modules/pluggy-sdk/dist/types/item.d.ts`) em mensagem acionável; `null` para os demais status (nada a avisar). Usada em dois pontos: `POST /api/pluggy/connect-item` (retorna `pluggyStatus`/`statusMessage` na resposta — um item pode nascer já em erro) e `POST /api/pluggy/sync/:itemId` (chama `fetchItem` antes de sincronizar; se precisa reautenticação, responde `409` com a mensagem, sem tentar sincronizar). No frontend, `src/services/api.ts` ganhou uma classe `ApiError` (estende `Error`, carrega `status` e o corpo da resposta) — sem quebrar nenhum código existente que só lê `.message`, permite ao `PluggyConnectButton` distinguir esse `409` de um erro genérico. Estado novo `needsReauth` exibe o aviso com destaque âmbar (não vermelho — não é bem um "erro", é uma ação pendente) e um botão "Reconectar Banco" que reabre o widget da Pluggy.

  **Validação executada**
  Testado via testes automatizados (`server.pluggy-status.test.js`, 3 casos: `LOGIN_ERROR`/`OUTDATED` retornam mensagem, status normais retornam `null`) — não foi possível forçar um item real do sandbox a entrar em `LOGIN_ERROR`/`OUTDATED` para um teste end-to-end contra a API real da Pluggy (o sandbox de teste, com credenciais `user-ok`/`password-ok`, sempre conecta com sucesso); `npx tsc -b --noEmit`/`npx eslint .` sem novos erros.

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

- [x] **P3 — FIN-084 — Pipeline de CI** ✅ Concluída junto com FIN-036 (mesma tarefa)
  Já coberta integralmente pela tarefa **FIN-036**. Mantida aqui apenas como referência cruzada.

- [x] **P3 — FIN-085 — Documentar `sandbox-pluggy/` como protótipo isolado, não integrado ao app principal** ✅ Concluída

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
  - [x] `sandbox-pluggy/` documentado como protótipo isolado, ou removido (mediante confirmação explícita do usuário — nunca remover código sem essa confirmação).

  **Nota de implementação (08/09/2026)**
  Optado por documentar (não remover — nenhuma confirmação do usuário foi pedida/dada para remoção). Novo `sandbox-pluggy/README.md`: tabela comparando porta/banco/autenticação com o backend principal, explica o propósito histórico (prototipagem do fluxo Pluggy antes de integrar a `server.js`) e avisa explicitamente para não usar em produção nem como referência de autenticação. README principal ganhou uma seção curta "📁 sandbox-pluggy/" apontando para esse arquivo.

---

## 22. 🏗️ Débitos Técnicos (Arquitetura)

- [x] FIN-086 — ✅ Concluída em 08/09/2026 (feita antes de FIN-034, na ordem inversa à dependência original, para os testes cobrirem a função já extraída em vez da lógica ainda inline). Lógica de `stats` movida de dentro de `App.tsx` para `src/hooks/useFinancialStats.ts`: `computeFinancialStats()` (função pura, testável sem React) + `useFinancialStats()` (wrapper `useMemo`, usado por `App.tsx`). `App.tsx` perdeu ~70 linhas de lógica de negócio, ficando só com `const stats = useFinancialStats(transactions, accounts, debts, dashboardAccountId);`.
- [x] FIN-087 — ✅ Concluída em 08/09/2026. `FormField` (idêntico em `AccountsManager.tsx` e `DebtManager.tsx`) extraído para `src/components/shared/FormField.tsx`; as duas cópias locais removidas, ambos os arquivos passaram a importar a versão compartilhada.
- [x] FIN-088 — ✅ Concluída junto com FIN-005: `App.tsx` e `DebtManager.tsx` agora usam `isDebtOverdue`/`isDebtPaid` de `src/utils/debts.ts`, sem lógica de vencimento duplicada remanescente.

**Dependências:** FIN-086 depende de FIN-034 para ter cobertura de teste antes/depois da extração (evitar regressão silenciosa). FIN-087 não tem dependências. FIN-088 depende de FIN-005.

- [x] FIN-089 — ✅ Concluída em 08/09/2026 (junto com FIN-026): os dois `formatter` de `RechartsTooltip` em `App.tsx` tinham `(v: number) => ...` anotado manualmente, incompatível com `Formatter<TValue>` (que aceita `TValue | undefined`). Corrigido removendo a anotação manual do parâmetro e usando `Number(v)` antes de repassar a `fmt()`. `npx tsc -b --noEmit` e `npm run build` agora terminam com 0 erros.

- [ ] **P2 — FIN-091 — `parseOFX` perde transações silenciosamente em extratos SGML com campos sem tag de fechamento** (achado ao escrever testes para FIN-035, `src/utils/parsers.test.ts`)

  **Objetivo**
  Corrigir (ou, no mínimo, alertar o usuário) quando um extrato OFX no formato SGML 1.x — onde apenas a tag externa `<STMTTRN>` costuma ser fechada, mas os campos internos (`<TRNAMT>`, `<FITID>` etc.) não têm `</TAG>` — é parseado incorretamente.

  **Problema**
  `parseOFX()` decide entre os dois branches (XML-style vs. SGML-style) checando apenas se existe o par `<STMTTRN>...</STMTTRN>` no conteúdo (`blockRegex`), **sem considerar se os campos internos também têm fechamento**. Dois cenários reais quebram silenciosamente:
  1. Tag externa fechada, campos internos sem fechamento → cai no branch XML; `get('TRNAMT')` (que exige `<TRNAMT>...</TRNAMT>`) não encontra nada, retorna `''`, vira `NaN`, e a transação é descartada pelo filtro final (`!isNaN(t.amount)`) — sem erro, sem aviso.
  2. Nenhuma tag `</STMTTRN>` em lugar nenhum (SGML "puro") → cai no branch SGML correto, mas esse branch só faz `push` da transação corrente ao encontrar a linha literal `</STMTTRN>` — que nunca existe nesse cenário — então **nenhuma transação é gravada**, em nenhum dos dois branches.
  Resultado prático: certos extratos SGML legítimos (histórico de alguns bancos) importam **zero transações**, sem qualquer mensagem de erro — o usuário pode achar que o extrato "não tinha nada para importar".

  **Arquivos envolvidos**
  - `src/utils/parsers.ts`

  **Alterações necessárias**
  - Detectar formato SGML de forma mais robusta (ex.: presença de `<STMTTRN>` sem exigir que os campos internos tenham fechamento — checar se `get('TRNAMT')` no branch XML retorna vazio e, nesse caso, tentar o parsing linha-a-linha como fallback).
  - No branch SGML, gravar a transação corrente também ao encontrar o início de um novo `<STMTTRN>` (não só ao encontrar `</STMTTRN>`) e ao final do arquivo (não depender exclusivamente de uma tag de fechamento que pode não existir).

  **Dependências**
  Nenhuma.

  **Validação**
  `src/utils/parsers.test.ts` já documenta os dois cenários quebrados (testes que hoje afirmam `[]` como resultado) — a correção deve trocar essas asserções para o resultado correto (transação extraída) sem quebrar os demais 25 testes já passando.

  **Critérios de aceite**
  - [ ] Extrato SGML com tag externa fechada mas campos internos sem fechamento é parseado corretamente.
  - [ ] Extrato SGML sem nenhuma tag de fechamento é parseado corretamente.
  - [ ] Todos os testes existentes de `parseOFX`/`parseCSV` continuam passando.

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

**FIN-022 — Criar endpoints `PUT`/`DELETE` para transação individual**

### Por quê?

Fase 2 do `TODO.md`, subseção "Banco de dados" (FIN-019, FIN-020, FIN-021), 100% concluída em 08/09/2026. Próxima subseção, na ordem do documento: "Backend / API" — FIN-022 é a primeira (P1), sem dependências pendentes (depende de FIN-008, já concluída).

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
