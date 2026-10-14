<?php
require __DIR__ . '/../config/bootstrap.php';

function count_articles(array $node): int
{
    $n = count($node['articles']);
    foreach ($node['sections'] as $s) {
        $n += $s['count'];
    }
    return $n;
}

function build_tree(): array
{
    $cats = run("SELECT id, name, slug, description FROM categories WHERE status = 'published' ORDER BY sort_order, id")->fetchAll();
    $secs = run("SELECT id, category_id, parent_id, kind, name, slug, description FROM sections WHERE status = 'published' ORDER BY sort_order, id")->fetchAll();
    $arts = run("SELECT id, category_id, section_id, number, title, slug, summary FROM articles WHERE status = 'published' ORDER BY sort_order, id")->fetchAll();

    $secBy = [];
    foreach ($secs as $s) {
        $secBy[$s['parent_id'] === null ? 'c' . $s['category_id'] : 's' . $s['parent_id']][] = $s;
    }
    $artBy = [];
    foreach ($arts as $a) {
        $key = $a['section_id'] === null ? 'c' . $a['category_id'] : 's' . $a['section_id'];
        $artBy[$key][] = ['id' => (int) $a['id'], 'number' => $a['number'], 'title' => $a['title'], 'slug' => $a['slug'], 'summary' => $a['summary']];
    }
    $build = function (string $key) use (&$build, $secBy, $artBy): array {
        $node = ['articles' => $artBy[$key] ?? [], 'sections' => []];
        foreach ($secBy[$key] ?? [] as $s) {
            $child = $build('s' . $s['id']);
            $child['count'] = count_articles($child);
            $node['sections'][] = [
                'id' => (int) $s['id'], 'kind' => $s['kind'], 'name' => $s['name'], 'slug' => $s['slug'],
                'description' => $s['description'],
            ] + $child;
        }
        return $node;
    };

    $out = [];
    foreach ($cats as $c) {
        $node = $build('c' . $c['id']);
        $node['count'] = count_articles($node);
        $out[] = ['id' => (int) $c['id'], 'name' => $c['name'], 'slug' => $c['slug'], 'description' => $c['description']] + $node;
    }
    $last = run("SELECT MAX(updated_at) FROM articles WHERE status = 'published'")->fetchColumn();
    return ['categories' => $out, 'total_articles' => count($arts), 'last_update' => $last ?: null];
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if (isset($_GET['admin'])) {
        start_session();
        require_auth();
        out(run(
            'SELECT c.id, c.name, c.slug, c.description, c.sort_order, c.status,
                    (SELECT COUNT(*) FROM sections s WHERE s.category_id = c.id) AS sections_count,
                    (SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id) AS articles_count
               FROM categories c ORDER BY c.sort_order, c.id'
        )->fetchAll());
    }
    out(build_tree());
}

if ($method !== 'POST') {
    fail('Método no permitido', 405);
}

start_session();
require_auth('admin');
require_csrf();
$b = body();
$action = (string) ($b['action'] ?? '');

switch ($action) {
    case 'create':
    case 'update':
        $name = str_in($b, 'name', 120, true, 'Nombre');
        $desc = str_in($b, 'description', 500, false, 'Descripción');
        $status = enum_in($b, 'status', ['draft', 'published'], 'published');
        if ($action === 'create') {
            $slug = unique_slug('categories', slugify(str_in($b, 'slug', 140) ?? $name));
            run('INSERT INTO categories (name, slug, description, status, sort_order) VALUES (?, ?, ?, ?, ?)',
                [$name, $slug, $desc, $status, next_order('categories', '1 = 1', [])]);
            out(['id' => (int) db()->lastInsertId(), 'slug' => $slug], 201);
        }
        $id = int_in($b['id'] ?? null);
        $old = $id ? run('SELECT slug FROM categories WHERE id = ?', [$id])->fetch() : null;
        if (!$old) {
            fail('La categoría no existe', 404);
        }
        $slug = $old['slug'];
        $wanted = slugify((string) ($b['slug'] ?? ''));
        if ($wanted !== '' && $wanted !== $slug) {
            $slug = unique_slug('categories', $wanted, $id);
        }
        run('UPDATE categories SET name = ?, slug = ?, description = ?, status = ? WHERE id = ?', [$name, $slug, $desc, $status, $id]);
        out(['id' => $id, 'slug' => $slug]);

    case 'delete':
        $id = int_in($b['id'] ?? null);
        if (!$id || !run('SELECT 1 FROM categories WHERE id = ?', [$id])->fetchColumn()) {
            fail('La categoría no existe', 404);
        }
        $s = (int) run('SELECT COUNT(*) FROM sections WHERE category_id = ?', [$id])->fetchColumn();
        $a = (int) run('SELECT COUNT(*) FROM articles WHERE category_id = ?', [$id])->fetchColumn();
        if (($s || $a) && empty($b['force'])) {
            fail("Esta categoría contiene {$s} apartado(s) y {$a} artículo(s). Se eliminarán también de forma definitiva.", 409, ['needs_force' => true]);
        }
        run('DELETE FROM categories WHERE id = ?', [$id]);
        out(['deleted' => $id]);

    case 'move':
        $id = int_in($b['id'] ?? null);
        $dir = enum_in($b, 'dir', ['up', 'down'], 'up');
        move_sibling('categories', '1 = 1', [], (int) $id, $dir);
        out(['moved' => $id]);

    default:
        fail('Acción no válida', 404);
}
