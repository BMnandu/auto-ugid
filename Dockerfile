# 改用 Debian 基础的 Node.js 镜像，解决 glibc 兼容性问题
FROM node:18-slim

# 设置时区为上海
ENV TZ="Asia/Shanghai"

# 安装 Chromium 浏览器及其依赖的图形渲染库
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 告诉 Puppeteer 直接使用系统安装的 Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

RUN npm init -y && npm install puppeteer-core

COPY monitor.js .

CMD ["node", "monitor.js"]