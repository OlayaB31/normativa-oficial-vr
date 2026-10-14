<?php
declare(strict_types=1);

/**
 * Estadísticas del panel de administración.
 */

require __DIR__ . '/../config/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    fail('Método no permitido', 405);
}

start_session();
require_auth();

$a = run(
    "SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status = 'published'), 0) AS published,
        COALESCE(SUM(status = 'draft'), 0) AS draft,
        COALESCE(SUM(status = 'archived'), 0) AS archived,
        MAX(updated_at) AS last_update
     FROM articles"
)->fetch();

out([
    'articles' => [
        'total' => (int) $a['total'],
        'published' => (int) $a['published'],
        'draft' => (int) $a['draft'],
        'archived' => (int) $a['archived'],
    ],
    'categories' => (int) run(
        'SELECT COUNT(*) FROM categories'
    )->fetchColumn(),
    'sections' => (int) run(
        'SELECT COUNT(*) FROM sections'
    )->fetchColumn(),
    'tags' => (int) run(
        'SELECT COUNT(*) FROM tags'
    )->fetchColumn(),
    'last_update' => $a['last_update'],
    'activity' => run(
        'SELECT
            v.version_no,
            v.change_note,
            v.created_at,
            a.id,
            a.number,
            a.title,
            u.display_name AS author
         FROM article_versions v
         INNER JOIN articles a ON a.id = v.article_id
         LEFT JOIN users u ON u.id = v.changed_by
         ORDER BY v.created_at DESC, v.id DESC
         LIMIT 8'
    )->fetchAll(),
]);
