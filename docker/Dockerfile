# Built from this repository rather than a fresh clone of main: the old Dockerfile ran
# `git clone https://github.com/zasper-io/zasper.git`, so the image ignored the checkout it was built
# from and always shipped whatever main happened to be — including when building from a release tag.
FROM golang:1.26 AS build

WORKDIR /src

# Node from the official image rather than NodeSource's setup script piped into bash. bookworm's own
# nodejs is 18, below what the frontend's dependencies declare (sanitize-html needs >=22.12).
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

COPY . .

RUN make init && make build

FROM debian:bookworm-slim

# Zasper runs notebooks on Jupyter kernels but does not provide one. ipykernel is the kernel; the whole of
# `jupyter` added Notebook and JupyterLab, which nothing here uses.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-pip ca-certificates \
    && pip install --no-cache-dir ipykernel --break-system-packages \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/zasper /usr/local/bin/zasper

RUN useradd -m -s /bin/bash zasper
USER zasper
WORKDIR /home/zasper

EXPOSE 8048

# /api/health answers without the access token. Python rather than curl, which the slim image lacks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8048/api/health', timeout=4)"

# --host 0.0.0.0 because a server bound to loopback inside a container is unreachable from the host.
# Every route still needs the access token, which `docker logs` shows on the startup line.
CMD ["zasper", "--host=0.0.0.0"]
