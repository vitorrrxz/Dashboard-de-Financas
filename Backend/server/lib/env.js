// FIN-115 — carrega o `.env` (efeito colateral, sem exports). Todo módulo que lê `process.env`
// no carregamento (e não só dentro de uma função/rota) importa este arquivo primeiro: como
// módulos ES são avaliados na ordem dos `import`s de CADA arquivo, isto garante que o `.env` já
// foi lido antes daquela leitura — não importa em que ordem `server.js` importe os módulos.
import dotenv from 'dotenv';

dotenv.config();
