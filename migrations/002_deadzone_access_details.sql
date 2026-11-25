-- Origem de cada sessão (IP, navegador, idioma, fuso, região) e histórico de acessos/partidas.
-- IP é dado pessoal (LGPD): o servidor do jogo apaga IP e user-agent depois de
-- DEADZONE_IP_RETENTION_DAYS dias (padrão 180). País/estado/cidade ficam.
-- Rodar uma vez, como root:  mysql deadzone < migrations/002_deadzone_access_details.sql

ALTER TABLE dz_sessions
  ADD COLUMN first_ip VARCHAR(45) NULL AFTER game_active,
  ADD COLUMN last_ip VARCHAR(45) NULL AFTER first_ip,
  ADD COLUMN user_agent VARCHAR(400) NULL AFTER last_ip,
  ADD COLUMN accept_language VARCHAR(120) NULL AFTER user_agent,
  ADD COLUMN client_lang VARCHAR(35) NULL AFTER accept_language,
  ADD COLUMN client_tz VARCHAR(64) NULL AFTER client_lang,
  ADD COLUMN client_screen VARCHAR(16) NULL AFTER client_tz,
  ADD COLUMN geo_country CHAR(2) NULL AFTER client_screen,
  ADD COLUMN geo_region VARCHAR(80) NULL AFTER geo_country,
  ADD COLUMN geo_city VARCHAR(80) NULL AFTER geo_region,
  ADD COLUMN client_updated_at DATETIME NULL AFTER geo_city;

CREATE TABLE IF NOT EXISTS dz_session_events (
  event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(16) NOT NULL,            -- visit | game_start | game_end
  ip VARCHAR(45) NULL,
  geo_country CHAR(2) NULL,
  geo_region VARCHAR(80) NULL,
  geo_city VARCHAR(80) NULL,
  user_agent VARCHAR(400) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_dz_events_session (session_id, event_type, created_at),
  KEY idx_dz_events_created (created_at),
  CONSTRAINT fk_dz_events_session FOREIGN KEY (session_id)
    REFERENCES dz_sessions (session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
