FROM node:20-alpine

RUN apk add --no-cache curl openssl libc6-compat ca-certificates

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ARG DATABASE_URL
RUN set -e; \
  if [ -z "${DATABASE_URL:-}" ]; then \
    echo "DATABASE_URL is required" >&2; \
    exit 1; \
  fi; \
  export DATABASE_URL; \
  npx prisma generate

RUN NODE_ENV=production npm run build

EXPOSE 3010

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
