# TODO.md - FinFlow (Backend + Frontend)

> Checklist de execução. Detalhamento completo de cada item (Objetivo, Problema, Arquivos, Critérios de aceite, notas de implementação e validação) em [`docs/BACKLOG_DETAIL.md`](docs/BACKLOG_DETAIL.md), sob o mesmo ID `FIN-XXX`.
> Gerado a partir de auditoria do código real em 2026-09-04. Fases 0-2 corrigem o estado atual do app; Fases 3-9 são o roadmap de novas funcionalidades.

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

### Frontend
- [x] Centralizar base URL da API (hoje hardcoded em 3 arquivos) (FIN-025)
- [x] Habilitar TypeScript `strict` mode (FIN-026)
- [x] Criar servico `apiFetch` unico, eliminando duplicacao (FIN-027, depende de FIN-025)

### Mobile / Responsividade
- [x] Criar navegacao mobile — sidebar hoje fica 100% inacessivel abaixo de `md` (FIN-028)
- [x] Adaptar grids fixos de 2 colunas em telas muito pequenas (FIN-029)

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

### Open Finance / Pluggy
- [x] Tratar status de item Pluggy expirado / erro de login (FIN-041)

### Infraestrutura / DX
- [x] Documentar `sandbox-pluggy/` como prototipo isolado, nao integrado ao app principal (FIN-085)

### Debitos tecnicos
- [x] Extrair calculo financeiro (`stats`) de `App.tsx` para modulo/hook dedicado (FIN-086, depende de FIN-034)
- [x] Centralizar padrao de formulario (`FormField`) entre AccountsManager e DebtManager (FIN-087)
- [x] Remover verificacao de vencimento duplicada remanescente apos FIN-005 (FIN-088, depende de FIN-005)
- [x] Corrigir 2 erros de `tsc` pre-existentes em `App.tsx` (tooltip Recharts) (FIN-089)
- [ ] Corrigir perda silenciosa de transacoes em OFX SGML com campos sem fechamento (FIN-091, achado ao escrever testes)

## Fase 3 - Planejamento Financeiro (Orcamento)

- [ ] Criar model `Budget` no schema Prisma (FIN-042, depende de FIN-015, FIN-020)
- [ ] Criar rotas CRUD `/api/budgets` (FIN-043, depende de FIN-042, FIN-008)
- [ ] Criar calculo de progresso do orcamento — gasto vs. limite por categoria/mes (FIN-044, depende de FIN-043)
- [ ] Criar aba "Orcamento" no frontend (FIN-045, depende de FIN-044)
- [ ] Integrar indicador de orcamento ao Dashboard (FIN-046, depende de FIN-045)
- [ ] Criar alerta visual ao ultrapassar limite do orcamento (FIN-047, depende de FIN-046)
- [ ] Testes do sistema de orcamento (FIN-048, depende de FIN-030, FIN-031, FIN-045)

## Fase 4 - Planejamento Financeiro (Metas e Recorrencias)

### Metas financeiras
- [ ] Criar model `Goal` no schema Prisma (FIN-049, depende de FIN-015, FIN-020)
- [ ] Criar rotas CRUD `/api/goals` (FIN-050, depende de FIN-049, FIN-008)
- [ ] Criar tela de Metas Financeiras (FIN-051, depende de FIN-050)
- [ ] Testes de metas financeiras (FIN-052, depende de FIN-030, FIN-031, FIN-051)

### Transacoes recorrentes
- [ ] Criar model `RecurringTransaction` no schema Prisma (FIN-053, depende de FIN-015, FIN-020)
- [ ] Criar rotas CRUD + endpoint de "lancar pendentes" (FIN-054, depende de FIN-053, FIN-008)
- [ ] Disparar checagem/lancamento de recorrencias pendentes ao carregar o dashboard (FIN-055, depende de FIN-054)
- [ ] Criar UI de gerenciamento de recorrencias (FIN-056, depende de FIN-054)
- [ ] Testes de transacoes recorrentes (FIN-057, depende de FIN-030, FIN-031, FIN-056)

### Projecao de saldo
- [ ] Criar calculo de projecao de saldo futuro (FIN-058, depende de FIN-053, FIN-005)
- [ ] Exibir grafico de projecao no Dashboard (FIN-059, depende de FIN-058)

