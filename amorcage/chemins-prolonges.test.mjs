/**
 * Amorçages de la règle livrée par `5a2ea94` (#73, chantier de #38, objectif primaire #58),
 * écrit par la session d'audit.
 *
 * **Où il vit, et pourquoi ici** (D65). Deux questions classent un harnais : qui l'a écrit, et
 * contre quel besoin. Celui-ci vient d'une session d'audit, et son besoin est une **règle du
 * projet** : `5a2ea94` change la façon dont la garde lit `docs/gardes.md`, en apprenant à `Chemins`
 * à se prolonger sous la ligne. Case auditeur × règle, donc amorçage, dans `amorcage/` et
 * hors de `pnpm test`.
 *
 * Le reste du travail d'audit de #73 est ailleurs — `packages/gardes/contraintes-c1-c2-c4-c7.test.mjs`
 * — parce que le besoin de #73 est un besoin de produit : quatre contraintes du produit reçoivent
 * leur garde. Une même PR peut porter les deux ; c'est la nature du besoin qui range chaque
 * fichier, pas la PR où il naît.
 *
 * **D'où vient la règle.** Le harnais d'audit de #73 a trouvé que `apps/web/vite.config.ts`, écrit
 * au registre sous C1 sur la seconde ligne de `Chemins`, n'était jamais lu : le plancher de l'entrée
 * était plus étroit que ce qu'elle annonçait, et rien ne le disait. I11 en souffrait déjà, trois de
 * ses cinq chemins n'étant pas lus. Le codeur a choisi d'apprendre la continuation à la garde
 * plutôt que de raccourcir la ligne de C1.
 *
 * **Ce que le codeur a écrit** (`packages/gardes/gardes.test.mjs`) : un registre inventé dont la
 * liste tient sur deux lignes, suivie d'une phrase qui ne prolonge rien, et les quatre chemins lus.
 * C'est le cas nominal. Ce qu'il ne dit pas, et que ce fichier tient :
 *
 * 1. **Aucun chemin écrit au vrai registre n'est perdu.** C'est la garantie qui compte, et elle
 *    survit à toute réécriture du registre : une liste coupée autrement, un chemin isolé sur sa
 *    ligne, une liste de trois lignes. Elle attrape aussi ce que la règle laisse tomber par
 *    construction — une ligne close par un point final, par exemple — là où le cas nominal, écrit
 *    d'après la règle, ne peut que la confirmer.
 * 2. **La continuation ne déborde pas.** Une ligne vide, une ligne d'étiquette (`- **Harnais** · …`)
 *    et une phrase ferment la liste ; et une fois close, elle ne se rouvre pas : une ligne de
 *    chemins écrite plus bas dans l'entrée n'est pas avalée. Sans cela, la continuation volerait à
 *    une entrée des chemins qui ne sont pas les siens, ou prendrait pour un chemin la suite
 *    renfoncée d'une ligne `Harnais`.
 *
 * Chaque vérification a son témoin vert — ce qui doit être accepté — et son témoin rouge — les mêmes
 * assertions rejouées sur une lecture volontairement revenue en arrière, qui doivent échouer.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RACINE, lireRegistre } from '../packages/gardes/gardes.mjs';

const REGISTRE = 'docs/gardes.md';
const RELIRE = "l'amorçage de la continuation des `Chemins` est à relire";

const registre = () => readFileSync(join(RACINE, REGISTRE), 'utf8');

/** Le corps d'une entrée du registre, titre exclu, jusqu'au titre suivant ou la fin. */
function corpsDeLEntree(id, texte) {
  const titre = texte.match(new RegExp(`^##+\\s+${id}\\s+·.*$`, 'm'));
  if (!titre) return '';
  const debut = titre.index + titre[0].length;
  const suite = texte.slice(debut).search(/\n##+\s+[IUC]\d+\s+·/);
  return suite === -1 ? texte.slice(debut) : texte.slice(debut, debut + suite);
}

/**
 * Les chemins qu'une entrée **écrit** sous `Chemins`, tous accents graves confondus, jusqu'à la
 * première ligne vide ou la première étiquette. Lu sans la garde, exprès : c'est ce que voit qui
 * relit le registre, et c'est à cela que la lecture de la garde doit être confrontée.
 */
function cheminsEcrits(id, texte) {
  const bloc = corpsDeLEntree(id, texte).match(/^Chemins\s*:([\s\S]*?)(?=\n\s*\n|\n[-*]\s)/m);
  return bloc ? [...bloc[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [];
}

/** Aucun chemin écrit au registre n'est perdu par la lecture de la garde. */
function verifierAucunCheminPerdu(texte) {
  const { entrees } = lireRegistre(texte);
  const perdus = [];
  for (const [id, entree] of entrees) {
    for (const chemin of cheminsEcrits(id, texte)) {
      if (!entree.chemins.includes(chemin)) perdus.push(`${id} : \`${chemin}\` est écrit au registre mais n'est pas lu`);
    }
  }
  assert.deepEqual(
    perdus,
    [],
    `des chemins écrits au registre ne sont pas lus par la garde : le plancher des entrées est plus ` +
      `étroit que ce qu'elles annoncent, sans que rien ne le dise :\n${perdus.join('\n')}`,
  );
}

test('règle · aucun chemin écrit au registre n’est perdu par la lecture de la garde', () => {
  verifierAucunCheminPerdu(registre());
});

/** Un registre inventé dont la liste se prolonge, tel que la règle le permet. */
const PROLONGE = [
  '## C9 · Une contrainte aux chemins nombreux',
  '',
  'Chemins : `a/un.ts`, `a/deux.ts`,',
  '`b/**/*.svelte`,',
  '`c/trois.html`',
  '',
  '- **Vérification manuelle** · `VM-C9-relire` — Relire les chemins écrits et constater que la garde les lit tous.',
].join('\n');

test('témoin vert · une liste coupée sur trois lignes, dont une pour un seul chemin, est lue en entier', () => {
  verifierAucunCheminPerdu(PROLONGE);
  assert.deepEqual(lireRegistre(PROLONGE).entrees.get('C9').chemins, ['a/un.ts', 'a/deux.ts', 'b/**/*.svelte', 'c/trois.html']);
});

test('témoin rouge · une lecture revenue à la seule première ligne fait échouer « aucun chemin perdu »', () => {
  const surUneSeuleLigne = (texte) => {
    const { entrees } = lireRegistre(texte);
    for (const entree of entrees.values()) entree.chemins = entree.chemins.slice(0, 2);
    return { entrees };
  };
  const perdus = [];
  for (const [id, entree] of surUneSeuleLigne(PROLONGE).entrees) {
    for (const chemin of cheminsEcrits(id, PROLONGE)) if (!entree.chemins.includes(chemin)) perdus.push(chemin);
  }
  assert.deepEqual(perdus, ['b/**/*.svelte', 'c/trois.html'], `la lecture tronquée devrait perdre deux chemins : ${RELIRE}`);
});

// ─── La continuation ne déborde pas ──────────────────────────────────────────────────────────

/** Les chemins lus pour `C9` dans un registre inventé. */
const lus = (lignes) => lireRegistre(lignes.join('\n')).entrees.get('C9')?.chemins ?? [];

test('règle · une ligne vide, une étiquette ou une phrase ferment la liste, et elle ne se rouvre pas', () => {
  const apresLigneVide = ['## C9 · Titre', '', 'Chemins : `a/un.ts`', '', '`b/vole.ts`', '', '- **Harnais** · `t.mjs` — ce qu’il garde. Témoin rouge : à bâtir (#1)'];
  assert.deepEqual(lus(apresLigneVide), ['a/un.ts'], 'une ligne de chemins écrite après une ligne vide ne doit pas rejoindre Chemins');

  const apresEtiquette = [
    '## C9 · Titre',
    '',
    'Chemins : `a/un.ts`',
    '- **Harnais** · `t.mjs` — ce qu’il garde. Témoin rouge : à bâtir (#1)',
    '`b/vole.ts`',
  ];
  assert.deepEqual(lus(apresEtiquette), ['a/un.ts'], 'une ligne de chemins écrite après une étiquette ne doit pas rejoindre Chemins');

  const apresPhrase = ['## C9 · Titre', '', 'Chemins : `a/un.ts`', 'Cette phrase ferme la liste.', '`b/vole.ts`'];
  assert.deepEqual(lus(apresPhrase), ['a/un.ts'], 'une ligne de chemins écrite après une phrase ne doit pas rejoindre Chemins');
});

test('témoin rouge · une continuation qui avalerait toute ligne de chemins ferait échouer la règle précédente', () => {
  const avale = (lignes) => {
    const chemins = [];
    let ouverte = false;
    for (const ligne of lignes) {
      const debut = ligne.match(/^Chemins\s*:\s*(.*)$/);
      if (debut) {
        ouverte = true;
        chemins.push(...[...debut[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
        continue;
      }
      if (ouverte && /^\s*`[^`]+`\s*,?\s*$/.test(ligne)) chemins.push(...[...ligne.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    }
    return chemins;
  };
  assert.deepEqual(avale(['## C9 · Titre', '', 'Chemins : `a/un.ts`', '', '`b/vole.ts`']), ['a/un.ts', 'b/vole.ts']);
  assert.notDeepEqual(avale(['## C9 · Titre', '', 'Chemins : `a/un.ts`', '', '`b/vole.ts`']), ['a/un.ts']);
});
