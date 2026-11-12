# jota-waba-hook

Webhook da Cloud API do 0800 Jota (Cloudflare Worker). Cérebro não entra nesta rota.
MCP das tools Meta: `grupojet/jota-meta-mcp`.

## Meta

- Callback: `https://portal.grupojet.com.br/webhook/waba` (canônico) ou `jota.grupojet.com.br/webhook/waba`
- Campo: `messages`

## Segurança

- `POST` só é encaminhado com `X-Hub-Signature-256` válido (HMAC-SHA256 do corpo cru com o App Secret).
  Sem `WABA_APP_SECRET` o worker responde 503 e não encaminha nada.
- `GET` de verificação só aceita `WABA_VERIFY_TOKEN` da env (não há valor padrão no código).
- O corpo cru e a assinatura original seguem para `JOTA_ORIGIN/api/omni/waba`, que pode revalidar.
- Destino com 5xx, falha de rede ou prazo (10 s) responde 502 para a Meta reenviar (o destino deduplica por evento).
  Destino com 4xx (recusa permanente) responde 200 e registra só o status em log, para a Meta não reenviar por dias.
- Autenticação com o destino: header `X-Jota-Ingest` (= `JOTA_INGEST_TOKEN`), o que o `jota-waba-ingest` exige.
- Rotas de cadastro do time foram removidas (410).

Secrets do worker (`npx wrangler secret put <NOME>`): `WABA_APP_SECRET`, `WABA_VERIFY_TOKEN`,
`JOTA_INGEST_TOKEN` (opcional). `GITHUB_TOKEN` não é mais usado: apagar com `npx wrangler secret delete GITHUB_TOKEN`.

## Teste

```bash
node --test test/index.test.mjs
```
