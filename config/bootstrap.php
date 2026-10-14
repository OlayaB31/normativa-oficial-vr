<?php
declare(strict_types=1);

if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"success":false,"message":"Se requiere PHP 8.1 o superior"}';
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');

final class ApiError extends Exception
{
    public function __construct(string $message, public int $status = 400, public array $extra = [])
    {
        parent::__construct($message);
    }
}

set_exception_handler(function (Throwable $e): void {
    $api = $e instanceof ApiError;
    if (!$api) {
        error_log('[normativa] ' . $e);
    }
    http_response_code($api ? $e->status : 500);
    $payload = ['success' => false, 'message' => $api ? $e->getMessage() : 'No se pudo completar la operación'];
    if ($api) {
        $payload += $e->extra;
    } elseif (!empty(cfg()['debug'])) {
        $payload['debug'] = $e->getMessage();
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
});


function out(mixed $data = null, int $code = 200): never
{
    http_response_code($code);
    echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fail(string $message, int $code = 400, array $extra = []): never
{
    throw new ApiError($message, $code, $extra);
}


function cfg(): array
{
    static $c = null;
    return $c ??= require __DIR__ . '/database.php';
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = cfg();
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], $c['port'], $c['database']);
        $pdo = new PDO($dsn, $c['username'], $c['password'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

function run(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    ini_set('session.use_strict_mode', '1');
    session_name('normativa_sid');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

function destroy_session(): void
{
    start_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Lax']);
    }
    session_destroy();
}

function current_user(): ?array
{
    static $user = false;
    if ($user !== false) {
        return $user;
    }
    start_session();
    $user = null;
    if (!empty($_SESSION['uid'])) {
        if (time() - (int) ($_SESSION['last'] ?? 0) > 4 * 3600) { // caducidad por inactividad
            $_SESSION = [];
        } else {
            $row = run('SELECT id, username, display_name, role FROM users WHERE id = ? AND is_active = 1', [(int) $_SESSION['uid']])->fetch();
            if ($row) {
                $_SESSION['last'] = time();
                $user = $row;
            }
        }
    }
    return $user;
}
function require_auth(string $role = 'editor'): array
{
    $u = current_user();
    if (!$u) {
        fail('Debes iniciar sesión', 401);
    }
    if ($role === 'admin' && $u['role'] !== 'admin') {
        fail('No tienes permisos para realizar esta acción', 403);
    }
    return $u;
}

/**
 * Validación CSRF desactivada.
 *
 * Se conserva la función para evitar errores en los endpoints
 * que todavía llaman a require_csrf().
 */
function require_csrf(): void
{
    return;
}


function body(): array
{
    static $b = null;
    if ($b !== null) {
        return $b;
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return $b = [];
    }
    if (strlen($raw) > 2_000_000) {
        fail('El contenido enviado es demasiado grande', 413);
    }
    $d = json_decode($raw, true);
    if (!is_array($d)) {
        fail('Solicitud no válida');
    }
    return $b = $d;
}

function str_in(array $a, string $key, int $max, bool $required = false, ?string $label = null): ?string
{
    $label ??= $key;
    $v = $a[$key] ?? null;
    $v = is_scalar($v) ? trim((string) $v) : '';
    if ($v === '') {
        if ($required) {
            fail("El campo «{$label}» es obligatorio");
        }
        return null;
    }
    if (mb_strlen($v) > $max) {
        fail("El campo «{$label}» no puede superar {$max} caracteres");
    }
    return $v;
}

function int_in(mixed $v): ?int
{
    if ($v === null || $v === '' || is_array($v)) {
        return null;
    }
    $i = filter_var($v, FILTER_VALIDATE_INT);
    return $i === false ? null : (int) $i;
}

function enum_in(array $a, string $key, array $allowed, string $default): string
{
    $v = $a[$key] ?? $default;
    if (!is_string($v) || !in_array($v, $allowed, true)) {
        fail("Valor no válido para «{$key}»");
    }
    return $v;
}

function placeholders(array $items): string
{
    return implode(',', array_fill(0, count($items), '?'));
}

function fold(string $s): string
{
    return strtr(mb_strtolower($s, 'UTF-8'), [
        'á' => 'a', 'à' => 'a', 'ä' => 'a', 'â' => 'a', 'é' => 'e', 'è' => 'e', 'ë' => 'e', 'ê' => 'e',
        'í' => 'i', 'ì' => 'i', 'ï' => 'i', 'î' => 'i', 'ó' => 'o', 'ò' => 'o', 'ö' => 'o', 'ô' => 'o',
        'ú' => 'u', 'ù' => 'u', 'ü' => 'u', 'û' => 'u', 'ñ' => 'n', 'ç' => 'c',
    ]);
}

function slugify(string $s): string
{
    $s = trim((string) preg_replace('/[^a-z0-9]+/', '-', fold($s)), '-');
    return mb_substr($s, 0, 120);
}

function unique_slug(string $table, string $base, ?int $exceptId = null): string
{
    $base = $base !== '' ? $base : 'item';
    $slug = $base;
    $i = 1;
    while (true) {
        $sql = "SELECT id FROM {$table} WHERE slug = ?" . ($exceptId ? ' AND id <> ' . (int) $exceptId : '');
        if (!run($sql, [$slug])->fetchColumn()) {
            return $slug;
        }
        $slug = $base . '-' . (++$i);
    }
}

function plain_text(string $html): string
{
    $t = preg_replace('/<[^>]*>/', ' ', $html);
    $t = html_entity_decode((string) $t, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return trim((string) preg_replace('/\s+/u', ' ', $t));
}

function clean_html(string $html): string
{
    $html = trim($html);
    if ($html === '') {
        return '';
    }
    $allowed = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'a', 'table', 'thead',
        'tbody', 'tr', 'th', 'td', 'h3', 'h4', 'hr', 'div', 'code'];
    $drop = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math', 'template', 'noscript', 'link', 'meta', 'title', 'head'];

    $dom = new DOMDocument('1.0', 'UTF-8');
    $prev = libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="UTF-8"><div id="root">' . $html . '</div>', LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);

    $root = $dom->getElementById('root');
    if (!$root) {
        return '';
    }
    clean_node($root, $allowed, $drop);

    $out = '';
    foreach ($root->childNodes as $child) {
        $out .= $dom->saveHTML($child);
    }
    return trim($out);
}

function clean_node(DOMNode $node, array $allowed, array $drop): void
{
    foreach (iterator_to_array($node->childNodes) as $child) {
        if ($child instanceof DOMText) {
            continue;
        }
        if (!($child instanceof DOMElement)) {
            $node->removeChild($child); // comentarios, instrucciones de proceso…
            continue;
        }
        $tag = strtolower($child->nodeName);
        if (in_array($tag, $drop, true)) {
            $node->removeChild($child);
            continue;
        }
        clean_node($child, $allowed, $drop);
        if (!in_array($tag, $allowed, true)) { // etiqueta desconocida: se conserva solo el contenido
            while ($child->firstChild) {
                $node->insertBefore($child->firstChild, $child);
            }
            $node->removeChild($child);
            continue;
        }
        foreach (iterator_to_array($child->attributes) as $attr) {
            $name = strtolower($attr->nodeName);
            $val = trim($attr->nodeValue ?? '');
            $keep = false;
            if ($tag === 'a' && $name === 'href') {
                $keep = (bool) preg_match('~^(https?://|mailto:|#|normativa\.html\?|informacion\.html|/)~i', $val);
            } elseif ($tag === 'div' && $name === 'class') {
                $classes = array_values(array_intersect(preg_split('/\s+/', $val) ?: [], ['callout', 'note', 'warn', 'hl']));
                if ($classes) {
                    $child->setAttribute('class', implode(' ', $classes));
                    continue;
                }
            }
            if (!$keep) {
                $child->removeAttributeNode($attr);
            }
        }
        if ($tag === 'a') {
            if (!$child->hasAttribute('href')) {
                while ($child->firstChild) {
                    $node->insertBefore($child->firstChild, $child);
                }
                $node->removeChild($child);
                continue;
            }
            $child->setAttribute('rel', 'noopener noreferrer');
            if (preg_match('~^https?://~i', $child->getAttribute('href'))) {
                $child->setAttribute('target', '_blank');
            }
        }
    }
}


function next_order(string $table, string $scopeSql, array $params): int
{
    return (int) run("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM {$table} WHERE {$scopeSql}", $params)->fetchColumn();
}

/** Intercambia un elemento con su vecino anterior/siguiente dentro de su grupo. */
function move_sibling(string $table, string $scopeSql, array $scopeParams, int $id, string $dir): void
{
    $ids = array_map('intval', run("SELECT id FROM {$table} WHERE {$scopeSql} ORDER BY sort_order, id", $scopeParams)->fetchAll(PDO::FETCH_COLUMN));
    $i = array_search($id, $ids, true);
    if ($i === false) {
        fail('Elemento no encontrado', 404);
    }
    $j = $dir === 'up' ? $i - 1 : $i + 1;
    if ($j < 0 || $j >= count($ids)) {
        return;
    }
    [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
    $pdo = db();
    $up = $pdo->prepare("UPDATE {$table} SET sort_order = ?, updated_at = updated_at WHERE id = ?");
    $pdo->beginTransaction();
    foreach ($ids as $k => $v) {
        $up->execute([$k + 1, $v]);
    }
    $pdo->commit();
}

function descendant_section_ids(int $id): array
{
    $sql = 'WITH RECURSIVE d AS (SELECT id FROM sections WHERE id = ? UNION ALL SELECT s.id FROM sections s JOIN d ON s.parent_id = d.id) SELECT id FROM d';
    return array_map('intval', run($sql, [$id])->fetchAll(PDO::FETCH_COLUMN));
}
