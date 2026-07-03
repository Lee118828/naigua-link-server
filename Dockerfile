FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server.js"]
