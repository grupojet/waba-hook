const FALLBACK_VERIFY = "grupojet-jota-0800";
const JOTA_DEFAULT = "https://jota.grupojet.com.br";
const GH_REPO = "grupojet/cadastro-time";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors() },
  });
}

async function saveIssue(env, payload) {
  const token = env && env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: "sem GITHUB_TOKEN" };
  const title =
    "[cadastro-time] " +
    (payload.nome || "sem nome") +
    " \u2014 " +
    (payload.papel_label || payload.papel || "");
  const body =
    "## Cadastro do time (ops interno)\n\n```json\n" +
    JSON.stringify(
      { type: "cadastro-time", source: "cloudflare-worker", payload: payload, sentAt: new Date().toISOString() },
      null,
      2
    ) +
    "\n```\n";
  const r = await fetch("https://api.github.com/repos/" + GH_REPO + "/issues", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "jota-waba-hook",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: title, body: body }),
  });
  const t = await r.text();
  let j = {};
  try {
    j = JSON.parse(t);
  } catch (e) {}
  if (!r.ok) return { ok: false, error: "github " + r.status, detail: j.message || t.slice(0, 180) };
  return { ok: true, number: j.number, url: j.html_url };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const jota = (env && env.JOTA_ORIGIN) || JOTA_DEFAULT;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    if (path === "/api/cadastro-time" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: "json" }, 400);
      }
      const payload = body.payload || body;
      if (!payload.nome || !payload.whatsapp || !payload.papel) {
        return json({ ok: false, error: "campos" }, 400);
      }
      const saved = await saveIssue(env, payload);
      if (!saved.ok) return json({ ok: false, received: true, saved: false, error: saved.error, detail: saved.detail }, 502);
      return json({ ok: true, received: true, saved: true, number: saved.number }, 200);
    }

    if (path === "/api/cadastro-time" && request.method === "GET") {
      const token = env && env.GITHUB_TOKEN;
      if (!token) return json({ ok: false, error: "sem GITHUB_TOKEN" }, 502);
      const r = await fetch("https://api.github.com/repos/" + GH_REPO + "/issues?state=open&per_page=50", {
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "User-Agent": "jota-waba-hook",
        },
      });
      const issues = await r.json();
      const list = Array.isArray(issues)
        ? issues
            .filter(function (i) {
              return String(i.title || "").indexOf("[cadastro-time]") === 0;
            })
            .map(function (i) {
              return { number: i.number, title: i.title, created_at: i.created_at };
            })
        : [];
      return json({ ok: true, count: list.length, items: list }, 200);
    }

    if (path === "/healthz") {
      try {
        const r = await fetch(jota.replace(/\/+$/, "") + "/healthz", { method: "GET" });
        const t = await r.text();
        return new Response(t, {
          status: r.status,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...cors() },
        });
      } catch (e) {
        return new Response("jota down", { status: 502, headers: cors() });
      }
    }

    const isHook = path === "/webhook/waba" || path === "/";
    if (!isHook) return new Response("not found", { status: 404 });

    const token = (env && env.WABA_VERIFY_TOKEN) || FALLBACK_VERIFY;

    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode") || "";
      const challenge = url.searchParams.get("hub.challenge") || "";
      const given = url.searchParams.get("hub.verify_token") || "";
      if (mode === "subscribe" && given === token) {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return new Response("forbidden", { status: 403 });
    }

    if (request.method === "POST") {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    return new Response("method", { status: 405 });
  },
};
