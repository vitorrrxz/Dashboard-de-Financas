import { useCallback, useState } from 'react';
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { parseFile } from '../utils/parsers';
import type { Transaction } from '../utils/parsers';

interface ImportModalProps {
  onClose: () => void;
  onImport: (transactions: Transaction[]) => void;
}

type UploadState = 'idle' | 'dragging' | 'loading' | 'success' | 'error';

export function ImportModal({ onClose, onImport }: ImportModalProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [preview, setPreview] = useState<Transaction[]>([]);
  const [fileName, setFileName] = useState('');

  const processFile = async (file: File) => {
    setState('loading');
    setFileName(file.name);
    try {
      const txs = await parseFile(file);
      if (txs.length === 0) {
        setErrorMsg('Nenhuma transação encontrada. Verifique o formato do arquivo.');
        setState('error');
        return;
      }
      setPreview(txs);
      setState('success');
    } catch {
      setErrorMsg('Erro ao processar o arquivo. Tente um OFX ou CSV válido.');
      setState('error');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState('idle');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleConfirm = () => {
    onImport(preview);
    onClose();
  };

  const income = preview.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expense = preview.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl glass-card rounded-2xl p-8 relative"
        onClick={e => e.stopPropagation()}
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Importar Extrato</h2>
            <p className="text-sm text-textMuted mt-1">Suporte a OFX (Itaú, Bradesco, BB, Santander) e CSV (Nubank, Inter)</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
            <X size={20} />
          </button>
        </div>

        {(state === 'idle' || state === 'dragging') && (
          <div
            onDragOver={e => { e.preventDefault(); setState('dragging'); }}
            onDragLeave={() => setState('idle')}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 ${
              state === 'dragging'
                ? 'border-primary bg-primary/10'
                : 'border-white/10 hover:border-white/30 hover:bg-white/[0.02]'
            }`}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input id="file-input" type="file" accept=".ofx,.qfx,.csv" className="hidden" onChange={handleFileInput} />
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors ${
              state === 'dragging' ? 'bg-primary/20' : 'bg-white/5'
            }`}>
              <Upload size={28} className={state === 'dragging' ? 'text-primary' : 'text-textMuted'} />
            </div>
            <p className="text-white font-semibold text-center mb-1">
              {state === 'dragging' ? 'Solte o arquivo aqui!' : 'Arraste seu extrato ou clique para buscar'}
            </p>
            <p className="text-textMuted text-sm text-center">Formatos aceitos: .OFX, .QFX, .CSV</p>

            <div className="flex gap-3 mt-6">
              {['Nubank (.csv)', 'Itaú (.ofx)', 'Bradesco (.ofx)', 'BB (.ofx)', 'Inter (.csv)'].map(b => (
                <span key={b} className="text-xs px-3 py-1 bg-white/5 border border-white/10 rounded-full text-textMuted">{b}</span>
              ))}
            </div>
          </div>
        )}

        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader size={40} className="text-primary animate-spin mb-4" />
            <p className="text-white font-medium">Processando <span className="text-primary">{fileName}</span>...</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-400" />
            </div>
            <p className="text-white font-semibold mb-2">Falha ao importar</p>
            <p className="text-textMuted text-sm text-center mb-6">{errorMsg}</p>
            <button onClick={() => setState('idle')} className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors">
              Tentar novamente
            </button>
          </div>
        )}

        {state === 'success' && (
          <div>
            {/* Success summary */}
            <div className="flex items-center gap-3 mb-5 p-4 bg-accent/10 border border-accent/20 rounded-xl">
              <CheckCircle size={20} className="text-accent shrink-0" />
              <div>
                <p className="text-white text-sm font-semibold">{preview.length} transações encontradas em <span className="text-accent">{fileName}</span></p>
                <p className="text-textMuted text-xs mt-0.5">
                  Receitas: <span className="text-accent">+R$ {income.toFixed(2).replace('.', ',')}</span>
                  {' · '}
                  Despesas: <span className="text-red-400">-R$ {expense.toFixed(2).replace('.', ',')}</span>
                </p>
              </div>
            </div>

            {/* Preview table */}
            <div className="max-h-64 overflow-y-auto rounded-xl border border-white/5">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-card/80 backdrop-blur">
                  <tr className="text-xs text-textMuted uppercase tracking-wider">
                    <th className="px-4 py-3 font-medium">Descrição</th>
                    <th className="px-4 py-3 font-medium">Categoria</th>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 50).map(tx => (
                    <tr key={tx.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-sm text-white max-w-[180px] truncate">{tx.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs px-2 py-1 bg-white/5 border border-white/10 rounded-full text-textMuted">{tx.category}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-textMuted">{new Date(tx.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
                      <td className={`px-4 py-2.5 text-sm font-semibold text-right ${tx.amount > 0 ? 'text-accent' : 'text-white'}`}>
                        {tx.amount > 0 ? '+' : ''}R$ {Math.abs(tx.amount).toFixed(2).replace('.', ',')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 50 && (
                <p className="text-center text-xs text-textMuted py-3">... e mais {preview.length - 50} transações</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setState('idle'); setPreview([]); }} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm text-textMuted transition-colors">
                Cancelar
              </button>
              <button onClick={handleConfirm} className="flex-1 py-2.5 bg-primary hover:bg-primary/90 rounded-xl text-sm text-white font-semibold transition-colors shadow-lg shadow-primary/20">
                <div className="flex items-center justify-center gap-2">
                  <FileText size={16} />
                  Importar {preview.length} transações
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
