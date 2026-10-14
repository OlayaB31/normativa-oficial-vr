<?php
/**
 * /api/auth.php
 *
 * GET                       -> estado de sesión
 * POST {action: 'login'}    -> inicia sesión
 * POST {action: 'setup'}    -> crea el primer administrador
 * POST {action: 'logout'}   -> cierra sesión
 * POST {action: 'password'} -> cambia la contraseña propia
 *
 * NOTA:
 * Este archivo no valida el token CSRF en sus peticiones POST.
 * Los demás endpoints conservan sus propias validaciones.
 */

require __DIR__ . '/../config/bootstrap.php';

start_session();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/**
 * Datos públicos del usuario.
 */
function public_user(array $u): array
{
    return [
        'id'           => (int) $u['id'],
        'username'     => $u['username'],
        'display_name' => $u['display_name'],
        'role'         => $u['role'],
    ];
}

/**
 * Valida la contraseña.
 */
function password_rules(string $p): void
{
    if (strlen($p) < 10) {
        fail('La contraseña debe tener al menos 10 caracteres');
    }

    if (strlen($p) > 200) {
        fail('La contraseña es demasiado larga');
    }
}

/**
 * Inicia la sesión del usuario.
 */
function start_user_session(array $user): array
{
    session_regenerate_id(true);

    $_SESSION['uid']  = (int) $user['id'];
    $_SESSION['last'] = time();

    // Se conserva el token en la respuesta para mantener
    // compatibilidad con el JavaScript existente.
    $_SESSION['csrf'] = bin2hex(random_bytes(32));

    run(
        'UPDATE users SET last_login = NOW() WHERE id = ?',
        [(int) $user['id']]
    );

    return [
        'authenticated' => true,
        'user'          => public_user($user),
        'csrf'          => $_SESSION['csrf'],
        'needs_setup'   => false,
    ];
}

/**
 * GET: estado de autenticación.
 */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $u = current_user();

    $users = (int) run(
        'SELECT COUNT(*) FROM users'
    )->fetchColumn();

    out([
        'authenticated' => (bool) $u,
        'user'          => $u ? public_user($u) : null,
        'csrf'           => $_SESSION['csrf'] ?? null,
        'needs_setup'   => $users === 0,
    ]);
}

/**
 * Solo se admiten peticiones GET y POST.
 */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Método no permitido', 405);
}

/**
 * La validación require_csrf() se ha omitido en este archivo.
 *
 * Esto NO elimina automáticamente la validación CSRF de
 * categories.php, articles.php ni de los demás endpoints.
 */
$b = body();

$action = (string) ($b['action'] ?? '');

$ip = substr(
    (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'),
    0,
    45
);

switch ($action) {

    /**
     * INICIAR SESIÓN
     */
    case 'login':

        $username = str_in(
            $b,
            'username',
            40,
            true,
            'Usuario'
        );

        $password = is_string($b['password'] ?? null)
            ? $b['password']
            : '';

        if ($password === '' || strlen($password) > 200) {
            fail('Usuario o contraseña incorrectos', 401);
        }

        $recent = (int) run(
            'SELECT COUNT(*)
               FROM login_attempts
              WHERE ip = ?
                AND created_at > (NOW() - INTERVAL '
                . LOCK_MINUTES . ' MINUTE)',
            [$ip]
        )->fetchColumn();

        if ($recent >= MAX_ATTEMPTS) {
            fail(
                'Demasiados intentos fallidos. Espera '
                . LOCK_MINUTES
                . ' minutos antes de volver a intentarlo.',
                429
            );
        }

        $user = run(
            'SELECT *
               FROM users
              WHERE username = ?
                AND is_active = 1',
            [$username]
        )->fetch();

        if ($user) {
            $ok = password_verify(
                $password,
                $user['password_hash']
            );
        } else {
            // Evita diferencias de tiempo demasiado evidentes
            // cuando el usuario no existe.
            password_hash('x', PASSWORD_DEFAULT);
            $ok = false;
        }

        if (!$ok) {
            run(
                'INSERT INTO login_attempts (ip, username)
                 VALUES (?, ?)',
                [$ip, $username]
            );

            fail('Usuario o contraseña incorrectos', 401);
        }

        if (
            password_needs_rehash(
                $user['password_hash'],
                PASSWORD_DEFAULT
            )
        ) {
            run(
                'UPDATE users
                    SET password_hash = ?
                  WHERE id = ?',
                [
                    password_hash($password, PASSWORD_DEFAULT),
                    $user['id'],
                ]
            );
        }

        run(
            'DELETE FROM login_attempts WHERE ip = ?',
            [$ip]
        );

        out(start_user_session($user));

    /**
     * CONFIGURACIÓN INICIAL
     */
    case 'setup':

        $username = str_in(
            $b,
            'username',
            40,
            true,
            'Usuario'
        );

        if (!preg_match('/^[A-Za-z0-9_.-]{3,40}$/', $username)) {
            fail(
                'El usuario solo admite letras, números, punto, '
                . 'guion y guion bajo (mínimo 3)'
            );
        }

        $display = str_in(
            $b,
            'display_name',
            80,
            false,
            'Nombre visible'
        ) ?? $username;

        $password = is_string($b['password'] ?? null)
            ? $b['password']
            : '';

        password_rules($password);

        $pdo = db();

        $pdo->beginTransaction();

        try {
            $users = (int) $pdo->query(
                'SELECT COUNT(*) FROM users FOR UPDATE'
            )->fetchColumn();

            if ($users > 0) {
                $pdo->rollBack();
                fail('La instalación ya está configurada', 403);
            }

            run(
                'INSERT INTO users
                    (username, display_name, password_hash, role)
                 VALUES (?, ?, ?, ?)',
                [
                    $username,
                    $display,
                    password_hash($password, PASSWORD_DEFAULT),
                    'admin',
                ]
            );

            $id = (int) $pdo->lastInsertId();

            $pdo->commit();

        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }

        $user = run(
            'SELECT * FROM users WHERE id = ?',
            [$id]
        )->fetch();

        if (!$user) {
            fail('No se pudo recuperar el administrador creado', 500);
        }

        out(start_user_session($user), 201);

    /**
     * CERRAR SESIÓN
     */
    case 'logout':

        destroy_session();

        out([
            'authenticated' => false,
        ]);

    /**
     * CAMBIAR CONTRASEÑA
     */
    case 'password':

        // Se mantiene la autenticación y la verificación
        // de la contraseña actual.
        $u = require_auth();

        $current = is_string($b['current'] ?? null)
            ? $b['current']
            : '';

        $new = is_string($b['new'] ?? null)
            ? $b['new']
            : '';

        $row = run(
            'SELECT password_hash
               FROM users
              WHERE id = ?',
            [$u['id']]
        )->fetch();

        if (
            !$row ||
            !password_verify($current, $row['password_hash'])
        ) {
            fail('La contraseña actual no es correcta', 403);
        }

        password_rules($new);

        run(
            'UPDATE users
                SET password_hash = ?
              WHERE id = ?',
            [
                password_hash($new, PASSWORD_DEFAULT),
                $u['id'],
            ]
        );

        out([
            'changed' => true,
        ]);

    /**
     * ACCIÓN DESCONOCIDA
     */
    default:

        fail('Acción no válida', 404);
}
