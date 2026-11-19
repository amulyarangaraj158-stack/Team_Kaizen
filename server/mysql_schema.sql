-- AutoPatch AI — MySQL 8.0+ Compatible Normalized Relational Schema
-- Mirrors the SQLite (node:sqlite) runtime schema for seamless production migration.

CREATE DATABASE IF NOT EXISTS autopatch_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE autopatch_ai;

CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  password_salt VARCHAR(128) NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'Developer',
  bio TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE sessions (
  token VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE projects (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  primary_language VARCHAR(40) NOT NULL DEFAULT 'Unknown',
  languages_json JSON NOT NULL,
  total_files INT NOT NULL DEFAULT 0,
  total_lines INT NOT NULL DEFAULT 0,
  health_status ENUM('healthy', 'warning', 'critical', 'unscanned') NOT NULL DEFAULT 'unscanned',
  last_scan_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_projects_user (user_id),
  INDEX idx_projects_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE uploaded_files (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  file_path VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  language VARCHAR(40) NOT NULL,
  size_bytes INT NOT NULL,
  line_count INT NOT NULL,
  original_content LONGTEXT NOT NULL,
  current_content LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_files_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_file_path (project_id, file_path(255)),
  INDEX idx_files_project (project_id)
) ENGINE=InnoDB;

CREATE TABLE scan_history (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  status ENUM('running', 'completed', 'failed') NOT NULL,
  model_used VARCHAR(80) NOT NULL,
  files_scanned INT NOT NULL DEFAULT 0,
  bugs_found INT NOT NULL DEFAULT 0,
  critical_count INT NOT NULL DEFAULT 0,
  high_count INT NOT NULL DEFAULT 0,
  medium_count INT NOT NULL DEFAULT 0,
  low_count INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_scans_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_scans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_scans_project (project_id),
  INDEX idx_scans_user (user_id),
  INDEX idx_scans_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE detected_bugs (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  scan_id VARCHAR(36) NOT NULL,
  file_id VARCHAR(36) NOT NULL,
  file_path VARCHAR(512) NOT NULL,
  line_start INT NOT NULL,
  line_end INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(64) NOT NULL,
  severity ENUM('critical', 'high', 'medium', 'low') NOT NULL,
  impact_score INT NOT NULL,
  confidence INT NOT NULL,
  priority_score INT NOT NULL,
  description TEXT NOT NULL,
  why_occurred TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  potential_impact TEXT NOT NULL,
  suggested_solution TEXT NOT NULL,
  status ENUM('open', 'patch_generated', 'patched', 'verified', 'rejected') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bugs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_bugs_scan FOREIGN KEY (scan_id) REFERENCES scan_history(id) ON DELETE CASCADE,
  CONSTRAINT fk_bugs_file FOREIGN KEY (file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE,
  INDEX idx_bugs_project (project_id),
  INDEX idx_bugs_severity (severity),
  INDEX idx_bugs_status (status)
) ENGINE=InnoDB;

CREATE TABLE suggested_fixes (
  id VARCHAR(36) PRIMARY KEY,
  bug_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  file_id VARCHAR(36) NOT NULL,
  original_code LONGTEXT NOT NULL,
  patched_code LONGTEXT NOT NULL,
  explanation TEXT NOT NULL,
  confidence INT NOT NULL,
  risks_json JSON NOT NULL,
  status ENUM('pending', 'accepted', 'rejected', 'rolled_back') NOT NULL DEFAULT 'pending',
  applied_by_user_id VARCHAR(36) NULL,
  applied_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fixes_bug FOREIGN KEY (bug_id) REFERENCES detected_bugs(id) ON DELETE CASCADE,
  CONSTRAINT fk_fixes_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_fixes_file FOREIGN KEY (file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE,
  CONSTRAINT fk_fixes_user FOREIGN KEY (applied_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_fixes_bug (bug_id),
  INDEX idx_fixes_project (project_id)
) ENGINE=InnoDB;

CREATE TABLE test_results (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  bug_id VARCHAR(36) NOT NULL,
  fix_id VARCHAR(36) NULL,
  phase ENUM('before', 'after') NOT NULL,
  execution_mode ENUM('isolated_vm', 'static_validation') NOT NULL,
  total_tests INT NOT NULL,
  passed_tests INT NOT NULL,
  failed_tests INT NOT NULL,
  regression_detected TINYINT(1) NOT NULL DEFAULT 0,
  validation_status ENUM('passed', 'failed', 'static_verified', 'error') NOT NULL,
  summary TEXT NOT NULL,
  cases_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tests_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_tests_bug FOREIGN KEY (bug_id) REFERENCES detected_bugs(id) ON DELETE CASCADE,
  CONSTRAINT fk_tests_fix FOREIGN KEY (fix_id) REFERENCES suggested_fixes(id) ON DELETE SET NULL,
  INDEX idx_tests_bug (bug_id),
  INDEX idx_tests_project (project_id)
) ENGINE=InnoDB;

CREATE TABLE change_history (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  file_id VARCHAR(36) NOT NULL,
  bug_id VARCHAR(36) NULL,
  fix_id VARCHAR(36) NULL,
  user_id VARCHAR(36) NOT NULL,
  action_type ENUM('patch_accepted', 'patch_rejected', 'rollback') NOT NULL,
  before_content LONGTEXT NOT NULL,
  after_content LONGTEXT NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_changes_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_changes_file FOREIGN KEY (file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE,
  CONSTRAINT fk_changes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_changes_project (project_id),
  INDEX idx_changes_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE learning_insights (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NULL,
  concept_title VARCHAR(180) NOT NULL,
  mistake_category VARCHAR(64) NOT NULL,
  frequency_count INT NOT NULL DEFAULT 1,
  why_it_happens TEXT NOT NULL,
  explanation TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  status ENUM('active', 'practicing', 'mastered') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_learning_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_learning_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, is_read)
) ENGINE=InnoDB;
