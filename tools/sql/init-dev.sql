-- FreshRescue development databases and user.
--
-- Run it once, as a MySQL admin:   mysql -u root -p < tools/sql/init-dev.sql
-- It is safe to run again: it creates what is missing and resets the user's password.
--
-- `freshrescue`       is the database the API uses  (DATABASE_URL in .env)
-- `freshrescue_test`  is the database the db and e2e tests use  (TEST_DATABASE_URL in .env)
--
-- The password below is public on purpose: this is a local demo. The user is created
-- for loopback addresses only, so it cannot be used from another machine. It has upper
-- and lower case letters, a digit and a special character, so a server that runs the
-- validate_password component at its default MEDIUM policy accepts it too.

CREATE DATABASE IF NOT EXISTS `freshrescue` CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS `freshrescue_test` CHARACTER SET utf8mb4;

CREATE USER IF NOT EXISTS 'freshrescue'@'localhost' IDENTIFIED BY 'FreshRescue_dev_1';
CREATE USER IF NOT EXISTS 'freshrescue'@'127.0.0.1' IDENTIFIED BY 'FreshRescue_dev_1';

ALTER USER 'freshrescue'@'localhost' IDENTIFIED BY 'FreshRescue_dev_1';
ALTER USER 'freshrescue'@'127.0.0.1' IDENTIFIED BY 'FreshRescue_dev_1';

GRANT ALL PRIVILEGES ON `freshrescue`.* TO 'freshrescue'@'localhost';
GRANT ALL PRIVILEGES ON `freshrescue_test`.* TO 'freshrescue'@'localhost';
GRANT ALL PRIVILEGES ON `freshrescue`.* TO 'freshrescue'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `freshrescue_test`.* TO 'freshrescue'@'127.0.0.1';
