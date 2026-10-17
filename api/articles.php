<?php
require __DIR__ . '/../config/bootstrap.php';

const STATUSES = ['draft', 'review', 'scheduled', 'published', 'archived'];
const STATUS_LABEL = ['draft' => 'Borrador', 'review' => 'En revisión', 'scheduled' => 'Programado', 'published' => 'Publicado', 'archived' => 'Archivado'];

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
    run("INSERT INTO article_versions
            (article_id, version_no, category_id, section_id, author_id, number, title, slug, summary, content, scope, status, scheduled_at, tags, submitted_at, reviewed_by, reviewed_at, change_note, changed_by)
         SELECT a.id, a.version, a.category_id, a.section_id, a.author_id, a.number, a.title, a.slug, a.summary, a.content, a.scope, a.status, a.scheduled_at,
                COALESCE((SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ')
                   FROM article_tags atg JOIN tags t ON t.id = atg.tag_id WHERE atg.article_id = a.id), ''),
                a.submitted_at, a.reviewed_by, a.reviewed_at, ?, ?
           FROM articles a WHERE a.id = ?",
        [$note, $uid, $id]);
}

function normalized_tag_keys(array $names): array
{
    $keys = [];
    foreach ($names as $name) {
        $key = slugify(trim((string) $name));
        if ($key !== '') {
            $keys[$key] = true;
        }
    }
    $keys = array_keys($keys);
    sort($keys, SORT_STRING);
    return $keys;
}

function positive_ids(mixed $value, int $max = 100): array
{
    if (!is_array($value)) {
        fail('La selección de artículos no es válida');
    }
    $ids = [];
    foreach ($value as $item) {
        $id = int_in($item);
        if ($id) {
            $ids[$id] = $id;
        }
    }
    $ids = array_values($ids);
    if (!$ids || count($ids) > $max) {
        fail('Selecciona entre 1 y ' . $max . ' artículos');
    }
    return $ids;
}

function article_fields(array $b): array
{
    $f = [
        'number'  => str_in($b, 'number', 20, false, 'Número'),
        'title'   => str_in($b, 'title', 200, true, 'Título'),
        'summary' => str_in($b, 'summary', 500, false, 'Descripción'),
        'scope'   => str_in($b, 'scope', 500, false, 'Aplicación'),
        'status'  => enum_in($b, 'status', STATUSES, 'draft'),
        'content' => sanitize_article_content(is_string($b['content'] ?? null) ? $b['content'] : ''),
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

function is_admin_user(array $user): bool
{
    return ($user['role'] ?? '') === 'admin';
}

function assert_article_editor_access(array $article, array $user): void
{
    if (is_admin_user($user)) {
        return;
    }
    if ((int) ($article['author_id'] ?? 0) !== (int) ($user['id'] ?? 0)) {
        fail('Solo puedes acceder a los borradores que tienes asignados. Solicita a un administrador que te asigne el artículo.', 403);
    }
    if (!in_array($article['status'] ?? '', ['draft', 'review'], true)) {
        fail('Los artículos publicados o archivados solo pueden modificarse por un administrador.', 403);
    }
}

function assert_status_permission(string $status, array $user): void
{
    if (!in_array($status, STATUSES, true)) {
        fail('El estado indicado no es válido');
    }
    if (!is_admin_user($user) && !in_array($status, ['draft', 'review'], true)) {
        fail('Solo un administrador puede publicar, programar o archivar artículos.', 403);
    }
}

function resolve_scheduled_at(array $body, string $status, array $user): ?string
{
    if ($status !== 'scheduled') {
        return null;
    }
    if (!is_admin_user($user)) {
        fail('Solo un administrador puede programar una publicación.', 403);
    }
    $raw = trim((string) ($body['scheduled_at'] ?? ''));
    if ($raw === '') {
        fail('Selecciona una fecha y hora para la publicación programada.');
    }
    $zone = new DateTimeZone('America/Bogota');
    $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $raw, $zone);
    $errors = DateTimeImmutable::getLastErrors();
    if (!$date || (is_array($errors) && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))) {
        fail('La fecha programada no tiene un formato válido.');
    }
    if ($date->getTimestamp() <= time() + 30) {
        fail('La fecha programada debe ser al menos 30 segundos posterior a la hora actual.');
    }
    return $date->format('Y-m-d H:i:s');
}

