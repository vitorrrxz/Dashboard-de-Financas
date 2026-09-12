// @vitest-environment node
// FIN-097 — o banco SQLite local (`dev.db`: dados reais e hashes de senha) e as cópias feitas antes
// das migrações não podem entrar no git. Uma regra do `.gitignore` não vale para arquivo que o git já
// rastreia — foi assim que o banco entrou no repositório —, por isso os testes conferem as duas
// coisas, com o próprio git: nada rastreado (`ls-files`) e as regras cobrindo os nomes
// (`check-ignore --no-index`, que avalia as regras mesmo para um caminho rastreado). Fora de um
// repositório git — um pacote baixado sem o histórico, por exemplo — os testes são pulados.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = args => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

const insideGitRepo = (() => {
  const result = git(['rev-parse', '--is-inside-work-tree']);
  return result.status === 0 && result.stdout.trim() === 'true';
})();

/** `git check-ignore` sai com 0 quando algum caminho é ignorado, 1 quando nenhum é, 128 em erro. */
const checkIgnore = paths => git(['check-ignore', '--no-index', ...paths]);
const lines = text => text.split(/\r?\n/).filter(Boolean);

/** Banco SQLite, com ou sem sufixo de arquivo auxiliar ou de cópia: `x.db`, `x.db-wal`, `x.db.bak-…`. */
const DATABASE_FILE = /\.(db|sqlite3?)([.-][^/]*)?$/i;

describe.skipIf(!insideGitRepo)('banco de dados fora do git (FIN-097)', () => {
  it('nenhum arquivo de banco rastreado pelo git', () => {
    const result = git(['ls-files', '-z']);
    expect(result.status).toBe(0);
    const tracked = result.stdout.split('\0').filter(Boolean);
    // Garante que a listagem veio de fato — uma lista vazia passaria no filtro abaixo sem provar nada.
    expect(tracked).toContain('package.json');
    expect(tracked.filter(path => DATABASE_FILE.test(path))).toEqual([]);
  });

  it('o .gitignore cobre o banco, os arquivos auxiliares do SQLite e as cópias', () => {
    const database = [
      'dev.db', 'dev.db-journal', 'dev.db-wal', 'dev.db-shm',
      // Cópias com os nomes que já foram versionados — nenhum deles casava com `*.db`.
      'dev.db.bak-2026-09-10T19-52-49-700Z', 'dev.db.backup-20260905-181115',
      'dev.bak-pre-fin078-2026-09-11T19-06-58-903Z.db', 'prisma/outro.db.bak-1',
    ];
    for (const path of database) expect(DATABASE_FILE.test(path), path).toBe(true);
    const result = checkIgnore(database);
    expect(result.status).toBe(0);
    expect(lines(result.stdout).sort()).toEqual([...database].sort());
  });

  it('as regras novas não ignoram o schema, as migrações nem o exemplo de .env', () => {
    const result = checkIgnore([
      'prisma/schema.prisma',
      'prisma/migrations/20260911190406_add_two_factor/migration.sql',
      '.env.example',
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });
});
