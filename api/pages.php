<?php

require __DIR__ . '/../config/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    fail('Método no permitido', 405);
}
$slug = (string) ($_GET['slug'] ?? '');
if ($slug === '') {
    out(run("SELECT slug, title FROM pages WHERE status = 'published' ORDER BY sort_order, id")->fetchAll());
}
$page = run("SELECT slug, title, content, updated_at FROM pages WHERE slug = ? AND status = 'published'", [$slug])->fetch();
if (!$page) {
    fail('La página solicitada no existe', 404);
}
out($page);
