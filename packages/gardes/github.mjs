/**
 * La garde sur GitHub (#58, #61, D61). À chaque événement d'une PR : enregistre les validations que
 * cet événement vient de cocher, décoche celles qu'une modification postérieure du code a annulées, puis rend
 * le bilan de `verifierPr`. Toute lecture et écriture passe par `api`, que les tests remplacent.
 */
import { analyseEcrite, cochees, decocher, empreinteAnalyse, lireDescriptionPr, lireHorodatages, texteAnnulation, texteHorodatage, verifierPr } from './gardes.mjs';

/** Après ces événements, aucune case cochée auparavant ne peut valoir pour l'état de la PR. */
const NOUVEL_ETAT = new Set(['opened', 'reopened', 'synchronize']);
const ESSAIS = 3;
const PAUSE_MS = 5000;

export async function verifierPrSurGithub({
  evenement,
  api,
  entrees,
  entreesAvant = new Map(),
  fichiersModifies = [],
  fichiersDepuis = () => null,
  attendre = (ms) => new Promise((fin) => setTimeout(fin, ms)),
  maintenant = () => new Date(),
}) {
  const numero = evenement.pull_request.number;
  const tete = evenement.pull_request.head.sha;
  const cible = evenement.pull_request.base.ref;
  const notes = [];
  const aJour = (pr) => pr.head.sha === tete && pr.base.ref === cible;

  // 1. Ce que cet événement vient de cocher s'enregistre, si la PR n'a pas changé entre-temps.
  if (evenement.action === 'edited' && evenement.changes?.body) {
    const avant = cochees(evenement.changes.body.from);
    const nouvelles = (lireDescriptionPr(evenement.pull_request.body ?? '')?.items ?? []).filter(
      (i) => i.validee && !avant.has(i.cle) && analyseEcrite(i.analyse),
    );
    if (nouvelles.length) {
      if (!aJour(await api.lirePr(numero))) {
        notes.push(`La PR a changé pendant la validation de ${nouvelles.map((i) => `\`${i.cle}\``).join(', ')} : relire, puis cocher de nouveau.`);
      } else {
        const date = maintenant().toISOString();
        const par = evenement.sender?.login ?? 'inconnu';
        await api.commenter(numero, texteHorodatage(nouvelles.map((i) => ({ cle: i.cle, tete, cible, analyse: empreinteAnalyse(i.analyse), par, date }))));
      }
    }
  }

  // 2. Bilan sur la description et les validations actuelles. Une case cochée à l'instant peut être
  //    en cours d'enregistrement par une vérification voisine : on lui en laisse le temps.
  const evaluer = async () => {
    const pr = await api.lirePr(numero);
    const horodatages = lireHorodatages(await api.lireCommentaires(numero));
    return { pr, resultat: verifierPr({ entrees, entreesAvant, corps: pr.body ?? '', fichiersModifies, validations: { tete, cible, horodatages, fichiersDepuis } }) };
  };
  let { pr, resultat } = await evaluer();
  for (let essai = 1; essai < ESSAIS && resultat.nonEnregistrees.length && aJour(pr); essai++) {
    await attendre(PAUSE_MS);
    ({ pr, resultat } = await evaluer());
  }

  // 3. Ce qui ne vaut plus se décoche, pour qu'il n'y ait qu'à cocher de nouveau. Une vérification en
  //    retard sur la PR ne touche à rien : celle du dernier événement fait foi.
  if (!aJour(pr)) {
    notes.push('La PR a changé depuis cet événement : la vérification suivante fait foi.');
  } else {
    const nouvelEtat = NOUVEL_ETAT.has(evenement.action) || Boolean(evenement.changes?.base);
    const nonEnregistrees = nouvelEtat ? resultat.nonEnregistrees : [];
    const cles = [...resultat.annulees.map((a) => a.cle), ...nonEnregistrees];
    const corps = decocher(pr.body ?? '', cles);
    if (cles.length && corps !== (pr.body ?? '')) {
      await api.modifierDescription(numero, corps);
      await api.commenter(numero, texteAnnulation(resultat.annulees, nonEnregistrees));
      ({ resultat } = await evaluer());
    }
  }
  resultat.enAttente.push(...notes);
  return resultat;
}
