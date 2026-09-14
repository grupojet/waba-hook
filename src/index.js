const FALLBACK_VERIFY = "grupojet-jota-0800";
const JOTA_DEFAULT = "https://jota.grupojet.com.br";
const GH_REPO = "grupojet/cadastro-time";
const FORM_SRC = "https://raw.githubusercontent.com/grupojet/cadastro-time/main/form.html";

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
  return String(s || "pessoa")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "pessoa";
}

function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

function personDir(payload) {
  const n = slug(payload.nome);
  const wa = digits(payload.whatsapp).slice(-4);
  return "pessoas/" + n + (wa ? "-" + wa : "");
}

function ghHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "jota-waba-hook",
    "Content-Type": "application/json",
  };
}

async function putFile(token, path, message, contentB64) {
  const get = await fetch("https://api.github.com/repos/" + GH_REPO + "/contents/" + path, {
    headers: ghHeaders(token),
  });
  let sha;
  if (get.ok) {
    const j = await get.json();
    sha = j.sha;
  }
  const r = await fetch("https://api.github.com/repos/" + GH_REPO + "/contents/" + path, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify({ message: message, content: contentB64, sha: sha }),
  });
  const j = await r.json();
  if (!r.ok) return { ok: false, error: j.message || String(r.status), path: path };
  const url = (j.content && j.content.download_url) || ("https://raw.githubusercontent.com/" + GH_REPO + "/main/" + path);
  return { ok: true, path: path, url: url, sha: j.content && j.content.sha };
}

function utf8B64(s) {
  return btoa(unescape(encodeURIComponent(s)));
}

async function savePasta(env, payload) {
  const token = env && env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: "sem GITHUB_TOKEN" };
  const dir = personDir(payload);
  const slim = Object.assign({}, payload);
  delete slim.fotoDataUrl;
  slim.foto = Boolean(payload.fotoDataUrl);
  slim.pasta = dir;
  slim.updatedAt = new Date().toISOString();
  const ficha = await putFile(token, dir + "/ficha.json", "ficha " + dir, utf8B64(JSON.stringify(slim, null, 2)));
  if (!ficha.ok) return { ok: false, error: ficha.error, pasta: dir };
  let foto = null;
  const raw = payload.fotoDataUrl || "";
  const m = String(raw).match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (m) {
    const ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
    foto = await putFile(token, dir + "/foto." + ext, "foto " + dir, m[2]);
  }
  return {
    ok: true,
    pasta: dir,
    ficha: ficha.url,
    foto: foto && foto.ok ? foto.url : null,
    fotoError: foto && !foto.ok ? foto.error : null,
  };
}

async function saveIssue(env, payload, pasta) {
  const token = env && env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: "sem GITHUB_TOKEN" };
  const slim = Object.assign({}, payload);
  delete slim.fotoDataUrl;
  slim.foto = pasta && pasta.foto ? pasta.foto : !!payload.foto;
  slim.pasta = pasta && pasta.pasta;
  const title =
    "[cadastro-time] " +
    (payload.nome || "sem nome") +
    " \u2014 " +
    (payload.papel_label || payload.papel || "");
  let body =
    "## Cadastro do time (ops interno)\n\nPasta: `" +
    (slim.pasta || "-") +
    "`\n\n```json\n" +
    JSON.stringify(
      { type: "cadastro-time", source: "cloudflare-worker", payload: slim, sentAt: new Date().toISOString() },
      null,
      2
    ) +
    "\n```\n";
  if (pasta && pasta.foto) body += "\n![foto](" + pasta.foto + ")\n";
  const r = await fetch("https://api.github.com/repos/" + GH_REPO + "/issues", {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ title: title, body: body }),
  });
  const t = await r.text();
  let j = {};
  try {
    j = JSON.parse(t);
  } catch (e) {}
  if (!r.ok) return { ok: false, error: "github " + r.status, detail: j.message || t.slice(0, 180) };
  return { ok: true, number: j.number, foto: pasta && pasta.foto, pasta: pasta && pasta.pasta };
}

async function listCadastros(env) {
  const token = env && env.GITHUB_TOKEN;
  const r = await fetch("https://api.github.com/repos/" + GH_REPO + "/contents/pessoas", {
    headers: ghHeaders(token),
  });
  const arr = await r.json();
  if (!Array.isArray(arr)) {
    const ir = await fetch("https://api.github.com/repos/" + GH_REPO + "/issues?state=open&per_page=50", {
      headers: ghHeaders(token),
    });
    const issues = await ir.json();
    if (!Array.isArray(issues)) return { ok: false, error: "github list" };
    const items = issues
      .filter((i) => String(i.title || "").indexOf("[cadastro-time]") === 0)
      .map((i) => ({ number: i.number, title: i.title, created_at: i.created_at, url: i.html_url }));
    return { ok: true, count: items.length, items: items };
  }
  const items = arr
    .filter((x) => x.type === "dir")
    .map((x) => ({ pasta: x.path, url: x.html_url }));
  return { ok: true, count: items.length, items: items };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const jota = (env && env.JOTA_ORIGIN) || JOTA_DEFAULT;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    if ((path === "/cadastro" || path === "/form") && request.method === "GET") {
      const r = await fetch(FORM_SRC, { headers: { "User-Agent": "jota-waba-hook" } });
      const html = await r.text();
      return new Response(html, {
        status: r.ok ? 200 : 502,
        headers: { "Content-Type": "text/html; charset=utf-8", ...cors() },
      });
    }

    if (path === "/api/cadastro-time" && request.method === "GET") {
      return json(await listCadastros(env), 200);
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
      const pasta = await savePasta(env, payload);
      if (!pasta.ok) return json({ ok: false, received: true, saved: false, error: pasta.error }, 502);
      const saved = await saveIssue(env, payload, pasta);
      if (!saved.ok) {
        return json({
          ok: true,
          received: true,
          saved: true,
          pasta: pasta.pasta,
          foto: pasta.foto,
          issueError: saved.error,
        }, 200);
      }
      return json({
        ok: true,
        received: true,
        saved: true,
        number: saved.number,
        pasta: pasta.pasta,
        foto: pasta.foto,
      }, 200);
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
