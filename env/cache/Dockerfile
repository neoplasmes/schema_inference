FROM caddy:2.10.2-builder@sha256:01668408cc26e2e00c9d067c30cb43b2ba14ad1f2808beda55503cb2a31f59dc AS builder

RUN xcaddy build v2.10.2 \
    --with github.com/caddyserver/cache-handler@v0.16.0 \
    --with github.com/darkweak/storages/redis/caddy@v0.0.16 \
    --with github.com/mholt/caddy-ratelimit@v0.1.1-0.20250915152450-04ea34edc0c4

RUN setcap -r /usr/bin/caddy

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d

ENV XDG_DATA_HOME=/tmp \
    XDG_CONFIG_HOME=/tmp

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

USER 65532:65532

EXPOSE 8080 8081 2019

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
