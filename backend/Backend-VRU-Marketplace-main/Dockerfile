# Multi-stage so the runtime image carries no compiler and no dev dependencies.
# The university server this runs on is short on memory; a smaller image is not vanity.

FROM node:22-bookworm-slim AS build

WORKDIR /app

# Dependencies first, so editing source does not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci

# The Prisma client is generated from the schema, so the schema and its config have to be
# present before `prisma generate`.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build


FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Production dependencies only. The generated Prisma client is copied from the build stage
# rather than regenerated, so the running image contains exactly what was compiled against.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist

# The Prisma *CLI* is deliberately NOT here. It is a devDependency with its own dependency tree
# (@prisma/config, @prisma/engines and more), so copying node_modules/prisma alone produces a
# `prisma` that cannot start — which is exactly the state this image was in: compose ran
# `npx prisma migrate deploy && node dist/main.js`, the CLI failed to load, and the server never
# started at all.
#
# Migrations now run from the `build` stage instead, as the one-shot `migrate` service in
# docker-compose.yml. That stage already has the CLI and the schema, this image stays minimal, and
# applying migrations becomes a visible step that either succeeds or stops the deploy — rather than
# something hidden in a shell chain in front of the server.

# The upload volume is mounted here. Owned by the unprivileged user, because the process
# writing user photos into it does not run as root.
RUN mkdir -p /var/lib/vru-marketplace/uploads && chown -R node:node /var/lib/vru-marketplace

USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
