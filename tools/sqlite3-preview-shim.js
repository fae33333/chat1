/* ============================================================================
   SoulChill — optional DEV shim: run the server without building `sqlite3`.

   Some sandboxes / shared hosts cannot compile the native `sqlite3` module
   (no build toolchain, or GitHub releases are blocked). Node 22 ships a
   built-in SQLite engine (`node:sqlite`), so this shim maps the small subset
   of the `sqlite3` callback API that this project uses (`run/get/all/close`)
   onto `node:sqlite`. The database file stays the same `soulchill.sqlite`.

   Usage (development only):
       node -r ./tools/sqlite3-preview-shim.js server.js

   Nothing else in the project changes, and if the real `sqlite3` package is
   installed and builds fine you can simply run `node server.js` as usual.
============================================================================ */
'use strict';

const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

function normalizeParams(params) {
  if (params === undefined || params === null) return [];
  if (!Array.isArray(params)) return [params];
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

class Statement {
  constructor(statement) {
    this.statement = statement;
  }
}

class Database {
  constructor(filename, callback) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL;');
    if (typeof callback === 'function') setTimeout(() => callback(null), 0);
  }

  run(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const statement = this.db.prepare(sql);
      const info = statement.run(...normalizeParams(params));
      if (typeof callback === 'function') {
        const context = { lastID: Number(info.lastInsertRowid || 0), changes: Number(info.changes || 0) };
        setTimeout(() => callback.call(context, null), 0);
      }
      return this;
    } catch (err) {
      if (typeof callback === 'function') return void setTimeout(() => callback(err), 0);
      throw err;
    }
  }

  get(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const row = this.db.prepare(sql).get(...normalizeParams(params));
      if (typeof callback === 'function') setTimeout(() => callback(null, row === undefined ? undefined : row), 0);
      return this;
    } catch (err) {
      if (typeof callback === 'function') return void setTimeout(() => callback(err), 0);
      throw err;
    }
  }

  all(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const rows = this.db.prepare(sql).all(...normalizeParams(params));
      if (typeof callback === 'function') setTimeout(() => callback(null, rows), 0);
      return this;
    } catch (err) {
      if (typeof callback === 'function') return void setTimeout(() => callback(err), 0);
      throw err;
    }
  }

  exec(sql, callback) {
    try {
      this.db.exec(sql);
      if (typeof callback === 'function') setTimeout(() => callback(null), 0);
      return this;
    } catch (err) {
      if (typeof callback === 'function') return void setTimeout(() => callback(err), 0);
      throw err;
    }
  }

  serialize(callback) {
    if (typeof callback === 'function') callback();
    return this;
  }

  parallelize(callback) {
    if (typeof callback === 'function') callback();
    return this;
  }

  close(callback) {
    try {
      this.db.close();
      if (typeof callback === 'function') setTimeout(() => callback(null), 0);
    } catch (err) {
      if (typeof callback === 'function') setTimeout(() => callback(err), 0);
    }
    return this;
  }
}

const sqlite3 = {
  Database,
  Statement,
  OPEN_READWRITE: 2,
  OPEN_CREATE: 4,
  verbose() {
    return sqlite3;
  }
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'sqlite3') return sqlite3;
  return originalLoad.call(this, request, parent, isMain);
};

console.log('[ROOM V2 preview] sqlite3 → node:sqlite shim active (dev only)');
