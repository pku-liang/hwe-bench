# Agents

This document describes how to evaluate coding agents on HWE-bench. It covers the six agents that ship with reference recipes, the flags that control a `harbor run`, and the scoring workflow that turns a Harbor job into a final resolved/unresolved count.

Skim the README first for the Quick Start and installation. This document assumes the repository is cloned, `uv sync` has run, Harbor is installed (`uv tool install --editable ./deps/harbor`), the benchmark JSONLs are under `datasets/`, and per-PR Docker images have been pulled (or built) for the repository you plan to evaluate.

## Prerequisites

A dataset JSONL alone is not enough to run an evaluation. The dataset file defines the problem (base SHA, problem statement, hidden tests, testbench script) but an evaluation also needs three other artifacts to come together.

**Docker images** carry the pre-installed toolchain for each pull request — Verilator, Mill, SBT, RISC-V GCC, and so on — along with a finalized commit whose SHA the testbench embeds. Pull them from the registry with `scripts/pull_images.sh <repo>`, or rebuild them from source via [docs/building-images.md](building-images.md). OpenTitan is an exception: HWE-bench does not distribute OpenTitan images because its evaluation flow requires Synopsys VCS; build those images locally from a `vcs:minimal` base image that you provide. Do not skip this step: Harbor will happily spin up containers and hand the agent a blank workspace if the image is missing, producing empty patches that look like zero-resolved runs.

**Task directories** are what Harbor actually consumes. The adapter reads the dataset JSONL, reads `/home/base_commit.txt` or the legacy `/home/<repo>_base_commit.txt` out of each image to capture the finalized SHA, and emits `tasks/hwe-bench-<repo>/<task-id>/` with `instruction.md` (the prompt the agent sees), `task.toml` (scheduling config), `environment/` (container entrypoints), and `tests/` (held out until scoring):

```bash
uv run python -m hwe_bench.harness.harbor.adapter \
  --input datasets/<dataset>.jsonl \
  --output tasks/hwe-bench-<repo>/
```

The adapter must be re-run whenever images are rebuilt. The finalized SHA drifts across rebuilds, and stale `test.sh` files silently produce empty patches when `git diff` against a missing commit fails.

**Agent clients and credentials.** Each agent runs inside its container with an installed CLI or SDK, authenticated against its backend. The recipes in the next section give the exact environment variables to set on the host before calling `harbor run`; Harbor passes them through.

With those three pieces in place, a `harbor run` produces `jobs/<job-name>/`, `verify_bridge` extracts `patches.jsonl`, and `evaluator` replays the hidden tests in a fresh container to decide pass-or-fail.

## How Harbor wires an agent

Harbor is task-oriented: one task directory becomes one container invocation. Given `harbor run --path tasks/hwe-bench-<repo>/ -a <agent> -m <model> --job-name <name>`, Harbor iterates over task subdirectories, starts a container from the per-PR image, installs the agent client into the container, and hands the agent `instruction.md` as the initial prompt. The agent has whatever tools its client provides (shell, editor, file read/write); it does **not** see `tests/` — that directory is held back and mounted only during the scoring phase. When the agent finishes or hits the turn limit, Harbor captures the container's modified working tree as a diff, writes it under `jobs/<job-name>/<task-id>/`, and moves on.

One practical consequence worth calling out: in HWE-bench's setup Harbor does not score. Its reward mechanism is stubbed to zero and the resolved/unresolved judgment happens offline in `evaluator`, which re-runs `tests/test.sh` inside a clean container against the agent's patch.

## Agent recipes

Each recipe below gives the host-side credential setup, the `harbor run` command template, the model identifier, and the constraints specific to that agent. Replace `<repo>` with one of `ibex`, `cva6`, `caliptra`, `rocketchip`, `xiangshan`, or `opentitan`.

All recipes share the same core flags: `-k 1 -r 2` for "one attempt per task, retry up to two transient failures"; `--n-concurrent` for parallelism; `--no-delete` to preserve per-PR images across retries; `--agent-setup-timeout-multiplier` to give slower agent CLIs extra time to install. Their meanings are explained in the next section.

### Codex CLI (OpenAI)

