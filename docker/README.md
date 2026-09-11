# Docker

Builds a Zasper image from this checkout rather than from a clone of `main`, so building from a
release tag ships that release.

The image:

- compiles Zasper in a Go and Node build stage and copies only the binary into a slim Debian image;
- installs `jupyter` with pip, since Zasper runs notebooks on Jupyter kernels but ships none;
- runs as an unprivileged `zasper` user whose home, `/home/zasper`, is the project Zasper opens.

## With Compose

From this directory:

```sh
docker compose up -d --build
docker compose logs zasper
```

The startup line in the log carries the access token. Zasper is published on `127.0.0.1:8048`;
change the mapping in `docker-compose.yml` to `"8048:8048"` to reach it from other machines.
Notebooks go in `./workspace`, which is mounted as the project.

## Without Compose

From the repository root:

```sh
docker build -f docker/Dockerfile -t zasper .
docker run -d -p 127.0.0.1:8048:8048 -v "$PWD/workspace:/home/zasper" zasper
```
