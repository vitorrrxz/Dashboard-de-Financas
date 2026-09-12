# TODO.md - FinFlow (Backend + Frontend)

> Checklist de execução. Detalhamento completo de cada item (Objetivo, Problema, Arquivos, Critérios de aceite, notas de implementação e validação) em [`docs/BACKLOG_DETAIL.md`](docs/BACKLOG_DETAIL.md), sob o mesmo ID `FIN-XXX`.
> Gerado a partir de auditoria do código real em 2026-09-04. Fases 0-2 corrigem o estado atual do app; Fases 3-9 são o roadmap de novas funcionalidades; a Fase 10 reúne as melhorias propostas depois da entrega (12/09/2026).

## Protocolo

1. Ler este arquivo antes de comecar. Escolher o primeiro item nao marcado, respeitando a ordem das fases e as dependencias indicadas entre parenteses.
2. Antes de implementar, abrir `docs/BACKLOG_DETAIL.md` e localizar o mesmo `FIN-XXX` para ver Objetivo/Problema/Criterios de aceite completos.
3. Uma tarefa por vez. Ler os arquivos envolvidos antes de alterar.
4. Rodar `npm run lint`, `npx tsc -b --noEmit` e `npm test` (quando existir) apos a implementacao.
5. So marcar `[x]` aqui **e** em `docs/BACKLOG_DETAIL.md` depois que os criterios de aceite forem satisfeitos.
6. Problema novo encontrado no caminho -> criar `FIN-XXX` novo (proximo ID livre) em `docs/BACKLOG_DETAIL.md` e referenciar aqui.

## Fase 0 - Bugs Criticos (P0)

- [x] Corrigir `JWT_SECRET` com fallback inseguro hardcoded (FIN-006)
- [x] Corrigir sync Pluggy que nao atualiza fatura pendente de cartao de credito (FIN-001)
- [x] Corrigir mapeamento de tipo de conta importada via Pluggy (FIN-002)
- [x] Adicionar verificacao de duplicidade na importacao manual de extrato CSV/OFX (FIN-003)
- [x] Evitar divida duplicada ao reimportar fatura de credito/PIX parcelado (FIN-004, depende de FIN-003)
- [x] Unificar logica de "divida vencida" entre Dashboard e Divida Manager, corrigindo bug de fuso horario (FIN-005)
- [x] Corrigir servidor crashando no boot sem credenciais Pluggy configuradas (FIN-090, achado em revisao de codigo)
- [x] Corrigir compras no cartao de credito importadas da Pluggy como RECEITA (FIN-092, achado em uso real)

## Fase 1 - Seguranca e Integridade Financeira (P1/P2)

### Seguranca
- [x] Rate limiting nas rotas de login/registro (FIN-007)
- [x] Validacao de payload no backend para accounts/transactions/debts (FIN-008)
- [x] Restringir CORS a origem conhecida do frontend (FIN-009)
- [x] Adicionar cabecalhos de seguranca HTTP via helmet (FIN-010)
- [x] Parar de expor mensagens de erro internas do Prisma ao cliente (FIN-011)
- [x] Revisar expiracao/revogacao de token JWT (FIN-012)
- [x] Normalizar e-mail (lowercase/trim) no cadastro e login (FIN-013)
- [x] Avaliar enumeracao de e-mail no registro (FIN-014, depende de FIN-007)
- [x] Recusar `accountId` de conta de outro usuario em transacoes, dividas e recorrencias (FIN-096, achado ao implementar FIN-071)
- [x] Remover do git o banco real (`dev.db`) e as copias de backup (FIN-097, achado ao iniciar a Fase 8)
- [x] Atualizar dependencias com vulnerabilidades conhecidas — npm audit com 12 high e 2 critical (FIN-100, achado ao verificar a Fase 9)
- [ ] Tirar do alcance publico o banco que ficou no historico do repositorio (FIN-101 — acao do dono do repositorio: trocar senhas reutilizadas; repositorio privado ou historico reescrito)

### Integridade financeira
- [x] Unificar logica de "divida vencida" entre Dashboard e Divida Manager, corrigindo bug de fuso horario (FIN-005)
- [x] Migrar valores monetarios de `Float` para inteiro em centavos (FIN-015)
  - [x] Criar utilitario `centavos <-> reais` com testes (FIN-015a)
  - [x] Migrar schema Prisma e dados existentes para centavos (FIN-015b)
  - [x] Atualizar `server.js` para centavos (FIN-015c)
  - [x] Atualizar frontend para converter centavos/reais em todos os pontos de entrada e exibicao (FIN-015d)
