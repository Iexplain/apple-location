FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# 数据持久化目录
RUN mkdir -p server/data
VOLUME ["/app/server/data"]

EXPOSE 3000

CMD ["node", "--experimental-sqlite", "server/index.js"]
