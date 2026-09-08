// FIN-087 — extraído de AccountsManager.tsx e DebtManager.tsx, onde existiam duas cópias
// idênticas deste componente (label uppercase + espaçamento padrão usado em todos os
// formulários de modal do app).
export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
