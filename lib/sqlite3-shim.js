// ----------------------------------------------------------------
// sqlite3-API-compatible wrapper over better-sqlite3 (synchronous).
// Used as a fallback when the native sqlite3 package can't build in
// environments without network access to download node-headers.
//
// Exposes only the subset of API surface that this project needs:
//   new Database(path)            (verbose() accepted and ignored)
//   db.serialize(cb)              (cb invoked synchronously)
//   db.parallelize(cb)            (cb invoked synchronously)
//   db.run(sql, ...params, cb)
//   db.get(sql, ...params, cb)
//   db.all(sql, ...params, cb)
//   db.each(sql, ...params, eachCb, doneCb)
//   db.exec(sql, cb)
//   db.prepare(sql)  -> statement with .run/.get/.all binding
//   db.close(cb)
//   Database.verbose()  (no-op, returns Database)
// ----------------------------------------------------------------
'use strict';
const DatabaseSync = require('better-sqlite3');
const path = require('path');

function toCallback(err, val, cb) {
  if (!cb) return;
  // Always call asynchronously to preserve original semantics
  process.nextTick(() => cb(err, val));
}

function bindParams(stmt, params) {
  if (params.length === 0) return stmt;
  // sqlite3 supports either positional array or named object/named parameters with $, @, :
  // flatten: if a single array arg, use as array; if object pass as object; else spread
  if (params.length === 1 && Array.isArray(params[0])) return stmt.bind(...params[0]);
  if (params.length === 1 && params[0] && typeof params[0] === 'object') return stmt.bind(params[0]);
  return stmt.bind(...params);
}

class Statement {
  constructor(getRaw, sql) {
    this._getRaw = getRaw;
    this._raw = null;
    this._sql = sql;
    this._lastErr = null;
  }
  _ensure() {
    if (this._raw) return this._raw;
    try { this._raw = this._getRaw(); }
    catch (e) { this._lastErr = e; this._raw = null; return null; }
    return this._raw;
  }
  run(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const raw = this._ensure();
    if (!raw || this._lastErr) {
      if (cb) toCallback(this._lastErr, { lastID: 0, changes: 0 }, cb);
      return { lastID: 0, changes: 0 };
    }
    try {
      const info = bindParams(raw, args).run();
      const ctx = { lastID: info.lastInsertRowid || 0, changes: info.changes || 0 };
      toCallback(null, ctx, cb);
      return ctx;
    } catch (e) {
      if (cb) { toCallback(e, { lastID: 0, changes: 0 }, cb); return { lastID: 0, changes: 0 }; }
      return { lastID: 0, changes: 0 };
    }
  }
  get(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const raw = this._ensure();
    if (!raw || this._lastErr) {
      if (cb) toCallback(this._lastErr, null, cb);
      return undefined;
    }
    try {
      const row = bindParams(raw, args).get();
      toCallback(null, row, cb);
      return row;
    } catch (e) {
      if (cb) toCallback(e, null, cb);
      return undefined;
    }
  }
  all(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const raw = this._ensure();
    if (!raw || this._lastErr) {
      if (cb) toCallback(this._lastErr, null, cb);
      return [];
    }
    try {
      const rows = bindParams(raw, args).all();
      toCallback(null, rows, cb);
      return rows;
    } catch (e) {
      if (cb) toCallback(e, null, cb);
      return [];
    }
  }
  finalize(cb) { toCallback(null, null, cb); }
  reset() { try { this._raw && this._raw.reset(); } catch (e) {} return this; }
  get sql() { return this._sql; }
}

class Database {
  constructor(file, mode, cb) {
    if (typeof mode === 'function') { cb = mode; mode = null; }
    try {
      const options = {};
      if (file === ':memory:') options.memory = true;
      if (mode && typeof mode === 'object') {
        if (mode.readonly) options.readonly = true;
        if (mode.fileMustExist) options.fileMustExist = true;
      }
      this._db = new DatabaseSync(file, options);
      this._open = true;
      toCallback(null, this, cb);
    } catch (e) {
      this._open = false;
      toCallback(e, null, cb);
      if (!cb) throw e;
    }
  }
  serialize(cb) {
    if (typeof cb === 'function') cb();
    return this;
  }
  parallelize(cb) {
    if (typeof cb === 'function') cb();
    return this;
  }
  prepare(sql) {
    return new Statement(() => this._db.prepare(sql), sql);
  }
  _collectParams(args) {
    const out = [];
    let cb = null;
    for (const a of args) {
      if (typeof a === 'function') cb = a; else out.push(a);
    }
    return { params: out, cb };
  }
  run(sql, ...args) {
    return this.prepare(sql).run(...args);
  }
  get(sql, ...args) {
    return this.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.prepare(sql).all(...args);
  }
  each(sql, ...args) {
    const eachCb = args.length && typeof args[args.length - 2] === 'function' ? args[args.length - 2] : null;
    const doneCb = args.length && typeof args[args.length - 1] === 'function' ? args.pop() : null;
    if (eachCb === doneCb) args.pop();
    const params = args.filter(a => typeof a !== 'function');
    try {
      const rows = this.prepare(sql).all(...params);
      let n = 0;
      for (const row of rows) { if (eachCb) eachCb(null, row); n++; }
      toCallback(null, n, doneCb);
    } catch (e) {
      if (eachCb) eachCb(e, null);
      toCallback(e, null, doneCb);
    }
  }
  exec(sql, cb) {
    if (typeof cb !== 'function') { cb = null; }
    try {
      this._db.exec(sql);
      toCallback(null, this, cb);
    } catch (e) {
      toCallback(e, null, cb);
      if (!cb) throw e;
    }
  }
  close(cb) {
    try {
      if (this._open) this._db.close();
      this._open = false;
      toCallback(null, null, cb);
    } catch (e) {
      toCallback(e, null, cb);
      if (!cb) throw e;
    }
  }
  on() { return this; }
  // PRAGMA helper
  pragma(s, opts) {
    return this._db.pragma(s, opts);
  }
}

module.exports = {
  Database,
  verbose() { return module.exports; },
  OPEN_READONLY: 1,
  OPEN_READWRITE: 2,
  OPEN_CREATE: 4
};
