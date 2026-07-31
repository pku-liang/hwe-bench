# Agents

This document describes how to evaluate coding agents on HWE-bench. It covers the four agent integrations that ship with reference recipes, the flags that control a `harbor run`, and the scoring workflow that turns a Harbor job into a final resolved/unresolved count.

Skim the README first for the Quick Start and installation. This document assumes the repository is cloned, `uv sync` has run, Harbor is installed (`uv tool install --editable ./deps/harbor --force`), the benchmark JSONLs are under `datasets/`, and per-PR Docker images have been pulled (or built) for the repository you plan to evaluate.

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

All recipes share the same core flags: `-k 1 -r 2` for "one attempt per task, retry up to two transient failures"; `--n-concurrent` for parallelism; `--agent-setup-timeout-multiplier` to give slower agent CLIs extra time to install. Their meanings are explained in the next section.

Generated HWE-bench tasks use Harbor task schema 1.4, keep setup and agent execution on the public network, and set the verifier phase to `no-network`. The pinned Harbor snapshot supports hostname allowlists, but its Docker network sidecar cannot resolve allowed hostnames on the tested rootless Docker setup, whose resolver is `10.0.2.3`. Keep the explicit Codex and Claude search restrictions below; only enable an agent allowlist after its Docker runtime passes Harbor's network-policy test.

### Codex CLI (OpenAI)

Codex authenticates through a ChatGPT Pro/Plus login stored in `~/.codex/auth.json`. Harbor uploads the file into the container directly when `CODEX_AUTH_JSON_PATH` points at it on the host:

```bash
export CODEX_AUTH_JSON_PATH=~/.codex/auth.json
harbor run --path tasks/hwe-bench-<repo>/ \
  -a codex -m openai/gpt-5.5 \
  --ak version=0.145.0 \
  --ak reasoning_effort=xhigh \
  --ak web_search=disabled \
  -k 1 -r 2 --n-concurrent 4 \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-<repo>-codex
```

Harbor exposes the Codex web-search setting through `--ak`; every reported HWE-bench run must pass `web_search=disabled` explicitly. Task ids contain the upstream repository and PR number, so web access could let the agent retrieve the original fix.

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
  -k 1 -r 2 --n-concurrent 4 \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-<repo>-claude
```

Disallowing `WebSearch` and `WebFetch` is the Claude-side equivalent of the Codex `web_search=disabled` setting. Raising `CLAUDE_CODE_MAX_OUTPUT_TOKENS` from the default 64k to 128k avoids thinking-loop truncation on longer multi-file edits. Swap the model identifier to `anthropic/claude-opus-4-6` for Opus runs; the remaining flags carry over.

### Kimi Code (Moonshot)

Kimi Code authenticates against the **Kimi Code** subscription plan (<https://www.kimi.com/code>), not the usage-based Moonshot platform. It uses the dedicated `api.kimi.com` endpoint with a key of the form `sk-kimi-...`, which is distinct from the Moonshot platform's `api.moonshot.cn` / `MOONSHOT_API_KEY` (`sk-...`). Crossing the two yields HTTP 401:

```bash
export KIMI_MODEL_API_KEY=sk-kimi-xxxxx
harbor run --path tasks/hwe-bench-<repo>/ \
  -a kimi-code -m k3 \
  --ak version=0.31.0 \
  --ae KIMI_MODEL_API_KEY="$KIMI_MODEL_API_KEY" \
  --ae KIMI_MODEL_BASE_URL=https://api.kimi.com/coding/v1 \
  --ae KIMI_MODEL_MAX_CONTEXT_SIZE=1048576 \
  --ae KIMI_MODEL_CAPABILITIES=thinking,always_thinking,image_in,video_in,tool_use \
  --ae KIMI_MODEL_THINKING_EFFORT=max \
  --ae KIMI_LOOP_MAX_STEPS_PER_TURN=500 \
  --ae KIMI_MODEL_TEMPERATURE=1.0 \
  --ae KIMI_MODEL_TOP_P=0.95 \
  -k 1 -r 2 --n-concurrent 2 \
  --agent-setup-timeout-multiplier 3.0 \
  --job-name hwe-<repo>-kimi
