import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import type { ThemePreference } from '../utils/theme';

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: typeof Sun }[] = [
  { value: 'dark', label: 'Escuro', hint: 'O visual original do FinFlow.', icon: Moon },
  { value: 'light', label: 'Claro', hint: 'Fundo claro, melhor em ambientes iluminados.', icon: Sun },
  { value: 'system', label: 'Igual ao sistema', hint: 'Acompanha o tema do celular ou do computador.', icon: Monitor },
];

interface ThemeSettingsProps {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}

/**
 * FIN-083 — escolha do tema. Botões de opção nativos (setas do teclado, leitor de tela), com o
 * cartão inteiro clicável: o rótulo se estende sobre ele (`after:inset-0`), e a descrição de cada
 * opção fica associada ao botão por `aria-describedby`, fora do nome.
 */
export function ThemeSettings({ preference, onChange }: ThemeSettingsProps) {
  return (
    <section aria-labelledby="theme-title" className="glass-card rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 shrink-0">
          <Palette size={20} className="text-primary" />
        </div>
        <div>
          <h2 id="theme-title" className="text-lg font-semibold text-white">Aparência</h2>
          <p className="text-sm text-textMuted">O tema escolhido fica salvo neste navegador.</p>
        </div>
      </div>

      <fieldset>
        <legend className="sr-only">Tema</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {OPTIONS.map(({ value, label, hint, icon: Icon }) => {
            const checked = preference === value;
            return (
              <div key={value}
                className={`relative flex items-start gap-3 p-3 rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-primary/50 ${
                  checked ? 'border-primary/60 bg-primary/10' : 'border-white/10 hover:bg-white/5'
                }`}>
                <input id={`theme-${value}`} type="radio" name="theme" value={value} checked={checked}
                  onChange={() => onChange(value)} aria-describedby={`theme-${value}-hint`}
                  className="mt-1 accent-primary" />
                <div>
                  <label htmlFor={`theme-${value}`}
                    className="flex items-center gap-1.5 text-sm font-semibold text-white cursor-pointer after:absolute after:inset-0">
                    <Icon size={14} aria-hidden="true" /> {label}
                  </label>
                  <p id={`theme-${value}-hint`} className="text-xs text-textMuted mt-0.5">{hint}</p>
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
