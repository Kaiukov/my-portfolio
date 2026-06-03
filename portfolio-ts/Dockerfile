FROM oven/bun:1-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg lsb-release ca-certificates jq procps \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

COPY portfolio-ts/package.json portfolio-ts/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY portfolio-ts/ ./
COPY portfolio_db/sql/ ./portfolio_db/sql/

EXPOSE 8787

CMD ["bun", "src/service.ts"]
