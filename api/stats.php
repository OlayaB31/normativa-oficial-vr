<?php
declare(strict_types=1);

/**
 * /api/stats.php
 *
 * GET -> estadísticas reales para el resumen del panel.
 * Requiere una sesión autenticada.
 */

require __DIR__ . '/../config/bootstrap.php';

// Solo se permite el método GET.
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    fail('Método no permitido', 405);
}

// Iniciar y comprobar la sesión.
start_session();
require_auth();

// Estadísticas generales de los artículos.
$a = run(
    "SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status = 'published'), 0) AS published,
        COALESCE(SUM(status = 'draft'), 0) AS draft,
        COALESCE(SUM(status = 'archived'), 0) AS archived,
        MAX(updated_at) AS last_update
     FROM articles"
)->fetch();

if (!$a) {
    fail('No se pudieron obtener las estadísticas', 500);
}

// Contar categorías, secciones y etiquetas.
$categories = (int) run(
    'SELECT COUNT(*) FROM categories'
)->fetchColumn();

$sections = (int) run(
    'SELECT COUNT(*) FROM sections'
)->fetchColumn();

$tags = (int) run(
    'SELECT COUNT(*) FROM tags'
)->fetchColumn();

// Recuperar los últimos ocho cambios de artículos.
$activity = run(
    'SELECT
        v.version_no,
        v.change_note,
        v.created_at,
        a.id,
        a.number,
        a.title,
        u.display_name AS author
     FROM article_versions v
     INNER JOIN articles a
        ON a.id = v.article_id
     LEFT JOIN users u
        ON u.id = v.changed_by
     ORDER BY v.created_at DESC, v.id DESC
     LIMIT 8'
)->fetchAll();

// Respuesta JSON para el panel.
out([
    'articles' => [
        'total'     => (int) $a['total'],
        'published' => (int) $a['published'],
        'draft'     => (int) $a['draft'],
        'archived'  => (int) $a['archived'],
    ],
    'categories'  => $categories,
    'sections'    => $sections,
    'tags'        => $tags,
    'last_update' => $a['last_update'],
    'activity'    => $activity,
]);
