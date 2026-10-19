import type { Account } from '../types';
import { groupByBank } from '../utils/accountGroups';

/**
 * Opções do filtro de conta, agrupadas por banco. Banco com mais de uma conta (conta corrente e
 * cartão) ganha a opção de ver tudo dele junto.
 */
export function AccountOptions({ accounts }: { accounts: Account[] }) {
  return (
    <>
      <option value="" className="bg-dashboard">Todas as contas</option>
      {groupByBank(accounts).map(group => (
        <optgroup key={group.key} label={group.bank} className="bg-dashboard">
          {group.accounts.length > 1 && (
            <option value={group.value} className="bg-dashboard">{group.bank} — tudo</option>
          )}
          {group.accounts.map(a => (
            <option key={a.id} value={a.id} className="bg-dashboard">{a.name}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

interface AccountFilterProps {
  id: string;
  accounts: Account[];
  /** `null` = todas as contas; id de conta ou banco inteiro (ver `accountIdsOf`). */
  value: string | null;
  onChange: (selection: string | null) => void;
}

/** Filtro por conta das abas Transações e Dívidas — some quando há uma conta só. */
export function AccountFilter({ id, accounts, value, onChange }: AccountFilterProps) {
  if (accounts.length < 2) return null;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-textMuted">Conta</label>
      <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value || null)}
        className="bg-white/5 border border-white/10 text-sm text-white py-2 px-4 rounded-xl focus:outline-none focus:border-primary/50">
        <AccountOptions accounts={accounts} />
      </select>
    </div>
  );
}
