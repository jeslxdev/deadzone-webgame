-- Identificação obrigatória do jogador (e-mail ou telefone) e aparelhos usados.
-- O jogo só abre partidas para sessões identificadas que aceitaram o aviso de privacidade.
-- Dados pessoais (LGPD): finalidade segurança/antifraude/estatística; IP e user-agent dos
-- aparelhos são apagados após DEADZONE_IP_RETENTION_DAYS dias, como nos acessos.
-- Rodar uma vez, como root:  mysql deadzone < migrations/003_deadzone_identity_devices.sql

ALTER TABLE dz_sessions
  ADD COLUMN contact_type VARCHAR(8) NULL AFTER client_updated_at,        -- email | phone
  ADD COLUMN contact_value VARCHAR(190) NULL AFTER contact_type,           -- e-mail em minúsculas ou telefone só com dígitos (+DDI)
  ADD COLUMN contact_at DATETIME NULL AFTER contact_value,
  ADD COLUMN consent_at DATETIME NULL AFTER contact_at,                    -- aceite do aviso de privacidade
  ADD COLUMN consent_version VARCHAR(16) NULL AFTER consent_at,
  ADD COLUMN device_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER consent_version,
  ADD KEY idx_dz_sessions_contact (contact_value);

CREATE TABLE IF NOT EXISTS dz_session_devices (
  device_row_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- sha256 dos dados estáveis do aparelho
  device_kind VARCHAR(16) NULL,                                           -- mobile | tablet | desktop
  os_name VARCHAR(40) NULL,
  os_version VARCHAR(40) NULL,
  browser_name VARCHAR(40) NULL,
  browser_version VARCHAR(40) NULL,
  device_model VARCHAR(80) NULL,
  gpu VARCHAR(200) NULL,
  screen VARCHAR(40) NULL,
  cpu_cores SMALLINT UNSIGNED NULL,
  memory_gb DECIMAL(5,2) NULL,
  timezone VARCHAR(64) NULL,
  language VARCHAR(35) NULL,
  connection VARCHAR(40) NULL,
  last_ip VARCHAR(45) NULL,
  geo_country CHAR(2) NULL,
  geo_region VARCHAR(80) NULL,
  geo_city VARCHAR(80) NULL,
  user_agent VARCHAR(400) NULL,
  device_json MEDIUMTEXT NULL,                                            -- todos os dados coletados (JSON)
  seen_count INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_row_id),
  UNIQUE KEY uq_dz_device (session_id, fingerprint),
  KEY idx_dz_device_fp (fingerprint),
  KEY idx_dz_device_seen (last_seen_at),
  CONSTRAINT fk_dz_device_session FOREIGN KEY (session_id)
    REFERENCES dz_sessions (session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
