<?php
/**
 * Relais Tirelire pour hébergement mutualisé (PHP ≥ 8.1, aucune dépendance).
 * Même contrat que `apps/relay/server.mjs` :
 *   POST /r/<salon>                    { site, upTo, iv, blob }  → { id }
 *   GET  /r/<salon>?site=X&after=N     → { records: [{ id, site, upTo, iv, blob, at }] }
 * Le salon est un secret partagé ; le contenu est chiffré côté client (AES-GCM),
 * le serveur ne voit jamais ni la phrase ni les données.
 *
 * Stockage : un fichier `donnees/<salon>.jsonl` par salon, écrit sous verrou (flock).
 * Le dossier `donnees` est interdit à la lecture web par son `.htaccess`.
 */
declare(strict_types=1);

const MAX_BODY = 20 * 1024 * 1024;
const SALON = '/^[A-Za-z0-9_-]{8,64}$/';

$config = is_file(__DIR__ . '/relais.config.php') ? (require __DIR__ . '/relais.config.php') : [];
$dataDir = rtrim((string) (getenv('TIRELIRE_RELAIS_DONNEES') ?: ($config['donnees'] ?? (__DIR__ . '/donnees'))), '/');

function repondre(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: content-type');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Le salon vient de la réécriture Apache (`?salon=`) ou, sans réécriture, du chemin. */
function salonDemande(): ?string
{
    if (isset($_GET['salon'])) {
        return (string) $_GET['salon'];
    }
    $path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (preg_match('#(?:^|/)r/([^/]+)/?$#', $path, $m)) {
        return rawurldecode($m[1]);
    }
    return null;
}

function lireSalon(string $file): array
{
    if (!is_file($file)) {
        return [];
    }
    $records = [];
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $r = json_decode($line, true);
        if (is_array($r)) {
            $records[] = $r;
        }
    }
    return $records;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    repondre(204, []);
}

$salon = salonDemande();
if ($salon === null) {
    repondre(404, ['error' => 'introuvable']);
}
if (!preg_match(SALON, $salon)) {
    repondre(400, ['error' => 'salon invalide']);
}

if (!is_dir($dataDir) && !@mkdir($dataDir, 0750, true)) {
    repondre(500, ['error' => 'dossier de données inaccessible']);
}
$htaccess = $dataDir . '/.htaccess';
if (!is_file($htaccess)) {
    @file_put_contents($htaccess, "Require all denied\n");
}
$file = "$dataDir/$salon.jsonl";

if ($method === 'GET') {
    $site = (string) ($_GET['site'] ?? '');
    $after = (int) ($_GET['after'] ?? 0);
    $records = array_values(array_filter(
        lireSalon($file),
        fn(array $r) => ($r['id'] ?? 0) > $after && ($r['site'] ?? '') !== $site,
    ));
    repondre(200, ['records' => $records]);
}

if ($method === 'POST') {
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > MAX_BODY) {
        repondre(413, ['error' => 'trop gros']);
    }
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($raw === false || strlen($raw) > MAX_BODY) {
        repondre(413, ['error' => 'trop gros']);
    }
    $body = json_decode($raw, true);
    if (!is_array($body) || !is_string($body['site'] ?? null) || !is_string($body['blob'] ?? null) || !is_string($body['iv'] ?? null)) {
        repondre(400, ['error' => 'paquet invalide']);
    }

    $h = fopen($file, 'c+');
    if ($h === false || !flock($h, LOCK_EX)) {
        repondre(500, ['error' => 'verrou impossible']);
    }
    $id = 0;
    while (($line = fgets($h)) !== false) {
        $r = json_decode($line, true);
        if (is_array($r) && ($r['id'] ?? 0) > $id) {
            $id = (int) $r['id'];
        }
    }
    $id++;
    $record = [
        'id' => $id,
        'site' => $body['site'],
        'upTo' => (int) ($body['upTo'] ?? 0),
        'iv' => $body['iv'],
        'blob' => $body['blob'],
        'at' => gmdate('c'),
    ];
    fseek($h, 0, SEEK_END);
    fwrite($h, json_encode($record, JSON_UNESCAPED_SLASHES) . "\n");
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    repondre(201, ['id' => $id]);
}

repondre(405, ['error' => 'méthode']);
