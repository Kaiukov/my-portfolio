FROM oven/bun:1-alpine

WORKDIR /app

ENV NODE_ENV=production

# Runtime deps only:
#   postgresql16-client -> pg_dump for the backup command
#   ca-certificates     -> TLS for R2/Cloudflare/Yahoo calls
#   jq, procps          -> in-container diagnostics
# Alpine ships postgresql16-client directly, so there's no pgdg apt repo to add
# and therefore no curl/gnupg/lsb-release build tools to install and purge.
RUN apk add --no-cache postgresql16-client ca-certificates jq procps

COPY portfolio-ts/package.json portfolio-ts/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY portfolio-ts/ ./
COPY portfolio_db/sql/ ./portfolio_db/sql/

EXPOSE 8787

CMD ["bun", "src/service.ts"]
