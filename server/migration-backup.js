import { DatabaseSync } from "node:sqlite";
import { existsSync, cpSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function backupBeforeMigration(dataDir) {
  const file = join(dataDir, "learning.sqlite");
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file);
  try {
    if (db.prepare("PRAGMA user_version").get().user_version >= 5) return null;
    // Windows requires releasing SQLite file locks before copying the directory.
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint.busy)
      throw new Error("Stop the running app before upgrading its data.");
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
  const fingerprint = () =>
    [file, `${file}-wal`, `${file}-shm`].map((path) => {
      if (!existsSync(path)) return null;
      const info = statSync(path, { bigint: true });
      return `${info.size}:${info.mtimeNs}`;
    });
  const before = JSON.stringify(fingerprint());
  const destination = `${resolve(dataDir)}.backup-v4-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  cpSync(dataDir, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  if (JSON.stringify(fingerprint()) !== before)
    throw new Error(
      "Data changed during backup. Stop the running app before upgrading.",
    );
  return destination;
}