```

This recipe selects K3 with max thinking effort, a declared 1M-token context, and a 500-step turn limit. Harbor's `kimi-code` adapter supplies `-m` as `KIMI_MODEL_NAME`, while the `KIMI_MODEL_*` variables configure the key, endpoint, model capabilities, and sampling parameters directly in Kimi Code. The coding endpoint requires `top_p=0.95` for K3; `1.0` is rejected. Do not pass a provider-qualified model alias or rely on `KIMI_API_KEY`: the adapter expects the subscription key in `KIMI_MODEL_API_KEY`.

### GLM-5.2 via OpenHands SDK

OpenHands SDK is a model-agnostic agent runtime; HWE-bench uses it for backends that do not ship a dedicated CLI. GLM-5.2 authenticates through `LLM_API_KEY`, which OpenHands routes via LiteLLM:

```bash
export LLM_API_KEY=$ZAI_API_KEY
export LLM_BASE_URL=https://api.z.ai/api/paas/v4
unset LLM_TEMPERATURE
harbor run --path tasks/hwe-bench-<repo>/ \
  -a openhands-sdk -m zai/glm-5.2 \
  --ak version=1.36.1 \
  --ak max_iterations=500 \
  --ak max_input_tokens=1000000 \
  --ak max_output_tokens=131072 \
  --ak enable_condenser=true \
  --ak condenser_max_size=240 \
  --ak condenser_keep_first=2 \
  --ae LLM_API_KEY="$LLM_API_KEY" \
  --ae LLM_BASE_URL="$LLM_BASE_URL" \
  --ae 'LITELLM_EXTRA_BODY={"thinking":{"type":"enabled"},"reasoning_effort":"max","max_tokens":131072}' \
  -k 1 -r 2 --n-concurrent 4 \
  --agent-setup-timeout-multiplier 3.0 \
  --job-name hwe-<repo>-glm52
```

LiteLLM does not currently provide GLM-5.2 context metadata, so the recipe passes the 1M input and 128K output limits explicitly. Keep `max_tokens=131072` in `LITELLM_EXTRA_BODY`: the Z.AI provider uses that request field for the output limit. The three condenser kwargs enable event-count-based compression after 240 events while retaining the first two; OpenHands leaves the condenser disabled when they are omitted.

## Flags worth understanding

A handful of `harbor run` flags deserve their own explanation because picking them wrong will either cost significant API budget or produce unreliable scores.

**`--no-delete` is optional with the pinned Harbor snapshot.** Default cleanup calls `docker compose down --rmi local`, which removes Harbor-built local images while preserving the external prebuilt image named by `environment.docker_image`. A rootless-Docker smoke run confirmed that the `hwebench/`, `mswebench/`, and registry tags for the tested task remained available after cleanup. Pass `--no-delete` only when retaining Harbor-built local images is useful for diagnosis; containers and networks are removed in either mode.

**`-k` versus `-r`.** `-k N` requests *N independent trials per task*, all of which run regardless of success — use this for pass@k metrics. `-r N` sets a retry budget for *orchestrator-level failures* (container crashes, network hiccups, transient API errors) and stops as soon as a trial succeeds. The default `-k 1 -r 2` means "run each task once, retry up to two times if something fails mid-run." Use `-k 3 -r 2` when you specifically need pass@3 data, and expect a 3× increase in API cost.

**`--n-concurrent`** picks the number of tasks that run in parallel. Four is a reasonable default for most backends; lower it to two for Kimi or providers with stricter rate limits.

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
  --ak "disallowed_tools=WebSearch,WebFetch" \
  --ae CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  --ae ANTHROPIC_API_KEY= \
  --ae CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
  -k 1 -r 2 --n-concurrent 4 \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-ibex-sonnet-smoke
```

Claude Sonnet on ibex scores 29 / 35 (83%) in our published runs; any result within ±2 confirms the pipeline is healthy. Numbers meaningfully outside that range usually point at one of three issues: stale task directories (re-run the adapter), wrong API credentials (check for `ANTHROPIC_API_KEY` leakage), or a partially pulled image set (`docker images | grep hwebench/` to inspect).
