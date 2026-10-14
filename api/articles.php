<?php
/**
 * /api/articles.php
 * Público:
 *   GET ?slug=x[&preview=1]   -> artículo publicado (preview: cualquier estado, solo con sesión)
 *   GET ?recent=1[&limit=8]   -> últimos artículos actualizados
 * Panel (sesión):
 *   GET ?admin=1&q=&status=&category_id=&page=   -> listado paginado
 *   GET ?admin=1&id=N                            -> artículo completo (para editar)
 *   GET ?admin=1&history=N                       -> historial de versiones
 *   POST {action: create|update|duplicate|move|set_status|restore|delete|sanitize}
 */
require __DIR__ . '/../config/bootstrap.php';

const STATUSES = ['draft', 'published', 'archived'];
const STATUS_LABEL = ['draft' => 'Borrador', 'published' => 'Publicado', 'archived' => 'Archivado'];

/* ---------- utilidades ---------- */

function tags_in(array $b): array
{
    $t = $b['tags'] ?? [];
    if (is_string($t)) {
        $t = explode(',', $t);
    }
    return is_array($t) ? array_slice($t, 0, 12) : [];
}

function sync_tags(int $articleId, array $names): void
{
    run('DELETE FROM article_tags WHERE article_id = ?', [$articleId]);
    $seen = [];
    foreach ($names as $n) {
        $n = trim(mb_substr((string) $n, 0, 40));
        $slug = slugify($n);
        if ($n === '' || $slug === '' || isset($seen[$slug])) {
            continue;
        }
        $seen[$slug] = true;
        run('INSERT INTO tags (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', [$n, $slug]);
        run('INSERT IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)', [$articleId, (int) db()->lastInsertId()]);
    }
}

function snapshot(int $id, ?string $note, ?int $uid): void
{
    run('INSERT INTO article_versions (article_id, version_no, number, title, summary, content, scope, status, change_note, changed_by)
         SELECT id, version, number, title, summary, content, scope, status, ?, ? FROM articles WHERE id = ?',
        [$note, $uid, $id]);
}

function article_fields(array $b): array
{
    $f = [
        'number'  => str_in($b, 'number', 20, false, 'Número'),
        'title'   => str_in($b, 'title', 200, true, 'Título'),
        'summary' => str_in($b, 'summary', 500, false, 'Descripción'),
        'scope'   => str_in($b, 'scope', 500, false, 'Aplicación'),
        'status'  => enum_in($b, 'status', STATUSES, 'draft'),
        'content' => clean_html(is_string($b['content'] ?? null) ? $b['content'] : ''),
    ];
    if (mb_strlen($f['content']) > 500000) {
        fail('El contenido es demasiado extenso');
    }
    return $f;
}

function resolve_location(array $b): array
{
    $cat = int_in($b['category_id'] ?? null);
    if (!$cat || !run('SELECT 1 FROM categories WHERE id = ?', [$cat])->fetchColumn()) {
        fail('Selecciona una categoría válida');
    }
    $sec = int_in($b['section_id'] ?? null);
    if ($sec && !run('SELECT 1 FROM sections WHERE id = ? AND category_id = ?', [$sec, $cat])->fetchColumn()) {
        fail('El apartado no pertenece a la categoría seleccionada');
    }
    return [$cat, $sec ?: null];
}

function find_article(mixed $id): array
{
    $id = int_in($id);
    $a = $id ? run('SELECT * FROM articles WHERE id = ?', [$id])->fetch() : null;
    if (!$a) {
        fail('El artículo no existe', 404);
    }
    return $a;
}

