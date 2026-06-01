FROM oven/bun:1-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

EXPOSE 8787

CMD ["bun", "src/service.ts"]
