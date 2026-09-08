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
  * [JSON Web Tokens (JWT)](https://jwt.io/) para autenticação segura baseada em sessão
  * [bcrypt](https://github.com/kelektiv/node.bcrypt.js) para criptografia de senhas (hashing) no banco de dados

---

## ✨ Funcionalidades

Checklist completo do que um dashboard de finanças pessoais deve oferecer. Itens marcados com ✅ já estão implementados no FinFlow; itens com ⬜ são sugestões de evolução (roadmap) para deixar o produto ainda mais completo.

### Implementado ✅

1. **Autenticação e Segurança**
   - ✅ Cadastro e login de usuário.
   - ✅ Senhas com hashing seguro (bcrypt) — nunca armazenadas em texto puro.
   - ✅ Sessão via JWT (token com validade de 7 dias), guardado no `localStorage`.
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
    - ⬜ Autenticação em duas etapas (2FA).
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

# Chave secreta para assinatura dos tokens JWT do usuário
JWT_SECRET="chave_secreta_finance_app"

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
> O projeto usa histórico de migrations versionado em `prisma/migrations` (não apenas `db push`) — isso garante que mudanças de schema fiquem registradas e sejam reproduzíveis em qualquer ambiente, sem risco de perda de dados silenciosa.

### Passo 4: Executar o Projeto
O projeto está configurado para iniciar o servidor backend (API Express na porta `3001`) e o servidor frontend (Vite na porta padrão) de forma simultânea e concorrente usando apenas um comando:
```bash
npm run dev
```
Após executar, abra o endereço exibido no terminal (geralmente `http://localhost:5173`) no seu navegador.

---

## 🔒 Segurança de Repositório

O arquivo `.gitignore` foi atualizado para garantir que os seguintes arquivos sensíveis/locais não sejam rastreados pelo Git ou enviados ao repositório público no GitHub:
* `.env` (contém a assinatura JWT e conexões confidenciais)
* `dev.db` e `dev.db-journal` (banco de dados SQLite local contendo suas transações e dados reais)
* Arquivos temporários de banco de dados (`*.db`, `*.db-journal`)
