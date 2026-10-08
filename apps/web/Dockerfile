FROM node:22-alpine AS build
WORKDIR /repo
RUN npm i -g pnpm@10.34.6
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter "@hypothec/web..."
RUN pnpm --filter @hypothec/web build
# хэш встроенного скрипта темы — для CSP без 'unsafe-inline'
RUN node -e "const fs=require('fs');const h=fs.readFileSync('apps/web/dist/index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);const hash=require('crypto').createHash('sha256').update(m[1]).digest('base64');fs.writeFileSync('/security-headers.conf',fs.readFileSync('apps/web/security-headers.conf','utf8').replace('THEME_HASH',hash))"

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