## Fase 5 - Relatorios

- [ ] Exportar relatorio de transacoes em CSV (FIN-060)
- [ ] Exportar relatorio de transacoes em PDF (FIN-061, depende de FIN-060)
- [ ] Criar comparativo mes a mes de receitas/despesas (FIN-062)
- [ ] Criar comparativo ano a ano (FIN-063, depende de FIN-062)
- [ ] Criar relatorio de patrimonio liquido — contas + investimentos - dividas (FIN-064, depende de FIN-018, FIN-070)

## Fase 6 - Notificacoes

- [ ] Criar model `Notification` e endpoint de listagem/leitura (FIN-065, depende de FIN-020, FIN-008)
- [ ] Conectar sino do header a uma central de notificacoes real (FIN-066, depende de FIN-039, FIN-065)
- [ ] Gerar notificacoes automaticas de vencimento de divida/fatura (FIN-067, depende de FIN-065, FIN-005)
- [ ] Avaliar notificacoes por e-mail para vencimentos (FIN-068, depende de FIN-067)
- [ ] Alertas de gasto incomum por categoria (FIN-069, depende de FIN-065)

## Fase 7 - Investimentos e Multi-moeda

### Investimentos
- [ ] Criar model `Investment` no schema Prisma (FIN-070, depende de FIN-015, FIN-020)
- [ ] Criar rotas CRUD `/api/investments` (FIN-071, depende de FIN-070, FIN-008)
- [ ] Criar tela de carteira de investimentos (FIN-072, depende de FIN-071)
- [ ] Integrar valor de investimentos ao patrimonio liquido (FIN-073, depende de FIN-064, FIN-072)

### Multi-moeda
- [ ] Adicionar campo `currency` em Account e Transaction (FIN-074, depende de FIN-020)
- [ ] Integrar API de cambio para conversao de exibicao (FIN-075, depende de FIN-074)
- [ ] Atualizar UI para exibir/selecionar moeda por conta (FIN-076, depende de FIN-075)

## Fase 8 - Colaboracao e PWA

### Colaboracao
- [ ] Modelar compartilhamento de dados entre usuarios / household (FIN-077 — requer alinhamento de produto antes de iniciar)
- [ ] Implementar 2FA (TOTP) no login (FIN-078, depende de FIN-012)
- [ ] Implementar exportacao completa de dados do usuario / backup (FIN-079)
- [ ] Implementar importacao/restauracao de backup (FIN-080, depende de FIN-079, FIN-008)

### PWA / Mobile avancado
- [ ] Refinar navegacao mobile — UX/acessibilidade (FIN-081, depende de FIN-028)
- [ ] Adicionar `manifest.json` + service worker — PWA instalavel (FIN-082, depende de FIN-081)
- [ ] Implementar tema claro / light mode (FIN-083)

## Fase 9 - Entregaveis

### Criterios de aceite gerais
- [ ] Nenhum bug P0 em aberto (Fase 0 completa)
- [ ] Nenhuma vulnerabilidade HIGH/CRITICAL em aberto (Fase 1 - Seguranca completa)
- [ ] Cobertura de testes minima nos fluxos de auth, isolamento por usuario e regras financeiras (FIN-030 a FIN-035)
- [ ] App usavel em viewport mobile (FIN-028)
- [ ] CI rodando lint + typecheck + testes + build a cada push (FIN-036)

### Pendencias pos-MVP (avaliar prioridade antes de iniciar)
- [ ] Planejamento financeiro completo — Orcamento, Metas, Recorrencias, Projecao (Fases 3 e 4)
- [ ] Relatorios e patrimonio liquido (Fase 5)
- [ ] Central de notificacoes completa (Fase 6)
- [ ] Investimentos e multi-moeda (Fase 7)
- [ ] Colaboracao, 2FA, backup e PWA (Fase 8)

---

Ver `docs/BACKLOG_DETAIL.md` para o detalhamento tecnico completo de cada `FIN-XXX` (Objetivo, Problema, Arquivos reais, Alteracoes necessarias, Validacao e Criterios de aceite, notas de implementação), a tabela de classificacao do README vs. codigo real, e o roadmap de releases (v0.1 a v2.0).
