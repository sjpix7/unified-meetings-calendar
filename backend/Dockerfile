FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget -qO- http://localhost:4000/api/health || exit 1
USER node
CMD ["node", "src/server.js"]
