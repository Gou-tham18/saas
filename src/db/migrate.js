import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { logger } from '../lib/logger.js';
import { isMain } from '../lib/isMain.js';

const currentFolder = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.join(currentFolder, 'migrations');
const MIGRATION_LOCK_ID = 72417001;

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT name FROM schema_migrations');
  const applied = [];
  for (const row of result.rows) {
    applied.push(row.name);
  }
  return applied;
}

async function getMigrationFiles() {
  const allFiles = await fs.readdir(MIGRATIONS_FOLDER);
  const sqlFiles = [];
  for (const file of allFiles) {
    if (file.endsWith('.sql')) {
      sqlFiles.push(file);
    }
  }
  sqlFiles.sort();
  return sqlFiles;
}

async function applyMigration(client, file) {
  const sql = await fs.readFile(path.join(MIGRATIONS_FOLDER, file), 'utf8');

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    logger.info({ migration: file }, 'Applied migration');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error('Migration ' + file + ' failed: ' + err.message);
  }
}

export async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );

    const appliedMigrations = await getAppliedMigrations(client);
    const migrationFiles = await getMigrationFiles();

    for (const file of migrationFiles) {
      if (!appliedMigrations.includes(file)) {
        await applyMigration(client, file);
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } catch (err) {
      logger.error({ err }, 'Could not release migration lock');
    }
    client.release();
  }
}

async function runFromCommandLine() {
  try {
    await migrate();
    logger.info('Migrations up to date');
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  runFromCommandLine();
}