/* ---------- GET ---------- */

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['admin'])) {
        start_session();
        require_auth();

        if (isset($_GET['history'])) {
            $id = (int) $_GET['history'];
            out(run('SELECT v.id, v.version_no, v.number, v.title, v.status, v.change_note, v.created_at, u.display_name AS author
                       FROM article_versions v LEFT JOIN users u ON u.id = v.changed_by
                      WHERE v.article_id = ? ORDER BY v.version_no DESC', [$id])->fetchAll());
        }
        if (isset($_GET['id'])) {
            $a = find_article($_GET['id']);
            unset($a['content_text']);
            $a['tags'] = run('SELECT t.name FROM tags t JOIN article_tags x ON x.tag_id = t.id WHERE x.article_id = ? ORDER BY t.name', [$a['id']])->fetchAll(PDO::FETCH_COLUMN);
            out($a);
        }

        $where = ['1 = 1'];
        $p = [];
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(a.title LIKE ? OR a.number LIKE ? OR a.slug LIKE ?)';
            array_push($p, $like, $like, $like);
        }
        if (in_array($_GET['status'] ?? '', STATUSES, true)) {
            $where[] = 'a.status = ?';
            $p[] = $_GET['status'];
        }
        if ($cat = int_in($_GET['category_id'] ?? null)) {
            $where[] = 'a.category_id = ?';
            $p[] = $cat;
        }
        if ($secId = int_in($_GET['section_id'] ?? null)) {
            $where[] = 'a.section_id = ?';
            $p[] = $secId;
        }
        $w = implode(' AND ', $where);
        $per = 20;
        $page = max(1, (int) ($_GET['page'] ?? 1));
        $off = ($page - 1) * $per;
        $total = (int) run("SELECT COUNT(*) FROM articles a WHERE $w", $p)->fetchColumn();
        $rows = run(
            "SELECT a.id, a.number, a.title, a.slug, a.status, a.version, a.updated_at, a.category_id, a.section_id,
                    c.name AS category, s.name AS section, u.display_name AS author
               FROM articles a
               JOIN categories c ON c.id = a.category_id
               LEFT JOIN sections s ON s.id = a.section_id
               LEFT JOIN users u ON u.id = a.author_id
              WHERE $w
              ORDER BY c.sort_order, c.id, (a.section_id IS NOT NULL), s.sort_order, a.section_id, a.sort_order, a.id
              LIMIT $per OFFSET $off", $p)->fetchAll();
        out(['items' => $rows, 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / $per))]);
    }

    if (isset($_GET['recent'])) {
        $limit = max(1, min(20, (int) ($_GET['limit'] ?? 8)));
        out(run("SELECT a.number, a.title, a.slug, a.updated_at, c.name AS category
                   FROM articles a JOIN categories c ON c.id = a.category_id AND c.status = 'published'
                  WHERE a.status = 'published' ORDER BY a.updated_at DESC, a.id DESC LIMIT $limit")->fetchAll());
    }

    $slug = (string) ($_GET['slug'] ?? '');
    if ($slug === '') {
        fail('Falta el documento solicitado');
    }
    $preview = !empty($_GET['preview']) && current_user() !== null;
    $sql = 'SELECT a.id, a.category_id, a.section_id, a.number, a.title, a.slug, a.summary, a.content, a.scope, a.status,
                   a.version, a.created_at, a.updated_at, a.published_at, u.display_name AS author
              FROM articles a JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id
             WHERE a.slug = ?' . ($preview ? '' : " AND a.status = 'published' AND c.status = 'published'");
    $a = run($sql, [$slug])->fetch();
    $notFound = 'El documento solicitado no existe o no está publicado';
    if (!$a) {
        fail($notFound, 404);
    }

    $crumbs = [];
    $sid = $a['section_id'];
    for ($guard = 0; $sid && $guard < 30; $guard++) {
        $s = run('SELECT parent_id, name, slug, kind, status FROM sections WHERE id = ?', [$sid])->fetch();
        if (!$s || (!$preview && $s['status'] !== 'published')) {
            fail($notFound, 404);
        }
        array_unshift($crumbs, ['type' => 's', 'name' => $s['name'], 'slug' => $s['slug']]);
        $sid = $s['parent_id'];
    }
    $cat = run('SELECT name, slug FROM categories WHERE id = ?', [$a['category_id']])->fetch();
    array_unshift($crumbs, ['type' => 'c', 'name' => $cat['name'], 'slug' => $cat['slug']]);

    $a['breadcrumbs'] = $crumbs;
    $a['tags'] = run('SELECT t.name, t.slug FROM tags t JOIN article_tags x ON x.tag_id = t.id WHERE x.article_id = ? ORDER BY t.name', [$a['id']])->fetchAll();
    $a['related'] = run(
        "SELECT a2.number, a2.title, a2.slug, COUNT(*) AS shared
           FROM article_tags t1
           JOIN article_tags t2 ON t2.tag_id = t1.tag_id AND t2.article_id <> t1.article_id
           JOIN articles a2 ON a2.id = t2.article_id AND a2.status = 'published'
          WHERE t1.article_id = ?
          GROUP BY a2.id, a2.number, a2.title, a2.slug
          ORDER BY shared DESC, a2.title LIMIT 4", [$a['id']])->fetchAll();
    unset($a['id'], $a['category_id'], $a['section_id']);
    out($a);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Método no permitido', 405);
}

/* ---------- POST (panel) ---------- */

start_session();
$user = require_auth();
require_csrf();
$b = body();
$action = (string) ($b['action'] ?? '');
$pdo = db();

switch ($action) {
    case 'create':
        $f = article_fields($b);
        [$cat, $sec] = resolve_location($b);
        $slug = unique_slug('articles', slugify(str_in($b, 'slug', 220) ?? $f['title']));
        $pdo->beginTransaction();
        run('INSERT INTO articles (category_id, section_id, number, title, slug, summary, content, content_text, scope, status,
                                   author_id, version, sort_order, published_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)',
            [$cat, $sec, $f['number'], $f['title'], $slug, $f['summary'], $f['content'], plain_text($f['content']), $f['scope'],
             $f['status'], $user['id'], next_order('articles', 'category_id = ? AND section_id <=> ?', [$cat, $sec]),
             $f['status'] === 'published' ? date('Y-m-d H:i:s') : null]);
        $id = (int) $pdo->lastInsertId();
        sync_tags($id, tags_in($b));
        snapshot($id, 'Creado', (int) $user['id']);
        $pdo->commit();
        out(['id' => $id, 'slug' => $slug, 'version' => 1], 201);

    case 'update':
        $old = find_article($b['id'] ?? null);
        $id = (int) $old['id'];
        $f = article_fields($b);
        [$cat, $sec] = resolve_location($b);
        $slug = $old['slug'];
        $wanted = slugify((string) ($b['slug'] ?? ''));
        if ($wanted !== '' && $wanted !== $slug) {
            $slug = unique_slug('articles', $wanted, $id);
        }
        $changed = false;
        foreach (['number', 'title', 'summary', 'scope', 'status', 'content'] as $k) {
            if ((string) $old[$k] !== (string) $f[$k]) {
                $changed = true;
            }
        }
        $order = (int) $old['sort_order'];
        if ((int) $old['category_id'] !== $cat || (string) $old['section_id'] !== (string) $sec) {
            $order = next_order('articles', 'category_id = ? AND section_id <=> ?', [$cat, $sec]);
        }
        $pdo->beginTransaction();
        run("UPDATE articles SET category_id=?, section_id=?, number=?, title=?, slug=?, summary=?, content=?, content_text=?,
                    scope=?, status=?, sort_order=?, version = version + ?,
                    published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END
              WHERE id = ?",
            [$cat, $sec, $f['number'], $f['title'], $slug, $f['summary'], $f['content'], plain_text($f['content']), $f['scope'],
             $f['status'], $order, $changed ? 1 : 0, $f['status'], $id]);
        sync_tags($id, tags_in($b));
        if ($changed) {
            snapshot($id, str_in($b, 'change_note', 200) ?? 'Modificado', (int) $user['id']);
        }
        $pdo->commit();
        out(['id' => $id, 'slug' => $slug, 'version' => (int) $old['version'] + ($changed ? 1 : 0)]);

    case 'duplicate':
        $a = find_article($b['id'] ?? null);
        $slug = unique_slug('articles', slugify($a['title'] . ' copia'));
        $pdo->beginTransaction();
        run("INSERT INTO articles (category_id, section_id, number, title, slug, summary, content, content_text, scope, status,
                                   author_id, version, sort_order)
             VALUES (?,?,?,?,?,?,?,?,?,'draft',?,1,?)",
            [$a['category_id'], $a['section_id'], $a['number'], mb_substr($a['title'], 0, 190) . ' (copia)', $slug, $a['summary'],
             $a['content'], $a['content_text'], $a['scope'], $user['id'],
             next_order('articles', 'category_id = ? AND section_id <=> ?', [$a['category_id'], $a['section_id']])]);
        $new = (int) $pdo->lastInsertId();
        run('INSERT INTO article_tags (article_id, tag_id) SELECT ?, tag_id FROM article_tags WHERE article_id = ?', [$new, $a['id']]);
        snapshot($new, 'Duplicado de «' . mb_substr($a['title'], 0, 120) . '»', (int) $user['id']);
        $pdo->commit();
        out(['id' => $new, 'slug' => $slug], 201);

    case 'move':
        $a = find_article($b['id'] ?? null);
        $dir = enum_in($b, 'dir', ['up', 'down'], 'up');
        move_sibling('articles', 'category_id = ? AND section_id <=> ?', [$a['category_id'], $a['section_id']], (int) $a['id'], $dir);
        out(['moved' => (int) $a['id']]);

    case 'set_status':
        $a = find_article($b['id'] ?? null);
        $status = enum_in($b, 'status', STATUSES, 'draft');
        if ($status !== $a['status']) {
            $pdo->beginTransaction();
            run("UPDATE articles SET status = ?, version = version + 1,
                        published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END WHERE id = ?",
                [$status, $status, $a['id']]);
            snapshot((int) $a['id'], 'Estado: ' . STATUS_LABEL[$status], (int) $user['id']);
            $pdo->commit();
        }
        out(['id' => (int) $a['id'], 'status' => $status]);

    case 'restore':
        $a = find_article($b['id'] ?? null);
        $vid = int_in($b['version_id'] ?? null);
        $v = $vid ? run('SELECT * FROM article_versions WHERE id = ? AND article_id = ?', [$vid, $a['id']])->fetch() : null;
        if (!$v) {
            fail('La versión indicada no existe', 404);
        }
        $pdo->beginTransaction();
        run('UPDATE articles SET number=?, title=?, summary=?, scope=?, content=?, content_text=?, version = version + 1 WHERE id = ?',
            [$v['number'], $v['title'], $v['summary'], $v['scope'], $v['content'], plain_text($v['content']), $a['id']]);
        snapshot((int) $a['id'], 'Restaurada la versión ' . $v['version_no'], (int) $user['id']);
        $pdo->commit();
        out(['id' => (int) $a['id'], 'restored' => (int) $v['version_no']]);

    case 'delete':
        require_auth('admin');
        $a = find_article($b['id'] ?? null);
        run('DELETE FROM articles WHERE id = ?', [$a['id']]);
        out(['deleted' => (int) $a['id']]);

    case 'sanitize': // la previsualización usa exactamente el mismo saneado que el guardado
        out(['html' => clean_html(is_string($b['html'] ?? null) ? $b['html'] : '')]);

    default:
        fail('Acción no válida', 404);
}
