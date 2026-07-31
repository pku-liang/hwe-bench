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
  --ak reasoning_effort=xhigh \
  --ak web_search=disabled \
  -k 1 -r 2 --n-concurrent 4 \
  --agent-setup-timeout-multiplier 2.0 \
  --job-name hwe-ibex-codex
```

HWE-bench does not use Harbor's reward score as the benchmark score. Harbor runs the agent and records patches; `hwe_bench.harness.evaluator` replays those patches against the hidden fail-to-pass tests and writes the final report. See [../docs/agents.md](../docs/agents.md) for the full evaluation workflow.

## Upstream Base

`deps/harbor/` is vendored as a subtree-style dependency. The current snapshot pins upstream `main` at commit `00c19fe2` (`[codex] Extract job planning into JobPlan (#2187)`), with the HWE-bench-specific patch listed below. This post-v0.20 snapshot still reports the package version as `0.20.0`.

The current HWE-bench snapshot keeps the vendored source in-tree rather than depending on a separately published Harbor fork because the OpenHands SDK adapter needs one benchmark-specific configuration surface.

## Local Patches

The retained Harbor patch is:

| Area | Patch | Purpose |
|------|-------|---------|
| OpenHands SDK runtime configuration | Add `enable_condenser`, `condenser_max_size`, `condenser_keep_first`, `max_input_tokens`, and `max_output_tokens` agent kwargs. | Keeps upstream behavior unchanged by default while allowing HWE-bench runs to request the standard 240/2 condenser and provide explicit model limits when LiteLLM metadata is unavailable. |

Codex web search, provider-specific request fields, proxy bypass settings, and Kimi model configuration are supplied through task or run configuration rather than Harbor source changes. OpenHands SDK recipes must pass all three condenser kwargs when results need to remain comparable with earlier HWE-bench OpenHands runs; model limits remain optional and are set per run.
