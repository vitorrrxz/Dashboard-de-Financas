import type { Account } from '../types';
import { groupByBank } from '../utils/accountGroups';

/**
 * Opções do filtro: um item por banco, que já reúne a conta corrente e o cartão dele. Com um banco
 * só, ele é a única opção (e equivale a "todos").
 */
export function AccountOptions({ accounts }: { accounts: Account[] }) {
  const groups = groupByBank(accounts);
  if (groups.length === 1) return <option value="" className="bg-dashboard">{groups[0].bank}</option>;
  return (
    <>
      <option value="" className="bg-dashboard">Todos os bancos</option>
      {groups.map(group => (
        <option key={group.key} value={group.value} className="bg-dashboard">{group.bank}</option>
      ))}
    </>
  );
}

interface AccountFilterProps {
  id: string;
  accounts: Account[];
  /** `null` = todos os bancos; senão, o banco escolhido (ver `accountIdsOf`). */
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
