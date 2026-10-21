import express from 'express';
import { authenticateToken } from '../lib/auth.js';
import { BASE_CURRENCY, CURRENCY_CODE_PATTERN } from '../lib/money.js';
import { getExchangeRates } from '../lib/exchangeRates.js';

export const router = express.Router();

// --- EXCHANGE RATES (FIN-075) ---
// O frontend pede só as moedas em uso (`?symbols=USD,EUR`) e recebe quantos reais vale 1
// unidade de cada. Moeda que o provedor não cota simplesmente não vem na resposta — o frontend
// deixa os itens dela fora dos totais e avisa. `stale: true` = cotação antiga, servida porque a
// atualização falhou. Autenticada para não virar um proxy aberto do provedor.
const MAX_EXCHANGE_SYMBOLS = 20;

router.get('/', authenticateToken, async (req, res) => {
  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const symbols = [...new Set(raw.split(',').map(code => code.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0 || symbols.length > MAX_EXCHANGE_SYMBOLS || !symbols.every(code => CURRENCY_CODE_PATTERN.test(code))) {
    return res.status(400).json({
      error: `Informe em "symbols" até ${MAX_EXCHANGE_SYMBOLS} códigos de moeda ISO, separados por vírgula (ex.: USD,EUR).`,
    });
  }
  try {
    const { date, rates, stale } = await getExchangeRates();
    const picked = {};
    for (const code of symbols) {
      if (code === BASE_CURRENCY) picked[code] = 1;
      else if (Object.prototype.hasOwnProperty.call(rates, code)) picked[code] = rates[code];
    }
    res.json({ base: BASE_CURRENCY, date, rates: picked, stale });
  } catch (err) {
    // O detalhe fica no log: a resposta não repete a mensagem do provedor (FIN-011).
    console.error('Falha ao obter cotações de câmbio:', err);
    res.status(502).json({ error: 'Cotações indisponíveis no momento. Tente novamente mais tarde.' });
  }
});
