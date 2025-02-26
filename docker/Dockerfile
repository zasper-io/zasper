FROM golang:latest

ENV CGO_ENABLED=1\
    GOOS=linux

# Dependencies
RUN apt-get update && apt-get install -y curl git gcc cpp npm

# Clone zasper repo
RUN git clone https://github.com/zasper-io/zasper.git 

# Build npm stuff 
RUN cd zasper && make init

# Build and install zasper 
RUN cd zasper && make webapp-install
 
# Install sample python env
RUN apt-get install -y python3-pip 
RUN pip install jupyter --break-system-packages

# Add user zasper 
RUN useradd -m -s /bin/bash zasper
RUN echo "zasper:password" | chpasswd

# Run app under user zasper
USER zasper
WORKDIR /home/zasper
CMD ["zasper"]
