-- ============================================================
--  Normativa Oficial · SA-MP Roleplay
--  Esquema + datos de demostración · MySQL 8.x · utf8mb4
--  Ejecutar UNA sola vez:   mysql -u root -p < database/database.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS `normativa-vr`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `normativa-vr`;
SET NAMES utf8mb4;

-- ------------------------------------------------------------
--  Usuarios del panel
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(40)  NOT NULL,
  display_name  VARCHAR(80)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','editor') NOT NULL DEFAULT 'editor',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login    DATETIME     NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

-- Intentos fallidos de login (limitación de fuerza bruta)
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip         VARCHAR(45) NOT NULL,
  username   VARCHAR(40) NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_attempts_ip_time (ip, created_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
--  Estructura documental
--  Normativa > Categoría > Apartado/Título/Capítulo/Sección (sin límite
--  de profundidad: sections.parent_id es autorreferenciada) > Artículo
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(140) NOT NULL,
  description VARCHAR(500) NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  status      ENUM('draft','published') NOT NULL DEFAULT 'published',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  KEY idx_categories_order (status, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sections (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id INT UNSIGNED NOT NULL,
  parent_id   INT UNSIGNED NULL,
  kind        ENUM('apartado','titulo','capitulo','seccion') NOT NULL DEFAULT 'apartado',
  name        VARCHAR(160) NOT NULL,
  slug        VARCHAR(180) NOT NULL,
  description VARCHAR(500) NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  status      ENUM('draft','published') NOT NULL DEFAULT 'published',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sections_slug (slug),
  KEY idx_sections_tree (category_id, parent_id, sort_order),
  CONSTRAINT fk_sections_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE,
  CONSTRAINT fk_sections_parent   FOREIGN KEY (parent_id)   REFERENCES sections (id)   ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS articles (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id  INT UNSIGNED NOT NULL,
  section_id   INT UNSIGNED NULL,
  number       VARCHAR(20)  NULL,
  title        VARCHAR(200) NOT NULL,
  slug         VARCHAR(220) NOT NULL,
  summary      VARCHAR(500) NULL,
  content      MEDIUMTEXT   NOT NULL,
  content_text MEDIUMTEXT   NULL,
  scope        VARCHAR(500) NULL,
  status       ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  author_id    INT UNSIGNED NULL,
  version      INT UNSIGNED NOT NULL DEFAULT 1,
  sort_order   INT NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_articles_slug (slug),
  KEY idx_articles_scope (category_id, section_id, sort_order),
  KEY idx_articles_status (status, updated_at),
  KEY idx_articles_number (number),
  CONSTRAINT fk_articles_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE,
  CONSTRAINT fk_articles_section  FOREIGN KEY (section_id)  REFERENCES sections (id)   ON DELETE CASCADE,
  CONSTRAINT fk_articles_author   FOREIGN KEY (author_id)   REFERENCES users (id)      ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pages (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug       VARCHAR(140) NOT NULL,
  title      VARCHAR(200) NOT NULL,
  content    MEDIUMTEXT   NOT NULL,
  status     ENUM('draft','published') NOT NULL DEFAULT 'published',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pages_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tags (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(60) NOT NULL,
  slug       VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_name (name),
  UNIQUE KEY uq_tags_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS article_tags (
  article_id INT UNSIGNED NOT NULL,
  tag_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (article_id, tag_id),
  KEY idx_article_tags_tag (tag_id),
  CONSTRAINT fk_at_article FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE,
  CONSTRAINT fk_at_tag     FOREIGN KEY (tag_id)     REFERENCES tags (id)     ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS article_versions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  article_id  INT UNSIGNED NOT NULL,
  version_no  INT UNSIGNED NOT NULL,
  number      VARCHAR(20)  NULL,
  title       VARCHAR(200) NOT NULL,
  summary     VARCHAR(500) NULL,
  content     MEDIUMTEXT   NOT NULL,
  scope       VARCHAR(500) NULL,
  status      ENUM('draft','published','archived') NOT NULL,
  change_note VARCHAR(200) NULL,
  changed_by  INT UNSIGNED NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_versions (article_id, version_no),
  KEY idx_versions_date (created_at),
  CONSTRAINT fk_versions_article FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE,
  CONSTRAINT fk_versions_user    FOREIGN KEY (changed_by) REFERENCES users (id)    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(60) NOT NULL,
  setting_value TEXT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB;

-- ============================================================
--  DATOS DE DEMOSTRACIÓN (se pueden borrar desde el panel)
-- ============================================================

INSERT INTO settings (setting_key, setting_value) VALUES
 ('server_name', 'Ciudad Esmeralda RP'),
 ('tagline',     'Reglamento y disposiciones del servidor SA-MP Roleplay'),
 ('description', 'Normativa oficial del servidor SA-MP Roleplay: reglas generales, roleplay, sanciones, organizaciones y procedimientos.'),
 ('footer_text', 'Documento de consulta para jugadores. Ante cualquier duda de interpretación prevalece el criterio del equipo administrativo.');

INSERT INTO categories (id, name, slug, description, sort_order, status) VALUES
 (1, 'Normas Generales',        'normas-generales',        'Conceptos básicos, interpretación y conducta general dentro del servidor.', 1, 'published'),
 (2, 'Roleplay',                'roleplay',                'Qué es el Roleplay, cómo se crean los personajes y cómo se interactúa.',   2, 'published'),
 (3, 'Conductas sancionables',  'conductas-sancionables',  'Faltas de rol y de conducta que acarrean sanción.',                         3, 'published'),
 (4, 'Organizaciones',          'organizaciones',          'Facciones legales e ilegales y sus normas especiales.',                     4, 'published'),
 (5, 'Vehículos',               'vehiculos',               'Uso, robo y mantenimiento de vehículos.',                                   5, 'published'),
 (6, 'Armas',                   'armas',                   'Posesión, uso y rol con armamento.',                                        6, 'published'),
 (7, 'Economía',                'economia',                'Dinero, comercio y transacciones entre jugadores.',                         7, 'published'),
 (8, 'Chat',                    'chat',                    'Canales de comunicación IC y OOC.',                                         8, 'published'),
 (9, 'Administración',          'administracion',          'Sanciones, procedimientos y funcionamiento del equipo administrativo.',     9, 'published');

INSERT INTO sections (id, category_id, parent_id, kind, name, slug, description, sort_order, status) VALUES
 (1, 1, NULL, 'apartado', 'Conceptos básicos',             'conceptos-basicos',             'Términos y reglas de interpretación.', 1, 'published'),
 (2, 1, NULL, 'apartado', 'Conducta dentro del servidor',  'conducta-dentro-del-servidor',  NULL, 2, 'published'),
 (3, 1, NULL, 'apartado', 'Uso de cuentas',                'uso-de-cuentas',                NULL, 3, 'published'),
 (4, 2, NULL, 'apartado', 'Conceptos de Roleplay',         'conceptos-de-roleplay',         NULL, 1, 'published'),
 (5, 2, NULL, 'apartado', 'Nombres y personajes',          'nombres-y-personajes',          NULL, 2, 'published'),
 (6, 4, NULL, 'titulo',   'Organizaciones legales',        'organizaciones-legales',        NULL, 1, 'published'),
 (7, 4, NULL, 'titulo',   'Organizaciones ilegales',       'organizaciones-ilegales',       NULL, 2, 'published'),
 (8, 4, 7,    'capitulo', 'Conflictos entre organizaciones','conflictos-entre-organizaciones','Procedimiento para iniciar y resolver conflictos.', 1, 'published');

INSERT INTO articles (id, category_id, section_id, number, title, slug, summary, content, scope, status, sort_order, version, published_at) VALUES
(1, 1, 1, '1.1', 'Definiciones generales', 'definiciones-generales',
 'Términos que se utilizan a lo largo de toda la normativa.',
 '<p>A efectos de esta normativa se entenderá por:</p><table><thead><tr><th>Término</th><th>Definición</th></tr></thead><tbody><tr><td>IC</td><td>In Character. Todo lo que ocurre dentro del rol del personaje.</td></tr><tr><td>OOC</td><td>Out Of Character. Todo lo que pertenece al jugador y no al personaje.</td></tr><tr><td>Staff</td><td>Equipo administrativo encargado de aplicar la normativa.</td></tr><tr><td>Rol</td><td>Interpretación de un personaje dentro del servidor.</td></tr></tbody></table>',
 'Esta norma aplica a todos los jugadores.', 'published', 1, 1, NOW()),
(2, 1, 1, '1.2', 'Reglas de interpretación', 'reglas-de-interpretacion',
 'Cómo se aplican las normas cuando existen dudas o vacíos.',
 '<p>La normativa se interpretará siguiendo estos criterios, en orden:</p><ol><li>El sentido literal del artículo.</li><li>El espíritu de la norma: favorecer el rol y la convivencia.</li><li>El criterio del equipo administrativo cuando exista un vacío.</li></ol><div class="callout note"><p>Que una situación no esté regulada expresamente no significa que esté permitida.</p></div>',
 'Esta norma aplica a jugadores y a miembros del staff.', 'published', 2, 1, NOW()),
(3, 1, 2, '1.3', 'Conducta dentro del servidor', 'conducta-dentro-del-servidor-art',
 'Respeto mínimo exigible a toda la comunidad.',
 '<p>Todo jugador debe mantener un trato respetuoso hacia el resto de la comunidad, tanto en el canal IC como en el OOC.</p><ul><li>Están prohibidos los insultos, amenazas y el acoso.</li><li>No se permite la discriminación por motivos personales.</li><li>Las discusiones OOC deben resolverse con el staff, nunca dentro del rol.</li></ul><div class="callout warn"><p>El incumplimiento reiterado de esta norma puede conllevar la suspensión de la cuenta.</p></div>',
 'Esta norma aplica en todo momento y en todos los canales.', 'published', 1, 1, NOW()),
(4, 1, 3, '1.4', 'Uso de cuentas', 'uso-de-cuentas-art',
 'Una persona, una cuenta.',
 '<p>Cada jugador puede utilizar únicamente <strong>una cuenta</strong>. Compartir o ceder una cuenta está prohibido y será sancionado tanto al titular como al usuario.</p><p>Es responsabilidad del jugador proteger sus credenciales.</p>',
 'Esta norma aplica a todas las cuentas registradas.', 'published', 1, 1, NOW()),
(5, 2, 4, '2.1', 'Concepto de Roleplay', 'concepto-de-roleplay',
 'Qué significa interpretar un personaje en el servidor.',
 '<p>El <strong>Roleplay</strong> consiste en interpretar un personaje dentro del entorno establecido por el servidor, actuando de forma coherente con la situación, el mundo y las reglas de la ciudad.</p><h3>Principios básicos</h3><ul><li>Mantener la coherencia del personaje en todo momento.</li><li>Dar a los demás jugadores la posibilidad de reaccionar.</li><li>Anteponer el rol al beneficio personal.</li></ul><div class="callout note"><p>Ante la duda, pregunta por el canal OOC o contacta con el staff antes de actuar.</p></div>',
 'Esta norma aplica a todos los jugadores.', 'published', 1, 1, NOW()),
(6, 2, 5, '2.2', 'Nombres y personajes', 'nombres-y-personajes-art',
 'Formato de nombres y límites de los personajes.',
 '<p>Los personajes deberán usar el formato <strong>Nombre_Apellido</strong>. No se admiten nombres de famosos, personajes de ficción ni nombres ofensivos.</p><blockquote>Un personaje debe poder existir razonablemente dentro del mundo del servidor.</blockquote><p>Los cambios de nombre se solicitan al staff y requieren una justificación de rol.</p>',
 'Esta norma aplica a toda creación o modificación de personajes.', 'published', 1, 1, NOW()),
(7, 3, NULL, '3.1', 'Metagaming', 'metagaming',
 'Usar información OOC dentro del rol.',
 '<p>Se considera <strong>metagaming</strong> utilizar en el rol información que el personaje no conoce y que el jugador ha obtenido por medios OOC: chats, streams, Discord u otros canales.</p><h3>Ejemplos</h3><ul><li>Perseguir a alguien por haber visto su ubicación en un stream.</li><li>Llamar por su nombre a un desconocido leyendo el tag de su cabeza.</li></ul><div class="callout warn"><p>Sanción habitual: de 24 a 72 horas según gravedad y reincidencia.</p></div>',
 'Esta norma aplica a todos los jugadores.', 'published', 1, 1, NOW()),
(8, 3, NULL, '3.2', 'Powergaming', 'powergaming',
 'Forzar acciones sobre otros jugadores o hacer acciones imposibles.',
 '<p>El <strong>powergaming</strong> consiste en imponer acciones a otro jugador sin darle opción de respuesta, o en realizar acciones que serían imposibles para un personaje normal.</p><p>Toda acción debe permitir una reacción razonable del resto de participantes.</p>',
 'Esta norma aplica a todos los jugadores.', 'published', 2, 1, NOW()),
(9, 3, NULL, '3.3', 'Deathmatch', 'deathmatch',
 'Atacar o matar sin motivo de rol.',
 '<p>Se considera <strong>deathmatch</strong> atacar o matar a otro jugador sin una razón de rol previa y suficiente.</p><ol><li>Debe existir un conflicto previo desarrollado en rol.</li><li>El ataque debe ser proporcional a la situación.</li><li>No se puede abrir fuego sin avisar cuando la situación lo permite.</li></ol>',
 'Esta norma aplica a todos los jugadores.', 'published', 3, 1, NOW()),
(10, 3, NULL, '3.4', 'Revenge Kill', 'revenge-kill',
 'Vengarse de quien te ha matado tras haber perdido la memoria del suceso.',
 '<p>Tras ser abatido, el personaje <strong>pierde la memoria</strong> de los hechos que llevaron a su muerte. Volver a por el responsable constituye <em>revenge kill</em>.</p><div class="callout hl"><p>Un personaje abatido no puede regresar a la zona del suceso durante los siguientes 15 minutos.</p></div>',
 'Esta norma aplica a todos los jugadores.', 'published', 4, 1, NOW()),
(11, 4, 8, '4.2.1', 'Guerra entre organizaciones', 'guerra-entre-organizaciones',
 'Requisitos para declarar y mantener un conflicto.',
 '<p>Una organización ilegal solo puede declarar un conflicto cuando exista un motivo de rol documentado y con aprobación del staff.</p><table><thead><tr><th>Fase</th><th>Requisito</th></tr></thead><tbody><tr><td>Declaración</td><td>Ticket con motivo y pruebas de rol</td></tr><tr><td>Duración</td><td>Máximo 7 días, renovable</td></tr><tr><td>Cierre</td><td>Acuerdo entre las partes o decisión del staff</td></tr></tbody></table>',
 'Esta norma aplica a todas las organizaciones ilegales.', 'published', 1, 1, NOW()),
(12, 5, NULL, '5.1', 'Uso de vehículos', 'uso-de-vehiculos',
 'Conducción realista y límites del uso del vehículo.',
 '<p>Los vehículos deben conducirse de forma coherente con un entorno real. Usar el vehículo como arma o realizar saltos y maniobras imposibles está prohibido.</p><ul><li>Respeta los límites de velocidad dentro de la ciudad.</li><li>Un vehículo dañado debe rolearse como tal.</li></ul>',
 'Esta norma aplica a todos los vehículos del servidor.', 'published', 1, 1, NOW()),
(13, 6, NULL, '6.1', 'Posesión y uso de armas', 'posesion-y-uso-de-armas',
 'Cuándo se puede portar y usar un arma.',
 '<p>Solo se pueden portar armas cuando el personaje tenga una justificación de rol y disponga de la licencia correspondiente, en caso de ser exigible.</p><div class="callout warn"><p>Amenazar con un arma exige una acción de rol previa. Sacar el arma no es una amenaza por sí mismo.</p></div>',
 'Esta norma aplica a todos los jugadores.', 'published', 1, 1, NOW()),
(14, 7, NULL, '7.1', 'Transacciones y comercio', 'transacciones-y-comercio',
 'Reglas para el dinero entre jugadores.',
 '<p>Toda transacción debe tener justificación de rol. Queda prohibida la venta de dinero, bienes o cuentas del servidor por dinero real.</p><p>Las estafas de rol son válidas siempre que no impliquen engaños OOC.</p>',
 'Esta norma aplica a todos los jugadores.', 'published', 1, 1, NOW()),
(15, 8, NULL, '8.1', 'Canales de chat', 'canales-de-chat',
 'Diferencia entre comunicación IC y OOC.',
 '<p>El chat <strong>IC</strong> es exclusivo del personaje. El chat <strong>OOC</strong> pertenece al jugador y no puede usarse para obtener ventaja en el rol.</p><p>Compartir información obtenida por OOC dentro del rol es metagaming y será sancionado.</p>',
 'Esta norma aplica a todos los canales de comunicación del servidor.', 'published', 1, 1, NOW()),
(16, 9, NULL, '9.1', 'Sanciones del equipo administrativo', 'sanciones-del-equipo-administrativo',
 'Escala de sanciones y criterios de aplicación.',
 '<p>Las sanciones se aplican de forma gradual según la gravedad y la reincidencia.</p><table><thead><tr><th>Nivel</th><th>Sanción</th></tr></thead><tbody><tr><td>1</td><td>Advertencia</td></tr><tr><td>2</td><td>Jail administrativo</td></tr><tr><td>3</td><td>Suspensión temporal</td></tr><tr><td>4</td><td>Expulsión permanente</td></tr></tbody></table>',
 'Esta norma aplica a todos los jugadores y al staff.', 'published', 1, 1, NOW()),
(17, 9, NULL, '9.2', 'Procedimiento de apelación', 'procedimiento-de-apelacion',
 'Cómo recurrir una sanción. (Borrador de ejemplo, no público.)',
 '<p>Este artículo está en estado <strong>borrador</strong>, por lo que no aparece en la web pública. Pruébalo desde el panel administrativo.</p>',
 'Esta norma aplica a todos los jugadores sancionados.', 'draft', 2, 1, NULL);

INSERT INTO tags (id, name, slug) VALUES
 (1, 'Roleplay', 'roleplay'), (2, 'OOC', 'ooc'), (3, 'Sanciones', 'sanciones'),
 (4, 'Metagaming', 'metagaming'), (5, 'Combate', 'combate'), (6, 'Vehículos', 'vehiculos'),
 (7, 'Cuentas', 'cuentas');

INSERT INTO article_tags (article_id, tag_id) VALUES
 (3,3),(4,7),(5,1),(6,1),(7,2),(7,3),(7,4),(8,1),(8,3),(9,5),(9,3),(10,5),(10,3),
 (12,6),(13,5),(15,2),(15,4),(16,3);

INSERT INTO pages (slug, title, content, status, sort_order) VALUES
('informacion', 'Información',
 '<h3>Sobre esta normativa</h3><p>Este documento reúne las reglas oficiales del servidor. Se organiza en categorías, apartados y artículos, y se actualiza de forma continua. Cada artículo muestra su fecha de última actualización.</p><h3>Cómo se aplica</h3><ul><li>Desconocer la normativa no exime de su cumplimiento.</li><li>Las sanciones se aplican de forma gradual según la gravedad y la reincidencia.</li><li>Cuando existe un vacío, el equipo administrativo decide siguiendo el espíritu de la norma.</li></ul><div class="callout note"><p>Puedes buscar cualquier término con la tecla <strong>/</strong> y cambiar entre modo claro y oscuro con la tecla <strong>t</strong>.</p></div><h3>Contacto</h3><p>Para dudas o reclamaciones, abre un ticket desde el canal de soporte del servidor.</p>',
 'published', 1);

-- Texto plano para el buscador (a partir de aquí lo mantiene PHP)
UPDATE articles
   SET content_text = TRIM(REGEXP_REPLACE(REGEXP_REPLACE(content, '<[^>]*>', ' '), '[[:space:]]+', ' '));

-- Versión inicial de cada artículo en el historial
INSERT INTO article_versions (article_id, version_no, number, title, summary, content, scope, status, change_note, changed_by)
SELECT id, 1, number, title, summary, content, scope, status, 'Creado', NULL FROM articles;
