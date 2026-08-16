FROM node:20-slim

# Install Chromium dependencies for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Install Playwright Chromium (pinned to package version)
# This ensures reproducible builds — the browser version matches the library
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.browsers
RUN npx playwright install chromium --with-deps

COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npx tsc

ENV PORT=3100
ENV HOST=0.0.0.0
EXPOSE 3100

# Non-root user for security
RUN adduser --disabled-password --gecos '' appuser
USER appuser

CMD ["node", "dist/server.js"]
