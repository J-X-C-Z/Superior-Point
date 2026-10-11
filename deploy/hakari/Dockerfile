FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    SP_BIND=0.0.0.0 \
    SP_PORT=3000 \
    SP_PG_BIN=/usr/lib/postgresql/18/bin

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg build-essential python3 \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev \
 && apt-get purge -y --auto-remove build-essential python3 gnupg curl \
 && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node adapters ./adapters
COPY --chown=node:node core ./core
COPY --chown=node:node examples ./examples
COPY --chown=node:node io ./io
COPY --chown=node:node mcp ./mcp
COPY --chown=node:node server ./server
COPY --chown=node:node storage ./storage
COPY --chown=node:node vendor ./vendor
COPY --chown=node:node web ./web

RUN mkdir -p /app/data/assets /app/data/backups \
 && chown -R node:node /app/data

USER node
EXPOSE 3000
CMD ["npm", "run", "service:start"]
