CREATE TABLE IF NOT EXISTS dz_sessions (
  session_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  game_started_at DATETIME NULL,
  game_last_seen_at DATETIME NULL,
  game_active TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id),
  KEY idx_dz_sessions_last_seen (last_seen_at),
  KEY idx_dz_sessions_game_seen (game_active, game_last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dz_feedback (
  feedback_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category VARCHAR(24) NOT NULL,
  message VARCHAR(2000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (feedback_id),
  KEY idx_dz_feedback_created (created_at),
  CONSTRAINT fk_dz_feedback_session FOREIGN KEY (session_id)
    REFERENCES dz_sessions (session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dz_profiles (
  session_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  profile_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  character_class VARCHAR(24) NOT NULL,
  level INT UNSIGNED NOT NULL DEFAULT 1,
  xp INT UNSIGNED NOT NULL DEFAULT 0,
  money BIGINT UNSIGNED NOT NULL DEFAULT 0,
  attributes_json JSON NOT NULL,
  stats_json JSON NOT NULL,
  items_json JSON NOT NULL,
  profile_json JSON NOT NULL,
  created_ms BIGINT UNSIGNED NOT NULL,
  updated_ms BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, profile_id),
  KEY idx_dz_profiles_updated (updated_at),
  KEY idx_dz_profiles_class_level (character_class, level),
  CONSTRAINT fk_dz_profiles_session FOREIGN KEY (session_id)
    REFERENCES dz_sessions (session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
