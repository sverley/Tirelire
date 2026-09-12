/**
 * Alerte de fusion non vérifiée et de push direct sur la branche principale (#62, D61).
 *
 * Sur un dépôt privé de l'offre gratuite, GitHub refuse la protection de branche comme les règles de
 * fusion : rien ne peut interdire une fusion ni un push. Le porteur a choisi d'y rester (#58, le
 * 11 septembre), donc la garde est une alerte après coup : une issue s'ouvre aussitôt, qui nomme la
 * PR ou le commit fautif, et la règle est écrite dans `CLAUDE.md`.
 *
 * Deux événements la déclenchent, et un seul juge à la fois :
 * - `pull_request` de type `closed` : la PR fusionnée dans la branche principale dont la vérification
 *   « Vérifications manuelles » n'était pas verte sur la tête fusionnée ouvre l'alerte. Une
 *   vérification absente ou inachevée vaut rouge — « vert veut dire validé » (D61) ;
 * - `push` sur la branche principale : seul se tait le push dont *tous* les commits viennent de PR
 *   fusionnées vers cette branche — la fermeture de ces PR les a déjà jugées, une fusion n'alerte pas
 *   deux fois. Tout le reste est un push direct : un commit glissé par-dessus une fusion faite en
 *   local, et tout push forcé, qui réécrit la branche et peut en retirer des fusions vérifiées sans
 *   porter un seul commit neuf. Question 1 de #62, tranchée par le porteur le 12 septembre : un
 *   changement de `main` qu'aucune PR n'explique est un push direct, et se tromper en parlant vaut
 *   mieux, pour une garde, que se tromper en se taisant.
 *
 * Le titre de l'issue est déterministe, et l'alerte cherche ce titre avant d'ouvrir : un événement
 * rejoué retrouve la sienne et n'en ouvre pas de seconde. Toute lecture et toute écriture passent par
 * `api`, que le harnais d'audit remplace (`alerte-fusion.test.mjs`).
 */

/** La vérification dont la couleur décide, seul signal avant une fusion (D61). */
export const VERIFICATION = 'Vérifications manuelles';
/** `alerte` marque ce que la garde ouvre ; `primaire` la rattache au chantier #58. */
export const ETIQUETTES = ['alerte', 'primaire'];
/** Un push en porte rarement plus, et la tête est lue la première : la fenêtre ne la manque jamais. */
const COMMITS_LUS = 20;

const court = (sha) => String(sha ?? '').slice(0, 7);
const date = (iso) => (iso ? String(iso).slice(0, 10) : 'date inconnue');
const qui = (...noms) => noms.find(Boolean) ?? 'auteur inconnu';

/**
 * Vert veut dire validé (D61) : seule une vérification terminée et réussie l'est. Absente, inachevée,
 * annulée ou en échec, elle est rouge — c'est la lecture proposée par l'audit, question 2 de #62.
 */
export function etatVerification(courses = []) {
  const siennes = courses.filter((c) => (c?.name ?? '').trim() === VERIFICATION);
  if (!siennes.length) return { verte: false, dit: `« ${VERIFICATION} » n'a jamais tourné sur cette tête` };
  // Le plus récent d'abord, comme GitHub les rend ; une exécution en cours ne tranche pas.
  const course = siennes.find((c) => c.status === 'completed') ?? siennes[0];
  if (course.status !== 'completed') return { verte: false, dit: `« ${VERIFICATION} » n'était pas terminée (${course.status})` };
  if (course.conclusion === 'success') return { verte: true, dit: `« ${VERIFICATION} » était verte` };
  return { verte: false, dit: `« ${VERIFICATION} » était ${course.conclusion === 'failure' ? 'rouge' : `« ${course.conclusion} »`}` };
}

/** Les commits que le push amène, du plus ancien au plus récent, sans doublon. */
export function commitsDuPush(evenement) {
  const listes = (evenement.commits ?? []).map((c) => c?.id).filter(Boolean);
  const tete = evenement.head_commit?.id ?? evenement.after;
  return [...new Set([...listes, tete].filter(Boolean))];
}

const RAPPEL = [
  '',
  "Règle (`CLAUDE.md`, #58 et #62) : tout changement de `main` passe par une PR dont la vérification",
  `« ${VERIFICATION} » est verte, et un push direct sur \`main\` vaut fusion non vérifiée. L'offre`,
  "gratuite ne permet pas de l'empêcher : cette issue est le signal.",
  '',
  'À faire : relire les vérifications manuelles concernées, les refaire sur `main` si le doute',
  'subsiste, puis fermer cette issue à la main.',
].join('\n');

