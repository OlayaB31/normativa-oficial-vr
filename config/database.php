<?php
/**
 * Configuración de la base de datos.
 * Puedes editar los valores de abajo o definir variables de entorno
 * (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS) en tu hosting.
 * Este archivo NUNCA debe ser accesible por web (ver config/.htaccess).
 */
return [
    'host'     => getenv('DB_HOST') ?: 'na04-sql.pebblehost.com',
    'port'     => (int) (getenv('DB_PORT') ?: 3306),
    'database' => getenv('DB_NAME') ?: 'customer_1053373_normativa-vr',
    'username' => getenv('DB_USER') ?: 'customer_1053373_normativa-vr',
    'password' => getenv('DB_PASS') ?: 'WFJFI^vb7lXxi!Kjd7Xq4h9o',

    // Solo para depurar en local: añade el mensaje técnico a los errores 500.
    'debug'    => true,
];