- [x] Referencia cruzada: centralizar logica de divida vencida (FIN-016, coberta por FIN-005)
- [x] Tornar "pagar todas as parcelas" / "excluir todas as dividas" resiliente a falha parcial (FIN-017)
- [x] Separar "Saldo Real" de saldo de contas de investimento no dashboard (FIN-018)

## Fase 2 - Qualidade (Banco, Backend, Frontend, Mobile, Testes)

### Banco de dados
- [x] Adicionar indices compostos por `userId` em Account/Transaction/Debt (FIN-019)
- [x] Adotar historico de migrations do Prisma em vez de `db push` (FIN-020, depende de FIN-015b)
- [x] Adicionar constraint de unicidade `(userId, pluggyId)` em Account e Transaction (FIN-021, depende de FIN-020)

### Backend / API
- [x] Criar endpoints `PUT`/`DELETE` para transacao individual (FIN-022, depende de FIN-008)
- [x] Implementar paginacao real em `GET /api/transactions` (FIN-023)
- [x] Adicionar script `typecheck` no `package.json` (FIN-024)
- [ ] Aceitar importacao de extrato com mais de ~500 transacoes — limite de 100 kB do corpo JSON (FIN-098, achado ao implementar FIN-080)

### Frontend
- [x] Centralizar base URL da API (hoje hardcoded em 3 arquivos) (FIN-025)
- [x] Habilitar TypeScript `strict` mode (FIN-026)
- [x] Criar servico `apiFetch` unico, eliminando duplicacao (FIN-027, depende de FIN-025)

### Mobile / Responsividade
- [x] Criar navegacao mobile — sidebar hoje fica 100% inacessivel abaixo de `md` (FIN-028)
- [x] Adaptar grids fixos de 2 colunas em telas muito pequenas (FIN-029)
- [x] Mostrar editar/excluir transacao em telas de toque e no foco do teclado (FIN-099, achado ao implementar FIN-081)

### Testes automatizados
- [x] Configurar Vitest + Testing Library no frontend (FIN-030)
- [x] Configurar testes de integracao do backend com Supertest (FIN-031)
- [x] Testes de isolamento de dados entre usuarios (FIN-032, depende de FIN-031)
- [x] Testes de autenticacao — registro, login, token invalido/expirado (FIN-033, depende de FIN-031)
- [x] Testes das regras financeiras — parcela paga, divida vencida, saldo negativo etc. (FIN-034, depende de FIN-030, FIN-005)
- [x] Testes dos parsers de CSV/OFX (FIN-035, depende de FIN-030)
- [x] Pipeline de CI no GitHub Actions — lint + typecheck + testes + build (FIN-036, depende de FIN-024, FIN-030, FIN-031; FIN-084 é referência cruzada da mesma tarefa)

### Performance
- [x] Sync Pluggy processa transacoes sequencialmente (N+1) — otimizar (FIN-037, depende de FIN-021)
- [x] Verificar paginacao da API da Pluggy em `fetchTransactions` (FIN-038)

### UX/UI
- [x] Conectar sino de notificacoes do header a algum conteudo real (FIN-039)
- [x] Parar de forcar troca para aba "Transacoes" a cada tecla digitada na busca (FIN-040)
- [x] Filtro mensal de receitas/despesas com total do mes na aba Transacoes (FIN-093)
- [x] Mover lancamentos parcelados para a aba Dividas, com mes de referencia e total mensal (FIN-094, depende de FIN-092, FIN-093)

### Open Finance / Pluggy
- [x] Tratar status de item Pluggy expirado / erro de login (FIN-041)
- [x] Gravar compras em moeda estrangeira no cartao pelo valor na moeda da conta (FIN-095, achado ao implementar FIN-074)

### Infraestrutura / DX
- [x] Documentar `sandbox-pluggy/` como prototipo isolado, nao integrado ao app principal (FIN-085)

### Debitos tecnicos
- [x] Extrair calculo financeiro (`stats`) de `App.tsx` para modulo/hook dedicado (FIN-086, depende de FIN-034)
- [x] Centralizar padrao de formulario (`FormField`) entre AccountsManager e DebtManager (FIN-087)
- [x] Remover verificacao de vencimento duplicada remanescente apos FIN-005 (FIN-088, depende de FIN-005)
- [x] Corrigir 2 erros de `tsc` pre-existentes em `App.tsx` (tooltip Recharts) (FIN-089)
- [ ] Corrigir perda silenciosa de transacoes em OFX SGML com campos sem fechamento (FIN-091, achado ao escrever testes)

