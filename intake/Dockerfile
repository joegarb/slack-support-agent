FROM node:26-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

USER node

CMD ["npm", "run", "intake"]
