import { useState } from 'react';
import { AlertTriangle, Archive, Download, Upload } from 'lucide-react';
import { apiFetch } from '../services/api';
import { downloadJSON, exportDateSuffix } from '../utils/export';
import {
  MAX_BACKUP_UPLOAD_BYTES, backupUploadBytes, describeBackupCounts, describeBackupSummary, parseRestoreResult,
  summarizeBackup, type BackupSummary,
} from '../utils/backup';
import { FormField } from './shared/FormField';

const UNEXPECTED = 'Resposta inesperada do servidor.';
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const secondaryButton = 'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-textMuted hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

interface BackupSettingsProps {
  token: string;
  /** Chamado depois de uma restauração bem-sucedida, com o resumo do que voltou — o App recarrega os dados. */
  onRestored: (summary: string) => void;
}

/**
 * FIN-079/FIN-080 — baixar o backup completo dos dados e restaurar um backup. A restauração
 * substitui todos os dados atuais, então só é liberada com o arquivo conferido (o resumo aparece
 * antes), a senha e a confirmação explícita.
 */
export function BackupSettings({ token, onRestored }: BackupSettingsProps) {
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [exportError, setExportError] = useState('');

  // `fileKey` recria o campo de arquivo — o único jeito de limpá-lo depois de restaurar.
  const [fileKey, setFileKey] = useState(0);
  const [backup, setBackup] = useState<unknown>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setExportError('');
    setExportNotice('');
    try {
      const data = await apiFetch<unknown>('/api/account/export', { token });
      const info = summarizeBackup(data);
      if (!info) throw new Error(UNEXPECTED);
      downloadJSON(`finflow-backup-${exportDateSuffix()}.json`, data);
      setExportNotice(`Backup baixado: ${describeBackupCounts(info.counts)}.`);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const forgetFile = () => {
    setBackup(null);
    setSummary(null);
    setConfirmed(false);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    forgetFile();
    setRestoreError('');
    if (!file) return;
    // O arquivo em disco é formatado e fica maior que o envio; quatro vezes o limite só barra o
    // que certamente não caberia, antes de gastar memória lendo.
    if (file.size > 4 * MAX_BACKUP_UPLOAD_BYTES) {
      setRestoreError('O arquivo passa do tamanho máximo aceito (25 MB).');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setRestoreError('O arquivo não é um JSON válido.');
      return;
    }
    const info = summarizeBackup(parsed);
    if (!info) {
      setRestoreError('O arquivo não é um backup do FinFlow, ou é de uma versão não suportada.');
      return;
    }
    if (backupUploadBytes(parsed) > MAX_BACKUP_UPLOAD_BYTES) {
      setRestoreError('O backup passa do tamanho máximo aceito (25 MB).');
      return;
    }
    setBackup(parsed);
    setSummary(info);
  };

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backup || !password || !confirmed) return;
    setRestoring(true);
    setRestoreError('');
    try {
      const response = await apiFetch<unknown>('/api/account/import', { method: 'POST', token, body: { password, backup } });
      const counts = parseRestoreResult(response);
      setPassword('');
      forgetFile();
      setFileKey(k => k + 1);
      onRestored(counts ? `Backup restaurado: ${describeBackupCounts(counts)}.` : 'Backup restaurado.');
    } catch (err) {
      setRestoreError(errorMessage(err));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section aria-labelledby="backup-title" className="glass-card rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 shrink-0">
          <Archive size={20} className="text-primary" />
        </div>
        <div>
          <h2 id="backup-title" className="text-lg font-semibold text-white">Backup dos seus dados</h2>
          <p className="text-sm text-textMuted">
            Um arquivo JSON com todas as suas contas, transações, dívidas, orçamentos, metas, recorrências e investimentos —
            para guardar uma cópia ou levar os dados para outra instalação do FinFlow.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Exportar</h3>
          <p className="text-sm text-textMuted mb-3">
            O arquivo tem os seus dados financeiros em texto aberto: guarde-o num lugar seguro. A senha e a verificação em
            duas etapas não vão nele.
          </p>
          {exportError && <p role="alert" className="text-sm text-red-400 mb-3">{exportError}</p>}
          {exportNotice && <p role="status" className="text-sm text-teal-400 mb-3">{exportNotice}</p>}
          <button type="button" onClick={handleExport} disabled={exporting} className={secondaryButton}>
            <Download size={15} /> {exporting ? 'Gerando…' : 'Baixar backup'}
          </button>
        </div>

        <div className="border-t border-white/5 pt-6">
          <h3 className="text-sm font-semibold text-white mb-3">Restaurar</h3>
          <div className="mb-4 p-3 rounded-xl flex items-start gap-2.5 border border-amber-500/25 bg-amber-500/10">
            <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-300">
              Restaurar <strong>substitui todos os seus dados atuais</strong> pelos do arquivo, e não dá para desfazer. Se
              quiser guardar o estado atual, baixe um backup antes.
            </p>
          </div>

          <form onSubmit={handleRestore} className="space-y-3">
            <FormField label="Arquivo de backup" htmlFor="backup-file">
              <input key={fileKey} id="backup-file" type="file" accept="application/json,.json" onChange={handleFile}
                aria-describedby={summary ? 'backup-summary' : undefined}
                className="block w-full text-sm text-textMuted file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-white/10 file:text-white file:text-sm file:cursor-pointer" />
            </FormField>

            {summary && (
              <>
                <p id="backup-summary" className="text-sm text-white">{describeBackupSummary(summary)}</p>
                <FormField label="Sua senha" htmlFor="backup-password">
                  <input id="backup-password" type="password" required autoComplete="current-password"
                    value={password} onChange={e => setPassword(e.target.value)} className="input-field" />
                </FormField>
                <div className="flex items-start gap-2">
                  <input id="backup-confirm" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
                    className="mt-1 accent-red-500" />
                  <label htmlFor="backup-confirm" className="text-sm text-textMuted">
                    Entendo que os meus dados atuais serão substituídos pelos do arquivo.
                  </label>
                </div>
              </>
            )}

            {restoreError && <p role="alert" className="text-sm text-red-400">{restoreError}</p>}

            <button type="submit" disabled={!summary || !password || !confirmed || restoring}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Upload size={15} /> {restoring ? 'Restaurando…' : 'Restaurar backup'}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
