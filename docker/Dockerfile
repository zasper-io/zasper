# Built from this repository rather than a fresh clone of main: the old Dockerfile ran
# `git clone https://github.com/zasper-io/zasper.git`, so the image ignored the checkout it was built
# from and always shipped whatever main happened to be — including when building from a release tag.
FROM golang:1.25 AS build

WORKDIR /src

# NodeSource rather than apt: bookworm's own nodejs is 18, below what the frontend's dependencies
# declare (sanitize-html needs >=22.12).
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN make init && make build

FROM debian:bookworm-slim

# Zasper runs notebooks on Jupyter kernels but does not provide one.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-pip ca-certificates \
    && pip install jupyter --break-system-packages \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/zasper /usr/local/bin/zasper

RUN useradd -m -s /bin/bash zasper
USER zasper
WORKDIR /home/zasper

EXPOSE 8048

# --host 0.0.0.0 because a server bound to loopback inside a container is unreachable from the host.
# Every route still needs the access token, which `docker logs` shows on the startup line.
CMD ["zasper", "--host=0.0.0.0"]
