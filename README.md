# PixelMania

Lienzo colaborativo en tiempo real con Discord OAuth, territorios, misiones, tienda y progreso tycoon.

## Características

- Lienzo infinito con sincronización en vivo (WebSockets)
- Login con Discord · economía de monedas · misiones · tienda (470+ artículos)
- Territorios reclamables · asedios · cuota de píxeles por jugador
- Colores comprables · mejoras individuales por cuenta

## Desarrollo local

```bash
npm install
cp .env.example .env
# Edita .env con Discord OAuth (localhost)
npm start
```

Abre **http://localhost:3000**

### Discord OAuth (local)

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **OAuth2** → redirect: `http://localhost:3000/auth/discord/callback`
3. Copia Client ID y Secret a `.env`

Generar `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Producción

### Checklist antes de subir

- [ ] `NODE_ENV=production` en `.env`
- [ ] `PUBLIC_URL=https://tu-dominio.com` (HTTPS, sin `/` final)
- [ ] `SESSION_SECRET` aleatorio (obligatorio — el servidor no arranca sin él)
- [ ] `DISCORD_CALLBACK_URL=https://tu-dominio.com/auth/discord/callback` registrado en Discord
- [ ] Carpeta `data/` persistente (usuarios, píxeles, sesiones)
- [ ] Proxy con HTTPS delante del Node (Nginx, Caddy, Cloudflare)

### Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `NODE_ENV` | `production` en servidor |
| `PORT` | Puerto interno (3000 o el del hosting) |
| `PUBLIC_URL` | URL pública HTTPS |
| `DISCORD_CLIENT_ID` | OAuth Discord |
| `DISCORD_CLIENT_SECRET` | OAuth Discord |
| `DISCORD_CALLBACK_URL` | `{PUBLIC_URL}/auth/discord/callback` |
| `SESSION_SECRET` | Secreto de sesión (48+ bytes hex) |
| `TRUST_PROXY` | `1` detrás de Nginx/Cloudflare |

### Health check

```
GET /health
→ { "ok": true, "env": "production", "uptime": 123, ... }
```

### Docker

```bash
cp .env.example .env
# Edita .env

docker compose up -d --build
```

Los datos persisten en el volumen `pixelmania_data`.

### PM2 (VPS)

```bash
npm ci --omit=dev
cp .env.example .env
# Edita .env

npm run check
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

### Nginx

Ver `deploy/nginx.example.conf` — incluye WebSocket para Socket.io.

### Hosting recomendado

- **VPS** (Hetzner, DigitalOcean, etc.) + PM2 + Nginx + Let's Encrypt
- **Docker** en cualquier servidor con volumen para `/app/data`
- **Railway / Render**: define variables de env y **disco persistente** en `data/`

> **Importante:** Sin volumen persistente, al reiniciar se pierden píxeles, usuarios y sesiones.

## Estructura de datos

```
data/
  pixels.json      # mapa
  users.json         # cuentas, monedas, compras
  territories.json   # zonas reclamadas
  sessions/          # sesiones OAuth
```

Estos archivos están en `.gitignore` — no los subas a Git.

## Scripts

| Comando | Uso |
|---------|-----|
| `npm start` | Arranca el servidor |
| `npm run check` | Verifica sintaxis JS |
| `npm run start:prod` | Check + arranque |

## Licencia

Uso del proyecto según tus términos.
# PixelMania
