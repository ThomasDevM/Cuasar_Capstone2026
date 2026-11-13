# ---- 1) Frontend ----
FROM node:22-alpine AS front
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2) Backend ----
FROM node:22-alpine AS back
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# ---- 3) Imagen final ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 TZ=America/Santiago
WORKDIR /app
COPY --from=back /app/backend/node_modules ./backend/node_modules
COPY --from=back /app/backend/dist ./backend/dist
COPY --from=back /app/backend/package.json ./backend/package.json
COPY --from=front /app/frontend/dist ./frontend/dist
RUN mkdir -p /app/backend/data && chown -R node:node /app
USER node
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
