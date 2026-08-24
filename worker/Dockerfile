FROM node:26-bookworm-slim

# ripgrep powers the code-search tool (it falls back to a Node scan if absent)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

USER node

CMD ["npm", "run", "worker"]