async function surFusion(evenement, principale, api) {
  const pr = evenement.pull_request;
  if (!pr) return { motif: "l'événement ne porte pas de PR" };
  if (evenement.action !== 'closed') return { motif: `action « ${evenement.action} » : seule la fermeture est jugée` };
  if (!pr.merged) return { motif: `la PR #${pr.number} a été fermée sans être fusionnée` };
  if (pr.base?.ref !== principale) return { motif: `la PR #${pr.number} a été fusionnée dans \`${pr.base?.ref}\`, pas dans \`${principale}\`` };

  const tete = pr.head?.sha;
  const etat = etatVerification(await api.courses(tete));
  if (etat.verte) return { motif: `la PR #${pr.number} a été fusionnée au vert` };

  return {
    motif: `la PR #${pr.number} a été fusionnée alors que ${etat.dit}`,
    alerte: {
      titre: `Fusion non vérifiée · PR #${pr.number}`,
      corps: [
        `La PR [#${pr.number}](${pr.html_url}) « ${pr.title ?? ''} » a été fusionnée dans \`${principale}\` sans vérification verte.`,
        '',
        `- Vérification : ${etat.dit}.`,
        `- Tête de la PR au moment de la fusion : \`${tete}\``,
        `- Commit de fusion : \`${pr.merge_commit_sha ?? 'inconnu'}\``,
        `- Fusionnée par @${qui(pr.merged_by?.login, evenement.sender?.login)} le ${date(pr.merged_at)}`,
        `- Branche fusionnée : \`${pr.head?.ref ?? 'inconnue'}\``,
        RAPPEL,
      ].join('\n'),
    },
  };
}

async function surPush(evenement, principale, api) {
  if (evenement.ref !== `refs/heads/${principale}`) return { motif: `push sur \`${evenement.ref}\`, hors de \`${principale}\`` };
  if (evenement.deleted) return { motif: `\`${principale}\` a été supprimée, pas modifiée` };

  const commits = commitsDuPush(evenement);
  if (!commits.length) return { motif: 'le push ne porte aucun commit' };

  const tete = evenement.after || evenement.head_commit?.id;
  // La tête d'abord : c'est le commit le plus parlant, et la fenêtre ne doit jamais la manquer.
  const aJuger = [...new Set([tete, ...commits].filter(Boolean))].slice(0, COMMITS_LUS);

  // Un push forcé n'est jamais l'effet d'une fusion : il réécrit la branche, et peut en retirer des
  // fusions déjà vérifiées sans porter un seul commit neuf. Rien à interroger, il est direct.
  const force = evenement.forced === true;
  let directs = aJuger;
  if (!force) {
    directs = [];
    let jugee;
    for (const sha of aJuger) {
      const pr = (await api.prsDuCommit(sha)).find((p) => p && (p.merged || p.merged_at) && p.base?.ref === principale);
      if (pr) jugee ??= pr;
      else directs.push(sha);
    }
    // Le silence demande que *tous* les commits viennent d'une PR fusionnée, pas au moins un : un
    // commit poussé par-dessus une fusion faite en local n'a été relu par personne.
    if (!directs.length) return { motif: `tous les commits poussés viennent de PR fusionnées, dont #${jugee.number}, déjà jugées à leur fermeture` };
  }

  const raison = force
    ? `push forcé sur \`${principale}\` : \`${court(tete)}\` réécrit la branche, ce qu'aucune fusion ne fait`
    : `push direct sur \`${principale}\` : ${directs.map((s) => `\`${court(s)}\``).join(', ')} n'appartiennent à aucune PR fusionnée`;

  return {
    motif: raison,
    alerte: {
      titre: `Push direct sur \`${principale}\` · \`${court(tete)}\``,
      corps: [
        ...(force
          ? [
              `\`${principale}\` a été réécrite par un push forcé. Un push forcé n'est jamais l'effet d'une fusion : il`,
              "peut retirer de la branche des fusions déjà vérifiées sans porter un seul commit neuf, et aucune",
              'PR ne l\'explique. Un push direct vaut fusion non vérifiée.',
            ]
          : [
              `Un push direct sur \`${principale}\` : des commits poussés n'appartiennent à aucune PR fusionnée,`,
              "donc aucune vérification manuelle ne les a relus. Un push direct vaut fusion non vérifiée.",
            ]),
        '',
        `- Commit de tête : \`${tete}\``,
        `- Commits poussés : ${commits.map((s) => `\`${s}\``).join(', ') || 'aucun commit neuf dans la plage'}`,
        ...(force ? ['- Push forcé : oui'] : [`- Commits qu'aucune PR fusionnée n'explique : ${directs.map((s) => `\`${s}\``).join(', ')}`]),
        `- Poussé par @${qui(evenement.pusher?.name, evenement.sender?.login)}`,
        ...(evenement.compare ? [`- Comparaison : ${evenement.compare}`] : []),
        RAPPEL,
      ].join('\n'),
    },
  };
}

/**
 * Juge un événement de GitHub Actions et ouvre l'alerte s'il y a lieu. Rend ce qui a été décidé :
 * `alerte` quand il y avait à signaler, `deja` quand l'issue existait, `ouverte` quand elle vient de
 * s'ouvrir, et `motif` pour le bilan.
 */
export async function alerter({ evenement, nom, api }) {
  const principale = evenement?.repository?.default_branch || 'main';
  const genre = nom || (evenement?.pull_request ? 'pull_request' : evenement?.ref ? 'push' : '');

  let bilan;
  if (genre === 'pull_request' || genre === 'pull_request_target') bilan = await surFusion(evenement, principale, api);
  else if (genre === 'push') bilan = await surPush(evenement, principale, api);
  else bilan = { motif: `événement « ${genre || 'inconnu'} » : la garde ne juge que « pull_request » et « push »` };

  if (!bilan.alerte) return bilan;

  const deja = (await api.issues()).find((i) => i?.title === bilan.alerte.titre);
  if (deja) return { ...bilan, deja };

  const ouverte = await api.ouvrir({ title: bilan.alerte.titre, body: bilan.alerte.corps, labels: ETIQUETTES });
  return { ...bilan, ouverte };
}
