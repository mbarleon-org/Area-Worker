FROM node:25-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --prefer-offline || npm install
COPY . .
RUN npm run build

FROM node:25-alpine
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="area-worker" \
   org.opencontainers.image.description="Area project worker" \
   org.opencontainers.image.source="https://github.com/mbarleon-org/Area-Worker" \
   org.opencontainers.image.url="https://github.com/mbarleon-org/Area-Worker" \
   org.opencontainers.image.created="${BUILD_DATE}" \
   org.opencontainers.image.revision="${VCS_REF}"

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
RUN apk add --no-cache curl ca-certificates \
    && curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl \
    && rm kubectl
CMD ["sh", "-c", "node /app/dist/index.js"]
