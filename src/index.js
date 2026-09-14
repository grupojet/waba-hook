const FALLBACK_VERIFY = "grupojet-jota-0800";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
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
