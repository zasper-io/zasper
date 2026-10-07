# Kernel memory and GPUs

Zasper shows how much memory each kernel is holding, and how much GPU memory, where people look while
they work: in the status bar for the notebook in front, and in the Jupyter info panel for every kernel
the server runs. A training run that is filling a GPU, or a notebook closed after lunch that still
holds 4 GB, is seen without `nvidia-smi` or `htop` open in another terminal.

This page is how that works, for anyone changing what is measured or where it is shown.

## What a reader sees

- **The status bar**, while a notebook with a running kernel is in front: the kernel's memory, and the
  GPU memory it holds with how busy that GPU is, before the zoom. `5.1 GB  17.9 GB · 87%`.
- **Its menu**, opened from either figure: a meter for this kernel and one for the machine (or the
  container, when it has a limit); for each GPU the kernel holds memory on, a meter for its share and
  one for how busy the device is; and _Restart kernel_, which is the notebook's own command and asks
  first.
- **The Jupyter info panel**: a _This machine_ section above the kernels, with a memory meter and one
  meter per GPU, naming the notebook that holds most of each GPU; and each kernel's memory on its row,
  before the time it last spoke. The row's tooltip adds what the figure counts and the GPU memory by
  device.

Rows keep their order. Sorting by memory would move them on every read, under a pointer heading for a
button.

### Nearly full

From 90% a meter takes the warning colour. The status bar does not change colour, since a warning hue
on the bar fails contrast in some themes; the figure changes its icon to a warning and says how full
instead: `5.1 GB · machine 94%`, or `22 GB · GPU 96% full`.

### When a GPU's memory belongs to nobody

Inside a container, `nvidia-smi` names the host's process ids, which do not exist in the container, so
none of a GPU's memory can be put down to a kernel. The server reports that memory as `unattributed`,
and the status bar falls back to the device's own figures: `GPU 18.2 of 24 GB · 87%`.

## What is measured

**A kernel is its process tree.** The kernel's own process, every descendant, and every process in its
process group (the kernel is started as a group leader). A DataLoader's workers, a `multiprocessing`
pool and a Ray worker started from a cell all count. Descendants and the group are both taken because
each misses something: a worker that calls `setsid` leaves the group but stays a descendant; one whose
parent has exited is re-parented to init but keeps the group.

**Each process counts its footprint, not its resident size.** Adding up resident sizes is wrong both
ways:

| Platform | Counted                                                               | Why not RSS                                                                                                      |
| -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Linux    | `Pss` from `/proc/<pid>/smaps_rollup`                                 | Forked workers share the kernel's pages until they write to them, so RSS counts the same memory once per worker. |
| macOS    | `ri_phys_footprint` from `proc_pid_rusage`, as Activity Monitor shows | macOS compresses untouched memory: a worker holding 400 MB reads as 80 MB resident within seconds.               |

Either falls back to RSS for a process it cannot read. On macOS `proc_pid_rusage` is libproc's wrapper
for the `proc_info` system call, which is made directly because release builds have no cgo.

**The machine is its limit.** On Linux, the cgroup's memory limit when there is one (v2, then v1),
since a container is killed at its limit whatever the host has; its usage leaves out inactive page
cache, as `docker stats` does. Otherwise `MemTotal` less `MemAvailable`. On macOS, wired, active and
compressed pages, which is Activity Monitor's _Memory Used_.

**GPUs are NVIDIA's, through `nvidia-smi`.** Device memory and utilisation from `--query-gpu`, and
memory per process from `--query-compute-apps`. Utilisation is only reported for the whole device, so
the menu says it is not the kernel's alone.

**Windows is not read.** The server answers no memory and no kernels, and nothing is shown. A GPU is
still listed if `nvidia-smi` is on the path.

## The cost

One reading answers every caller for a second: the status bar polls every 2 seconds and the panel every
5, in every open window, and they share it. A reading is one walk of `/proc` (or one `ps`), the
footprint of the processes in kernels' trees only, and at most one `nvidia-smi`.

`nvidia-smi` is looked for once, so a machine without it never runs anything. A call has a 3-second
timeout, and one that fails is not tried again for a minute: a driver that does not match its kernel
module fails slowly, and every poll would wait for it. A request that is cancelled does not cancel the
shared reading.

The browser asks only while it would show the answer: the status bar while a notebook with a kernel is
in front, the panel while it is open, and neither while the page is hidden.

## Where the work is done

| Piece                  | Where                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading the system     | `internal/resources/` — `resources.go` (the tree, the sampler), `proc_linux.go`, `proc_darwin.go`, `nvidia.go`, and the parsers in `parse.go` |
| The endpoint           | `ResourcesHandler` in `internal/kernel/kernel_api_handler.go`: `GET /api/kernels/resources`, in [API.md](API.md)                              |
| Polling and formatting | `ui/src/store/kernelResources.ts`, `ui/src/ide/resources/memory.ts`                                                                           |
| The status bar item    | `ui/src/ide/statusBar/KernelResourceStatus.tsx`                                                                                               |
| The panel              | `ui/src/ide/sidebar/jupyterInfoPanel/MachineSection.tsx`, and `KernelList.tsx` for the rows                                                   |
| A meter                | `.z-meter` in `ui/src/styles/_controls.scss`, and `ui/src/ide/resources/Reading.tsx`                                                          |

Sizes are in powers of 1024 under the names everyone uses: `812 MB`, `5.1 GB`, `24 GB`.

## Not done

- **Why a kernel died.** A kernel killed for running out of memory dies with no reason given. With
  each kernel's last reading kept after it exits, the notebook could say "the kernel died while the
  machine was 97% full".
- **AMD and Apple GPUs.** `rocm-smi` would fit beside `nvidia-smi`; Apple's GPU shares the machine's
  memory and has no per-process figure to read.
- **History.** Each reading replaces the last. A sparkline of a training run's memory would need the
  server to keep them.
