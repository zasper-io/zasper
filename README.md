<p align="center">
  <img src="./assets/logo.svg" alt="Zasper">
</p>
<p align="center">
    ⚡ High Performance IDE 🚀 Massive concurrency 🐥  Inspired by Jupyter
</p>

<p align=center>
  <a href="https://github.com/zasper-io/zasper" target="_blank">
      <img src="https://img.shields.io/github/last-commit/zasper-io/zasper" alt="Last Commit">
  </a>
  <a href="https://github.com/zasper-io/zasper/stargazers" target="_blank">
      <img src="https://img.shields.io/github/stars/zasper-io/zasper" alt="GitHub Stars">
  </a>
  <a href="https://github.com/zasper-io/zasper/issues" target="_blank">
      <img src="https://img.shields.io/github/issues/zasper-io/zasper" alt="GitHub Issues">
  </a>
  <a href="https://github.com/zasper-io/zasper/actions/workflows/gobuild.yml" target="_blank"><img alt="Github CD status" src="https://github.com/zasper-io/zasper/actions/workflows/gobuild.yml/badge.svg"></a>
</p>

<p align="center">
    <a href="https://www.youtube.com/watch?v=LvVOkYL_LzQ" target="_blank"><img src="https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/play-demo.png" alt="Zasper Demo"></a>
</p>


Zasper is an IDE designed from the ground up to support massive concurrency. It provides a minimal memory footprint, exceptional speed, and the ability to handle numerous concurrent connections.

It's perfectly suited for running REPL-style data applications, with Jupyter notebooks being one example.

**Currently Zasper is fully supported on MacOS and Linux.** Currently Windows has limited support!

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=zasper-io/zasper)

# Benchmarks - 4X Better
Zasper uses one fourth of RAM and one fourth of CPU used by Jupyterlab. While Jupyterlab uses around 104.8 MB of RAM and 0.8 CPUs, Zasper uses 26.7 MB of RAM and 0.2 CPUs.


# Why I built Zasper ?

There are several proprietary JupyterLab-like frontend tools available in the market, such as Databricks Notebooks and Deepnote Notebooks. However, none of them are free or open-source, and most require users to work in the cloud. Even the modest personal computers these days are typically equipped with at least 8 GB of RAM, an 8-core CPU, and a decent 4 GB GPU, I saw an opportunity to create a solution that works seamlessly on local machines. That’s why I decided to build Zasper which can effectively utilize the resources available and guarantee maximum efficiency.

Originally I wrote https://github.com/zasper-io/zasper_py (now in Private mode) to build a new frontend around Jupyter. During the process I realized, Go is the ideal choice to rebuild the Jupyter project. Go has excellent support for REST, RPC, WS protocols. Concurrency and Performance are the areas where Go shines.

Go's Concurrency: Better suited for applications requiring both concurrency and parallelism, as it leverages multiple cores effectively. It's easier to handle blocking operations without freezing the system.

Python's Event Loop: Ideal for I/O-bound applications that need to handle a lot of asynchronous tasks without blocking. However, it struggles with CPU-bound tasks and lacks native parallelism unless additional worker threads are used.

Hence the Go version of Zasper was born!


# Jupyter Kernels Supported

