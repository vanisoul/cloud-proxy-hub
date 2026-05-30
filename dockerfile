ARG VERSION=0.0.0
FROM node:24.15.0-bookworm-slim AS builder

ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /app

RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:24.15.0-bookworm-slim
ARG VERSION
ENV VERSION=${VERSION}

RUN apt-get update && apt-get install -y curl unzip gnupg && \
    curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com bookworm main" > /etc/apt/sources.list.d/hashicorp.list && \
    apt-get update && apt-get install -y terraform && \
    curl -fsSL https://bun.sh/install | bash && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /app

RUN mkdir -p /app/config /app/data

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder /app/web/dist ./web/dist

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