Codex authenticates through a ChatGPT Pro/Plus login stored in `~/.codex/auth.json`. Harbor uploads the file into the container directly when `CODEX_AUTH_JSON_PATH` points at it on the host:

```bash
export CODEX_AUTH_JSON_PATH=~/.codex/auth.json
harbor run --path tasks/hwe-bench-<repo>/ \
  -a codex -m openai/gpt-5.4 \
  --ak reasoning_effort=xhigh \
  --ak web_search=disabled \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-<repo>-codex
```

The adapter defaults to `web_search=disabled`; keep it disabled for benchmark reporting. Task ids contain the upstream repository and PR number, so web access could let the agent retrieve the original fix.

Codex also accepts an OpenAI API key via `OPENAI_API_KEY` for pay-as-you-go billing. The model identifier must be passed explicitly; there is no default. 

OAuth tokens carry one constraint worth surfacing: the `access_token` inside `auth.json` has a 10-day lifetime (visible as the `exp` claim in its JWT payload, and recorded alongside a `last_refresh` timestamp in the file). Check that it has not expired before starting a long run; if it has, run `codex login` on the host to refresh `auth.json`, then launch `harbor run`.

### Claude Code (Anthropic)

Claude Code accepts a long-lived OAuth token via `CLAUDE_CODE_OAUTH_TOKEN`, suitable for non-interactive container use. Generate one on the host with `claude setup-token` (requires an active Claude Pro / Max / Team / Enterprise subscription); the resulting token is valid for one year. Explicitly clear `ANTHROPIC_API_KEY` inside the container: Claude Code prefers the API key over the OAuth token when both are set, and a stray host-side key (even a zero-balance one) will make the agent abort with "credit balance too low". For further details on Claude Code authentication, see <https://code.claude.com/docs/en/authentication>.

```bash
harbor run --path tasks/hwe-bench-<repo>/ \
  -a claude-code -m anthropic/claude-sonnet-4-6 \
  --ak max_turns=500 \
  --ak reasoning_effort=high \
  --ak "disallowed_tools=WebSearch,WebFetch" \
  --ae CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  --ae ANTHROPIC_API_KEY= \
  --ae CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-<repo>-claude
```

Disallowing `WebSearch` and `WebFetch` is the Claude-side equivalent of the Codex `web_search=disabled` setting. Raising `CLAUDE_CODE_MAX_OUTPUT_TOKENS` from the default 64k to 128k avoids thinking-loop truncation on longer multi-file edits. Swap the model identifier to `anthropic/claude-opus-4-6` for Opus runs; the remaining flags carry over.

### Kimi CLI (Moonshot)

