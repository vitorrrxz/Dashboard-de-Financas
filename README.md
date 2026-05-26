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

## ✨ Funcionalidades Principais

1. **Autenticação Segura**:
   * Tela de Login e Cadastro de Usuário de fácil uso.
   * Senhas salvas de forma segura no banco SQLite usando hashing (bcrypt).
   * Controle de sessão utilizando tokens JWT com validade de 7 dias.

2. **Dashboard Interativo (Visão Geral)**:
   * Filtro global de visualização por conta/cartão específica ou consolidado.
   * Indicadores de **Saldo Real** (somatório de contas correntes, poupanças, carteira), **Faturas Pendentes** de cartões de crédito e **Dívidas Ativas**.
   * Resumo de total de Receitas, Despesas e Gastos do mês corrente.
   * Gráficos dinâmicos com alternância de períodos (últimos 30 dias com evolução diária ou histórico de saldo por mês).
   * Alertas visuais em caso de dívidas vencidas e não quitadas.

3. **Gestão de Contas e Cartões (CRUD)**:
   * Criação, edição e exclusão de contas do tipo: Corrente, Poupança, Cartão de Crédito, Investimento e Dinheiro.
   * Para cartões de crédito, permite cadastrar limite total, dia de vencimento, dia de fechamento e valor da fatura pendente.
   * Cores personalizáveis para cada conta cadastrada.

4. **Importação Manual de Extratos**:
   * Suporte nativo para importação de extratos bancários nos formatos **CSV** e **OFX**.
   * Filtro e mapeamento automático inteligente de transações durante a importação.

5. **Controle de Transações**:
   * Tabela organizada de transações com categorização colorida.
   * Filtros rápidos para visualização de: Todas, apenas Receitas ou apenas Despesas.
   * Busca em tempo real por descrição ou categoria.
   * Opção para limpar todo o histórico de transações vinculadas ao usuário.

6. **Gerenciador de Dívidas**:
   * Controle refinado de parcelamentos e passivos a longo prazo.
   * Detalhamento com valor total da dívida, valor já pago, valor de cada parcela mensal, número de parcelas (pagas vs. totais), taxa de juros e próxima data de vencimento.
   * Suporte a importação de sub-itens vinculados à dívida.

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
```

### Passo 3: Geração do Prisma Client e Banco de Dados
Gere as classes de cliente do Prisma e sincronize a estrutura com o banco SQLite local (`dev.db`):
```bash
npx prisma generate
npx prisma db push
```

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
