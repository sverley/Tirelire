/**
 * Méta-harnais d'audit de #91, écrit par la session d'audit du 14 septembre 2026.
 *
 * #91 est un besoin de règle, et sa livraison est un texte : l'ordre des deux agents, ce qui
 * appartient à chacun, ce que le codeur ne peut pas faire, l'atomicité du harnais, la part humaine.
 * Rien là-dedans ne garde un comportement du produit — c'est le cas d'un méta-harnais (D65) : il
 * constate une livraison, il ne mord pas sur le code. Ce qui se vérifie, c'est que la règle soit
 * écrite **là où les sessions la lisent** (`CLAUDE.md`), qu'une décision la consigne **avec les mots
 * du porteur**, et que ce qu'elle rend sans objet soit signalé.
 *
 * Le harnais part des « Fait quand » de #91, pas du texte livré : il ne cherche aucune phrase
 * attendue, seulement le sens, par des lectures volontairement larges (un rôle, et ce qu'on lui
 * attribue, à portée l'un de l'autre). La solution reste libre de sa formulation.
 *
 * Témoins. Une lecture qui dirait « oui » de tout serait verte sans #91 : chaque lecture est donc
 * rejouée sur les documents **tels qu'ils étaient avant D67** (commit `ebe590a`, fusion de #90, le
 * 14 septembre) et doit y dire « non ». La lecture des citations a ses deux témoins en mémoire : une
 * paraphrase doit être lue « non », les mots du porteur « oui ».
 *
 * Question laissée ouverte par le porteur, consignée dans #91 : le harnais global attend-il que les
 * sous-tâches soient **vertes** ou **fermées** ? Le harnais accepte les deux lectures — trancher ici
 * reviendrait à décider dans une PR ce que le porteur n'a pas décidé. Quand il tranchera, la lecture
 * `atomicite-sous-taches` se resserre sur le mot retenu.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE = 'CLAUDE.md';
const DECISIONS = 'docs/decisions.md';
const RELIRE = "le méta-harnais d'audit de #91 est à relire";
const STRICT = Boolean(process.env.TIRELIRE_STRICT);

/** Les documents tels qu'ils étaient avant D67 : fusion de #90 sur `main`, le 14 septembre 2026. */
const AVANT_D67 = 'ebe590af09063d67be85407fc9b19bb9d68be6c0';

// ─── Lire les documents ───────────────────────────────────────────────────────────────────────

const lire = (fichier) => readFileSync(join(DEPOT, fichier), 'utf8');

