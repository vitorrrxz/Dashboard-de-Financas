/** Marca do FinFlow: três saldos que escoam — um livro-caixa visto de lado. */
export function FinFlowMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect x="3" y="5" width="18" height="3" rx="1.5" fill="var(--color-accent)" />
      <rect x="3" y="10.5" width="13" height="3" rx="1.5" fill="var(--color-white)" />
      <rect x="3" y="16" width="7" height="3" rx="1.5" fill="var(--color-white)" opacity="0.45" />
    </svg>
  );
}
