# syntax=docker/dockerfile:1
# Multi-stage build for kubeswift-ui: compile the Angular app to static assets,
# then serve them from an unprivileged (non-root) nginx that can also
# reverse-proxy the kubeswift-gateway. See docker/ and README.md.

# ---- build: compile the Angular app to static assets ----------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

ARG VERSION=dev
ARG GIT_COMMIT=unknown

# Install deps against the lockfile first so the layer caches across source edits.
COPY package.json package-lock.json ./
RUN npm ci

# Build the production bundle -> dist/kubeswift-ui/browser.
COPY . .
RUN npx ng build --configuration production

# ---- serve: unprivileged nginx --------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS serve

ARG VERSION=dev
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.title="kubeswift-ui" \
      org.opencontainers.image.source="https://github.com/projectbeskar/kubeswift-ui" \
      org.opencontainers.image.description="KubeSwift web console (Angular SPA served by nginx)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}"

# Default wiring: same-origin reverse-proxy to a gateway Service named
# "kubeswift-gateway" in the same namespace. The Helm chart (ui.gateway.*)
# overrides these; both are harmless for a bare `docker run`.
ENV KUBESWIFT_GATEWAY_URL="@origin" \
    KUBESWIFT_GATEWAY_UPSTREAM="kubeswift-gateway:8080"

USER root
# Static app -> nginx web root, owned by the runtime user (uid 101, gid 0) so
# the entrypoint can (re)write config.js there at startup. gid-0 + group-write
# also keeps it writable under an OpenShift arbitrary-uid SCC.
COPY --from=build --chown=101:0 /app/dist/kubeswift-ui/browser /usr/share/nginx/html
# Server config (envsubst template) + runtime entrypoint hooks.
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/entrypoint.d/10-kubeswift-resolver.envsh /docker-entrypoint.d/10-kubeswift-resolver.envsh
COPY docker/entrypoint.d/30-kubeswift-config-js.sh   /docker-entrypoint.d/30-kubeswift-config-js.sh
# Drop the stock welcome server; make the entrypoint hooks executable (the
# nginx entrypoint only runs *.sh/*.envsh that are +x); keep the web root
# group-writable for config.js regeneration.
RUN rm -f /etc/nginx/conf.d/default.conf \
 && chmod 0755 /docker-entrypoint.d/10-kubeswift-resolver.envsh \
               /docker-entrypoint.d/30-kubeswift-config-js.sh \
 && chmod -R g+w /usr/share/nginx/html
USER 101

EXPOSE 8080
# ENTRYPOINT (/docker-entrypoint.sh) + CMD (nginx -g 'daemon off;') inherited.
