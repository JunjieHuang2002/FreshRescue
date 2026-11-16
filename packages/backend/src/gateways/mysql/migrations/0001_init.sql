-- FreshRescue schema, version 1 (plan, phase 7). migrate.ts applies it once and records it.
--
-- Nine tables: the six record lists of a snapshot, the one-row settings and counters, and the
-- runner's own list of the migrations it has applied. tables.ts maps these names to the logical
-- table and field names of WriteOps, and no other source file knows them.
--
-- Ids are assigned by the application, from one counter that serves every kind of record, so no id
-- column is AUTO_INCREMENT. The one AUTO_INCREMENT column, recipe_ingredient.seq, only keeps the
-- rows of that table in the order they were first written. There are no foreign keys: the cascade
-- rules live in the deciders, and SnapshotInvariantChecker checks every reference before anything
-- is written. The one rule the schema keeps itself is the CHECK on the two quantity columns.
--
-- Each table is created only when it is missing, so a migration that stopped half way through can
-- simply run again.

CREATE TABLE IF NOT EXISTS food_category (
  id                    BIGINT UNSIGNED NOT NULL,
  name                  VARCHAR(200)    NOT NULL,
  parent_id             BIGINT UNSIGNED NULL,
  is_system             BOOLEAN         NOT NULL,
  custom_threshold_days BIGINT UNSIGNED NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS food_type (
  id                    BIGINT UNSIGNED NOT NULL,
  name                  VARCHAR(200)    NOT NULL,
  category_id           BIGINT UNSIGNED NOT NULL,
  unit                  VARCHAR(16)     NOT NULL,
  custom_threshold_days BIGINT UNSIGNED NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- A quantity is a whole number of thousandths, from 0.001 to 500,000.
CREATE TABLE IF NOT EXISTS batch (
  id              BIGINT UNSIGNED NOT NULL,
  food_type_id    BIGINT UNSIGNED NOT NULL,
  quantity        INT             NOT NULL,
  inbound_date    DATE            NOT NULL,
  expiration_date DATE            NOT NULL,
  created_seq     BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT batch_quantity_range CHECK (quantity BETWEEN 1 AND 500000000)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS recipe_category (
  id        BIGINT UNSIGNED NOT NULL,
  name      VARCHAR(200)    NOT NULL,
  is_system BOOLEAN         NOT NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS recipe (
  id                 BIGINT UNSIGNED NOT NULL,
  name               VARCHAR(200)    NOT NULL,
  recipe_category_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- A row is named by its recipe and its Food Type together. A put of an existing pair updates the
-- row and keeps its seq, so it stays where it stands; a new row gets the next seq and comes last.
CREATE TABLE IF NOT EXISTS recipe_ingredient (
  seq                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipe_id              BIGINT UNSIGNED NOT NULL,
  food_type_id           BIGINT UNSIGNED NOT NULL,
  required_quantity      INT             NOT NULL,
  required_unit          VARCHAR(16)     NOT NULL,
  deleted_food_type_name VARCHAR(200)    NULL,
  PRIMARY KEY (seq),
  UNIQUE KEY recipe_ingredient_row (recipe_id, food_type_id),
  CONSTRAINT recipe_ingredient_quantity_range CHECK (required_quantity BETWEEN 1 AND 500000000)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- The settings and the counters are one row each: the key column holds 1 and nothing else.
CREATE TABLE IF NOT EXISTS app_settings (
  id              TINYINT UNSIGNED NOT NULL DEFAULT 1,
  simulated_today DATE             NULL,
  bootstrapped    BOOLEAN          NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT app_settings_one_row CHECK (id = 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS app_counters (
  id       TINYINT UNSIGNED NOT NULL DEFAULT 1,
  next_id  BIGINT UNSIGNED  NOT NULL,
  next_seq BIGINT UNSIGNED  NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT app_counters_one_row CHECK (id = 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