## Fase 3 - Planejamento Financeiro (Orcamento)

- [x] Criar model `Budget` no schema Prisma (FIN-042, depende de FIN-015, FIN-020)
- [x] Criar rotas CRUD `/api/budgets` (FIN-043, depende de FIN-042, FIN-008)
- [x] Criar calculo de progresso do orcamento — gasto vs. limite por categoria/mes (FIN-044, depende de FIN-043)
- [x] Criar aba "Orcamento" no frontend (FIN-045, depende de FIN-044)
- [x] Integrar indicador de orcamento ao Dashboard (FIN-046, depende de FIN-045)
- [x] Criar alerta visual ao ultrapassar limite do orcamento (FIN-047, depende de FIN-046)
- [x] Testes do sistema de orcamento (FIN-048, depende de FIN-030, FIN-031, FIN-045)

## Fase 4 - Planejamento Financeiro (Metas e Recorrencias)

### Metas financeiras
- [x] Criar model `Goal` no schema Prisma (FIN-049, depende de FIN-015, FIN-020)
- [x] Criar rotas CRUD `/api/goals` (FIN-050, depende de FIN-049, FIN-008)
- [x] Criar tela de Metas Financeiras (FIN-051, depende de FIN-050)
- [x] Testes de metas financeiras (FIN-052, depende de FIN-030, FIN-031, FIN-051)

### Transacoes recorrentes
- [x] Criar model `RecurringTransaction` no schema Prisma (FIN-053, depende de FIN-015, FIN-020)
- [x] Criar rotas CRUD + endpoint de "lancar pendentes" (FIN-054, depende de FIN-053, FIN-008)
- [x] Disparar checagem/lancamento de recorrencias pendentes ao carregar o dashboard (FIN-055, depende de FIN-054)
- [x] Criar UI de gerenciamento de recorrencias (FIN-056, depende de FIN-054)
- [x] Testes de transacoes recorrentes (FIN-057, depende de FIN-030, FIN-031, FIN-056)

### Projecao de saldo
- [x] Criar calculo de projecao de saldo futuro (FIN-058, depende de FIN-053, FIN-005)
- [x] Exibir grafico de projecao no Dashboard (FIN-059, depende de FIN-058)

## Fase 5 - Relatorios

- [x] Exportar relatorio de transacoes em CSV (FIN-060)
- [x] Exportar relatorio de transacoes em PDF (FIN-061, depende de FIN-060)
- [x] Criar comparativo mes a mes de receitas/despesas (FIN-062)
- [x] Criar comparativo ano a ano (FIN-063, depende de FIN-062)
- [x] Criar relatorio de patrimonio liquido — contas + investimentos - dividas (FIN-064, depende de FIN-018, FIN-070)

## Fase 6 - Notificacoes

- [x] Criar model `Notification` e endpoint de listagem/leitura (FIN-065, depende de FIN-020, FIN-008)
- [x] Conectar sino do header a uma central de notificacoes real (FIN-066, depende de FIN-039, FIN-065)
- [x] Gerar notificacoes automaticas de vencimento de divida/fatura (FIN-067, depende de FIN-065, FIN-005)
- [x] Avaliar notificacoes por e-mail para vencimentos (FIN-068, depende de FIN-067 — avaliacao registrada; implementacao aguarda decisao de produto/infra)
- [x] Alertas de gasto incomum por categoria (FIN-069, depende de FIN-065)

## Fase 7 - Investimentos e Multi-moeda

### Investimentos
- [x] Criar model `Investment` no schema Prisma (FIN-070, depende de FIN-015, FIN-020)
- [x] Criar rotas CRUD `/api/investments` (FIN-071, depende de FIN-070, FIN-008)
- [x] Criar tela de carteira de investimentos (FIN-072, depende de FIN-071)
- [x] Integrar valor de investimentos ao patrimonio liquido (FIN-073, depende de FIN-064, FIN-072)

### Multi-moeda
- [x] Adicionar campo `currency` em Account e Transaction (FIN-074, depende de FIN-020)
- [x] Integrar API de cambio para conversao de exibicao (FIN-075, depende de FIN-074)
- [x] Atualizar UI para exibir/selecionar moeda por conta (FIN-076, depende de FIN-075)

## Fase 8 - Colaboracao e PWA

### Colaboracao
- [ ] Modelar compartilhamento de dados entre usuarios / household (FIN-077 — fora do escopo por decisao de produto: dashboard pessoal, sem compartilhamento; NAO implementar)
- [x] Implementar 2FA (TOTP) no login (FIN-078, depende de FIN-012)
- [x] Implementar exportacao completa de dados do usuario / backup (FIN-079)
- [x] Implementar importacao/restauracao de backup (FIN-080, depende de FIN-079, FIN-008)

