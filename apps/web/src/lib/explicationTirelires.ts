/**
 * Le texte qui explique une tirelire et ses besoins, écrit une fois (#361, #369) : l'assistant l'affiche
 * en tête de chaque étape, l'écran Tirelires le replie sous « Comment ça marche ? ».
 */
import type { GenreDeLaSection } from './sectionTirelires.svelte';

export const EXPLICATION: Record<GenreDeLaSection, string> = {
  everyday:
    'Courses, essence, restaurants : le montant varie, mais vous voulez vous fixer une limite par période et voir ce qu\'il en reste. C\'est une tirelire qui se remplit à chaque paie.',
  periodic:
    'C\'est ici que les tirelires servent vraiment. Donnez le montant de la facture et sa date : Tirelire répartit la somme sur les paies qui restent d\'ici là, et vous n\'aurez pas de mauvaise surprise.',
  savings:
    'Une épargne sans date : vous décidez du montant par période, et la cible si vous en avez une. Elle passe après le reste — c\'est ce qui est financé en dernier quand le mois est serré.',
};
