# HWE-bench

A benchmark for evaluating coding agents on RTL/hardware bug-fixing tasks. HWE-bench curates 417 real bug-fix cases from 6 open-source hardware projects (ibex, cva6, caliptra, rocket-chip, XiangShan, OpenTitan) across Verilog, SystemVerilog, and Chisel. Each case is verified end-to-end via simulation (fail-to-pass): the included test fails on the buggy commit and passes after the fix.

Methodology, design decisions, and detailed analysis are described in the accompanying [paper](https://arxiv.org/abs/2604.14709).

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Paper](https://img.shields.io/badge/Paper-arXiv-red)](https://arxiv.org/abs/2604.14709)
[![Dataset](https://img.shields.io/badge/Dataset-HuggingFace-orange)](https://huggingface.co/datasets/henryen/hwe-bench)

## Contents

- [News](#news)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Running an Evaluation](#running-an-evaluation)
- [Results](#results)
- [Adding a New Repository](#adding-a-new-repository)
- [Repository Layout](#repository-layout)
- [Citation](#citation)

## News

- **2026-04-26:** Updated the reference results with three new model scores: Kimi K2.6 at 66.9%, DeepSeek V4 Pro at 60.6%, and DeepSeek V4 Flash at 58.3%. Kimi K2.6 was evaluated with Kimi CLI; both DeepSeek V4 models were evaluated with Claude Code using a 1M context window and max thinking effort.

## Quick Start

Clone, install dependencies, download the benchmark data, and run Codex on the ibex subset (smallest, 35 cases):

```bash
# 1. Clone and install
git clone https://github.com/pku-liang/hwe-bench.git
cd hwe-bench
uv sync
uv tool install --editable ./deps/harbor --force

# 2. Download dataset and per-PR Docker images
hf download henryen/hwe-bench --repo-type dataset --local-dir datasets/
./scripts/pull_images.sh ibex

# 3. Generate task directories
uv run python -m hwe_bench.harness.harbor.adapter \
  --input datasets/lowRISC__ibex.jsonl \
  --output tasks/hwe-bench-ibex/

# 4. Run the agent
export CODEX_AUTH_JSON_PATH=~/.codex/auth.json
harbor run --path tasks/hwe-bench-ibex/ \
  -a codex -m openai/gpt-5.4 --ak reasoning_effort=xhigh \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name my-first-run

# 5. Extract patches and score
uv run python -m hwe_bench.harness.harbor.verify_bridge \
  --harbor-job-dir jobs/my-first-run \
  --output results/my-first-run/patches

uv run python -m hwe_bench.harness.evaluator \
  --workdir $(pwd)/results/my-first-run/eval_workdir \
  --patch_files $(pwd)/results/my-first-run/patches/patches.jsonl \
  --dataset_files $(pwd)/datasets/lowRISC__ibex.jsonl \
  --output_dir results/my-first-run/eval \
  --log_dir $(pwd)/results/my-first-run/eval_logs \
  --stop_on_error false --max_workers 4
```

The aggregate report lands at `results/my-first-run/eval/final_report.json`.
For detailed agent recipes, scoring conventions, and troubleshooting notes, see [docs/agents.md](docs/agents.md).

## Installation

### Prerequisites

- Linux (tested on Ubuntu 22.04)
- Docker 20.10+ (rootless supported and recommended)
- Python 3.12+
- [uv](https://github.com/astral-sh/uv)
- [huggingface_hub](https://pypi.org/project/huggingface-hub/) CLI (`pip install -U huggingface_hub`) for dataset download
- Disk space: roughly 200 GB for the published non-OpenTitan image set (ibex alone is ~10 GB); OpenTitan local builds require additional storage
- Network access to `ghcr.io/pku-liang`, HuggingFace Hub, and GitHub

### Install HWE-bench

```bash
git clone https://github.com/pku-liang/hwe-bench.git
cd hwe-bench
uv sync
uv tool install --editable ./deps/harbor --force
```

The vendored Harbor dependency is documented in [deps/README.md](deps/README.md), including its upstream base and HWE-bench-specific patches.

### Dataset

All JSONL datasets are hosted on [HuggingFace](https://huggingface.co/datasets/henryen/hwe-bench):

```bash
hf download henryen/hwe-bench --repo-type dataset --local-dir datasets/
```

The repository-specific JSONL files are:

| Scope | Dataset file |
|-------|--------------|
| ibex | `datasets/lowRISC__ibex.jsonl` |
| cva6 | `datasets/openhwgroup__cva6.jsonl` |
| caliptra-rtl | `datasets/chipsalliance__caliptra-rtl.jsonl` |
| rocket-chip | `datasets/chipsalliance__rocket-chip.jsonl` |
| XiangShan | `datasets/OpenXiangShan__XiangShan.jsonl` |
| OpenTitan | `datasets/lowRISC__opentitan.jsonl` |
| Full benchmark | `datasets/hwe_bench_full.jsonl` |

`datasets/hwe_bench_full.jsonl` contains all 417 cases for analysis and aggregate loading. Use the repository-specific files when running evaluations.

### Docker Images

Per-PR Docker images are published at `ghcr.io/pku-liang`. Pull images for one repository at a time:

```bash
./scripts/pull_images.sh ibex --dataset datasets/lowRISC__ibex.jsonl
```

OpenTitan images are not distributed because the benchmark flow requires Synopsys VCS. To build OpenTitan locally, first provide a local `vcs:minimal` image with your own VCS installation and license environment, then follow [docs/building-images.md](docs/building-images.md).

The pull script retags remote images into the local `hwebench/...` names used by the harness and Harbor task files.
The `--dataset` path can point anywhere; image tags are derived from the JSONL records, not from the file name.

If you prefer to rebuild other images from source, see [docs/building-images.md](docs/building-images.md).
For a fuller description of image tags, retagging, and source builds, see [docs/images.md](docs/images.md) and [docs/building-images.md](docs/building-images.md).

### Agent Credentials

Set environment variables for the agents you plan to evaluate:

| Agent | Variable | Notes |
|---|---|---|
| Claude Code | `CLAUDE_CODE_OAUTH_TOKEN` | Also pass `--ae ANTHROPIC_API_KEY=` to clear any host-side API key |
| Codex CLI | `CODEX_AUTH_JSON_PATH` | Host path to `~/.codex/auth.json`; Harbor uploads it into the container |
| Kimi CLI | `KIMI_API_KEY` | Format `sk-kimi-...` (not `MOONSHOT_API_KEY`) |
| OpenHands SDK | `LLM_API_KEY` | Provider-specific, passed through to LiteLLM see [docs/agents.md](docs/agents.md) for endpoint details |

Agent-specific command templates and provider notes are documented in [docs/agents.md](docs/agents.md).

## Running an Evaluation

The evaluation pipeline has four steps. A full run over all 417 cases typically takes around a day of wall-clock time with 4 concurrent containers.
This section gives the short path; [docs/agents.md](docs/agents.md) covers agent-specific flags, credentials, resume behavior, and scoring details.

### 1. Generate task directories

```bash
uv run python -m hwe_bench.harness.harbor.adapter \
  --input datasets/<dataset>.jsonl \
  --output tasks/hwe-bench-<repo>/
```

Re-run the adapter whenever per-PR Docker images are rebuilt; task `test.sh` files embed the image's base-commit SHA, which changes across rebuilds.

### 2. Run the agent

`--no-delete` is **mandatory**. Without it Harbor deletes per-PR images between retries, breaking subsequent attempts.

```bash
# Codex CLI
export CODEX_AUTH_JSON_PATH=~/.codex/auth.json
harbor run --path tasks/hwe-bench-<repo>/ \
  -a codex -m openai/gpt-5.4 --ak reasoning_effort=xhigh \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-<repo>-codex

# Claude Code
harbor run --path tasks/hwe-bench-<repo>/ \
  -a claude-code -m anthropic/claude-sonnet-4-6 \
  --ak max_turns=500 --ak reasoning_effort=high \
  --ak "disallowed_tools=WebSearch,WebFetch" \
  --ae CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  --ae ANTHROPIC_API_KEY= \
  --ae CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-<repo>-claude
```

Recipes for other agents (Kimi, DeepSeek, Qwen, GLM): see [docs/agents.md](docs/agents.md).

### 3. Extract patches

```bash
uv run python -m hwe_bench.harness.harbor.verify_bridge \
  --harbor-job-dir jobs/<job-name> \
  --output results/<job-name>/patches
```

### 4. Score

```bash
uv run python -m hwe_bench.harness.evaluator \
  --workdir $(pwd)/results/<job-name>/eval_workdir \
  --patch_files $(pwd)/results/<job-name>/patches/patches.jsonl \
  --dataset_files $(pwd)/datasets/<dataset>.jsonl \
  --output_dir results/<job-name>/eval \
  --log_dir $(pwd)/results/<job-name>/eval_logs \
  --stop_on_error false --max_workers 4
```

The aggregate report is at `results/<job-name>/eval/final_report.json`. Per-case reports live in `results/<job-name>/eval_workdir/<org>/<repo>/evals/pr-<N>/report.json`. `--workdir` must be an absolute path (required by Docker's bind-mount).

## Results

Scores on the 417-case benchmark, with default settings (`-k 1 -r 2`):

![HWE-bench resolved rates](docs/assets/benchmark_results.png)

Per-repository breakdowns and analysis: see the [paper](https://arxiv.org/abs/2604.14709).

## Adding a New Repository

HWE-bench supports Verilog, SystemVerilog, and Chisel repositories. Adding a new repo involves running the s01–s08 collection pipeline, implementing a harness class (Docker base image plus prepare scripts), writing prompt templates for tbgen/verify/psgen, running s09–s11 to produce an eval-ready JSONL, and generating task directories via the adapter.

The construction pipeline is documented in stages: [collect](hwe_bench/collect/README.md) covers s01–s08 PR collection and scoring, [harness](hwe_bench/harness/README.md) gives the overall s09–s11 flow, and the stage-specific documents cover [tbgen](hwe_bench/harness/tbgen/README.md), [verify](hwe_bench/harness/verify/README.md), [psgen](hwe_bench/harness/psgen/README.md), and [repository harnesses](hwe_bench/harness/repos/README.md).

## Repository Layout

```
hwe_bench/
  collect/            # s01-s08: GitHub PR collection and filtering
  harness/
    base.py           # core types: PullRequest, Image, Instance, Config
    docker_runner.py  # image builds and f2p validation
    evaluator.py      # offline patch scoring
    reporting.py      # report aggregation
    harbor/           # Harbor adapter (JSONL → task dirs, patch extraction)
    tbgen/            # s09: test-bench generation
    verify/           # s10: verification in Docker
    psgen/            # s11: problem-statement generation
    audit/            # trajectory audit pipeline
    repos/            # per-repo harnesses
      verilog/{ibex,cva6,opentitan,caliptra}/
      chisel/{xiangshan,rocketchip}/
deps/
  harbor/             # Harbor framework (git subtree)
datasets/             # JSONL datasets (downloaded separately; not in git)
tasks/                # Harbor task dirs (generated by adapter; not in git)
jobs/                 # Harbor run outputs (not in git)
results/              # Patches and evaluation outputs (not in git)
docs/                 # Extended documentation
```

## Citation

If you use HWE-bench in your research, please cite:

```bibtex
@article{cui2026hwe,
  title={HWE-Bench: Benchmarking LLM Agents on Real-World Hardware Bug Repair Tasks},
  author={Cui, Fan and Hou, Hongyuan and Luo, Zizhang and Yin, Chenyun and Liang, Yun},
  journal={arXiv preprint arXiv:2604.14709},
  year={2026}
}
```

## License

Apache 2.0. See [LICENSE](LICENSE).

## Acknowledgments

HWE-bench builds on open-source contributions from the hardware design community. We thank the maintainers of the six benchmark subject repositories: [ibex](https://github.com/lowRISC/ibex) (lowRISC), [cva6](https://github.com/openhwgroup/cva6) (OpenHW Group), [caliptra-rtl](https://github.com/chipsalliance/caliptra-rtl) and [rocket-chip](https://github.com/chipsalliance/rocket-chip) (CHIPS Alliance), [XiangShan](https://github.com/OpenXiangShan/XiangShan) (OpenXiangShan), and [OpenTitan](https://github.com/lowRISC/opentitan) (lowRISC).

The evaluation harness is built on [Harbor](https://github.com/harbor-framework/harbor). The project was originally forked from [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench) and rewritten for hardware description languages.
