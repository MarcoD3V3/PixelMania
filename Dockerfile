FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data/sessions

EXPOSE 3000

# Persistencia: en Railway usa Volumes en el dashboard → mount /app/data
# (Railway NO permite la instrucción VOLUME en Dockerfile)

CMD ["node", "server.js"]
