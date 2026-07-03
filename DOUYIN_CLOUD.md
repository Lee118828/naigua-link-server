# Douyin Cloud Deployment Notes

Use this service as the temporary room server for the Naigua 2-4 player test.

## Service

- Runtime: Node.js 18 or newer
- Start command: `npm start`
- Port: `8000`
- Health check path: `/health`
- WebSocket path: `/ws`
- HTTP test path: `/example`

## Client URL

After Douyin Cloud gives the service a public HTTPS domain, set the game client to:

```js
const ONLINE_WS_URL = "wss://YOUR_DOUYIN_CLOUD_DOMAIN/ws";
```

Then rebuild/preview in Douyin DevTools.

## Smoke Test

Open:

```text
https://YOUR_DOUYIN_CLOUD_DOMAIN/health
```

Expected shape:

```json
{
  "ok": true,
  "version": "douyin-cloud-ready-v2",
  "tickMs": 33
}
```

## Notes

- Keep the server alive before inviting friends; cold starts can make the first connection feel slow.
- The mini-game must use `wss://`, not `ws://`, outside local development.
- If Douyin requires a legal domain list, add the cloud service domain under the mini-game networking/domain configuration.
