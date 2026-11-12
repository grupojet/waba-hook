// node --test test/   (Node >= 20; sem rede: fetch e mockado)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker, { validSignature } from "../src/index.js";

const SECRET = "app-secret-de-teste";
const VERIFY = "verify-de-teste";
const ENV = { WABA_APP_SECRET: SECRET, WABA_VERIFY_TOKEN: VERIFY, JOTA_ORIGIN: "https://jota.invalid", JOTA_INGEST_TOKEN: "ingest-de-teste" };
const BODY = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [] }] });
const sign = (body, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response("ok", { status: 200 });
  };
});

const post = (body, headers = {}, path = "/webhook/waba") =>
  new Request("https://hook.invalid" + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

test("assinatura valida encaminha corpo cru e repassa a assinatura", async () => {
  const r = await worker.fetch(post(BODY, { "x-hub-signature-256": sign(BODY) }), ENV);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "EVENT_RECEIVED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://jota.invalid/api/omni/waba");
  assert.equal(new TextDecoder().decode(calls[0].init.body), BODY);
  assert.equal(calls[0].init.headers["X-Hub-Signature-256"], sign(BODY));
  assert.equal(calls[0].init.headers["X-Jota-Ingest"], "ingest-de-teste");
});

test("sem assinatura, assinatura errada, outro segredo ou corpo alterado = 401 e nada encaminhado", async () => {
  for (const h of [{}, { "x-hub-signature-256": "sha256=" + "0".repeat(64) }, { "x-hub-signature-256": sign(BODY, "outro") }, { "x-hub-signature-256": sign(BODY + " ") }, { "x-hub-signature-256": "sha1=abc" }]) {
    const r = await worker.fetch(post(BODY, h), ENV);
    assert.equal(r.status, 401, JSON.stringify(h));
  }
  assert.equal(calls.length, 0);
});

test("sem WABA_APP_SECRET nao encaminha (fail-closed)", async () => {
  const r = await worker.fetch(post(BODY, { "x-hub-signature-256": sign(BODY) }), { ...ENV, WABA_APP_SECRET: "" });
  assert.equal(r.status, 503);
  assert.equal(calls.length, 0);
});

test("destino fora do ar = 502 para a Meta reenviar", async () => {
  globalThis.fetch = async () => new Response("x", { status: 503 });
  const r = await worker.fetch(post(BODY, { "x-hub-signature-256": sign(BODY) }), ENV);
  assert.equal(r.status, 502);
});

test("verify GET: so com token da env; sem env sempre 403", async () => {
  const q = (t) => new Request(`https://hook.invalid/webhook/waba?hub.mode=subscribe&hub.challenge=123&hub.verify_token=${t}`);
  let r = await worker.fetch(q(VERIFY), ENV);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "123");
  r = await worker.fetch(q("errado"), ENV);
  assert.equal(r.status, 403);
  r = await worker.fetch(q(""), { ...ENV, WABA_VERIFY_TOKEN: "" });
  assert.equal(r.status, 403, "sem env nao ha token padrao");
  r = await worker.fetch(q("qualquer-valor"), { ...ENV, WABA_VERIFY_TOKEN: "" });
  assert.equal(r.status, 403, "sem env nao ha token padrao");
});

test("rotas de cadastro removidas (410) e sem CORS", async () => {
  for (const [m, p] of [["GET", "/api/cadastro-time"], ["POST", "/api/cadastro-time"], ["GET", "/cadastro"], ["GET", "/form"], ["OPTIONS", "/api/cadastro-time"]]) {
    const r = await worker.fetch(new Request("https://hook.invalid" + p, { method: m, body: m === "POST" ? "{}" : undefined }), ENV);
    assert.equal(r.status, 410, m + " " + p);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
  assert.equal(calls.length, 0, "nao toca GitHub");
});

test("validSignature direto", async () => {
  const raw = new TextEncoder().encode(BODY);
  assert.equal(await validSignature(SECRET, raw, sign(BODY)), true);
  assert.equal(await validSignature("", raw, sign(BODY)), false);
});
