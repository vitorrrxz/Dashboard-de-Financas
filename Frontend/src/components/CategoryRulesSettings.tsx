import { useEffect, useId, useState, type FormEvent } from 'react';
import { Plus, Tags, Trash2 } from 'lucide-react';
import { apiFetch } from '../services/api';
import { CATEGORY_COLORS } from '../utils/categories';

interface CategoryRule {
  id: string;
  match: string;
  category: string;
}

const CATEGORIES = Object.keys(CATEGORY_COLORS);
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const byMatch = (a: CategoryRule, b: CategoryRule) => a.match.localeCompare(b.match, 'pt-BR');
const labelClass = 'block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide';

/**
 * FIN-106 — regras de categoria (FIN-105): a transação nova, importada ou da Pluggy, cuja descrição
 * contém o texto entra com a categoria da regra. Aqui se lista, troca a categoria, exclui e cria — o
 * servidor edita pela mesma rota da criação, identificando a regra pelo texto.
 */
export function CategoryRulesSettings({ token }: { token: string }) {
  const id = useId();
  const [rules, setRules] = useState<CategoryRule[] | null>(null);
  const [match, setMatch] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<CategoryRule[]>('/api/category-rules', { token })
      .then(list => setRules(Array.isArray(list) ? [...list].sort(byMatch) : []))
      .catch(err => { setRules([]); setError(errorMessage(err)); });
  }, [token]);

  const save = async (rule: { match: string; category: string }) => {
    setError('');
    try {
      const saved = await apiFetch<CategoryRule>('/api/category-rules', { method: 'POST', body: rule, token });
      if (!saved || typeof saved.id !== 'string') throw new Error('Resposta inesperada do servidor.');
      setRules(prev => [...(prev ?? []).filter(r => r.id !== saved.id), saved].sort(byMatch));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  const remove = async (rule: CategoryRule) => {
    setError('');
    try {
      await apiFetch(`/api/category-rules/${rule.id}`, { method: 'DELETE', token });
      setRules(prev => (prev ?? []).filter(r => r.id !== rule.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await save({ match, category })) setMatch('');
  };

  return (
    <section aria-labelledby={`${id}-title`} className="glass-card rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 shrink-0">
          <Tags size={20} className="text-primary" aria-hidden="true" />
        </div>
        <div>
          <h2 id={`${id}-title`} className="text-lg font-bold text-white">Regras de categoria</h2>
          <p className="text-sm text-textMuted">
            A transação nova — importada ou da Pluggy — cuja descrição contém o texto entra com a categoria da regra.
            Sem acento e sem diferenciar maiúsculas; havendo mais de uma, vale a de texto mais longo.
          </p>
        </div>
      </div>

      {error && <p role="alert" className="mb-4 text-sm text-red-400">{error}</p>}

      {rules === null ? (
        <p className="text-sm text-textMuted">Carregando regras…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-textMuted">Nenhuma regra ainda. Crie uma abaixo, ou ao corrigir a categoria de uma transação.</p>
      ) : (
        <ul className="space-y-2">
          {rules.map(rule => (
            <li key={rule.id} className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
              <span className="flex-1 min-w-0 truncate font-medium text-white">{rule.match}</span>
              <label htmlFor={`${id}-${rule.id}`} className="sr-only">Categoria de "{rule.match}"</label>
              <select id={`${id}-${rule.id}`} value={rule.category} className="input-field w-auto"
                onChange={e => { void save({ match: rule.match, category: e.target.value }); }}>
                {[...new Set([rule.category, ...CATEGORIES])].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" onClick={() => { void remove(rule); }} aria-label={`Excluir a regra "${rule.match}"`}
                className="p-2 rounded-lg text-textMuted hover:text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor={`${id}-match`} className={labelClass}>Texto na descrição</label>
          <input id={`${id}-match`} value={match} onChange={e => setMatch(e.target.value)} className="input-field"
            placeholder="Ex.: UBER" required minLength={2} maxLength={100} />
        </div>
        <div>
          <label htmlFor={`${id}-category`} className={labelClass}>Categoria</label>
          <select id={`${id}-category`} value={category} onChange={e => setCategory(e.target.value)} className="input-field">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button type="submit" className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}>
          <Plus size={16} aria-hidden="true" /> Adicionar regra
        </button>
      </form>
    </section>
  );
}
