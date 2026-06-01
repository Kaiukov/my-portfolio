FROM oven/bun:1-slim

WORKDIR /app

ENV NODE_ENV=production

COPY portfolio-ts/package.json portfolio-ts/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY portfolio-ts/ ./
COPY portfolio_db/sql/ ./portfolio_db/sql/

EXPOSE 8787

CMD ["bun", "src/service.ts"]
