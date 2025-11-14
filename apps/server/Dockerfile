FROM python:3.12.12-slim-bookworm@sha256:4a8e0824201e50fc44ee8d208a2b3e44f33e00448907e524066fca5a96eb5567 AS build

ARG TARGETARCH
ENV MOON_TOOLCHAIN_FORCE_GLOBALS=true \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_NO_PROGRESS=1

WORKDIR /workspace
COPY env/docker/install_tools.py /tmp/install_tools.py
RUN python /tmp/install_tools.py "$TARGETARCH"

COPY . .
RUN moon run server:setup-runtime --no-actions

FROM python:3.12.12-slim-bookworm@sha256:4a8e0824201e50fc44ee8d208a2b3e44f33e00448907e524066fca5a96eb5567

ENV PATH="/workspace/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    UPLOAD_ROOT=/data/uploads \
    WORDNET_ROOT=/opt/wordnet

COPY --from=build /workspace/.venv /workspace/.venv
COPY --from=build --chown=10001:10001 /workspace/apps/server/nltk_data /opt/wordnet
RUN groupadd --gid 10001 workspace \
    && useradd --uid 10001 --gid workspace --no-create-home workspace \
    && mkdir -p /data/uploads \
    && chown workspace:workspace /data/uploads

WORKDIR /data
USER workspace
EXPOSE 8000
CMD ["python", "-m", "main"]
