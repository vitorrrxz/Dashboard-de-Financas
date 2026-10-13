import type { Account } from '../types';

interface AccountFilterProps {
  id: string;
  accounts: Account[];
  /** `null` = todas as contas. */
  value: string | null;
  onChange: (accountId: string | null) => void;
}

/** Filtro por conta das abas Transações e Dívidas — some quando há uma conta só. */
export function AccountFilter({ id, accounts, value, onChange }: AccountFilterProps) {
  if (accounts.length < 2) return null;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-textMuted">Conta</label>
      <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value || null)}
        className="bg-white/5 border border-white/10 text-sm text-white py-2 px-4 rounded-xl focus:outline-none focus:border-primary/50">
        <option value="" className="bg-dashboard">Todas as contas</option>
        {accounts.map(a => (
          <option key={a.id} value={a.id} className="bg-dashboard">{a.name} - {a.bank}</option>
        ))}
      </select>
    </div>
  );
}
