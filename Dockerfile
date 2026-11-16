# FreshRescue in containers (plan, phase 11): one file, three stages. compose.yaml builds two of them.
#   build  installs every dependency from the lock file and builds the web app
#   api    the backend, started by its workspace's `start` script: TypeScript runs through tsx, as in development
#   web    the Next.js app, started by its workspace's `start` script
#
# The Node of the images. `.npmrc` sets engine-strict, so `npm ci` fails inside the image, as it does on a
# laptop, when this Node is older than the floor that package.json names (22.22.2):
#   docker compose build --build-arg NODE_VERSION=24.15.0
ARG NODE_VERSION=22.23.5

FROM node:${NODE_VERSION}-slim AS build
# Next bakes its /api rewrite into the build (apps/web/next.config.ts), so the address of the API is decided
# here: the `api` service of compose.yaml. The ENV keeps the same value for the servers that start from this tree.
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=${API_ORIGIN}
# Next would otherwise send telemetry, and it looks up git to do so
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# .dockerignore keeps node_modules, .next, .git and .env out, so nothing built or set on a laptop gets in
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build

FROM build AS api
ENV API_PORT=4000
EXPOSE 4000
# The slim image has no curl, so the health check asks with Node's own fetch.
HEALTHCHECK --interval=5s --timeout=5s --start-period=30s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || '4000') + '/healthz').then((answer) => process.exit(answer.ok ? 0 : 1), () => process.exit(1))"]
CMD ["npm", "run", "start", "-w", "@freshrescue/api"]

FROM build AS web
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=5s --start-period=30s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then((answer) => process.exit(answer.ok ? 0 : 1), () => process.exit(1))"]
CMD ["npm", "run", "start", "-w", "@freshrescue/web"]
