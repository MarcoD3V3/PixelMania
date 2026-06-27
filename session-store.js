/** Session store en JSON (writeFile directo — evita EPERM de rename en Windows). */
const fs = require('fs');
const path = require('path');
const session = require('express-session');

class JsonFileSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.dir = options.dir || path.join(__dirname, 'data', 'sessions');
    this.ttlMs = (options.ttl || 90 * 24 * 60 * 60) * 1000;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  filePath(sid) {
    const safe = String(sid).replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  get(sid, cb) {
    const file = this.filePath(sid);
    fs.readFile(file, 'utf8', (err, raw) => {
      if (err) return cb(null);
      try {
        const wrap = JSON.parse(raw);
        if (wrap.expires && wrap.expires < Date.now()) {
          fs.unlink(file, () => {});
          return cb(null);
        }
        cb(null, wrap.session);
      } catch {
        cb(null);
      }
    });
  }

  set(sid, sess, cb) {
    const file = this.filePath(sid);
    const maxAge = sess?.cookie?.maxAge;
    const expires = maxAge ? Date.now() + maxAge : Date.now() + this.ttlMs;
    const payload = JSON.stringify({ expires, session: sess });
    fs.writeFile(file, payload, 'utf8', (err) => cb(err));
  }

  destroy(sid, cb) {
    fs.unlink(this.filePath(sid), () => cb(null));
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = { JsonFileSessionStore };
