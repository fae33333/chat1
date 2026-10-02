#!/usr/bin/env bash
# تشغيل سيرفر التطبيق في بيئات بلا بناء أصلي (بدون الوصول لترويسات node):
#  - npm install --ignore-scripts
#  - بديل better-sqlite3 فوق وحدة node:sqlite المدمجة
# الاستخدام: bash tools/run-local.sh   (المنفذ الافتراضي 3000)
set -u
cd "$(dirname "$0")/.."

if [ ! -d node_modules/express ]; then
  echo "[run-local] installing dependencies…"
  npm install --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 || npm install --ignore-scripts --no-audit --no-fund
fi

if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  echo "[run-local] building better-sqlite3 shim over node:sqlite…"
  mkdir -p node_modules/better-sqlite3
  cat > node_modules/better-sqlite3/package.json <<'JSON'
{ "name": "better-sqlite3", "version": "13.0.3-shim", "main": "index.js", "private": true }
JSON
  cat > node_modules/better-sqlite3/index.js <<'JS'
'use strict';
const { DatabaseSync } = require('node:sqlite');
function conv(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  return v;
}
function normArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
      && !(args[0] instanceof Date) && !(args[0] instanceof Uint8Array)) {
    const out = {};
    for (const k of Object.keys(args[0])) out[k] = conv(args[0][k]);
    return [out];
  }
  if (args.length === 1 && Array.isArray(args[0])) return args[0].map(conv);
  return args.map(conv);
}
class Statement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._cached = null; }
  _raw() { if (!this._cached) this._cached = this._db.prepare(this._sql); return this._cached; }
  run(...args) { const i = this._raw().run(...normArgs(args)); return { changes: Number(i.changes || 0), lastInsertRowid: Number(i.lastInsertRowid || 0) }; }
  get(...args) { return this._raw().get(...normArgs(args)); }
  all(...args) { return this._raw().all(...normArgs(args)); }
  iterate(...args) { return this._raw().iterate(...normArgs(args)); }
  pluck() { return this; } raw() { return this; } bind() { return this; }
}
class Database {
  constructor(file, opts) {
    this._db = new DatabaseSync(file || ':memory:', opts || {});
    try { this._db.exec('PRAGMA journal_mode = WAL'); } catch (e) { }
  }
  prepare(sql) { return new Statement(this._db, sql); }
  exec(sql) { return this._db.exec(sql); }
  pragma(str) {
    const s = String(str || '');
    if (s.includes('=')) { try { this._db.exec('PRAGMA ' + s); } catch (e) { } return undefined; }
    try { return this._db.prepare('PRAGMA ' + s).all(); } catch (e) { return []; }
  }
  transaction(fn) {
    const self = this;
    return function (...args) {
      self._db.exec('BEGIN');
      try { const r = fn.apply(this, args); self._db.exec('COMMIT'); return r; }
      catch (e) { try { self._db.exec('ROLLBACK'); } catch (e2) { } throw e; }
    };
  }
  close() { try { return this._db.close(); } catch (e) { } }
  serialize(cb) { if (typeof cb === 'function') cb(); }
  parallelize(cb) { if (typeof cb === 'function') cb(); }
}
module.exports = Database;
module.exports.default = Database;
JS
fi

export PORT="${PORT:-3000}"
export BEHIND_NGINX="${BEHIND_NGINX:-1}"
echo "[run-local] starting on 0.0.0.0:$PORT"
exec node server.js
