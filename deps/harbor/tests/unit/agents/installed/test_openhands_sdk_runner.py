"""Focused tests for the standalone OpenHands SDK runner."""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock


def _load_runner(monkeypatch, condenser_type: type) -> ModuleType:
    openhands = ModuleType("openhands")
    sdk = ModuleType("openhands.sdk")
    context = ModuleType("openhands.sdk.context")
    condenser = ModuleType("openhands.sdk.context.condenser")
    event = ModuleType("openhands.sdk.event")
    tools = ModuleType("openhands.tools")
    file_editor = ModuleType("openhands.tools.file_editor")
    task_tracker = ModuleType("openhands.tools.task_tracker")
    terminal = ModuleType("openhands.tools.terminal")

    for name in ("LLM", "Agent", "AgentContext", "Conversation", "Tool"):
        setattr(sdk, name, type(name, (), {}))
    sdk.get_logger = lambda name: Mock()
    context.Skill = type("Skill", (), {})
    condenser.LLMSummarizingCondenser = condenser_type
    for name in ("ActionEvent", "MessageEvent", "ObservationEvent", "TokenEvent"):
        setattr(event, name, type(name, (), {}))
    file_editor.FileEditorTool = type("FileEditorTool", (), {"name": "file_editor"})
    task_tracker.TaskTrackerTool = type("TaskTrackerTool", (), {"name": "task_tracker"})
    terminal.TerminalTool = type("TerminalTool", (), {"name": "terminal"})

    modules = {
        "openhands": openhands,
        "openhands.sdk": sdk,
        "openhands.sdk.context": context,
        "openhands.sdk.context.condenser": condenser,
        "openhands.sdk.event": event,
        "openhands.tools": tools,
        "openhands.tools.file_editor": file_editor,
        "openhands.tools.task_tracker": task_tracker,
        "openhands.tools.terminal": terminal,
    }
    for name, module in modules.items():
        monkeypatch.setitem(sys.modules, name, module)

    runner_path = (
        Path(__file__).parents[4]
        / "src/harbor/agents/installed/openhands_sdk_runner.py"
    )
    spec = importlib.util.spec_from_file_location(
        "openhands_sdk_runner_test", runner_path
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_condenser_disabled_by_default(monkeypatch):
    class Condenser:
        pass

    runner = _load_runner(monkeypatch, Condenser)
    monkeypatch.setenv("OPENHANDS_SDK_ENABLE_CONDENSER", "0")

    assert runner.create_condenser(Mock()) is None


def test_condenser_uses_explicit_settings(monkeypatch):
    class Condenser:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    llm = Mock()
    condenser_llm = object()
    llm.model_copy.return_value = condenser_llm
    runner = _load_runner(monkeypatch, Condenser)
    monkeypatch.setenv("OPENHANDS_SDK_ENABLE_CONDENSER", "1")
    monkeypatch.setenv("OPENHANDS_SDK_CONDENSER_MAX_SIZE", "240")
    monkeypatch.setenv("OPENHANDS_SDK_CONDENSER_KEEP_FIRST", "2")

    result = runner.create_condenser(llm)

    llm.model_copy.assert_called_once_with(update={"usage_id": "condenser"})
    assert result.kwargs == {
        "llm": condenser_llm,
        "max_size": 240,
        "keep_first": 2,
    }


def test_main_passes_explicit_token_limits_to_llm(monkeypatch, tmp_path):
    class Condenser:
        pass

    runner = _load_runner(monkeypatch, Condenser)
    llm = Mock()
    llm.metrics = SimpleNamespace(
        accumulated_token_usage=None,
        accumulated_cost=0.0,
    )
    llm_factory = Mock(return_value=llm)
    agent = SimpleNamespace(static_system_message=None, tools_map={})
    conversation = Mock()
    conversation.state = SimpleNamespace(events=[])

    monkeypatch.setattr(runner, "LLM", llm_factory)
    monkeypatch.setattr(runner, "Tool", lambda **kwargs: kwargs)
    monkeypatch.setattr(runner, "AgentContext", lambda **kwargs: kwargs)
    monkeypatch.setattr(runner, "Agent", lambda **kwargs: agent)
    monkeypatch.setattr(runner, "Conversation", lambda **kwargs: conversation)
    monkeypatch.setenv("LLM_MODEL", "zai/glm-5.2")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.z.ai/api/paas/v4")
    monkeypatch.setenv("LLM_MAX_INPUT_TOKENS", "1000000")
    monkeypatch.setenv("LLM_MAX_OUTPUT_TOKENS", "131072")
    monkeypatch.setenv(
        "LITELLM_EXTRA_BODY",
        '{"thinking":{"type":"enabled"},"reasoning_effort":"max","max_tokens":131072}',
    )
    monkeypatch.setenv("LOAD_SKILLS", "0")
    monkeypatch.setenv("OPENHANDS_SDK_ENABLE_CONDENSER", "0")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_agent.py",
            "--instruction=test",
            f"--logs-dir={tmp_path / 'logs'}",
            f"--trajectory-path={tmp_path / 'trajectory.json'}",
        ],
    )

    runner.main()

    llm_factory.assert_called_once_with(
        model="zai/glm-5.2",
        api_key="test-key",
        base_url="https://api.z.ai/api/paas/v4",
        max_input_tokens=1_000_000,
        max_output_tokens=131_072,
        litellm_extra_body={
            "thinking": {"type": "enabled"},
            "reasoning_effort": "max",
            "max_tokens": 131_072,
        },
    )
    conversation.send_message.assert_called_once_with("test")
    conversation.run.assert_called_once_with()