* Python Kernels
* Conda environments
* R kernels [(iR)](https://github.com/IRkernel/IRkernel)
* Julia Kernels [(iJulia)](https://julialang.github.io/IJulia.jl/stable/)
* Ruby kernels [(iRuby)](https://github.com/SciRuby/iruby)
* Javascript kernels [(Deno)](https://docs.deno.com/runtime/reference/cli/jupyter/)
* Go Kernels ([GoNb](https://github.com/janpfeifer/gonb))
* Compatible with all Jupyter kernels


## 📷 Screenshots

### Editor
![Editor](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main//editor.png)

### Terminal
![Editor](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/terminal.png)

### Launcher
![Launcher](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/launcher.png) 

### Jupyter Notebook
![Notebook](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/notebook.png) 

### Version Control
![Version Control](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/git.png) 

### Command Palette
![Command Palette](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/commandPalette.png)

### Dark Mode
![Dark mode](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/dark.png) 

![Dark Notebook mode](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/darkNotebook.png) 

## Architecture
![architecture](./assets/architecture.svg)


## ⚡️ Quick start

Zasper comes in two flavours:

1. Web App
2. Desktop App


#### Initializing 

Download `zasper` from Github and initialize the dependencies.

```
git clone https://github.com/zasper-io/zasper
cd zasper
make init
```

#### Web App

```
make webapp-install
```

This will create a binary `zasper` and add it to your go executables directory. Make sure you have go executables on your path. 

Run zasper in any directory to see if the installation was done correctly.

```
prasunanand@Prasuns-Laptop example % zasper --help
Usage of zasper:
  -cwd string
    	base directory of project (default ".")
  -debug
    	sets log level to debug
  -port string
    	port to start the server on (default ":8048")
```


Go to any directory you want to serve and run `zasper`. This starts zasper server in the directory.

```
prasunanand@Prasuns-Laptop nbformat_go % zasper

███████╗ █████╗ ███████╗██████╗ ███████╗██████╗ 
╚══███╔╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔══██╗
  ███╔╝ ███████║███████╗██████╔╝█████╗  ██████╔╝
 ███╔╝  ██╔══██║╚════██║██╔═══╝ ██╔══╝  ██╔══██╗
███████╗██║  ██║███████║██║     ███████╗██║  ██║
╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝                  
	
2025/02/21 10:19:44 Zasper Server started! Listening on port :8048
2025/02/21 10:19:44 Visit Zasper webapp on http://localhost:8048

```

Go to `http://localhost:8048`



### Desktop App

```
make electron-package-mac # on macOS
```

```
make electron-package-linux # on Linux
```

This creates  `zasper-0.1.0-arm64.dmg`(macOS) and `zasper_0.1.0_arm64.deb`(Debian) installer.

```
prasunanand@Prasuns-Laptop zasper % ls -l ui/dist 
total 626360
-rw-r--r--   1 prasunanand  staff       1713 Feb 21 10:31 builder-debug.yml
-rw-r--r--   1 prasunanand  staff        353 Feb 21 10:29 builder-effective-config.yaml
drwxr-xr-x  21 prasunanand  staff        672 Feb 21 10:30 linux-arm64-unpacked
drwxr-xr-x   3 prasunanand  staff         96 Feb 21 10:29 mac-arm64
-rw-r--r--@  1 prasunanand  staff  196642562 Feb 21 10:30 zasper-0.1.0-arm64.dmg
-rw-r--r--   1 prasunanand  staff     204747 Feb 21 10:30 zasper-0.1.0-arm64.dmg.blockmap
-rw-r--r--   1 prasunanand  staff  119088602 Feb 21 10:31 zasper_0.1.0_arm64.deb

```

Install `zasper-0.1.0-arm64.dmg` to your machine.

## Jupyter kernels

Please ensure you have jupyter kernels installed.

```
prasunanand@Prasuns-Laptop examples % jupyter kernelspec list
Available kernels:
  deno          /Users/prasunanand/Library/Jupyter/kernels/deno
  firstenv      /Users/prasunanand/Library/Jupyter/kernels/firstenv
  gonb          /Users/prasunanand/Library/Jupyter/kernels/gonb
  ir            /Users/prasunanand/Library/Jupyter/kernels/ir
  julia-1.11    /Users/prasunanand/Library/Jupyter/kernels/julia-1.11
  ruby3         /Users/prasunanand/Library/Jupyter/kernels/ruby3
  python3       /Users/prasunanand/Library/Python/3.9/share/jupyter/kernels/python3
```
The simplest way to install a Python 3 Jupyter kernel is

```
pip install jupyter
```

You can install other kernels as well. Just Google it!

## Logging

By default, the application writes logs to the following locations:

```bash
on Linux: ~/.config/zasper/logs/main.log
on macOS: ~/Library/Logs/zasper/main.log
on Windows: %USERPROFILE%\AppData\Roaming\zasper\logs\main.log
```

# Wiki

For Zasper architecture, and other info refer [wiki](https://github.com/zasper-io/zasper/wiki).

# Contributing

You can contribute in multiple ways:
* Documentation
* Bug Filing
* Submitting PRs or reviewing them

# Code of Conduct

See [Code of conduct](./CODE_OF_CONDUCT.md)

# Roadmap

Data Scientists and AI Engineers spend most of their time running Notebooks on IDEs and hence need a robust ecosystem.
Zasper aspires to be a full fledged IDE and the future development will be along making it more efficient by:

* Allowing custom data apps support rather than just Jupyter Notebooks. 
* Easier integration with the existing tools.
* Zasper Hub for Self Hosted deployment in the cloud.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zasper-io/zasper&type=Date)](https://star-history.com/#zasper-io/zasper&Date)

# 🌐 Community

Join Zasper Community on [Slack](https://join.slack.com/t/zasper/shared_invite/zt-30sx3uo8w-w~sw4Kje1aoUjxY5MZ_Fkg)

<p align=center>
  <a href="https://join.slack.com/t/zasper/shared_invite/zt-30sx3uo8w-w~sw4Kje1aoUjxY5MZ_Fkg" target="_blank">
      <img height=120px src="./assets/slack.svg">
  </a>
</p>

# Sponsors

<img height=100px src="./assets/foss-united.png">

<img height=40px src="./assets/zerodha.png">

# Copyright

Prasun Anand 

## ⚖️ License

Zasper is licensed under AGPL-3.0 license.
