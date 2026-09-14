const FALLBACK_VERIFY = "grupojet-jota-0800";
const JOTA_DEFAULT = "https://jota.grupojet.com.br";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
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
      const fwd = {
        type: "cadastro-time",
        source: "cloudflare-worker",
        payload: payload,
        sentAt: new Date().toISOString(),
      };
      let jotaOk = false;
      try {
        const r = await fetch(jota.replace(/\/+$/, "") + "/api/v1/cadastro-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fwd),
        });
        jotaOk = r.ok;
      } catch (e) {
        jotaOk = false;
      }
      return json({ ok: true, jota: jotaOk, received: true }, 200);
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors() },
  });
}
