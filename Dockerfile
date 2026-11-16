# causewise has no runtime npm dependencies: Node runs the TypeScript sources
# directly and SQLite is built in (ADR 0007).
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production \
    CAUSEWISE_HOST=0.0.0.0 \
    CAUSEWISE_DB=/data/causewise.db
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.CAUSEWISE_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
