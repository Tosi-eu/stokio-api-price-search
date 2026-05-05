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

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3010

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
