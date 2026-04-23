# Vendored Dependencies

This directory contains third-party code that HWE-bench vendors directly. The only vendored dependency at the moment is [Harbor](https://github.com/harbor-framework/harbor), under `deps/harbor/`.

## Harbor

Harbor is the task runner used for agent evaluation. HWE-bench uses it to turn generated task directories into containerized agent runs, collect trajectories, and save the final workspace diff for offline scoring.

Install the vendored Harbor CLI from the repository root:

```bash
uv tool install --editable ./deps/harbor --force
```

Typical usage is through `harbor run` after generating task directories with the HWE-bench adapter:

```bash
harbor run --path tasks/hwe-bench-ibex/ \
  -a codex -m openai/gpt-5.4 \
  --ak reasoning_effort=high \
  -k 1 -r 2 --n-concurrent 4 --no-delete \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-ibex-codex
```

HWE-bench does not use Harbor's reward score as the benchmark score. Harbor runs the agent and records patches; `hwe_bench.harness.evaluator` replays those patches against the hidden fail-to-pass tests and writes the final report. See [../docs/agents.md](../docs/agents.md) for the full evaluation workflow.

## Upstream Base

`deps/harbor/` is vendored as a subtree-style dependency. The current snapshot is based on Harbor upstream `main` at commit `11b15883`, with the HWE-bench-specific patches listed below.

The current HWE-bench snapshot keeps the vendored source in-tree rather than depending on a separately published Harbor fork, because several small agent-runtime patches are still needed for the benchmark recipes below.

## Local Patches

The retained Harbor patches are:

| Area | Patch | Purpose |
|------|-------|---------|
| OpenHands SDK install | Switch SDK installation to `uv`. | Installs OpenHands SDK reliably in HWE-bench hardware containers whose shell environment may intercept bare `pip`. |
| OpenHands SDK runtime | Register GLM-5.1 and Qwen3.6-plus LiteLLM aliases and wire the condenser. | Supports the model names used in HWE-bench recipes and enables `LLMSummarizingCondenser(max_size=240, keep_first=2)` for long OpenHands SDK runs. |
| Kimi CLI configuration | Tune Kimi CLI for long-context benchmark tasks. | Uses the Kimi coding endpoint with a 262k-token context window and a higher per-turn step budget for long hardware debugging tasks. |
| Kimi CLI process management | Use a FIFO-based run command with exit-code normalization. | Prevents Kimi CLI cancellation and error exits from leaving Harbor waiting indefinitely or misclassifying normal termination. |

Several older local patches were dropped after the upstream sync because current Harbor or current dependencies already cover them. Notably, HWE-bench now uses Harbor's native `CODEX_AUTH_JSON_PATH` flow for Codex authentication, and the older DeepSeek `reasoning_content` replay patch is no longer needed with the synced OpenHands SDK / LiteLLM stack.

## Updating Harbor

When syncing Harbor again, keep the update as a subtree change and then reapply only the patches that are still necessary:

```bash
git subtree pull --prefix=deps/harbor harbor-upstream main --squash
```

If a future sync is easier to handle manually, maintainers may also replace `deps/harbor/` with a fresh upstream snapshot and reapply the HWE-bench patches as a separate commit. After any Harbor update, smoke-test at least one small HWE-bench task for each affected agent family: Codex CLI, Claude Code, OpenHands SDK backends, and Kimi CLI.
