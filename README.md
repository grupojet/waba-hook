# jota-waba-hook

Webhook da Cloud API do 0800 Jota. Cérebro não entra nesta rota.

## Meta

- Callback: `https://portal.grupojet.com.br/webhook/waba` (canônico, portal ponto)
- Verify token: `grupojet-jota-0800` (ou `WABA_VERIFY_TOKEN` no host)
- Campo: `messages`

Enquanto o túnel do portal estiver 530, publica este worker:

```bash
npx wrangler deploy
```

Cola a URL `*.workers.dev/webhook/waba` na Meta. Quando o portal voltar, troca de volta para o canônico.
