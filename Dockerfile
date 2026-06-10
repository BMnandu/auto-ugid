FROM node:18-alpine

ENV TZ="Asia/Shanghai"

WORKDIR /app

COPY monitor.js .

CMD ["node", "monitor.js"]
