// jota-waba-hook: webhook da Cloud API (Meta) -> JOTA_ORIGIN/api/omni/waba.
//
// Seguranca (auditoria 11/11/2026):
// - POST so e encaminhado com X-Hub-Signature-256 valido (HMAC-SHA256 do corpo cru com WABA_APP_SECRET).
//   Sem WABA_APP_SECRET configurado: nada e encaminhado (fail-closed).
// - Verify token so vem da env WABA_VERIFY_TOKEN (sem valor embutido no codigo).
// - Rotas de cadastro do time (/cadastro, /form, /api/cadastro-time) removidas: o formulario mudou
//   para o JOTA em 30/09 e o repo de cadastro agora e privado. Respondem 410.
// - Sem CORS: nenhuma rota e chamada por navegador.

const JOTA_DEFAULT = "https://jota.grupojet.com.br";
// Prazo das chamadas ao destino: destino lento nao segura a resposta a Meta.
const FORWARD_TIMEOUT_MS = 10000;
const enc = new TextEncoder();

function text(body, status, extra) {
  return new Response(body, { status: status, headers: { "Content-Type": "text/plain; charset=utf-8", ...(extra || {}) } });
}

function hex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

export async function validSignature(secret, rawBody, header) {
  if (!secret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || "").trim());
  if (!m) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, rawBody);
  return safeEqual(hex(mac), m[1].toLowerCase());
}

async function forwardJota(env, rawBody, signature) {
  const jota = ((env && env.JOTA_ORIGIN) || JOTA_DEFAULT).replace(/\/+$/, "");
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "jota-waba-hook",
    // Repassa a assinatura original: o destino pode revalidar sobre o mesmo corpo cru.
    "X-Hub-Signature-256": signature,
  };
  if (env && env.JOTA_INGEST_TOKEN) headers["X-Jota-Ingest"] = env.JOTA_INGEST_TOKEN;
  try {
    const r = await fetch(jota + "/api/omni/waba", { method: "POST", headers: headers, body: rawBody, signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS) });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const jota = (env && env.JOTA_ORIGIN) || JOTA_DEFAULT;

    if (path === "/cadastro" || path === "/form" || path === "/api/cadastro-time") {
      return text("gone", 410);
    }

    if (path === "/healthz" && request.method === "GET") {
      try {
        const r = await fetch(jota.replace(/\/+$/, "") + "/healthz", { method: "GET", signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS) });
        return text(r.ok ? "ok" : "jota " + r.status, r.ok ? 200 : 502);
      } catch (e) {
        return text("jota down", 502);
      }
    }

    const isHook = path === "/webhook/waba" || path === "/";
    if (!isHook) return text("not found", 404);

    if (request.method === "GET") {
      const want = String((env && env.WABA_VERIFY_TOKEN) || "");
      const mode = url.searchParams.get("hub.mode") || "";
      const challenge = url.searchParams.get("hub.challenge") || "";
      const given = url.searchParams.get("hub.verify_token") || "";
      if (want && mode === "subscribe" && safeEqual(given, want)) return text(challenge, 200);
      return text("forbidden", 403);
    }

    if (request.method === "POST") {
      const secret = String((env && env.WABA_APP_SECRET) || "");
      if (!secret) return text("misconfigured", 503);
      const raw = await request.arrayBuffer();
      const sig = request.headers.get("x-hub-signature-256") || "";
      if (!(await validSignature(secret, raw, sig))) return text("invalid signature", 401);
      const fwd = await forwardJota(env, raw, sig);
      // Falha transitoria ou corrigivel = 502: a Meta reenvia. O destino deduplica por evento.
      // Inclui 5xx, rede, prazo, 408/429 (podem vir da borda na frente do tunel) e 401/403
      // (token divergente entre worker e destino: responder 200 perderia TODOS os eventos em silencio).
      const st = fwd.status;
      if (st === 0 || st >= 500 || st === 401 || st === 403 || st === 408 || st === 429) {
        if (st === 401 || st === 403) console.error("jota-waba-hook: destino recusou a credencial, status " + st);
        return text("forward failed", 502, { "X-Jota-Forward": "fail" });
      }
      // Demais 4xx = recusa permanente do corpo: reenviar nao resolve; 200 + log (so o status, sem corpo).
      if (!fwd.ok) {
        console.error("jota-waba-hook: destino recusou o evento, status " + fwd.status);
        return text("EVENT_RECEIVED", 200, { "X-Jota-Forward": "rejected" });
      }
      return text("EVENT_RECEIVED", 200, { "X-Jota-Forward": "ok" });
    }

    return text("method", 405);
  },
};
