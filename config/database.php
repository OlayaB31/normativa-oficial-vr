<?php
/**
 * Configuración de la base de datos.
 * Puedes editar los valores de abajo o definir variables de entorno
 * (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS) en tu hosting.
 * Este archivo NUNCA debe ser accesible por web (ver config/.htaccess).
 */
return [
    'host'     => getenv('DB_HOST') ?: '127.0.0.1',
    'port'     => (int) (getenv('DB_PORT') ?: 3306),
    'database' => getenv('DB_NAME') ?: 'normativa',
    'username' => getenv('DB_USER') ?: 'root',
    'password' => getenv('DB_PASS') ?: '',

    // Solo para depurar en local: añade el mensaje técnico a los errores 500.
    'debug'    => false,
];
