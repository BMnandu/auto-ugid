FROM node:24-alpine

ENV NODE_ENV=production \
    TZ=Asia/Shanghai

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node monitor.js ./monitor.js

RUN mkdir -p /data && chown node:node /data

USER node

VOLUME ["/data"]

CMD ["node", "src/index.js"]
