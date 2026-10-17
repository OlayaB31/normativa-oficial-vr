<?php
require __DIR__ . '/../config/bootstrap.php';
start_session();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function public_user(array $u): array
{
    return ['id' => (int) $u['id'], 'username' => $u['username'], 'display_name' => $u['display_name'], 'role' => $u['role']];
}

function password_rules(string $p): void
{
    if (strlen($p) < 10) {
        fail('La contraseña debe tener al menos 10 caracteres');
    }
    if (strlen($p) > 200) {
        fail('La contraseña es demasiado larga');
    }
}

function start_user_session(array $user): array
{
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $user['id'];
    $_SESSION['last'] = time();
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    run('UPDATE users SET last_login = NOW() WHERE id = ?', [(int) $user['id']]);
    return ['authenticated' => true, 'user' => public_user($user), 'csrf' => $_SESSION['csrf'], 'needs_setup' => false];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $u = current_user();
    $users = (int) run('SELECT COUNT(*) FROM users')->fetchColumn();
    out([
        'authenticated' => (bool) $u,
        'user'          => $u ? public_user($u) : null,
        'csrf'          => $_SESSION['csrf'],
        'needs_setup'   => $users === 0,
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Método no permitido', 405);
}

require_csrf();
$b = body();
$action = (string) ($b['action'] ?? '');
$ip = substr((string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);

switch ($action) {
    case 'login':
        $username = str_in($b, 'username', 40, true, 'Usuario');
        $password = is_string($b['password'] ?? null) ? $b['password'] : '';
        if ($password === '' || strlen($password) > 200) {
            fail('Usuario o contraseña incorrectos', 401);
        }
        $recent = (int) run(
            'SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND created_at > (NOW() - INTERVAL ' . LOCK_MINUTES . ' MINUTE)',
            [$ip]
        )->fetchColumn();
        if ($recent >= MAX_ATTEMPTS) {
            fail('Demasiados intentos fallidos. Espera ' . LOCK_MINUTES . ' minutos antes de volver a intentarlo.', 429);
        }
        $user = run('SELECT * FROM users WHERE username = ? AND is_active = 1', [$username])->fetch();
        if ($user) {
            $ok = password_verify($password, $user['password_hash']);
        } else {
            password_hash('x', PASSWORD_DEFAULT); // iguala el tiempo de respuesta cuando el usuario no existe
            $ok = false;
        }
        if (!$ok) {
            run('INSERT INTO login_attempts (ip, username) VALUES (?, ?)', [$ip, $username]);
            fail('Usuario o contraseña incorrectos', 401);
        }
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        run('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
        out(start_user_session($user));

    case 'setup':
        $username = str_in($b, 'username', 40, true, 'Usuario');
        if (!preg_match('/^[A-Za-z0-9_.-]{3,40}$/', $username)) {
            fail('El usuario solo admite letras, números, punto, guion y guion bajo (mínimo 3)');
        }
        $display = str_in($b, 'display_name', 80, false, 'Nombre visible') ?? $username;
        $password = is_string($b['password'] ?? null) ? $b['password'] : '';
        password_rules($password);
        $pdo = db();
        $pdo->beginTransaction();
        if ((int) $pdo->query('SELECT COUNT(*) FROM users FOR UPDATE')->fetchColumn() > 0) {
            $pdo->rollBack();
            fail('La instalación ya está configurada', 403);
        }
        run('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)',
            [$username, $display, password_hash($password, PASSWORD_DEFAULT), 'admin']);
        $id = (int) $pdo->lastInsertId();
        $pdo->commit();
        $user = run('SELECT * FROM users WHERE id = ?', [$id])->fetch();
        out(start_user_session($user), 201);

    case 'logout':
        destroy_session();
        out(['authenticated' => false]);

    case 'password':
        $u = require_auth();
        $current = is_string($b['current'] ?? null) ? $b['current'] : '';
        $new = is_string($b['new'] ?? null) ? $b['new'] : '';
        $row = run('SELECT password_hash FROM users WHERE id = ?', [$u['id']])->fetch();
        if (!$row || !password_verify($current, $row['password_hash'])) {
            fail('La contraseña actual no es correcta', 403);
        }
        password_rules($new);
        run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]);
        out(['changed' => true]);

    default:
        fail('Acción no válida', 404);
}
