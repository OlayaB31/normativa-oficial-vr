<?php
/**
 * /api/search.php?q=texto[&page=1][&limit=15]
 * Busca en títulos, número, descripción, contenido, categorías, apartados y etiquetas
 * (solo artículos publicados). La colación utf8mb4_unicode_ci ignora mayúsculas y acentos.
 */
require __DIR__ . '/../config/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    fail('Método no permitido', 405);
}

$q = trim((string) preg_replace('/\s+/u', ' ', (string) ($_GET['q'] ?? '')));
$q = mb_substr($q, 0, 80);
$terms = array_slice(array_values(array_unique(array_filter(explode(' ', $q), fn ($t) => mb_strlen($t) >= 2))), 0, 5);
$limit = max(1, min(50, (int) ($_GET['limit'] ?? 15)));
$page = max(1, (int) ($_GET['page'] ?? 1));

$empty = ['query' => $q, 'terms' => [], 'total' => 0, 'items' => [], 'categories' => [], 'sections' => [], 'page' => 1, 'pages' => 0];
if (!$terms) {
    out($empty);
}

$like = fn (string $t): string => '%' . addcslashes($t, '%_\\') . '%';
$cond = [];
$cp = [];
foreach ($terms as $t) {
    $l = $like($t);
    $cond[] = '(a.title LIKE ? OR a.number LIKE ? OR a.summary LIKE ? OR a.content_text LIKE ? OR c.name LIKE ? OR s.name LIKE ?
                OR EXISTS (SELECT 1 FROM article_tags x JOIN tags t ON t.id = x.tag_id WHERE x.article_id = a.id AND t.name LIKE ?))';
    array_push($cp, $l, $l, $l, $l, $l, $l, $l);
}
$from = "FROM articles a
         JOIN categories c ON c.id = a.category_id AND c.status = 'published'
         LEFT JOIN sections s ON s.id = a.section_id
         WHERE a.status = 'published' AND (a.section_id IS NULL OR s.status = 'published') AND " . implode(' AND ', $cond);

$total = (int) run("SELECT COUNT(*) $from", $cp)->fetchColumn();
$off = ($page - 1) * $limit;
$phrase = $like($q);
$score = '((a.title LIKE ?) * 6 + (a.number = ?) * 6 + (a.summary LIKE ?) * 3 + (a.content_text LIKE ?)
          + EXISTS (SELECT 1 FROM article_tags x2 JOIN tags t2 ON t2.id = x2.tag_id WHERE x2.article_id = a.id AND t2.name LIKE ?) * 3)';
$rows = run(
    "SELECT a.number, a.title, a.slug, a.summary, a.content_text, a.updated_at, c.name AS category, s.name AS section,
            (SELECT GROUP_CONCAT(t3.name SEPARATOR '||') FROM article_tags x3 JOIN tags t3 ON t3.id = x3.tag_id WHERE x3.article_id = a.id) AS tags,
            $score AS score
       $from ORDER BY score DESC, a.updated_at DESC, a.id LIMIT $limit OFFSET $off",
    array_merge([$phrase, $q, $phrase, $phrase, $phrase], $cp)
)->fetchAll();

function has_term(?string $text, array $terms): bool
{
    $f = fold((string) $text);
    foreach ($terms as $t) {
        if (str_contains($f, fold($t))) {
            return true;
        }
    }
    return false;
}

function snippet(string $text, array $terms, int $len = 170): string
{
    $f = fold($text);
    $pos = null;
    foreach ($terms as $t) {
        $p = mb_strpos($f, fold($t));
        if ($p !== false && ($pos === null || $p < $pos)) {
            $pos = $p;
        }
    }
    $start = $pos === null ? 0 : max(0, $pos - 60);
    $s = mb_substr($text, $start, $len);
    return ($start > 0 ? '…' : '') . $s . ($start + $len < mb_strlen($text) ? '…' : '');
}

$items = [];
foreach ($rows as $r) {
    $tags = $r['tags'] ? explode('||', $r['tags']) : [];
    $found = [];
    foreach ([['título', $r['title']], ['número', $r['number']], ['descripción', $r['summary']], ['contenido', $r['content_text']],
              ['categoría', $r['category']], ['apartado', $r['section']], ['etiqueta', implode(' ', $tags)]] as [$label, $val]) {
        if (has_term($val, $terms)) {
            $found[] = $label;
        }
    }
    $inBody = has_term($r['content_text'], $terms);
    $items[] = [
        'number' => $r['number'], 'title' => $r['title'], 'slug' => $r['slug'],
        'category' => $r['category'], 'section' => $r['section'], 'tags' => $tags, 'found_in' => $found,
        'snippet' => snippet($inBody ? (string) $r['content_text'] : (string) ($r['summary'] ?: $r['content_text']), $inBody ? $terms : [], 170),
        'updated_at' => $r['updated_at'],
    ];
}

$categories = $sections = [];
if ($page === 1) {
    $cc = $cpar = $sc = $spar = [];
    foreach ($terms as $t) {
        $l = $like($t);
        $cc[] = '(name LIKE ? OR description LIKE ?)';
        array_push($cpar, $l, $l);
        $sc[] = '(s.name LIKE ? OR s.description LIKE ?)';
        array_push($spar, $l, $l);
    }
    $categories = run("SELECT name, slug, description FROM categories WHERE status = 'published' AND " . implode(' AND ', $cc) . ' ORDER BY sort_order LIMIT 5', $cpar)->fetchAll();
    $sections = run("SELECT s.name, s.slug, s.kind, c.name AS category FROM sections s
                       JOIN categories c ON c.id = s.category_id AND c.status = 'published'
                      WHERE s.status = 'published' AND " . implode(' AND ', $sc) . ' ORDER BY c.sort_order, s.sort_order LIMIT 5', $spar)->fetchAll();
}

out(['query' => $q, 'terms' => $terms, 'total' => $total, 'items' => $items, 'categories' => $categories,
     'sections' => $sections, 'page' => $page, 'pages' => (int) ceil($total / $limit)]);
