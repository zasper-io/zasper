<p align="center">
  <img src="./screenshots/logo.svg" alt="Zasper">
</p>
<p align="center">
    ⚡ High Performance IDE 🚀 Powered by AI 🐥  Inspired by Jupyter
</p>


# Why Go ?

Inbuilt concurrency


## 📷 Screenshots

### Editor
![Editor](./screenshots/editor.png)

### Terminal
![Editor](./screenshots/terminal.png)

### Launcher
![Launcher](./screenshots/launcher.png) 

## ⚡️ Quick start

Zasper comes in two flavours:

1. Electron App
2. Web App

### Electron App

#### Start the backend

Go to project home and start the server

```bash
go run .
```

Go to `ui` and run the app in dev mode

```
npm run electron-dev
```


### Webapp

#### Build the frontend

```bash
cd ./ui/
npm run build
```

#### Install zeromq
On debian
```bash
sudo apt-get install libzmq3-dev
```

On mac
```zsh
brew install pkg-config
brew install zeromq
```

#### Start the backend

Go to project home and start the server

```bash
go run .
```


Go to `http://localhost:8888`

# Contributing

You can contribute in multiple ways:
* Documentation
* Bug Filing
* Submitting PRs or reviewing them

# Code of Conduct

See [Code of conduct](./CODE_OF_CONDUCT.md)

# Copyright

Prasun Anand 

## ⚖️ License

Zasper is licensed under BSD 3-Clause License
