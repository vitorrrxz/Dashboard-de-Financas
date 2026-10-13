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
  token: string;
  onRestored: (summary: string) => void;
}

export function SettingsPage({ settingsNotice, onDismissNotice, theme, token, onRestored }: SettingsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Configurações</h1>
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
        <CategoryRulesSettings token={token} />
        <TwoFactorSettings token={token} />
        <BackupSettings token={token} onRestored={onRestored} />
      </div>
    </>
  );
}
