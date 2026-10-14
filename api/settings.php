<?php
require __DIR__ . '/../config/bootstrap.php';

const KEYS = ['server_name' => 80, 'tagline' => 200, 'description' => 300, 'footer_text' => 300];

function read_settings(): array
{
    $out = array_fill_keys(array_keys(KEYS), '');
    foreach (run('SELECT setting_key, setting_value FROM settings')->fetchAll() as $r) {
        if (array_key_exists($r['setting_key'], $out)) {
            $out[$r['setting_key']] = (string) $r['setting_value'];
        }
    }
    return $out;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    out(read_settings());
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Método no permitido', 405);
}
start_session();
require_auth('admin');
require_csrf();
$in = body()['settings'] ?? null;
if (!is_array($in)) {
    fail('Solicitud no válida');
}
foreach (KEYS as $key => $max) {
    if (!array_key_exists($key, $in)) {
        continue;
    }
    $val = str_in($in, $key, $max, $key === 'server_name', $key) ?? '';
    run('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [$key, $val]);
}
out(read_settings());
