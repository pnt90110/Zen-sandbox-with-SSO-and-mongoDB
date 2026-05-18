FROM node:20-bookworm-slim

WORKDIR /app

# Install production dependencies first to maximize layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8000

USER node
CMD ["node", "backend/server.js"]
