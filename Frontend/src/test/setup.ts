// Registrado via `test.setupFiles` em vitest.config.ts. Estende `expect` com os matchers
// do jest-dom (ex. `toBeInTheDocument()`) para todos os testes de componente React — o
// subpath `/vitest` (em vez do import principal) também traz a tipagem do `expect` do
// Vitest aumentada com esses matchers, necessária para `tsc -b --noEmit` não reclamar de
// `.toBeInTheDocument` como propriedade inexistente.
import '@testing-library/jest-dom/vitest';
