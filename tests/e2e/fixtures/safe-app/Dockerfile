FROM node:20-alpine
RUN adduser -D appuser
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
ENV PORT=8080
EXPOSE 8080
USER appuser
CMD ["node", "server.js"]
