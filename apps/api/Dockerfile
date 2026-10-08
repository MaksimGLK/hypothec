# Образ API и воркера (один образ, разные команды).
FROM node:22-alpine AS build
WORKDIR /repo
RUN npm i -g pnpm@10.34.6
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter "@hypothec/api..."
RUN pnpm --filter @hypothec/api build
RUN pnpm --filter @hypothec/api deploy --legacy --prod /out

FROM node:22-alpine
ENV NODE_ENV=production CONTENT_DIR=/app/content
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/content ./content
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
