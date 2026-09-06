/**
 * Ce qui diffère entre le navigateur et l'application Android (Capacitor) :
 * enregistrer / partager un fichier.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

/**
 * Remet un fichier à l'utilisateur : téléchargement dans le navigateur,
 * feuille de partage sur Android (enregistrer dans les fichiers, envoyer…).
 */
export async function saveFile(name: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (isNative) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const written = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: name, url: written.uri, dialogTitle: 'Enregistrer ou partager' });
    return;
  }
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
