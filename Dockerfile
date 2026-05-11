# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ARG DATABASE_URL
RUN if [ -z "${DATABASE_URL:-}" ]; then \
      echo "DATABASE_URL is required" >&2; \
      exit 1; \
    fi; \
    export DATABASE_URL; \
    ok=0; \
    for i in 1 2 3 4 5; do \
      if npx prisma generate; then ok=1; break; fi; \
      echo "prisma generate attempt $i failed, retrying..." >&2; \
      sleep $((i * 5)); \
    done; \
    if [ "$ok" != "1" ]; then \
      echo "prisma generate failed after 5 attempts (check access to https://binaries.prisma.sh)" >&2; \
      exit 1; \
    fi

RUN npm run build

EXPOSE 3010

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
