import { X } from 'lucide-react';
import { ThemeSettings } from '../components/ThemeSettings';
import { CategoryRulesSettings } from '../components/CategoryRulesSettings';
import { TwoFactorSettings } from '../components/TwoFactorSettings';
import { BackupSettings } from '../components/BackupSettings';
import type { useTheme } from '../hooks/useTheme';

interface SettingsPageProps {
  settingsNotice: string;
  onDismissNotice: () => void;
  theme: ReturnType<typeof useTheme>;
  onRestored: (summary: string) => void;
  hasTransactions: boolean;
  onClearTransactions: () => void;
}

export function SettingsPage({ settingsNotice, onDismissNotice, theme, onRestored, hasTransactions, onClearTransactions }: SettingsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-medium tracking-tight text-white mb-1">Configurações</h1>
        <p className="text-textMuted text-sm">Aparência, regras de categoria, segurança da conta e backup dos dados</p>
      </div>
      <div className="space-y-6 max-w-3xl">
        {settingsNotice && (
          <div role="status" className="p-4 rounded-xl flex items-start justify-between gap-3 border border-teal-500/25 bg-teal-500/10">
            <p className="text-sm text-teal-300">{settingsNotice}</p>
            <button type="button" onClick={onDismissNotice} aria-label="Fechar aviso"
              className="p-1 rounded-lg text-teal-300 hover:bg-white/10 transition-colors shrink-0">
              <X size={14}/>
            </button>
          </div>
        )}
        <ThemeSettings preference={theme.preference} onChange={theme.setPreference} />
        <CategoryRulesSettings />
        <TwoFactorSettings />
        <BackupSettings onRestored={onRestored} />
        {hasTransactions && (
          <section aria-labelledby="danger-title" className="pt-6 border-t border-[var(--line)]">
            <h2 id="danger-title" className="text-base font-medium text-white">Apagar todas as transações</h2>
            <p className="text-sm text-textMuted mt-1 mb-4">Remove todas as transações importadas e lançadas. Contas, dívidas e metas ficam. Não dá para desfazer — faça um backup antes.</p>
            <button type="button" onClick={onClearTransactions}
              className="h-9 px-4 rounded-md text-sm font-medium text-red-400 border border-red-400/40 hover:bg-red-500/10 transition-colors">
              Apagar transações
            </button>
          </section>
        )}
      </div>
    </>
  );
}