/** Le document à un commit donné, `null` si l'objet n'est pas là (copie sans `.git`, clone court). */
function lireA(commit, fichier) {
  try {
    return execFileSync('git', ['show', `${commit}:${fichier}`], {
      cwd: DEPOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Texte ramené à ce qui porte le sens : sans accents, sans mise en forme, une seule sorte
 * d'apostrophe et de guillemet, espaces et retours à la ligne réduits. Les lectures traversent ainsi
 * les fins de ligne et ne dépendent ni du gras, ni des `…`, ni de l'apostrophe choisie.
 */
const normaliser = (texte) =>
  texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['‘’]/g, "'")
    .replace(/[«»“”"]/g, ' ')
    .replace(/[`*_>]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

// ─── Ce que #91 demande que `CLAUDE.md` dise ─────────────────────────────────────────────────

/**
 * Une lecture par « Fait quand ». Chacune tient en un motif appliqué au document normalisé : un
 * repère (le rôle, ou la notion) et ce qu'on lui attribue, séparés d'au plus quelques phrases.
 */
const LECTURES = [
  {
    cle: 'ordre',
    quoi: "l'ordre des deux agents : l'auditeur passe avant le codeur",
    motif: /l'auditeur (passe en premier|d'abord|avant le codeur)|auditeur,? puis (le )?codeur|le codeur (ensuite|apres)/,
  },
  {
    cle: 'auditeur-decoupage',
    quoi: "le découpage appartient à l'auditeur : c'est lui qui juge si le besoin tient en une tâche ou se décline",
    motif: /auditeur[\s\S]{0,240}(se decline en (une ou plusieurs )?(sous-)?taches|tient en une tache|decoupe le besoin|une ou plusieurs taches)/,
  },
  {
    cle: 'auditeur-fait-quand',
    quoi: "le « Fait quand » vérifiable appartient à l'auditeur",
    motif: /auditeur[\s\S]{0,320}fait quand/,
  },
  {
    cle: 'auditeur-harnais-et-pr',
    quoi: "le harnais et la PR, description comprise, appartiennent à l'auditeur",
    motif: /auditeur[\s\S]{0,320}(code|ecrit) le harnais[\s\S]{0,160}(ouvre|redige|ecrit)[\s\S]{0,80}(la pr|description)/,
  },
  {
    cle: 'codeur-ne-modifie-pas-la-pr',
    quoi: 'ce que le codeur ne peut pas faire : modifier la PR',
    motif: /codeur[\s\S]{0,320}ne (modifie|touche)[^.]{0,40}(jamais |pas )?(a )?(la pr|sa description|la description)/,
  },
  {
    cle: 'codeur-commente',
    quoi: 'ce que le codeur peut faire à la place : commenter',
    motif: /ne (modifie|touche)[^.]{0,60}(la pr|description)[\s\S]{0,400}commentaire/,
  },
  {
    cle: 'atomicite-tache',
    quoi: "un harnais n'est exigible que sur une tâche atomique, celle qu'une session mène entièrement",
    motif: /harnais[\s\S]{0,160}atomique|atomique[\s\S]{0,160}harnais/,
  },
  {
    cle: 'atomicite-sous-taches',
    quoi: "le harnais global d'une tâche à sous-tâches attend qu'elles soient vertes (ou fermées : #91)",
    motif: /(sous-)?taches?[\s\S]{0,240}harnais global[\s\S]{0,160}(vertes|fermees)|harnais global[\s\S]{0,240}(sous-)?taches[\s\S]{0,160}(vertes|fermees)/,
  },
  {
    cle: 'part-humaine',
    quoi: "l'intervention humaine fait partie du harnais, ce n'est pas un niveau de plus",
    motif: /(intervention|part) humaine[\s\S]{0,200}harnais[\s\S]{0,200}(pas un niveau|ni un niveau)/,
  },
];

const lectureDe = (cle) => LECTURES.find((l) => l.cle === cle) ?? assert.fail(`lecture ${cle} inconnue : ${RELIRE}`);
const dit = (texte, cle) => lectureDe(cle).motif.test(normaliser(texte));

// ─── La décision, et les mots du porteur ─────────────────────────────────────────────────────

/** Les mots dictés par le porteur le 14 septembre, recopiés de #91 : ce que la décision doit citer. */
const DICTE = [
  {
    cle: 'deux-agents',
    texte:
      "je ne fais pas confiance au codeur. Aussi, quand un besoin est défini (que ce soit une règle ou une " +
      'fonctionnalité), je veux un agent qui code le harnais du besoin pour vérifier que le codeur va bien ' +
      'répondre au besoin et un agent qui code le besoin.',
  },
  {
    cle: 'atomicite',
    texte:
      "un harnais ne doit être codé que si on a une tache atomique. Si une tache contient des sous-tache, on ne " +
      'peut pas imposer un harnais global tant que les sous-taches ne sont pas faites et vertes',
  },
  {
    cle: 'auditeur-ouvre-la-pr',
    texte:
      "c'est l'auditeur qui ouvre une PR. C'est donc l'auditeur d'un besoin qui évalue si le besoin doit se " +
      'décliner en une ou plusieurs taches. Le codeur ne fait que coder le besoin dont le harnais est déjà en place',
  },
  {
    cle: 'commentaires',
    texte: 'le codeur ne doit pas modifier une PR. Mais il peut mettre des commentaires',
  },
];

/** Une paraphrase fidèle mais réécrite : témoin rouge de la lecture des citations. */
const PARAPHRASE =
  "Le porteur ne présume pas de la bonne foi du codeur : il demande deux agents distincts, l'un pour le " +
  "harnais du besoin, l'autre pour le besoin lui-même, et réserve l'ouverture de la PR à l'auditeur.";

/** Le plus long des passages de `citation` recopié mot pour mot dans `texte`, `null` sinon. */
function motAMot(citation, texte, mots = 10) {
  const fenetres = normaliser(citation).split(' ');
  const cible = normaliser(texte);
  for (let i = 0; i + mots <= fenetres.length; i++) {
    const fenetre = fenetres.slice(i, i + mots).join(' ');
    if (cible.includes(fenetre)) return fenetre;
  }
  return null;
}

/** Les entrées de `docs/decisions.md` : identifiant, titre, corps, lignes citées. */
function decisions(texte) {
  const entrees = [];
  for (const ligne of texte.replace(/\r\n?/g, '\n').split('\n')) {
    const titre = ligne.match(/^##\s+(D\d+)\s+·\s+(.+)$/);
    if (titre) entrees.push({ id: titre[1], titre: titre[2], corps: '', citations: '' });
    else if (entrees.length) {
      const courante = entrees.at(-1);
      courante.corps += `${ligne}\n`;
      if (/^>/.test(ligne)) courante.citations += `${ligne.replace(/^>\s?/, '')}\n`;
    }
  }
  return entrees;
}

/** La décision qui consigne le fonctionnement : celle qui parle des deux agents, `null` sinon. */
const decisionDuFonctionnement = (texte) =>
  decisions(texte).find((d) => {
    const corps = normaliser(d.corps);
    return corps.includes('auditeur') && corps.includes('codeur') && DICTE.some((c) => motAMot(c.texte, d.citations));
  }) ?? null;

// ─── Amorçage : sans lui, un vert ne prouverait rien ──────────────────────────────────────────

test('amorçage · les documents que le harnais lit sont bien là', () => {
  for (const fichier of [CLAUDE, DECISIONS]) {
    assert.ok(lire(fichier).length > 500, `${fichier} est vide ou introuvable : ${RELIRE}`);
  }
  assert.ok(decisions(lire(DECISIONS)).length >= 60, `le journal des décisions ne se lit plus : ${RELIRE}`);
});

test("amorçage · la lecture des citations sait dire oui, et sait dire non", () => {
  for (const { cle, texte } of DICTE) {
    assert.ok(motAMot(texte, texte), `témoin vert : les mots du porteur ne se reconnaissent pas eux-mêmes (${cle}) : ${RELIRE}`);
    assert.equal(
      motAMot(texte, PARAPHRASE),
      null,
      `témoin rouge : une paraphrase est lue comme une citation (${cle}) ; une décision qui reformulerait le porteur passerait : ${RELIRE}`,
    );
  }
});

test("amorçage · avant D67, aucune des lectures ne disait oui", (t) => {
  const avant = lireA(AVANT_D67, CLAUDE);
  if (avant === null) {
    assert.ok(!STRICT, `le commit ${AVANT_D67.slice(0, 7)} est introuvable alors que TIRELIRE_STRICT est posé : ${RELIRE}`);
    return t.skip("dépôt sans historique : le témoin rouge ne peut pas être joué ici (il l'est en CI)");
  }
  for (const { cle, quoi } of LECTURES) {
    assert.ok(
      !dit(avant, cle),
      `témoin rouge : la lecture « ${cle} » dit déjà oui sur le CLAUDE.md d'avant D67 — elle passerait au vert sans #91.\n` +
        `Elle est censée mesurer : ${quoi}.\n${RELIRE}`,
    );
  }
  assert.equal(
    decisionDuFonctionnement(lireA(AVANT_D67, DECISIONS) ?? ''),
    null,
    `témoin rouge : une décision d'avant D67 est lue comme consignant le fonctionnement : ${RELIRE}`,
  );
});

// ─── #91 · CLAUDE.md dit l'ordre, ce qui appartient à chacun, et l'atomicité ──────────────────

for (const { cle, quoi } of LECTURES) {
  test(`#91 · ${CLAUDE} dit : ${quoi}`, () => {
    assert.ok(
      dit(lire(CLAUDE), cle),
      `#91 : ${CLAUDE} ne dit pas ${quoi}.\n` +
        `C'est un des « Fait quand » de #91 : la règle doit être écrite là où les sessions la lisent, ` +
        `pas seulement dans le journal des décisions. La formulation est libre ; c'est le sens qui est lu (${cle}).`,
    );
  });
}

// ─── #91 · une décision consigne le fonctionnement, avec les mots du porteur ──────────────────

test('#91 · une décision consigne le fonctionnement des deux agents', () => {
  const decision = decisionDuFonctionnement(lire(DECISIONS));
  assert.ok(
    decision,
    `#91 : aucune décision de ${DECISIONS} ne consigne le fonctionnement — une entrée qui parle de l'auditeur et du ` +
      `codeur et qui cite le porteur mot pour mot. La règle vit alors dans ${CLAUDE} seul, sans trace datée de qui l'a voulue.`,
  );
});

test('#91 · la décision cite le porteur mot pour mot, sur chacun des points qu’il a dictés', () => {
  const decision = decisionDuFonctionnement(lire(DECISIONS)) ?? assert.fail('la décision manque (voir le test précédent)');
  for (const { cle, texte } of DICTE) {
    assert.ok(
      motAMot(texte, decision.citations),
      `#91 : ${decision.id} ne cite pas le porteur sur « ${cle} ». Le porteur l'a dicté le 14 septembre ; une décision ` +
        `qui le reformule fait foi à sa place (${CLAUDE} : « le texte du porteur, mot pour mot, qui fait foi »).\n` +
        `Passage attendu, en citation : « ${texte.slice(0, 120)}… »`,
    );
  }
});

test('#91 · la décision signale ce qui devient sans objet dans les règles existantes', () => {
  const decision = decisionDuFonctionnement(lire(DECISIONS)) ?? assert.fail('la décision manque (voir le test précédent)');
  const corps = normaliser(decision.corps);
  assert.match(
    corps,
    /(sans objet|ne s'applique plus|caduc|tombe)[\s\S]{0,300}d\d+|d\d+[\s\S]{0,300}(devient sans objet|ne s'applique plus|caduc)/,
    `#91 : ${decision.id} ne dit pas ce qu'elle rend sans objet dans les règles existantes, en nommant la décision ` +
      `concernée. C'est un des « Fait quand » : une règle qui en périme une autre sans le dire laisse deux règles ` +
      `contradictoires en vigueur.`,
  );
});

test('#91 · CLAUDE.md renvoie à cette décision, pour qu’une session remonte à son origine', () => {
  const decision = decisionDuFonctionnement(lire(DECISIONS)) ?? assert.fail('la décision manque (voir le test précédent)');
  assert.ok(
    new RegExp(`\\b${decision.id}\\b`).test(lire(CLAUDE)),
    `#91 : ${CLAUDE} n'y renvoie pas : la règle y est écrite sans citer ${decision.id}, et rien ne relie plus la règle ` +
      `aux mots du porteur qui la fondent.`,
  );
});