function resolve_author_id(array $b, array $user, ?array $old = null): int
{
    if (!is_admin_user($user)) {
        return (int) ($old['author_id'] ?? $user['id']);
    }
    $authorId = int_in($b['author_id'] ?? ($old['author_id'] ?? $user['id']));
    if (!$authorId || !run('SELECT 1 FROM users WHERE id = ? AND is_active = 1', [$authorId])->fetchColumn()) {
        fail('Selecciona un autor activo válido.');
    }
    return $authorId;
}

function sanitize_article_content(string $raw): string
{
    $requestedToc = (bool) preg_match('~class\s*=\s*(["\'])[^"\']*\barticle-toc\b[^"\']*\1~i', $raw);
    $safe = clean_html($raw);
    // Si el sanitizador de la instalación elimina clases desconocidas, se conserva
    // de forma controlada el marcador que activa la generación del índice.
    if ($requestedToc && !preg_match('~class\s*=\s*(["\'])[^"\']*\barticle-toc\b[^"\']*\1~i', $safe)) {
        $safe = '<div class="article-toc"><p>Índice automático</p></div>' . $safe;
    }
    return sync_auto_toc($safe);
}

function sync_auto_toc(string $html): string
{
    $tocPattern = '~<div\b(?=[^>]*\bclass\s*=\s*(["\'])[^"\']*\barticle-toc\b[^"\']*\1)[^>]*>.*?</div\s*>~is';
    if (!preg_match($tocPattern, $html, $tocMatch, PREG_OFFSET_CAPTURE)) {
        return $html;
    }
    $offset = $tocMatch[0][1];
    $withoutToc = substr($html, 0, $offset) . substr($html, $offset + strlen($tocMatch[0][0]));
    $items = [];
    $number = 0;
    $withIds = preg_replace_callback('~<h([2-4])\b([^>]*)>(.*?)</h\1\s*>~is', function ($m) use (&$items, &$number) {
        $label = trim(html_entity_decode(strip_tags($m[3]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $label = preg_replace('/\s+/u', ' ', $label) ?? $label;
        if ($label === '') {
            return $m[0];
        }
        $number++;
        $slug = trim((string) slugify($label), '-');
        if ($slug === '') {
            $slug = 'apartado-' . $number;
        }
        $id = 'articulo-' . $number . '-' . substr($slug, 0, 70);
        $attrs = preg_replace('/\s+id\s*=\s*(["\']).*?\1/i', '', $m[2]) ?? $m[2];
        $attrs = rtrim($attrs) . ' id="' . htmlspecialchars($id, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '"';
        $items[] = ['level' => (int) $m[1], 'id' => $id, 'label' => $label];
        return '<h' . $m[1] . $attrs . '>' . $m[3] . '</h' . $m[1] . '>';
    }, $withoutToc);
    if (!is_string($withIds)) {
        return $html;
    }
    $toc = '<div class="article-toc"><h3>Índice del artículo</h3>';
    if ($items) {
        $toc .= '<ol>';
        foreach ($items as $item) {
            $toc .= '<li class="toc-h' . $item['level'] . '"><a href="#' . htmlspecialchars($item['id'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '">' . htmlspecialchars($item['label'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</a></li>';
        }
        $toc .= '</ol>';
    } else {
        $toc .= '<p>Añade títulos o subtítulos para completar este índice automáticamente.</p>';
    }
    $toc .= '</div>';
    return $toc . $withIds;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['admin'])) {
        start_session();
        $adminUser = require_auth();

        if (isset($_GET['me'])) {
            out(['id' => (int) $adminUser['id'], 'display_name' => (string) ($adminUser['display_name'] ?? $adminUser['username'] ?? 'Usuario'), 'role' => (string) ($adminUser['role'] ?? 'editor')]);
        }
        if (isset($_GET['authors'])) {
            if (!is_admin_user($adminUser)) {
                fail('Solo un administrador puede consultar la lista de autores.', 403);
            }
            out(run('SELECT id, display_name, role FROM users WHERE is_active = 1 ORDER BY display_name, id')->fetchAll());
        }

        if (isset($_GET['history'])) {
            $id = int_in($_GET['history']);
            if (!$id) {
                fail('El identificador del artículo no es válido');
            }
            assert_article_editor_access(find_article($id), $adminUser);
            out(run('SELECT v.id, v.version_no, v.number, v.title, v.slug, v.summary, v.status,
                            v.category_id, v.section_id, v.author_id, v.submitted_at, v.reviewed_by, v.reviewed_at, v.change_note, v.created_at, u.display_name AS author
                       FROM article_versions v LEFT JOIN users u ON u.id = v.changed_by
                      WHERE v.article_id = ? ORDER BY v.version_no DESC', [$id])->fetchAll());
        }
        if (isset($_GET['version'], $_GET['article_id'])) {
            $versionId = int_in($_GET['version']);
            $articleId = int_in($_GET['article_id']);
            if ($articleId) {
                assert_article_editor_access(find_article($articleId), $adminUser);
            }
            $version = ($versionId && $articleId)
                ? run('SELECT v.id, v.article_id, v.version_no, v.category_id, v.section_id, v.number, v.title, v.slug,
                              v.summary, v.content, v.scope, v.status, v.tags, v.author_id, v.scheduled_at, v.submitted_at, v.reviewed_by, v.reviewed_at, v.change_note, v.created_at,
                              u.display_name AS author
                         FROM article_versions v LEFT JOIN users u ON u.id = v.changed_by
                        WHERE v.id = ? AND v.article_id = ?', [$versionId, $articleId])->fetch()
                : null;
            if (!$version) {
                fail('La versión indicada no existe', 404);
            }
            out($version);
        }
        if (isset($_GET['id'])) {
            $a = find_article($_GET['id']);
            assert_article_editor_access($a, $adminUser);
            $a['author_name'] = run('SELECT display_name FROM users WHERE id = ?', [$a['author_id']])->fetchColumn() ?: 'Sin asignar';
            $a['updated_by_name'] = !empty($a['updated_by']) ? (run('SELECT display_name FROM users WHERE id = ?', [$a['updated_by']])->fetchColumn() ?: null) : $a['author_name'];
            $a['reviewed_by_name'] = !empty($a['reviewed_by']) ? (run('SELECT display_name FROM users WHERE id = ?', [$a['reviewed_by']])->fetchColumn() ?: null) : null;
            unset($a['content_text']);
            $a['tags'] = run('SELECT t.name FROM tags t JOIN article_tags x ON x.tag_id = t.id WHERE x.article_id = ? ORDER BY t.name', [$a['id']])->fetchAll(PDO::FETCH_COLUMN);
            out($a);
        }

        $where = ['1 = 1'];
        $p = [];
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(a.title LIKE ? OR a.number LIKE ? OR a.slug LIKE ? OR a.summary LIKE ? OR a.content_text LIKE ?)';
            array_push($p, $like, $like, $like, $like, $like);
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
            "SELECT a.id, a.number, a.title, a.slug, a.status, a.version, a.updated_at, a.scheduled_at, a.category_id, a.section_id,
                    a.author_id, a.updated_by, c.name AS category, s.name AS section,
                    u.display_name AS author, uu.display_name AS updated_by_name
               FROM articles a
               JOIN categories c ON c.id = a.category_id
               LEFT JOIN sections s ON s.id = a.section_id
               LEFT JOIN users u ON u.id = a.author_id
               LEFT JOIN users uu ON uu.id = a.updated_by
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

start_session();
$user = require_auth();
require_csrf();
$b = body();
$action = (string) ($b['action'] ?? '');
$pdo = db();

switch ($action) {
    case 'create':
        $f = article_fields($b);
        assert_status_permission($f['status'], $user);
        [$cat, $sec] = resolve_location($b);
        $authorId = resolve_author_id($b, $user);
        $slug = unique_slug('articles', slugify(str_in($b, 'slug', 220) ?? $f['title']));
        $publishedAt = $f['status'] === 'published' ? date('Y-m-d H:i:s') : null;
        $scheduledAt = resolve_scheduled_at($b, $f['status'], $user);
        $submittedAt = $f['status'] === 'review' ? date('Y-m-d H:i:s') : null;
        $reviewedBy = in_array($f['status'], ['published', 'scheduled'], true) ? (int) $user['id'] : null;
        $reviewedAt = in_array($f['status'], ['published', 'scheduled'], true) ? date('Y-m-d H:i:s') : null;
        $pdo->beginTransaction();
        run('INSERT INTO articles (category_id, section_id, number, title, slug, summary, content, content_text, scope, status,
                                   author_id, updated_by, version, sort_order, published_at, scheduled_at, submitted_at, reviewed_by, reviewed_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)',
            [$cat, $sec, $f['number'], $f['title'], $slug, $f['summary'], $f['content'], plain_text($f['content']), $f['scope'],
             $f['status'], $authorId, $user['id'], next_order('articles', 'category_id = ? AND section_id <=> ?', [$cat, $sec]),
             $publishedAt, $scheduledAt, $submittedAt, $reviewedBy, $reviewedAt]);
        $id = (int) $pdo->lastInsertId();
        sync_tags($id, tags_in($b));
        snapshot($id, 'Creado', (int) $user['id']);
        $pdo->commit();
        out(['id' => $id, 'slug' => $slug, 'version' => 1], 201);

    case 'update':
        $old = find_article($b['id'] ?? null);
        assert_article_editor_access($old, $user);
        $id = (int) $old['id'];
        $f = article_fields($b);
        assert_status_permission($f['status'], $user);
        $scheduledAt = resolve_scheduled_at($b, $f['status'], $user);
        [$cat, $sec] = resolve_location($b);
        $authorId = resolve_author_id($b, $user, $old);
        $slug = $old['slug'];
        $wanted = slugify((string) ($b['slug'] ?? ''));
        if ($wanted === '') {
            $wanted = slugify($f['title']);
        }
        if ($wanted !== '' && $wanted !== $slug) {
            $slug = unique_slug('articles', $wanted, $id);
        }
        $changed = false;
        foreach (['number', 'title', 'summary', 'scope', 'status', 'content'] as $k) {
            if ((string) $old[$k] !== (string) $f[$k]) {
                $changed = true;
                break;
            }
        }
        if ((int) $old['category_id'] !== $cat || (int) ($old['section_id'] ?? 0) !== (int) ($sec ?? 0) || (string) $old['slug'] !== $slug || (int) $old['author_id'] !== $authorId) {
            $changed = true;
        }
        if ((string) ($old['scheduled_at'] ?? '') !== (string) ($scheduledAt ?? '')) {
            $changed = true;
        }
        $oldTags = run('SELECT t.name FROM tags t JOIN article_tags x ON x.tag_id = t.id WHERE x.article_id = ?', [$id])->fetchAll(PDO::FETCH_COLUMN);
        if (normalized_tag_keys($oldTags) !== normalized_tag_keys(tags_in($b))) {
            $changed = true;
        }
        $order = (int) $old['sort_order'];
        if ((int) $old['category_id'] !== $cat || (string) $old['section_id'] !== (string) $sec) {
            $order = next_order('articles', 'category_id = ? AND section_id <=> ?', [$cat, $sec]);
        }
        $pdo->beginTransaction();
        run("UPDATE articles SET category_id=?, section_id=?, number=?, title=?, slug=?, summary=?, content=?, content_text=?,
                    scope=?, status=?, author_id=?, updated_by=?, sort_order=?, version = version + ?,
                    submitted_at = CASE WHEN ? = 'review' AND ? <> 'review' THEN NOW() ELSE submitted_at END,
                    published_at = CASE WHEN ? = 'scheduled' THEN NULL WHEN ? = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
                    scheduled_at = ?,
                    reviewed_by = CASE WHEN ? IN ('published','scheduled') THEN ? ELSE reviewed_by END,
                    reviewed_at = CASE WHEN ? IN ('published','scheduled') THEN NOW() ELSE reviewed_at END
              WHERE id = ?",
            [$cat, $sec, $f['number'], $f['title'], $slug, $f['summary'], $f['content'], plain_text($f['content']), $f['scope'],
             $f['status'], $authorId, $user['id'], $order, $changed ? 1 : 0, $f['status'], $old['status'], $f['status'], $f['status'],
             $scheduledAt, $f['status'], $user['id'], $f['status'], $id]);
        sync_tags($id, tags_in($b));
        if ($changed) {
            snapshot($id, str_in($b, 'change_note', 200) ?? 'Modificado', (int) $user['id']);
        }
        $pdo->commit();
        out(['id' => $id, 'slug' => $slug, 'version' => (int) $old['version'] + ($changed ? 1 : 0)]);

    case 'duplicate':
        $a = find_article($b['id'] ?? null);
        assert_article_editor_access($a, $user);
        $slug = unique_slug('articles', slugify($a['title'] . ' copia'));
        $pdo->beginTransaction();
        run("INSERT INTO articles (category_id, section_id, number, title, slug, summary, content, content_text, scope, status,
                                   author_id, updated_by, version, sort_order)
             VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?,1,?)",
            [$a['category_id'], $a['section_id'], $a['number'], mb_substr($a['title'], 0, 190) . ' (copia)', $slug, $a['summary'],
             $a['content'], $a['content_text'], $a['scope'], $user['id'], $user['id'],
             next_order('articles', 'category_id = ? AND section_id <=> ?', [$a['category_id'], $a['section_id']])]);
        $new = (int) $pdo->lastInsertId();
        run('INSERT INTO article_tags (article_id, tag_id) SELECT ?, tag_id FROM article_tags WHERE article_id = ?', [$new, $a['id']]);
        snapshot($new, 'Duplicado de «' . mb_substr($a['title'], 0, 120) . '»', (int) $user['id']);
        $pdo->commit();
        out(['id' => $new, 'slug' => $slug], 201);

    case 'move':
        $a = find_article($b['id'] ?? null);
        assert_article_editor_access($a, $user);
        $dir = enum_in($b, 'dir', ['up', 'down'], 'up');
        move_sibling('articles', 'category_id = ? AND section_id <=> ?', [$a['category_id'], $a['section_id']], (int) $a['id'], $dir);
        out(['moved' => (int) $a['id']]);

    case 'set_status':
        $a = find_article($b['id'] ?? null);
        assert_article_editor_access($a, $user);
        $status = enum_in($b, 'status', STATUSES, 'draft');
        assert_status_permission($status, $user);
        if ($status === 'scheduled') {
            fail('Para programar una publicación, abre el artículo y establece su fecha y hora.');
        }
        if ($status !== $a['status']) {
            $pdo->beginTransaction();
            run("UPDATE articles SET status = ?, updated_by = ?, version = version + 1, scheduled_at = NULL,
                        submitted_at = CASE WHEN ? = 'review' AND ? <> 'review' THEN NOW() ELSE submitted_at END,
                        published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
                        reviewed_by = CASE WHEN ? = 'published' THEN ? ELSE reviewed_by END,
                        reviewed_at = CASE WHEN ? = 'published' THEN NOW() ELSE reviewed_at END WHERE id = ?",
                [$status, $user['id'], $status, $a['status'], $status, $status, $user['id'], $status, $a['id']]);
            snapshot((int) $a['id'], 'Estado: ' . STATUS_LABEL[$status], (int) $user['id']);
            $pdo->commit();
        }
        out(['id' => (int) $a['id'], 'status' => $status]);

    case 'restore':
        require_auth('admin');
        $a = find_article($b['id'] ?? null);
        $vid = int_in($b['version_id'] ?? null);
        $v = $vid ? run('SELECT * FROM article_versions WHERE id = ? AND article_id = ?', [$vid, $a['id']])->fetch() : null;
        if (!$v) {
            fail('La versión indicada no existe', 404);
        }
        $targetCategory = !empty($v['category_id']) ? (int) $v['category_id'] : (int) $a['category_id'];
        $targetSection = !empty($v['category_id']) ? ((int) ($v['section_id'] ?? 0) ?: null) : ($a['section_id'] ? (int) $a['section_id'] : null);
        $targetAuthor = !empty($v['author_id']) ? (int) $v['author_id'] : ((int) ($a['author_id'] ?? 0) ?: (int) $user['id']);
        if (!$targetAuthor || !run('SELECT 1 FROM users WHERE id = ?', [$targetAuthor])->fetchColumn()) {
            $targetAuthor = (int) $user['id'];
        }
        $targetSubmittedAt = $v['submitted_at'] ?? null;
        $targetScheduledAt = $v['scheduled_at'] ?? null;
        if (($v['status'] ?? '') === 'scheduled') {
            $scheduleDate = $targetScheduledAt ? new DateTimeImmutable((string) $targetScheduledAt, new DateTimeZone('America/Bogota')) : null;
            if (!$scheduleDate || $scheduleDate->getTimestamp() <= time() + 30) {
                fail('La versión elegida contiene una fecha de publicación programada que ya pasó. Cambia la fecha desde el editor antes de restaurarla.');
            }
        }
        $targetSlug = !empty($v['slug']) ? slugify((string) $v['slug']) : (string) $a['slug'];
        if ($targetSlug !== (string) $a['slug']) {
            $targetSlug = unique_slug('articles', $targetSlug, (int) $a['id']);
        }
        $order = (int) $a['sort_order'];
        if ($targetCategory !== (int) $a['category_id'] || (string) $targetSection !== (string) $a['section_id']) {
            $order = next_order('articles', 'category_id = ? AND section_id <=> ?', [$targetCategory, $targetSection]);
        }
        $pdo->beginTransaction();
        run("UPDATE articles SET category_id=?, section_id=?, sort_order=?, slug=?, number=?, title=?, summary=?, scope=?, content=?, content_text=?, status=?,
                    author_id=?, updated_by=?, submitted_at=?, scheduled_at=?, version = version + 1,
                    published_at = CASE WHEN ? = 'scheduled' THEN NULL WHEN ? = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
                    reviewed_by = CASE WHEN ? IN ('published','scheduled') THEN ? ELSE NULL END,
                    reviewed_at = CASE WHEN ? IN ('published','scheduled') THEN NOW() ELSE NULL END
              WHERE id = ?",
            [$targetCategory, $targetSection, $order, $targetSlug, $v['number'], $v['title'], $v['summary'], $v['scope'], $v['content'], plain_text($v['content']), $v['status'], $targetAuthor, $user['id'], $targetSubmittedAt, $targetScheduledAt, $v['status'], $v['status'], $v['status'], $user['id'], $v['status'], $a['id']]);
        if (array_key_exists('tags', $v) && $v['tags'] !== null) {
            sync_tags((int) $a['id'], $v['tags'] === '' ? [] : explode(', ', (string) $v['tags']));
        }
        snapshot((int) $a['id'], 'Restaurada la versión ' . $v['version_no'], (int) $user['id']);
        $pdo->commit();
        out(['id' => (int) $a['id'], 'restored' => (int) $v['version_no'], 'slug' => $targetSlug]);

    case 'bulk_set_status':
        $ids = positive_ids($b['ids'] ?? null, 100);
        $status = enum_in($b, 'status', STATUSES, 'draft');
        assert_status_permission($status, $user);
        if ($status === 'scheduled') {
            fail('La publicación programada debe configurarse individualmente en cada artículo.');
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $rows = run("SELECT id, author_id, status FROM articles WHERE id IN ($placeholders)", $ids)->fetchAll();
        if (count($rows) !== count($ids)) {
            fail('Uno o más artículos ya no existen');
        }
        if (!is_admin_user($user)) {
            foreach ($rows as $row) {
                assert_article_editor_access($row, $user);
            }
        }
        $pdo->beginTransaction();
        foreach ($rows as $row) {
            if ($row['status'] === $status) {
                continue;
            }
            run("UPDATE articles SET status = ?, updated_by = ?, version = version + 1, scheduled_at = NULL,
                        submitted_at = CASE WHEN ? = 'review' AND ? <> 'review' THEN NOW() ELSE submitted_at END,
                        published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
                        reviewed_by = CASE WHEN ? = 'published' THEN ? ELSE reviewed_by END,
                        reviewed_at = CASE WHEN ? = 'published' THEN NOW() ELSE reviewed_at END
                  WHERE id = ?",
                [$status, $user['id'], $status, $row['status'], $status, $status, $user['id'], $status, $row['id']]);
            snapshot((int) $row['id'], 'Estado: ' . STATUS_LABEL[$status], (int) $user['id']);
        }
        $pdo->commit();
        out(['updated' => count($rows), 'status' => $status]);

    case 'bulk_delete':
        require_auth('admin');
        $ids = positive_ids($b['ids'] ?? null, 100);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $found = (int) run("SELECT COUNT(*) FROM articles WHERE id IN ($placeholders)", $ids)->fetchColumn();
        if ($found !== count($ids)) {
            fail('Uno o más artículos ya no existen');
        }
        $pdo->beginTransaction();
        run("DELETE FROM articles WHERE id IN ($placeholders)", $ids);
        $pdo->commit();
        out(['deleted' => count($ids)]);

    case 'delete':
        require_auth('admin');
        $a = find_article($b['id'] ?? null);
        run('DELETE FROM articles WHERE id = ?', [$a['id']]);
        out(['deleted' => (int) $a['id']]);

    case 'sanitize':
        out(['html' => sanitize_article_content(is_string($b['html'] ?? null) ? $b['html'] : '')]);

    default:
        fail('Acción no válida', 404);
}
