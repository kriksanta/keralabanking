import { DurableObject } from "cloudflare:workers";

const ACTIVE_WINDOW_MS = 90_000;
const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const path = new URL(request.url).pathname;
    if (!new Set(["/api/login", "/api/heartbeat", "/api/logout"]).has(path)) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const id = env.LOGIN_COUNTER.idFromName("bfil-shared-login-counter");
    const response = await env.LOGIN_COUNTER.get(id).fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};

export class LoginCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS login_totals (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO login_totals (id, total) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS login_sessions (
        session_id TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL
      );
    `);
  }

  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const path = new URL(request.url).pathname;
    const now = Date.now();
    this.sql.exec("DELETE FROM login_sessions WHERE last_seen < ?", now - SESSION_RETENTION_MS);

    if (path === "/api/login") {
      const expectedUser = (this.env.CASH_TOOLS_USERNAME || "").trim().toUpperCase();
      const expectedPassword = this.env.CASH_TOOLS_PASSWORD || "";
      const username = String(body.username || "").trim().toUpperCase();
      const password = String(body.password || "");
      if (!expectedUser || !expectedPassword) return json({ error: "Login service is not configured" }, 503);
      if (username !== expectedUser || password !== expectedPassword) return json({ error: "Invalid credentials" }, 401);
      const sessionId = crypto.randomUUID();
      this.sql.exec("INSERT INTO login_sessions (session_id, last_seen) VALUES (?, ?)", sessionId, now);
      this.sql.exec("UPDATE login_totals SET total = total + 1 WHERE id = 1");
      return json({ sessionId, ...this.counts(now) });
    }

    const sessionId = String(body.sessionId || "");
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ error: "Invalid session" }, 401);
    const known = this.sql.exec("SELECT session_id FROM login_sessions WHERE session_id = ?", sessionId).toArray().length > 0;
    if (path === "/api/logout") {
      this.sql.exec("DELETE FROM login_sessions WHERE session_id = ?", sessionId);
      return json(this.counts(now));
    }
    if (path !== "/api/heartbeat") return json({ error: "Not found" }, 404);
    if (!known) return json({ error: "Session expired" }, 401);
    this.sql.exec("UPDATE login_sessions SET last_seen = ? WHERE session_id = ?", now, sessionId);
    return json(this.counts(now));
  }

  counts(now) {
    const totalLogins = this.sql.exec("SELECT total FROM login_totals WHERE id = 1").one().total;
    const activeCount = this.sql.exec("SELECT COUNT(*) AS count FROM login_sessions WHERE last_seen >= ?", now - ACTIVE_WINDOW_MS).one().count;
    return { activeCount, totalLogins };
  }
}
