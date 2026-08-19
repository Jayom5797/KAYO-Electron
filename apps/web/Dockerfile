FROM public.ecr.aws/docker/library/node:20-alpine AS builder
WORKDIR /app
# Ensure UTF-8 encoding so emoji and unicode in source are preserved
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY . .
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
# Accept API URL as a build arg so it gets baked into the Next.js bundle
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM public.ecr.aws/docker/library/node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
