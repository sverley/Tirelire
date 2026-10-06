/**
 * Tests du codeur de #199, point 11 : une table `meta` à laquelle manque `key` ou `value` fait refuser
 * le fichier en le disant, à l'ouverture comme par la vérification du cœur et par `verifier-fichier`.
 * Tous de niveau 4 (D83).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { decrireProbleme, FichierRefuse, LedgerStore, verifierFichier } from '../src/index.js';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

const fichier = (ddl: string): Uint8Array => {
  const db = new SQL.Database();
  db.exec(ddl);
  const o = db.export();
  db.close();
  return o;
};

for (const [manque, ddl] of [
  ['value', `CREATE TABLE meta (key TEXT); INSERT INTO meta VALUES ('format');`],
  ['key', `CREATE TABLE meta (value TEXT); INSERT INTO meta VALUES ('tirelire');`],
] as const) {
  describe(`[niveau 4] #199 · 11. une table meta sans sa colonne « ${manque} »`, () => {
    let octets!: Uint8Array;
    beforeAll(() => {
      octets = fichier(ddl);
    });

    it('est refusée par la vérification du cœur, la table et la colonne nommées', async () => {
      const v = await verifierFichier(octets, { sqlJs: SQL });
      expect(v).toMatchObject({ ouvre: false, reason: 'invalide' });
      if (v.ouvre) return;
      expect(v.problemes).toHaveLength(1);
      expect(decrireProbleme(v.problemes[0]!)).toContain(`table meta, colonne ${manque}`);
      expect(v.problemes[0]!.message).toContain(`« ${manque} »`);
    });

    it('est refusée à l’ouverture, avec le refus des autres fichiers hors du format, sans rien ouvrir', async () => {
      for (const verifier of [true, false]) {
        const err = await LedgerStore.create({ sqlJs: SQL, bytes: octets, verifier, siteId: 'x' }).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(err, `verifier = ${String(verifier)}`).toBeInstanceOf(FichierRefuse);
        expect((err as FichierRefuse).reason).toBe('invalide');
        expect((err as FichierRefuse).message).toContain(`table meta, colonne ${manque}`);
      }
    });

    it('est refusée par verifier-fichier, qui sort 1 en disant le problème, jamais sur une erreur brute', () => {
      const dossier = mkdtempSync(join(tmpdir(), 'meta-sans-colonne-'));
      writeFileSync(join(dossier, 'f.sqlite'), octets);
      const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', '--import', './bin/resolution-ts.mjs', 'bin/verifier-fichier.ts', 'f.sqlite'], {
        cwd: resolve(import.meta.dirname, '..'),
        env: { ...process.env, INIT_CWD: dossier },
        encoding: 'utf-8',
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('refusé. 1 problème(s)');
      expect(r.stdout).toContain(`table meta, colonne ${manque}`);
      expect(r.stderr).not.toContain('no such column');
    });
  });
}
