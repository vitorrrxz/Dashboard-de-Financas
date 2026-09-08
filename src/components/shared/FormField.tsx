// FIN-087 — extraído de AccountsManager.tsx e DebtManager.tsx, onde existiam duas cópias
// idênticas deste componente (label uppercase + espaçamento padrão usado em todos os
// formulários de modal do app).
//
// `htmlFor` é opcional (nem todo uso passa um `id` para o controle interno), mas quando
// fornecido associa o `<label>` ao campo via atributo nativo `for`/`id` — sem isso,
// leitores de tela não anunciam o rótulo ao focar o input, e clicar no texto do label não
// foca/marca o controle.
export function FormField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
