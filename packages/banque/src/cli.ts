/**
 * Ligne de commande du connecteur (preuve de faisabilité, tourne sur le serveur de Simon).
 *
 *   pnpm --filter @tirelire/banque cli banques
 *   pnpm --filter @tirelire/banque cli connecter [--banque "Société Générale"] [--jours 180]
 *   pnpm --filter @tirelire/banque cli comptes
 *   pnpm --filter @tirelire/banque cli operations [--depuis AAAA-MM-JJ | --tout] [--compte IBAN] [--sortie fichier.csv] [--json]
 *
 * Configuration (variables d'environnement ou `config.json` dans le dossier d'état) :
 *   TIRELIRE_EB_APP_ID   identifiant de l'application Enable Banking
 *   TIRELIRE_EB_CLE      chemin de la clé privée PEM téléchargée à la création de l'application
 *   TIRELIRE_EB_RETOUR   URL de retour déclarée dans l'application (défaut : la première déclarée)
 *   TIRELIRE_BANQUE_DIR  dossier d'état (défaut ~/.tirelire-banque) : config.json, session.json, exports
 * Rien de tout cela n'est versionné.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { ClientEnableBanking, ErreurEnableBanking, trouverBanque, type CompteBanque } from './enable-banking.ts';
import { cleCompte, versCsv, versLignes } from './conversion.ts';
import { SOCIETE_GENERALE } from './sg.ts';

interface Config {
  appId: string;
  clePem: string;
  redirectUrl?: string;
}

interface EtatSession {
  sessionId: string;
  banque: { name: string; country: string };
  validJusquau?: string;
  creeLe: string;
  comptes: Array<{ uid: string; cle: string; nom?: string; hash?: string }>;
}

const dossier = process.env['TIRELIRE_BANQUE_DIR'] ?? join(homedir(), '.tirelire-banque');
mkdirSync(dossier, { recursive: true });
const cheminSession = join(dossier, 'session.json');

function chargerConfig(): Config {
  const fichier = join(dossier, 'config.json');
  const f = existsSync(fichier) ? (JSON.parse(readFileSync(fichier, 'utf8')) as Partial<Config> & { cle?: string }) : {};
  const appId = process.env['TIRELIRE_EB_APP_ID'] ?? f.appId;
  const cheminCle = process.env['TIRELIRE_EB_CLE'] ?? f.cle;
  if (!appId || !cheminCle) {
    console.error(`Il manque TIRELIRE_EB_APP_ID et TIRELIRE_EB_CLE (ou ${fichier} avec appId et cle).`);
    process.exit(2);
  }
  const redirectUrl = process.env['TIRELIRE_EB_RETOUR'] ?? f.redirectUrl;
  return { appId, clePem: readFileSync(cheminCle, 'utf8'), ...(redirectUrl ? { redirectUrl } : {}) };
}

function chargerSession(): EtatSession {
  if (!existsSync(cheminSession)) {
    console.error('Aucune session : lance d\'abord « connecter ».');
    process.exit(2);
  }
  return JSON.parse(readFileSync(cheminSession, 'utf8')) as EtatSession;
}

async function demander(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function extraireCode(saisie: string): string {
  try {
    const code = new URL(saisie).searchParams.get('code');
    if (code) return code;
  } catch {
    /* pas une URL : on suppose que c'est le code lui-même */
  }
  return saisie;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      banque: { type: 'string' },
      jours: { type: 'string' },
      depuis: { type: 'string' },
      tout: { type: 'boolean' },
      compte: { type: 'string' },
      sortie: { type: 'string' },
      json: { type: 'boolean' },
      attente: { type: 'boolean' },
    },
  });
  const commande = positionals[0];
  const config = chargerConfig();
  const client = new ClientEnableBanking(config);

  switch (commande) {
    case 'banques': {
      const banques = await client.listerBanques(positionals[1] ?? 'FR');
      for (const b of banques.sort((a, b) => a.name.localeCompare(b.name))) {
        const jours = b.maximum_consent_validity ? Math.round(b.maximum_consent_validity / 86_400) : '?';
        console.log(`${b.name}\t${b.country}\t${jours} j\t${(b.psu_types ?? []).join(',')}${b.beta ? '\tbêta' : ''}`);
      }
      return;
    }

    case 'connecter': {
      const app = await client.application();
      const redirectUrl = config.redirectUrl ?? app.redirect_urls?.[0];
      if (!redirectUrl) {
        console.error('Aucune URL de retour : déclare-en une dans l\'application Enable Banking ou TIRELIRE_EB_RETOUR.');
        process.exit(2);
      }
      const nom = values.banque ?? SOCIETE_GENERALE.nom;
      const banques = await client.listerBanques(SOCIETE_GENERALE.pays);
      const banque = trouverBanque(banques, nom, SOCIETE_GENERALE.psuType);
      if (!banque) {
        console.error(`Banque « ${nom} » introuvable. Lance « banques » pour voir la liste.`);
        process.exit(2);
      }
      const maxJours = banque.maximum_consent_validity ? banque.maximum_consent_validity / 86_400 : 90;
      const jours = Math.min(Number(values.jours ?? maxJours), maxJours);
      const validJusquau = new Date(Date.now() + jours * 86_400_000);
      const { url } = await client.demarrerAutorisation({
        banque: { name: banque.name, country: banque.country },
        redirectUrl,
        validJusquau,
        state: randomUUID(),
        psuType: SOCIETE_GENERALE.psuType,
        langue: 'fr',
      });
      console.log(`\nBanque : ${banque.name} (${banque.country}), consentement ${Math.round(jours)} jours.`);
      console.log('Ouvre cette adresse dans un navigateur, valide dans l\'application de la banque :\n');
      console.log(url + '\n');
      const saisie = await demander('Colle ici l\'adresse de retour (ou le code) : ');
      const session = await client.creerSession(extraireCode(saisie));
      const etat: EtatSession = {
        sessionId: session.session_id,
        banque: { name: banque.name, country: banque.country },
        ...(session.access?.valid_until ? { validJusquau: session.access.valid_until } : {}),
        creeLe: new Date().toISOString(),
        comptes: session.accounts.map((c: CompteBanque) => ({
          uid: c.uid,
          cle: cleCompte(c),
          ...(c.name ? { nom: c.name } : {}),
          ...(c.identification_hash ? { hash: c.identification_hash } : {}),
        })),
      };
      writeFileSync(cheminSession, JSON.stringify(etat, null, 2));
      console.log(`\nSession créée, ${etat.comptes.length} compte(s) :`);
      for (const c of etat.comptes) console.log(`  ${c.cle}${c.nom ? `  (${c.nom})` : ''}`);
      console.log(`Valide jusqu'au ${etat.validJusquau ?? '?'}. État dans ${cheminSession}.`);
      console.log('Conseil : lance « operations --tout » dans l\'heure, tant que l\'historique long est ouvert.');
      return;
    }

    case 'comptes': {
      const etat = chargerSession();
      const session = await client.session(etat.sessionId);
      console.log(`${etat.banque.name} — session ${session.status ?? '?'}, valide jusqu'au ${session.access?.valid_until ?? etat.validJusquau ?? '?'}`);
      for (const c of etat.comptes) console.log(`  ${c.cle}${c.nom ? `  (${c.nom})` : ''}`);
      return;
    }

    case 'operations': {
      const etat = chargerSession();
      const comptes = values.compte ? etat.comptes.filter((c) => c.cle === values.compte || c.uid === values.compte) : etat.comptes;
      if (!comptes.length) {
        console.error('Compte introuvable dans la session.');
        process.exit(2);
      }
      const depuis = values.tout ? undefined : (values.depuis ?? iso(new Date(Date.now() - 90 * 86_400_000)));
      const lignes = [];
      for (const c of comptes) {
        const ops = await client.listerOperations(c.uid, {
          ...(depuis ? { depuis } : {}),
          strategie: values.tout ? 'longest' : 'default',
        });
        const attente = ops.filter((o) => o.status === 'PDNG').length;
        console.error(`${c.cle} : ${ops.length} opérations reçues${attente ? ` dont ${attente} en attente` : ''}`);
        lignes.push(...versLignes(ops, { compte: c.cle, ...(values.attente ? { garderAttente: true } : {}) }));
      }
      const sortie = values.sortie ?? join(dossier, `operations-${iso(new Date()).replace(/-/g, '')}.${values.json ? 'json' : 'csv'}`);
      writeFileSync(sortie, values.json ? JSON.stringify(lignes, null, 2) : versCsv(lignes));
      console.error(`${lignes.length} lignes écrites dans ${sortie}`);
      return;
    }

    default:
      console.error('Commandes : banques [pays] | connecter [--banque nom] [--jours n] | comptes | operations [--depuis AAAA-MM-JJ | --tout] [--compte IBAN] [--sortie f] [--json] [--attente]');
      process.exit(2);
  }
}

main().catch((e: unknown) => {
  if (e instanceof ErreurEnableBanking) {
    if (e.sessionExpiree) console.error('Session expirée : relance « connecter ».');
    else if (e.limiteAtteinte) console.error('Limite de la banque atteinte (4 récupérations par jour en arrière-plan) : réessaie dans quelques heures.');
    console.error(e.message);
  } else console.error(e);
  process.exit(1);
});
