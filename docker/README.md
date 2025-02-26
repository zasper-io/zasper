# Docker

The files in this directory will build a basic docker environment for zasper that will 

* install the latest version of zasper from github
* use system provided python and install `jupyter` into this version. 
* run `zasper` using a non-root user account named `zasper`
* provide `zasper` at port 8048. 

## Build docker container

```
docker compose build
```

If `docker compose` is not available, simply run `docker build . -t zasper` in this folder 

## Run docker container

```
docker compose up -d 
```

If `docker-compose` is not available, please run `docker run -p 8048:8048 -d zasper`. 
