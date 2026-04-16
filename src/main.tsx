import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Clear potentially corrupted localStorage data from old sessions
try {
  const stored = localStorage.getItem('finance_transactions');
  if (stored) JSON.parse(stored); // test parse — if it fails, clear it
} catch {
  localStorage.removeItem('finance_transactions');
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
