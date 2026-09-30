# jota-waba-hook

Webhook da Cloud API do 0800 Jota. Cérebro não entra nesta rota.
MCP das tools Meta: `grupojet/jota-meta-mcp`.

## Meta

- Callback: `https://portal.grupojet.com.br/webhook/waba` (canônico, portal ponto)
- Verify token: `grupojet-jota-0800` (ou `WABA_VERIFY_TOKEN` no host)
- Campo: `messages`

POST da Meta responde `EVENT_RECEIVED` e encaminha o JSON para
`JOTA_ORIGIN/api/omni/waba` (default `https://jota.grupojet.com.br`).

Enquanto o túnel do portal estiver 530, publica este worker:

```bash
npx wrangler deploy
```

Cola a URL `*.workers.dev/webhook/waba` na Meta. Quando o portal voltar, troca de volta para o canônico.