### PWA / Mobile avancado
- [x] Refinar navegacao mobile — UX/acessibilidade (FIN-081, depende de FIN-028)
- [x] Adicionar `manifest.json` + service worker — PWA instalavel (FIN-082, depende de FIN-081)
- [x] Implementar tema claro / light mode (FIN-083)

## Fase 9 - Entregaveis

> Verificado em 11/09/2026 — evidencias de cada criterio em `docs/BACKLOG_DETAIL.md`, secao "Fase 9 — Entregaveis".

### Criterios de aceite gerais
- [x] Nenhum bug P0 em aberto (Fase 0 completa)
- [ ] Nenhuma vulnerabilidade HIGH/CRITICAL em aberto (Fase 1 - Seguranca completa) — FIN-096, FIN-097 e FIN-100 concluidas; falta FIN-101, acao do dono do repositorio
- [x] Cobertura de testes minima nos fluxos de auth, isolamento por usuario e regras financeiras (FIN-030 a FIN-035)
- [x] App usavel em viewport mobile (FIN-028; tambem FIN-029, FIN-081 e FIN-099)
- [x] CI rodando lint + typecheck + testes + build a cada push (FIN-036)

### Pendencias pos-MVP (avaliar prioridade antes de iniciar)
- [x] Planejamento financeiro completo — Orcamento, Metas, Recorrencias, Projecao (Fases 3 e 4)
- [x] Relatorios e patrimonio liquido (Fase 5)
- [x] Central de notificacoes completa (Fase 6)
- [x] Investimentos e multi-moeda (Fase 7)
- [x] 2FA, backup e PWA (Fase 8 — colaboracao ficou fora do escopo, ver FIN-077)

## Fase 10 - Evolucao pos-entrega

> Sugestoes discutidas em 12/09/2026, na ordem de prioridade combinada. Antes, a FIN-101 (acao do dono do repositorio, Fase 1). Nada multiusuario: o FinFlow e um dashboard pessoal (FIN-077).

### Protecao dos dados
- [ ] Backup automatico diario do banco SQLite, fora do repositorio e com rotacao (FIN-102, depende de FIN-097)

### Numeros certos
- [ ] Tratar transferencia entre contas proprias e pagamento de fatura fora dos totais de receita e despesa (FIN-103)
- [ ] Detectar transferencias e pagamento de fatura automaticamente, para confirmacao (FIN-104, depende de FIN-103)
- [ ] Regras de categorizacao do usuario, aplicadas na importacao e no sync (FIN-105)
- [ ] Criar regra ao corrigir a categoria de uma transacao + tela de regras (FIN-106, depende de FIN-105)

### Uso no dia a dia
- [ ] Sincronizacao automatica com a Pluggy ao abrir o app (FIN-107)
- [ ] Empacotar o app em Docker — frontend + API + banco em volume (FIN-108)
- [ ] Acesso privado pelo celular via Tailscale com HTTPS — PWA instalado (FIN-109, depende de FIN-108)
- [ ] Token de sessao em cookie httpOnly em vez do localStorage (FIN-110, depende de FIN-108)
- [ ] Detectar assinaturas nas transacoes e sugerir recorrencias (FIN-111)
- [ ] Historico mensal do patrimonio liquido, com grafico de evolucao (FIN-112, depende de FIN-064, FIN-073)
- [ ] Metas ligadas a uma conta ou investimento, com progresso automatico (FIN-113, depende de FIN-050, FIN-096)

### Engenharia
- [ ] Acelerar a suite de testes — schema criado uma vez e copiado por arquivo (FIN-114)
- [ ] Dividir `server.js` em rotas por dominio, sem mudar comportamento (FIN-115)
- [ ] Dividir `App.tsx` em paginas e componentes, sem mudar comportamento (FIN-116)
- [ ] Carregar abas pesadas sob demanda — pacote inicial abaixo de 500 kB (FIN-117, depende de FIN-116)
- [ ] Dependabot e `npm audit` semanal no CI (FIN-118, depende de FIN-036, FIN-100)

---

Ver `docs/BACKLOG_DETAIL.md` para o detalhamento tecnico completo de cada `FIN-XXX` (Objetivo, Problema, Arquivos reais, Alteracoes necessarias, Validacao e Criterios de aceite, notas de implementação), a tabela de classificacao do README vs. codigo real, e o roadmap de releases (v0.1 a v2.0).
