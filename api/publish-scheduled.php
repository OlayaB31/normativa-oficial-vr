<?php
declare(strict_types=1);

// This worker is intentionally CLI-only. Configure a cron/task scheduler to run it once per minute.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

date_default_timezone_set('America/Bogota');
require __DIR__ . '/../config/bootstrap.php';

function snapshot_scheduled_publication(int $articleId): void
{
    run("INSERT INTO article_versions
            (article_id, version_no, category_id, section_id, author_id, number, title, slug, summary, content, scope, status, scheduled_at, tags, submitted_at, reviewed_by, reviewed_at, change_note, changed_by)
         SELECT a.id, a.version, a.category_id, a.section_id, a.author_id, a.number, a.title, a.slug, a.summary, a.content, a.scope, a.status, a.scheduled_at,
                COALESCE((SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ')
                   FROM article_tags atg JOIN tags t ON t.id = atg.tag_id WHERE atg.article_id = a.id), ''),
                a.submitted_at, a.reviewed_by, a.reviewed_at, 'Publicación programada activada', COALESCE(a.updated_by, a.author_id)
           FROM articles a WHERE a.id = ?",
        [$articleId]);
}

try {
    $pdo = db();
    $zone = new DateTimeZone('America/Bogota');
    $now = (new DateTimeImmutable('now', $zone))->format('Y-m-d H:i:s');
    $pdo->beginTransaction();

    // The row locks prevent two overlapping cron executions from publishing the same article twice.
    $ids = run("SELECT id FROM articles
                 WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
                 ORDER BY scheduled_at, id LIMIT 100 FOR UPDATE", [$now])->fetchAll(PDO::FETCH_COLUMN);

    $published = 0;
    foreach ($ids as $rawId) {
        $id = (int) $rawId;
        $update = run("UPDATE articles
                          SET status = 'published', scheduled_at = NULL, version = version + 1,
                              published_at = COALESCE(published_at, ?),
                              reviewed_by = COALESCE(reviewed_by, updated_by, author_id),
                              reviewed_at = COALESCE(reviewed_at, ?)
                        WHERE id = ? AND status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?",
            [$now, $now, $id, $now]);
        if ($update->rowCount() !== 1) {
            continue;
        }
        snapshot_scheduled_publication($id);
        $published++;
    }

    $pdo->commit();
    fwrite(STDOUT, sprintf("%s: %d artículo(s) publicado(s) por programación.%s", $now, $published, PHP_EOL));
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'Error en publicación programada: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
