/**
 * Le jour où tournent les pages : un jour fixe, pour que le verdict ne dépende pas de la date réelle
 * (#149). C'est un jour quelconque après l'exemple (daté du 6 septembre 2026) et dans sa période
 * (28 août – 27 septembre) : comme chez tout utilisateur qui charge l'exemple, l'écran lit au
 * 6 septembre, pas « aujourd'hui ». Midi, heure de Paris : loin de tout changement de jour.
 *
 * Écrit une fois, ici, pour les tests navigateur (`harnais.ts`) et pour l'application montée sans
 * navigateur (`ecran.ts`, #417), qui ne peut pas importer `harnais.ts` (Vite et puppeteer ne se
 * chargent pas sous jsdom).
 */
export const JOUR_DES_TESTS = '2026-09-20T12:00:00+02:00';
