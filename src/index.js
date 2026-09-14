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

function slug(s) {
  return String(s || "foto")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "foto";
}

async function saveFoto(env, payload) {
  const raw = payload.fotoDataUrl || "";
  const m = String(raw).match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const token = env && env.GITHUB_TOKEN;
  const ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
  const path = "fotos/" + Date.now() + "-" + slug(payload.nome) + "." + ext;
  const r = await fetch("https://api.github.com/repos/" + GH_REPO + "/contents/" + path, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "jota-waba-hook",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "foto cadastro " + (payload.nome || ""),
      content: m[2],
    }),
  });
  const j = await r.json();
  if (!r.ok) return { error: j.message || String(r.status) };
  const url = (j.content && j.content.download_url) || ("https://raw.githubusercontent.com/" + GH_REPO + "/main/" + path);
  return { path: path, url: url };
}

async function saveIssue(env, payload, foto) {
  const token = env && env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: "sem GITHUB_TOKEN" };
  const slim = Object.assign({}, payload);
  delete slim.fotoDataUrl;
  slim.foto = foto && foto.url ? foto.url : !!payload.foto;
  const title =
    "[cadastro-time] " +
    (payload.nome || "sem nome") +
    " \u2014 " +
    (payload.papel_label || payload.papel || "");
  let body =
    "## Cadastro do time (ops interno)\n\n```json\n" +
    JSON.stringify(
      { type: "cadastro-time", source: "cloudflare-worker", payload: slim, sentAt: new Date().toISOString() },
      null,
      2
    ) +
    "\n```\n";
  if (foto && foto.url) body += "\n![foto](" + foto.url + ")\n";
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
  return { ok: true, number: j.number, foto: foto && foto.url };
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
      let foto = null;
      try {
        foto = await saveFoto(env, payload);
      } catch (e) {
        foto = { error: String(e) };
      }
      const saved = await saveIssue(env, payload, foto && foto.url ? foto : null);
      if (!saved.ok) return json({ ok: false, received: true, saved: false, error: saved.error, detail: saved.detail }, 502);
      return json({ ok: true, received: true, saved: true, number: saved.number, foto: saved.foto || null }, 200);
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
        return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      return new Response("forbidden", { status: 403 });
    }
    if (request.method === "POST") return new Response("EVENT_RECEIVED", { status: 200 });
    return new Response("method", { status: 405 });
  },
};
