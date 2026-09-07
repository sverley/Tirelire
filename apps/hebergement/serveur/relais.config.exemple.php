<?php
// Copier en `relais.config.php` pour placer les données hors du dossier web
// (par exemple à côté de `www` sur l'hébergement, jamais servi par Apache).
return [
    'donnees' => dirname(__DIR__, 2) . '/tirelire-donnees',
];
