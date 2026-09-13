FROM node:22-slim AS package-manifest
WORKDIR /app
COPY package.json package-lock.json ./
RUN node -e "const fs=require('fs');const pkg=require('./package.json');if(pkg.scripts){delete pkg.scripts.prepare;}fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2)+'\\n');"

FROM node:22-slim AS build
WORKDIR /app
COPY --from=package-manifest /app/package.json /app/package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=package-manifest /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build

ENV PORT=8080
EXPOSE 8080
CMD ["node", "build/http.js"]
