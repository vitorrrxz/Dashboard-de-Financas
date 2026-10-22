# FinFlow 💼 - Dashboard de Finanças Pessoais

O **FinFlow** é um sistema completo e moderno para controle e gestão de finanças pessoais. Ele oferece uma interface rica, responsiva e dinâmica para acompanhamento de saldos, faturas de cartões de crédito, fluxo de caixa e controle de dívidas parceladas, com suporte a importação manual de extratos bancários.

---

## 🚀 Tecnologias Utilizadas

### Frontend
* **Core**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
* **Estilização**: [Tailwind CSS](https://tailwindcss.com/) com design moderno de painéis em efeito vidro (*glassmorphism*), gradientes sutis e modo escuro nativo.
* **Gráficos**: [Recharts](https://recharts.org/) para visualização interativa do fluxo financeiro e distribuição de despesas por categoria.
* **Ícones**: [Lucide React](https://lucide.dev/)

### Backend & Banco de Dados
* **Core**: [Node.js](https://nodejs.org/) com [Express](https://expressjs.com/)
* **Banco de Dados**: [SQLite](https://www.sqlite.org/) (leve, embarcado e rápido, ideal para dados locais)
* **ORM**: [Prisma ORM](https://www.prisma.io/) com adaptador otimizado `better-sqlite3`
* **Segurança e Autenticação**:
  * [Better Auth](https://www.better-auth.com/) para cadastro, login, sessão e verificação em duas etapas
  * [bcrypt](https://github.com/kelektiv/node.bcrypt.js) para criptografia de senhas (hashing) no banco de dados

---

## ✨ Funcionalidades

Checklist completo do que um dashboard de finanças pessoais deve oferecer. Itens marcados com ✅ já estão implementados no FinFlow; itens com ⬜ são sugestões de evolução (roadmap) para deixar o produto ainda mais completo.

### Implementado ✅

1. **Autenticação e Segurança**
   - ✅ Cadastro e login de usuário.
   - ✅ Senhas com hashing seguro (bcrypt) — nunca armazenadas em texto puro.
   - ✅ Sessão pelo Better Auth (FIN-121): cookie `httpOnly`, válido por 7 dias e renovado com o uso, encerrada no servidor ao sair.
   - ✅ Verificação em duas etapas (TOTP) com códigos de recuperação, e limite de tentativas no login — obrigatória em todas as contas, também no login pelo Google/GitHub (FIN-123).
   - ✅ Todas as rotas de dados protegidas por middleware de autenticação, isolando os dados por usuário.

2. **Dashboard / Visão Geral**
   - ✅ Cards de resumo: Saldo Real, Fatura Pendente, Dívidas Ativas, Receitas, Despesas e Gastos do mês corrente.
   - ✅ Filtro global por conta/cartão específico ou consolidado.
   - ✅ Gráfico de fluxo financeiro com alternância entre "últimos 30 dias" (evolução diária) e "histórico" (saldo por mês).
   - ✅ Gráfico de despesas por categoria (barras horizontais, cores por categoria).
   - ✅ Alerta visual de dívidas vencidas e não quitadas.
   - ✅ Estado vazio (onboarding) guiando o usuário a cadastrar conta/importar extrato.

3. **Contas e Cartões (CRUD)**
   - ✅ Tipos: Corrente, Poupança, Cartão de Crédito, Investimento e Dinheiro.
   - ✅ Para cartões: limite total, dia de fechamento, dia de vencimento e valor da fatura pendente.
   - ✅ Cor personalizável por conta.
   - ✅ Edição e exclusão de contas já cadastradas.

4. **Transações**
   - ✅ Importação manual de extratos em **CSV** e **OFX**, com mapeamento automático de colunas/campos.
   - ✅ Classificação por tipo de pagamento (Débito, Crédito, PIX, PIX Parcelado).
   - ✅ Criação automática de dívida/fatura ao importar transações de crédito ou PIX parcelado.
   - ✅ Tabela com categorização colorida, filtro (Todas / Receitas / Despesas) e busca em tempo real por descrição ou categoria.
   - ✅ Lançamento manual e exclusão em lote do histórico de transações.

5. **Dívidas e Parcelamentos**
   - ✅ Valor total, valor pago, parcela mensal, parcelas pagas vs. totais, taxa de juros e próxima data de vencimento.
   - ✅ Sub-itens vinculados a cada dívida (ex.: itens de uma fatura).
   - ✅ Vínculo opcional da dívida a uma conta/cartão.

6. **Open Finance (Pluggy)**
   - ✅ Conexão de contas bancárias reais via widget da Pluggy.
   - ✅ Sincronização de saldo de contas e importação idempotente de transações (últimos 30 dias).

### Roadmap sugerido ⬜

Funcionalidades comuns em dashboards financeiros maduros que ainda não existem neste projeto — boas candidatas para próximas iterações:

7. **Planejamento financeiro**
   - ⬜ Orçamento (budget) mensal por categoria, com barra de progresso e alerta ao estourar o limite.
   - ⬜ Metas financeiras (ex.: "Juntar R$10.000 até dezembro") com acompanhamento de progresso.
   - ⬜ Transações recorrentes (assinaturas, salário, aluguel) com lançamento automático e lembrete de vencimento.
   - ⬜ Projeção de saldo futuro com base em recorrências e dívidas em aberto.

8. **Relatórios e exportação**
   - ⬜ Exportação de relatórios em PDF/Excel/CSV.
   - ⬜ Comparativo mês a mês / ano a ano de receitas e despesas.
   - ⬜ Relatório de patrimônio líquido (net worth) somando contas, investimentos e dívidas.

9. **Notificações e alertas**
   - ⬜ Notificações por e-mail/push para vencimento de faturas e dívidas.
   - ⬜ Central de notificações (o sino no header hoje é apenas visual).
   - ⬜ Alertas de gastos incomuns ou acima da média por categoria.

10. **Personalização e organização**
    - ⬜ Categorias e subcategorias customizáveis pelo usuário (hoje são fixas no código).
    - ⬜ Tags e anotações em transações.
    - ⬜ Edição inline de transações importadas (hoje só é possível excluir tudo em lote).
    - ⬜ Tema claro (o app hoje é fixo em modo escuro).

11. **Investimentos e multi-moeda**
    - ⬜ Acompanhamento de carteira de investimentos (renda fixa, ações, cripto).
    - ⬜ Suporte a múltiplas moedas e conversão automática.

12. **Colaboração e acesso**
    - ⬜ Compartilhamento de conta/orçamento entre membros da família.
    - ✅ Autenticação em duas etapas (2FA), obrigatória (FIN-123).
    - ⬜ Backup/restore e exportação completa dos dados do usuário.

13. **Experiência mobile**
    - ⬜ Layout responsivo dedicado a mobile (o sidebar atual é ocultado em telas pequenas, sem navegação alternativa).
    - ⬜ PWA instalável.

---

## 🛠️ Configuração do Ambiente Local

### Pré-requisitos
Certifique-se de possuir o [Node.js](https://nodejs.org/) instalado em sua máquina.

### Passo 1: Instalação das Dependências
Clone este repositório e execute a instalação dos pacotes necessários:
```bash
npm install
```

### Passo 2: Variáveis de Ambiente (`.env`)
Para manter a segurança das credenciais e do banco de dados, o arquivo `.env` não é enviado ao GitHub. Crie um arquivo `.env` na raiz do seu projeto com base no arquivo `.env.example`:
```env
# URL de conexão do banco de dados (SQLite local)
DATABASE_URL="file:./dev.db"

# Segredo do Better Auth: assina os cookies de sessão (mínimo 32 caracteres)
BETTER_AUTH_SECRET="gere_com_crypto_randomBytes_48"

# Credenciais da Pluggy (Open Finance) — necessárias apenas para conectar bancos reais
PLUGGY_CLIENT_ID=""
PLUGGY_CLIENT_SECRET=""
```

### Passo 3: Geração do Prisma Client e Banco de Dados
Gere as classes de cliente do Prisma e aplique as migrations no banco SQLite local (`dev.db`):
```bash
npx prisma generate
npx prisma migrate dev
```
> O projeto usa histórico de migrations versionado em `Backend/prisma/migrations` (não apenas `db push`) — isso torna mudanças de schema explícitas, reproduzíveis em qualquer ambiente e revisáveis antes de aplicar, reduzindo (mas não eliminando) o risco de mudanças destrutivas silenciosas.

### Passo 4: Executar o Projeto
O projeto está configurado para iniciar o servidor backend (API Express na porta `3001`) e o servidor frontend (Vite na porta padrão) de forma simultânea e concorrente usando apenas um comando:
```bash
npm run dev
```
Após executar, abra o endereço exibido no terminal (geralmente `http://localhost:5173`) no seu navegador.

---

## 🐳 Rodando com Docker

Para deixar o FinFlow rodando num computador ou servidor seu, sempre do mesmo jeito: frontend e API no mesmo contêiner, na mesma origem, e o banco num volume.

1. Instale o [Docker](https://docs.docker.com/get-docker/), com o Compose.
2. Crie o `.env` a partir do `.env.example`. O contêiner lê as mesmas variáveis (`BETTER_AUTH_SECRET`, Pluggy…) a cada subida; o `.env` nunca entra na imagem.
3. Rode `docker compose up -d --build` e abra `http://localhost:3001`.

* **Banco:** fica no volume `finflow-data`. Reiniciar ou recriar o contêiner mantém os dados; só `docker compose down -v` apaga o volume. As migrações pendentes rodam sozinhas a cada subida (`prisma migrate deploy`).
* **Backups:** o backup diário (seção abaixo) vai para a pasta `BACKUP_DIR` do `.env` ou, se ela estiver vazia, para `./backups`. No Linux, crie a pasta antes (`mkdir -p backups`): o contêiner roda como o usuário de id 1000.
* **Levar o banco atual para o contêiner, ou restaurar um backup:** com o app parado (`docker compose stop`), rode
  `docker compose run --rm finflow sh -c 'cp /backups/finflow-AAAA-MM-DDTHH-MM-SS.db /data/finflow.db && rm -f /data/finflow.db-wal /data/finflow.db-shm'`
  e depois `docker compose up -d`. Para trazer o banco do desenvolvimento, grave antes uma cópia dele com `npm run backup`.
* **Atualizar:** `git pull` e `docker compose up -d --build`.
* **Acesso:** a porta só abre para este computador (`127.0.0.1:3001`). Para usar pelo celular sem expor os dados na internet, ver FIN-109 (Tailscale).

---

## 🚀 Rodando sem Docker (nativo)

Sem Docker disponível (ex: máquina sem permissão de administrador para instalar o Docker/WSL), o mesmo resultado — build e API na mesma origem, migrações automáticas — roda direto com Node, sem contêiner:

1. Crie o `.env` a partir do `.env.example`. Deixe `VITE_API_URL=""` e defina `FRONTEND_DIR=Frontend/dist`.
2. `npm ci && npm run build` — gera `Frontend/dist/` com o frontend já apontando para a própria origem.
3. `npm start` — aplica as migrações pendentes (`prisma migrate deploy`) e sobe a API em `http://localhost:3001`, servindo o frontend.

O banco (`DATABASE_URL` do `.env`, um arquivo SQLite) e os backups ficam onde estiverem configurados — não há volume nem imagem, é o mesmo processo Node que já roda em desenvolvimento. Para manter rodando entre reinícios do computador, use o Agendador de Tarefas do Windows ou um gerenciador de processos como o [PM2](https://pm2.keymetrics.io/).

---

## ☁️ Publicando na Vercel (FIN-120)

Para abrir o FinFlow de qualquer lugar, só com e-mail e senha. A Vercel não tem disco permanente, então o banco fica no [Turso](https://turso.tech) (SQLite hospedado): mesmo schema e mesmas migrations do `dev.db`.

1. **Banco no Turso** — instale o CLI (`brew install tursodatabase/tap/turso`), entre (`turso auth login`) e suba o banco atual:
   `sqlite3 dev.db 'PRAGMA journal_mode=WAL;'` e `turso db import dev.db --name finflow`
   (ou `turso db create finflow` para começar vazio). Anote a URL (`turso db show finflow --url`) e gere um token (`turso db tokens create finflow`).
2. **Projeto na Vercel** — `npx vercel link` e cadastre as variáveis de produção (`npx vercel env add NOME production`):
   `DATABASE_URL` (a URL `libsql://` do Turso), `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET`, `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `FRONTEND_URL` e `BETTER_AUTH_URL` (as duas últimas com o endereço do site na Vercel). Não defina `VITE_API_URL`: o build já aponta o frontend para a própria origem.
3. **Publicar** — `npx vercel deploy --prod`. O build aplica as migrations pendentes no Turso (`Backend/scripts/migrate-turso.mjs`, o `prisma migrate deploy` de lá) e gera o frontend; a API roda como função serverless (`api/index.js`).

* **Segurança:** o site fica aberto na internet e o que protege os dados é o login do app — use uma senha forte; a verificação em duas etapas é obrigatória (FIN-123). A senha do banco nunca passa pelo app (fica com a Pluggy), mas as transações e contas sincronizadas ficam no Turso.
* **Diferenças do servidor local:** o backup diário em `BACKUP_DIR` não roda (o Turso guarda o histórico do banco; a exportação em Configurações continua funcionando), e o limite de tentativas de login vale por instância da função, não para o site inteiro.
* **Migrations novas:** crie como sempre, com `npx prisma migrate dev` no `dev.db`; o próximo deploy aplica no Turso.

---

## 🔑 Login com Google, GitHub e Microsoft (FIN-122)

Opcional: cada provedor aparece na tela de login quando as duas variáveis dele estão no `.env` (ou na Vercel). Em cada um, crie um app OAuth e cadastre a **URL de retorno** — o endereço da API seguido de `/api/auth/callback/<provedor>`:

| Ambiente | URL de retorno (ex.: Google) |
| --- | --- |
| Produção | `https://finflow-ashen-ten.vercel.app/api/auth/callback/google` |
| Desenvolvimento | `http://localhost:3001/api/auth/callback/google` |

* **Google** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → *Criar credenciais* → *ID do cliente OAuth* → tipo *Aplicativo da Web*. Em *URIs de redirecionamento autorizados*, as duas URLs acima. Configure antes a *Tela de consentimento OAuth* (tipo *Externo*; enquanto estiver *Em teste*, só os e-mails de *Usuários de teste* entram). Variáveis: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
* **GitHub** — [Settings → Developer settings → OAuth Apps](https://github.com/settings/developers) → *New OAuth App*. O GitHub aceita uma URL de retorno por app: crie um para produção (`…/api/auth/callback/github` no endereço da Vercel) e outro para o desenvolvimento. Variáveis: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
* **Microsoft** — [Microsoft Entra → Registros de aplicativo](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → *Novo registro*, com *Contas em qualquer diretório organizacional e contas pessoais da Microsoft*. Em *Autenticação*, plataforma *Web* com as duas URLs (`…/callback/microsoft`); em *Certificados e segredos*, um segredo do cliente. Variáveis: `MICROSOFT_CLIENT_ID` (o *ID do aplicativo*) e `MICROSOFT_CLIENT_SECRET` (o *Valor* do segredo, não o ID dele).

**Quem já tem conta** entra com e-mail e senha e conecta os provedores em *Configurações → Contas conectadas*. Entrar direto pelo Google com o e-mail de uma conta existente é recusado de propósito: o FinFlow não verifica e-mails no cadastro, e juntar as duas sozinho deixaria quem cadastrasse o e-mail de outra pessoa ficar com a conta dela quando ela entrasse pelo Google. **Contas novas** podem ser criadas direto por qualquer provedor.

---

## 🛡️ Verificação em duas etapas obrigatória (FIN-123)

Toda conta precisa da verificação em duas etapas com um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy, 1Password…):

* **Primeiro acesso** — depois do login, quem ainda não ativou vê só a tela *Proteja sua conta*: escaneia o QR code, confirma com um código e guarda os códigos de recuperação. Até lá, a API recusa as rotas do app (403 `TWO_FACTOR_SETUP_REQUIRED`).
* **Logins seguintes** — com e-mail e senha **ou** pelo Google/GitHub/Microsoft, o app pede o código de 6 dígitos (ou um código de recuperação) antes de abrir a sessão.
* **Trocar de celular** — *Configurações → Verificação em duas etapas → Configurar em outro celular* mostra o mesmo QR code de novo (pede a senha, se a conta tiver uma). Desativar não é possível enquanto a exigência estiver ligada.
* **Celular perdido** — entre com um dos códigos de recuperação e configure o celular novo como acima.

`TWO_FACTOR_REQUIRED=false` no `.env` desliga a exigência (a verificação volta a ser opcional, em Configurações). Com o login desativado (`VITE_AUTH_DISABLED=true`), ela também não vale.

---

## 🔒 Segurança de Repositório

O arquivo `.gitignore` foi atualizado para garantir que os seguintes arquivos sensíveis/locais não sejam rastreados pelo Git ou enviados ao repositório público no GitHub:
* `.env` (contém o segredo das sessões e conexões confidenciais)
* `dev.db` e `dev.db-journal` (banco de dados SQLite local contendo suas transações e dados reais)
* Arquivos temporários de banco de dados (`*.db`, `*.db-journal`)

---

## 💾 Backup do banco

Todos os dados ficam num único arquivo SQLite (`dev.db`), que não vai para o git. Para ter cópias:
* **Automático:** defina `BACKUP_DIR` no `.env` — de preferência outro disco ou uma pasta sincronizada com a nuvem. O servidor grava uma cópia ao subir e outra a cada 24 horas, e mantém as `BACKUP_KEEP` mais recentes (padrão 30).
* **Manual:** `npm run backup`.

A cópia é feita com `VACUUM INTO`, segura com o servidor rodando, e conferida com `integrity_check` antes de as antigas serem apagadas.

**Restaurar:** pare o servidor, guarde o `dev.db` atual com outro nome, copie o backup escolhido (`finflow-AAAA-MM-DDTHH-MM-SS.db`) para `dev.db`, apague `dev.db-wal` e `dev.db-shm` se existirem e suba o servidor de novo.

---

## 📁 `Backend/sandbox-pluggy/`

A pasta `Backend/sandbox-pluggy/` **não é parte do aplicativo principal** — é um protótipo isolado, sem autenticação real, usado para testar a integração com a Pluggy separadamente. Não confundir com o backend (`Backend/server.js`). Detalhes em [`Backend/sandbox-pluggy/README.md`](Backend/sandbox-pluggy/README.md).
