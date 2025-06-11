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
<p align="center">
  <a href="https://snapcraft.io/zasper" target="_blank"><img src="https://snapcraft.io/en/light/install.svg" alt="Get it from the Snap Store"></a>
</p>

Zasper is an IDE designed from the ground up to support massive concurrency. It provides a minimal memory footprint, exceptional speed, and the ability to handle numerous concurrent connections.

It implements [Jupyter's wire protocol](https://jupyter-client.readthedocs.io/en/latest/messaging.html) and can efficiently run Jupyter Notebooks.

# Cross Platform

✅ Fully supported: macOS & Linux

⚠️ Limited support: Windows — for the best experience, use via WSL


# Benchmarks

How is Zasper better than JupyterLab ?

![](https://raw.githubusercontent.com/zasper-io/zasper-benchmark/main/assets/summary_resources.png)

* Up to 5X Less CPU usage
* Up to 40X Less RAM usage
* Higher throughput
* Lower latency
* Highly resilient under very high loads

Benchmark comparision report can be accessed [here](https://github.com/zasper-io/zasper-benchmark?tab=readme-ov-file#benchmarking-zasper-vs-jupyterlab).


# Jupyter Kernels Supported

* Python Kernels
* Conda environments
* R kernels [(iR)](https://github.com/IRkernel/IRkernel)
* Julia Kernels [(iJulia)](https://julialang.github.io/IJulia.jl/stable/)
* Ruby kernels [(iRuby)](https://github.com/SciRuby/iruby)
* Javascript kernels [(Deno)](https://docs.deno.com/runtime/reference/cli/jupyter/)
* Go Kernels ([GoNb](https://github.com/janpfeifer/gonb))
* Compatible with all Jupyter kernels
* Also works with UV. See the section on "Working with conda environments".

# 🚀 Installation

Zasper comes in two flavours:

1. Web App
2. Desktop App

Web App is available as Homebrew , snap and conda package.

### HomeBrew

```
brew install zasper-io/tap/zasper
```

### Snap

```
sudo snap install zasper
```

### Conda

```
conda install zasper -c conda-forge
```

### Desktop App

Visit our [downloads page](https://zasper.io/downloads)

Or directly install from releases.

# Releases

Current release version: `v0.2.0-beta`

| OS              | Web App | Desktop App |
|-----------------|:-------:|:-----------:|
| Mac 🍏 Silicon  |    ✅   |     ✅      |
| Mac AMD 64      |    ✅   |     ✅      |
| Debian AMD 64   |    ✅   |     ✅      |
| Debian ARM 64   |    ✅   |     ✅      |
| Debian i386     |    ✅   |     ✅      |
| Redhat AMD 64   |    ✅   |     ❌      |
| Redhat ARM 64   |    ✅   |     ❌      |
| Redhat i386     |    ✅   |     ❌      |
| Windows AMD 64  |    ✅   |     ❌      |
| Windows ARM 64  |    ✅   |     ✅      |
| Windows i386    |    ✅   |     ❌      |

The missing distributions will be out soon.

## 📷 Screenshots

### Editor
![Editor](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main//editor.png)

### Terminal
![Terminal](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/terminal.png)

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


## Quickstart


### Webapp

Just launch Zasper from launcher.

### Webapp

Once you have the webapp installed, Go to any directory you want to serve and run `zasper`. This starts zasper server in the directory.

```
prasunanand@Prasuns-Mac-mini example % zasper
==========================================================
     ███████╗ █████╗ ███████╗██████╗ ███████╗██████╗
     ╚══███╔╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔══██╗
       ███╔╝ ███████║███████╗██████╔╝█████╗  ██████╔╝
      ███╔╝  ██╔══██║╚════██║██╔═══╝ ██╔══╝  ██╔══██╗
     ███████╗██║  ██║███████║██║     ███████╗██║  ██║
     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝

                    Zasper Server
                Version: 0.1.0-alpha
----------------------------------------------------------
 ✅ Server started successfully!
 📡 Listening on:         http://localhost:8048
 🖥️ Webapp available at:  http://localhost:8048
 🔒 Protected Mode:       disabled
==========================================================

```

Go to `http://localhost:8048`


### 🚀 Hosting Zasper

To host your own instance of Zasper, follow these steps:

#### 1. Start the server in protected mode
Run Zasper with the --protected=true flag to enable authentication:

```
prasunanand@Prasuns-Mac-mini example % zasper --protected=true

==========================================================
     ███████╗ █████╗ ███████╗██████╗ ███████╗██████╗
     ╚══███╔╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔══██╗
       ███╔╝ ███████║███████╗██████╔╝█████╗  ██████╔╝
      ███╔╝  ██╔══██║╚════██║██╔═══╝ ██╔══╝  ██╔══██╗
     ███████╗██║  ██║███████║██║     ███████╗██║  ██║
     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝

                    Zasper Server
                Version: 0.1.0-alpha
----------------------------------------------------------
 ✅ Server started successfully!
 📡 Listening on:        http://localhost:8048
 🖥️  Webapp available at: http://localhost:8048
 🔒 Protected Mode:      enabled
 🔐 Server Access Token: 14be1b674a3b9196a82c01129028d0dd
==========================================================
```
### 2. Access the login page

Once the server starts, visit: [http://localhost:8048](http://localhost:8048). It will redirect you to a login page.


![Server Login Page](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/login.png)

### 3. Authenticate using the access token
Copy the `Server Access Token` displayed in the console output when the server starts.
Paste it into the login page to authenticate and access the app.

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
pip install ipykernel
```

or

```
pip install jupyter
```

## Working with conda environments

Create an environment.
```
conda create --name torchEnv
```

Activate the environment.
```
conda activate torchEnv
```

Install the necessary packages and ipykernel

```
conda install -c anaconda ipykernel
```

Create `kernelspec` file and you are done! 🚀

```
python -m ipykernel install --user --name=torchEnv
```

## Working with UV

Create a project.
```
uv init exampleUV
cd exampleUV
uv run main.py    # This creates a .venv directory
```

Activate the environment.
```

source .venv/bin/activate
```

Install the necessary packages and ipykernel

```
uv pip install ipykernel
```

Create `kernelspec` file and you are done! 🚀

```
uv run python -m ipykernel install --user --name=exampleUV
```

## ⚡️ Building from Source

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
  -protected
    	enable protected mode
```

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

# 🪵 Logging

By default, the application writes logs to the following locations:

```bash
on Linux: ~/.config/zasper/logs/main.log
on macOS: ~/Library/Logs/zasper/main.log
on Windows: %USERPROFILE%\AppData\Roaming\zasper\logs\main.log
```

# 🧭 Roadmap

Data Scientists and AI Engineers spend most of their time running Notebooks on IDEs and hence need a robust ecosystem.
Zasper aspires to be a full fledged IDE and the future development will be along making it more efficient by:

* Allowing custom data apps support rather than just Jupyter Notebooks.
* Easier integration with the existing tools.
* Zasper Hub for Self Hosted deployment in the cloud.


# 🤞 Support Zasper

If you like Zasper and want to support me in my mission, please consider [sponsoring me on GitHub](https://github.com/sponsors/prasunanand).


#  🚀 Sponsors

A few months ago I received a grant to help me building Zasper.

<img height=100px src="./assets/foss-united.png"> &nbsp;&nbsp;&nbsp;&nbsp; <img height=80px src="./assets/zerodha.png">


# 🌐 Community

Join Zasper Community on [Slack](https://join.slack.com/t/zasper/shared_invite/zt-30sx3uo8w-w~sw4Kje1aoUjxY5MZ_Fkg)

<p align=center>
  <a href="https://join.slack.com/t/zasper/shared_invite/zt-30sx3uo8w-w~sw4Kje1aoUjxY5MZ_Fkg" target="_blank">
      <img height=120px src="./assets/slack.svg">
  </a>
</p>

# Contributors

<a href = "https://github.com/zasper-io/zasper/graphs/contributors">
  <img src = "https://contrib.rocks/image?repo=zasper-io/zasper"/>
</a>

# Contributing

You can contribute in multiple ways:
* Documentation
* Bug Filing
* Submitting PRs or reviewing them

# ⭐️ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zasper-io/zasper&type=Date)](https://star-history.com/#zasper-io/zasper&Date)

# Code of Conduct

See [Code of conduct](./CODE_OF_CONDUCT.md)

# 🙏 Thanks to Jupyter Community

Zasper would not exist without the incredible work of the Jupyter community. Zasper uses the Jupyter wire protocol and draws inspiration from its architecture. Deep thanks to all Jupyter contributors for laying the groundwork. Data Science Notebooks would not have existed without them.

# Copyright

Prasun Anand

## ⚖️ License

Zasper is licensed under AGPL-3.0 license.
