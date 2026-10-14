<?php
/**
 * /api/sections.php  (apartados, títulos, capítulos y secciones, con profundidad ilimitada)
 *   GET ?admin=1                                   -> listado plano (requiere sesión)
 *   POST {action: create|update|delete|move}       (administrador + CSRF)
 */
require __DIR__ . '/../config/bootstrap.php';

const KINDS = ['apartado', 'titulo', 'capitulo', 'seccion'];
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    start_session();
    require_auth();
    out(run(
        'SELECT s.id, s.category_id, s.parent_id, s.kind, s.name, s.slug, s.description, s.sort_order, s.status,
                (SELECT COUNT(*) FROM articles a WHERE a.section_id = s.id) AS articles_count
           FROM sections s ORDER BY s.category_id, s.sort_order, s.id'
    )->fetchAll());
}
if ($method !== 'POST') {
    fail('Método no permitido', 405);
}

start_session();
require_auth('admin');
require_csrf();
$b = body();
$action = (string) ($b['action'] ?? '');

/** Valida la ubicación elegida y devuelve [category_id, parent_id]. */
function resolve_place(array $b, ?int $selfId): array
{
    $cat = int_in($b['category_id'] ?? null);
    if (!$cat || !run('SELECT 1 FROM categories WHERE id = ?', [$cat])->fetchColumn()) {
        fail('Selecciona una categoría válida');
    }
    $parent = int_in($b['parent_id'] ?? null);
    if ($parent) {
        $p = run('SELECT category_id FROM sections WHERE id = ?', [$parent])->fetch();
        if (!$p || (int) $p['category_id'] !== $cat) {
            fail('El elemento padre no pertenece a la categoría seleccionada');
        }
        if ($selfId && in_array($parent, descendant_section_ids($selfId), true)) {
            fail('Un apartado no puede colocarse dentro de sí mismo ni de sus descendientes');
        }
    }
    return [$cat, $parent ?: null];
}

switch ($action) {
    case 'create':
    case 'update':
        $name = str_in($b, 'name', 160, true, 'Nombre');
        $desc = str_in($b, 'description', 500, false, 'Descripción');
        $kind = enum_in($b, 'kind', KINDS, 'apartado');
        $status = enum_in($b, 'status', ['draft', 'published'], 'published');

        if ($action === 'create') {
            [$cat, $parent] = resolve_place($b, null);
            $slug = unique_slug('sections', slugify(str_in($b, 'slug', 180) ?? $name));
            run('INSERT INTO sections (category_id, parent_id, kind, name, slug, description, status, sort_order) VALUES (?,?,?,?,?,?,?,?)',
                [$cat, $parent, $kind, $name, $slug, $desc, $status, next_order('sections', 'category_id = ? AND parent_id <=> ?', [$cat, $parent])]);
            out(['id' => (int) db()->lastInsertId(), 'slug' => $slug], 201);
        }

        $id = int_in($b['id'] ?? null);
        $old = $id ? run('SELECT * FROM sections WHERE id = ?', [$id])->fetch() : null;
        if (!$old) {
            fail('El apartado no existe', 404);
        }
        [$cat, $parent] = resolve_place($b, $id);
        $slug = $old['slug'];
        $wanted = slugify((string) ($b['slug'] ?? ''));
        if ($wanted !== '' && $wanted !== $slug) {
            $slug = unique_slug('sections', $wanted, $id);
        }
        $order = $old['sort_order'];
        if ((int) $old['category_id'] !== $cat || (string) $old['parent_id'] !== (string) $parent) {
            $order = next_order('sections', 'category_id = ? AND parent_id <=> ?', [$cat, $parent]);
        }
        $pdo = db();
        $pdo->beginTransaction();
        run('UPDATE sections SET category_id=?, parent_id=?, kind=?, name=?, slug=?, description=?, status=?, sort_order=? WHERE id=?',
            [$cat, $parent, $kind, $name, $slug, $desc, $status, $order, $id]);
        if ((int) $old['category_id'] !== $cat) { // al cambiar de categoría arrastra a su descendencia
            $ids = descendant_section_ids($id);
            $in = placeholders($ids);
            run("UPDATE sections SET category_id = ? WHERE id IN ($in)", array_merge([$cat], $ids));
            run("UPDATE articles SET category_id = ? WHERE section_id IN ($in)", array_merge([$cat], $ids));
        }
        $pdo->commit();
        out(['id' => $id, 'slug' => $slug]);

    case 'delete':
        $id = int_in($b['id'] ?? null);
        if (!$id || !run('SELECT 1 FROM sections WHERE id = ?', [$id])->fetchColumn()) {
            fail('El apartado no existe', 404);
        }
        $ids = descendant_section_ids($id);
        $in = placeholders($ids);
        $arts = (int) run("SELECT COUNT(*) FROM articles WHERE section_id IN ($in)", $ids)->fetchColumn();
        $subs = count($ids) - 1;
        if (($arts || $subs) && empty($b['force'])) {
            fail("Este apartado contiene {$subs} subapartado(s) y {$arts} artículo(s). Se eliminarán también de forma definitiva.", 409, ['needs_force' => true]);
        }
        run('DELETE FROM sections WHERE id = ?', [$id]);
        out(['deleted' => $id]);

    case 'move':
        $id = int_in($b['id'] ?? null);
        $dir = enum_in($b, 'dir', ['up', 'down'], 'up');
        $row = $id ? run('SELECT category_id, parent_id FROM sections WHERE id = ?', [$id])->fetch() : null;
        if (!$row) {
            fail('El apartado no existe', 404);
        }
        move_sibling('sections', 'category_id = ? AND parent_id <=> ?', [$row['category_id'], $row['parent_id']], $id, $dir);
        out(['moved' => $id]);

    default:
        fail('Acción no válida', 404);
}
