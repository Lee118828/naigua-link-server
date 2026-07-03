FROM node:20-alpine
WORKDIR /opt/application
COPY package.json server.js run.sh ./
ENV PORT=8000
EXPOSE 8000
RUN chmod +x ./run.sh
CMD ["./run.sh"]
