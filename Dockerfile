FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node server.mjs core.mjs digest.mjs ./
COPY --chown=node:node public ./public
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node","server.mjs"]
