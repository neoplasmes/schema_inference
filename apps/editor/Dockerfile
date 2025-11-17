FROM nginx:1.28.0-alpine@sha256:91786fc3554a00f445f9639d4f21a8564b6fd4f1ad39d17ed32f00faae24bc7c

COPY nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/

USER nginx
EXPOSE 8080 8081
HEALTHCHECK --interval=2s --timeout=3s --retries=30 CMD wget -q --spider http://127.0.0.1:8080/mf-manifest.json || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
