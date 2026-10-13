// FIN-105 — texto sem acento e em minúsculas: "Uber", "UBER" e "Úber" casam com a mesma regra.
export const foldText = text => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Categoria da regra do usuário contida em `description` — a mais específica (texto mais longo) —, ou `null`. */
export function ruleCategory(rules, description) {
  const text = foldText(description);
  const hits = rules.filter(rule => text.includes(foldText(rule.match)));
  if (hits.length === 0) return null;
  return hits.reduce((best, rule) => (foldText(rule.match).length > foldText(best.match).length ? rule : best)).category;
}
