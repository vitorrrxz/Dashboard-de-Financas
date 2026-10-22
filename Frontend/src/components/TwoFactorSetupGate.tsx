import { LogOut, ShieldCheck } from 'lucide-react';
import { FinFlowMark } from './FinFlowMark';
import { TwoFactorSettings } from './TwoFactorSettings';

interface TwoFactorSetupGateProps {
  /** A verificação foi ativada e os códigos de recuperação, guardados: o app pode abrir. */
  onEnabled: () => void;
  onLogout: () => void;
}

/**
 * FIN-123 — com a verificação em duas etapas obrigatória, quem entra sem ela ativa vê só esta tela até
 * configurar o aplicativo autenticador. O servidor recusa as rotas do app nesse meio-tempo (403
 * TWO_FACTOR_SETUP_REQUIRED); aqui é só o caminho até ativar.
 */
export function TwoFactorSetupGate({ onEnabled, onLogout }: TwoFactorSetupGateProps) {
  return (
    <main className="min-h-screen w-full flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <FinFlowMark />
            <span className="text-sm font-medium text-white">FinFlow</span>
          </div>
          <button type="button" onClick={onLogout}
            className="flex items-center gap-2 h-9 px-3 rounded-md text-sm text-textMuted hover:text-white hover:bg-white/[0.06] transition-colors">
            <LogOut size={16} aria-hidden="true" /> Sair
          </button>
        </div>
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-xl font-medium text-white mb-2">
            <ShieldCheck size={22} className="text-primary" aria-hidden="true" /> Proteja sua conta
          </h1>
          <p className="text-sm text-textMuted">
            Para usar o FinFlow, ative a verificação em duas etapas. A partir daí, todo login pede, além da senha (ou do
            Google/GitHub), um código do aplicativo autenticador do celular.
          </p>
        </div>
        <TwoFactorSettings onEnabled={onEnabled} />
      </div>
    </main>
  );
}
