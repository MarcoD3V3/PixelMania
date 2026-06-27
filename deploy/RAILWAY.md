# Despliegue en Railway

Guía paso a paso para [Railway](https://railway.app).

## 1. Subir el proyecto

1. Entra en [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo** (conecta tu repositorio)  
   o **Empty project** → **Deploy from GitHub** / sube con CLI
3. Railway detecta Node.js y usa `npm start` (ver `railway.toml`)

## 2. Volumen persistente (obligatorio)

Sin volumen se pierden píxeles, usuarios y sesiones al redeploy.

1. En tu servicio → pestaña **Volumes**
2. **Add Volume**
3. **Mount path:** `/app/data`
4. Guarda y redeploy

## 3. Variables de entorno

En el servicio → **Variables** → añade:

| Variable | Valor |
|----------|--------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | string aleatorio largo (ver abajo) |
| `DISCORD_CLIENT_ID` | de Discord Developer Portal |
| `DISCORD_CLIENT_SECRET` | de Discord Developer Portal |
| `TRUST_PROXY` | `1` |

**Opcional** (si no las pones, Railway puede inferir la URL):

| Variable | Valor |
|----------|--------|
| `PUBLIC_URL` | `https://tu-app.up.railway.app` (Settings → Networking → domain) |
| `DISCORD_CALLBACK_URL` | `https://tu-app.up.railway.app/auth/discord/callback` |

Generar `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `PORT` lo asigna Railway automáticamente — no hace falta definirlo.

## 4. Discord OAuth

1. [Discord Developer Portal](https://discord.com/developers/applications) → tu app → **OAuth2**
2. **Redirects** → añade exactamente:
   ```
   https://TU-DOMINIO-RAILWAY.up.railway.app/auth/discord/callback
   ```
3. Si usas dominio custom, usa ese dominio en el redirect.

## 5. Dominio público

1. Servicio → **Settings** → **Networking** → **Generate Domain**
2. Copia la URL (`*.up.railway.app`)
3. Ponla en `PUBLIC_URL` y en Discord redirect (o deja que Railway exponga `RAILWAY_PUBLIC_DOMAIN`)

## 6. Comprobar

- Abre `https://tu-app.up.railway.app`
- Health: `https://tu-app.up.railway.app/health` → `"ok": true`
- Login Discord → pinta un píxel → redeploy → el píxel debe seguir (volumen OK)

## Problemas frecuentes

| Problema | Solución |
|----------|----------|
| Login Discord falla | Redirect URL debe coincidir **exactamente** con `DISCORD_CALLBACK_URL` |
| Sesión no persiste | Volumen montado en `/app/data` |
| App no arranca | Falta `SESSION_SECRET` en variables |
| Datos borrados tras deploy | Crear volumen y montar en `/app/data` |
| Build failed: `VOLUME` not supported | Ya corregido — Railway no permite `VOLUME` en Dockerfile; usa Volumes del dashboard |
| WebSocket cae | Railway soporta WebSockets; no hace falta config extra |

## CLI (opcional)

```bash
npm i -g @railway/cli
railway login
railway link
railway up
railway variables set NODE_ENV=production
railway variables set SESSION_SECRET=tu_secreto_aqui
```