Kimi CLI authenticates against the **Kimi Code** subscription plan (<https://www.kimi.com/code>), not the usage-based Moonshot platform. It uses the dedicated `api.kimi.com` endpoint with a `KIMI_API_KEY` of the form `sk-kimi-...`, which is distinct from the Moonshot platform's `api.moonshot.cn` / `MOONSHOT_API_KEY` (`sk-...`). Crossing the two yields HTTP 401, which the Kimi adapter surfaces as a hung trial:

```bash
export KIMI_API_KEY=sk-kimi-xxxxx
harbor run --path tasks/hwe-bench-<repo>/ \
  -a kimi-cli -m kimi/kimi-for-coding \
  --ae KIMI_API_KEY="$KIMI_API_KEY" \
  -k 1 -r 2 --n-concurrent 2 --no-delete \
  --agent-setup-timeout-multiplier 3.0 \
  --job-name hwe-<repo>-kimi
```

The model identifier `kimi/kimi-for-coding` is an alias that the Kimi Code backend routes to the current coding-tuned snapshot; you do not pin a specific version here. The Kimi adapter configures a 262k-token context and a per-turn step limit of 500, both hardcoded — no `--ak` overrides are required. Kimi Code enforces a rolling quota of roughly 300–1200 requests per 5-hour window (depending on membership tier) with a 30-concurrent cap; start at `--n-concurrent 2` for long benchmark runs to avoid exhausting the window mid-repo, and raise only after confirming your quota.

### DeepSeek V3.2 via OpenHands SDK

OpenHands SDK is a model-agnostic agent runtime; HWE-bench uses it for backends that do not ship a dedicated CLI. DeepSeek authenticates through `LLM_API_KEY`, which OpenHands routes via LiteLLM:

```bash
export LLM_API_KEY=$DEEPSEEK_API_KEY
harbor run --path tasks/hwe-bench-<repo>/ \
  -a openhands-sdk -m deepseek/deepseek-reasoner \
  --ae MAX_ITERATIONS=500 \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --agent-setup-timeout-multiplier 3.0 \
  --job-name hwe-<repo>-deepseek
```

DeepSeek V3.2 has a 128k input / 64k output context budget. OpenHands uses an event-count-based summarizing condenser (240 events before compression, first two preserved), which keeps conversations comfortably within that envelope on every case. One environment footgun: if `LLM_BASE_URL` is exported on the host, OpenHands silently redirects DeepSeek traffic there — unset it before running DeepSeek.

### Qwen 3.6 Plus

Qwen 3.6 Plus runs through the generic OpenHands SDK adapter, authenticated via DashScope's API key:

```bash
export LLM_API_KEY=$DASHSCOPE_API_KEY
harbor run --path tasks/hwe-bench-<repo>/ \
  -a openhands-sdk -m dashscope/qwen3.6-plus \
  --ae MAX_ITERATIONS=500 \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --agent-setup-timeout-multiplier 3.0 \
  --job-name hwe-<repo>-qwen
```

Because LiteLLM's model registry does not yet list `dashscope/qwen3.6-plus`, HWE-bench's Harbor patch registers the alias at agent-install time, inheriting metadata from `dashscope/qwen3.5-plus` (~992k input, 65k output, function calling supported).

LiteLLM's `dashscope/` provider defaults to the mainland China endpoint `https://dashscope.aliyuncs.com/compatible-mode/v1`. Users outside mainland China should obtain a key from DashScope International (<https://dashscope-intl.console.aliyun.com>) and set `LLM_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1` before calling `harbor run`; the two endpoints use separate accounts and keys, and swapping them yields authentication errors.

### GLM-5.1 (Zhipu AI)

GLM-5.1 is authenticated against Zhipu's **GLM Coding Plan** subscription (<https://z.ai/subscribe>), not the usage-based Z.ai platform. The plan exposes GLM-5.1 alongside GLM-5-Turbo, GLM-4.7, and GLM-4.5-Air through a dedicated coding endpoint. Set both the API key and the coding endpoint:

```bash
export LLM_API_KEY=$ZAI_API_KEY
export LLM_BASE_URL=https://api.z.ai/api/coding/paas/v4
harbor run --path tasks/hwe-bench-<repo>/ \
  -a openhands-sdk -m zai/glm-5.1 \
  --ae MAX_ITERATIONS=500 \
  -k 1 -r 2 --n-concurrent 2 --no-delete \
  --agent-setup-timeout-multiplier 3.0 \
  --job-name hwe-<repo>-glm
```

Because LiteLLM's registry does not yet list `zai/glm-5.1`, HWE-bench's Harbor patch registers the alias at install time, inheriting metadata from `zai/glm-5` (200k input / 128k output). Users on the mainland China billing entity should substitute `LLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4` with a key issued by BigModel (<https://open.bigmodel.cn/glm-coding>); the two endpoints use separate accounts and keys.

## Flags worth understanding

A handful of `harbor run` flags deserve their own explanation because picking them wrong will either cost significant API budget or produce unreliable scores.

**`--no-delete` is mandatory.** Without it, Harbor calls `docker compose down --rmi` after each trial, which removes the per-PR image. Any `-r` retry then fails with "pull access denied" because the local image is gone. `--no-delete` only skips the `--rmi` step; containers and networks are still cleaned up normally.

**`-k` versus `-r`.** `-k N` requests *N independent trials per task*, all of which run regardless of success — use this for pass@k metrics. `-r N` sets a retry budget for *orchestrator-level failures* (container crashes, network hiccups, transient API errors) and stops as soon as a trial succeeds. The default `-k 1 -r 2` means "run each task once, retry up to two times if something fails mid-run." Use `-k 3 -r 2` when you specifically need pass@3 data, and expect a 3× increase in API cost.

**`--n-concurrent`** picks the number of tasks that run in parallel. Four is a reasonable default for most backends; lower it to two for GLM and Kimi to stay under per-provider rate limits.

**`--agent-setup-timeout-multiplier`** extends the default per-task setup timeout, which is used while the agent CLI is being installed inside the container. Two is enough for Codex and Claude Code; three helps Kimi and OpenHands SDK on networks with slower `uv` / `npm` / `pip` mirrors.

**`-i <task-id>`** filters the dataset down to a single task, useful for debugging. Use the task ID as it appears in the `tasks/` directory — for example, `-i ibex-pr-48`.

**`--job-name`** fixes the `jobs/<name>/` directory name and should generally match your `results/<name>/` naming. Without it, Harbor falls back to a timestamp, which makes downstream scoring paths harder to track.

## Scoring

Once the Harbor job finishes, two small commands turn `jobs/<name>/` into a `final_report.json`. `verify_bridge` walks the job directory, extracts each trial's final workspace diff, and writes a flat `patches.jsonl`. `evaluator` takes that patches file plus the original dataset JSONL, spins up one container per patch, applies the patch, runs `tests/test.sh`, and decides f2p based on the test marker output.

```bash
uv run python -m hwe_bench.harness.harbor.verify_bridge \
  --harbor-job-dir jobs/<name> \
  --output results/<name>/patches

uv run python -m hwe_bench.harness.evaluator \
  --workdir $(pwd)/results/<name>/eval_workdir \
  --patch_files $(pwd)/results/<name>/patches/patches.jsonl \
  --dataset_files $(pwd)/datasets/<dataset>.jsonl \
  --output_dir results/<name>/eval \
  --log_dir $(pwd)/results/<name>/eval_logs \
  --stop_on_error false --max_workers 4
```

Two path rules matter. `--workdir` must be an **absolute path** — Docker's bind mount rejects relative paths with an opaque error. And `--workdir` must be **persistent**: per-case `report.json` files only exist under the workdir, not under `--output_dir`, so putting the workdir under `/tmp` breaks resume and breaks any later audit pass. The canonical layout is `results/<name>/eval_workdir/` for the workdir and `results/<name>/eval/` for the aggregate report.

The evaluator supports resume. If `workdir/<org>/<repo>/evals/pr-N/report.json` already exists, that case is skipped on re-run. This is what makes split Harbor jobs — one initial run plus a resume pass for transient failures — score cleanly without redoing the completed cases. To force re-scoring of a specific PR, delete that case's `report.json` in place rather than wiping the whole workdir.

The final aggregate lands at `results/<name>/eval/final_report.json`, with the fields `resolved_ids`, `unresolved_ids`, `empty_patch_ids`, and `error_ids` summing to the dataset size.

## Reproducing the published scores

Full-benchmark reproduction is expensive (roughly a day of API calls per agent). A cheap sanity check that validates the full pipeline end-to-end is to run one agent on ibex, the smallest subset at 35 cases:

```bash
./scripts/pull_images.sh ibex
uv run python -m hwe_bench.harness.harbor.adapter \
  --input datasets/lowRISC__ibex.jsonl \
  --output tasks/hwe-bench-ibex/
export CLAUDE_CODE_OAUTH_TOKEN=<your-token>
harbor run --path tasks/hwe-bench-ibex/ \
  -a claude-code -m anthropic/claude-sonnet-4-6 \
  --ak max_turns=500 --ak reasoning_effort=high \
  --ae CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  --ae ANTHROPIC_API_KEY= \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --job-name hwe-ibex-sonnet-smoke
```

Claude Sonnet on ibex scores 29 / 35 (83%) in our published runs; any result within ±2 confirms the pipeline is healthy. Numbers meaningfully outside that range usually point at one of three issues: stale task directories (re-run the adapter), wrong API credentials (check for `ANTHROPIC_API_KEY` leakage), or a partially pulled image set (`docker images | grep hwebench/` to inspect).
