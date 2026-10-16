# syntax=docker/dockerfile:1
# Serves the static site built by the builder container. Runs as an unprivileged user on port 8080.
FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
