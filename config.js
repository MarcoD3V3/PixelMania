/** Configuración central — desarrollo y producción */
require('dotenv').config();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const DEV_SESSION_SECRET = 'pixelmania-dev-secret-change-me';

function resolvePublicUrl() {
  if (PUBLIC_URL) return PUBLIC_URL;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) {
    const host = railway.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${host}`;
  }
  return `http://localhost:${PORT}`;
}

function validateProductionConfig() {
  const errors = [];
  const warnings = [];
  const publicUrl = resolvePublicUrl();

  if (!IS_PROD) return { errors, warnings };

  const secret = process.env.SESSION_SECRET || DEV_SESSION_SECRET;
  if (!process.env.SESSION_SECRET || secret === DEV_SESSION_SECRET) {
    errors.push('SESSION_SECRET debe ser un string aleatorio largo (no el valor de ejemplo).');
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    warnings.push('Discord OAuth no configurado — el login estará desactivado.');
  }

  if (publicUrl.includes('localhost')) {
    warnings.push('PUBLIC_URL no definida — en Railway añádela o usa el dominio *.up.railway.app.');
  }

  const callback = process.env.DISCORD_CALLBACK_URL || `${publicUrl}/auth/discord/callback`;
  if (!publicUrl.includes('localhost') && callback && !callback.startsWith(publicUrl)) {
    warnings.push('DISCORD_CALLBACK_URL no coincide con la URL pública — revisa OAuth de Discord.');
  }

  return { errors, warnings };
}

module.exports = {
  IS_PROD,
  PORT,
  PUBLIC_URL,
  resolvePublicUrl,
  validateProductionConfig,
  DEV_SESSION_SECRET,
  TRUST_PROXY: process.env.TRUST_PROXY === '1' || IS_PROD,
};
