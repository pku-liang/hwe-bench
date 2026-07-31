from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any


TEMPLATES_DIR = Path(__file__).with_name("templates")
EVALUATION_CONSTRAINTS = (
    "## Evaluation constraints\n\n"
    "Solve this task using only the files and tools already present in the task "
    "environment. Do not issue commands or invoke tools to access the Internet "
    "or any external service, including GitHub, git remotes, package registries, "
    "search engines, documentation sites, or external APIs."
)

# Map (org, repo) to the directory name used inside Docker containers.
# Harness Dockerfiles clone repos into /home/<dir_name>.
# Legacy repos use lowercase repo name; new repos may differ.
_REPO_HOME_DIR: dict[tuple[str, str], str] = {
    ("OpenXiangShan", "XiangShan"): "xiangshan",
}


def _repo_home(org: str, repo: str) -> str:
    """Return the container directory name for a repo (under /home/)."""
    return _REPO_HOME_DIR.get((org, repo), repo)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            records.append(json.loads(line))
    return records


def parse_only(value: str | None) -> set[int] | None:
    if value is None or value.strip() == "":
        return None

    numbers: set[int] = set()
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        numbers.add(int(item))

    if not numbers:
        raise ValueError("--only did not contain any PR numbers")
    return numbers


def render_template(template_name: str, context: dict[str, str]) -> str:
    template_path = TEMPLATES_DIR / template_name
    text = template_path.read_text(encoding="utf-8")
    for key, value in context.items():
        text = text.replace(f"{{{{ {key} }}}}", value)
    return text


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def get_real_base_sha(image_name: str, repo: str) -> str:
    # New repos use /home/base_commit.txt; legacy repos use /home/{repo}_base_commit.txt
    candidates = [
        "/home/base_commit.txt",
        f"/home/{repo}_base_commit.txt",
    ]

    for path in candidates:
        result = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--entrypoint",
                "cat",
                image_name,
                path,
            ],
            capture_output=True,
            text=True,
        )

        sha = result.stdout.strip()
        if result.returncode == 0 and re.fullmatch(r"[0-9a-f]{40}", sha):
            return sha

    raise RuntimeError(
        f"Failed to extract base_sha from {image_name}: "
        f"tried {candidates}, last rc={result.returncode}, "
        f"stdout={result.stdout.strip()!r}, stderr={result.stderr.strip()!r}"
    )


def convert(records: list[dict[str, Any]], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)

    selected_task_dirs: list[Path] = []
    base_sha_cache: dict[tuple[str, str], str] = {}

    for record in records:
        org = str(record["org"])
        repo = str(record["repo"])
        number = int(record["number"])
        repo_home = _repo_home(org, repo)
        instance_id = f"{org}/{repo}:pr-{number}"
        image_name = f"hwebench/{org.lower()}_m_{repo.lower()}:pr-{number}"
        cache_key = (image_name, repo)

        if cache_key not in base_sha_cache:
            base_sha_cache[cache_key] = get_real_base_sha(image_name, repo)
        real_base_sha = base_sha_cache[cache_key]

        task_dir = output_dir / f"{repo}-pr-{number}"
        task_dir.mkdir(parents=True, exist_ok=True)

        write_text(
            task_dir / "task.toml",
            render_template(
                "task.toml.j2",
                {
                    "instance_id": instance_id,
                    "image_name": image_name,
                },
            ),
        )
        problem_statement = str(record["problem_statement"]).rstrip()
        write_text(
            task_dir / "instruction.md",
            f"{problem_statement}\n\n{EVALUATION_CONSTRAINTS}\n",
        )
        write_text(task_dir / "environment" / "docker-compose.yaml", "services: {}\n")
        write_text(
            task_dir / "tests" / "test.sh",
            render_template(
                "test.sh.j2",
                {
                    "repo": repo_home,
                    "base_sha": real_base_sha,
                    "instance_id": instance_id,
                },
            ),
        )
        write_text(
            task_dir / "solution" / "solve.sh",
            render_template(
                "solve.sh.j2",
                {
                    "repo": repo_home,
                    "fix_patch": str(record["fix_patch"]),
                },
            ),
        )

        selected_task_dirs.append(task_dir)

    return selected_task_dirs


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert HWE-bench s11 JSONL records into Harbor task directories."
    )
    parser.add_argument("--input", type=Path, required=True, help="Input s11 JSONL file.")
    parser.add_argument("--output", type=Path, required=True, help="Output Harbor task directory.")
    parser.add_argument(
        "--only",
        type=str,
        default="",
        help="Comma-separated PR numbers to include, e.g. 222,54,272.",
    )
    args = parser.parse_args()

    only_numbers = parse_only(args.only)
    records = read_jsonl(args.input)
    if only_numbers is not None:
        records = [record for record in records if int(record["number"]) in only_numbers]

    if not records:
        raise SystemExit("No records selected for conversion.")

    task_dirs = convert(records, args.output)
    print(f"Generated {len(task_dirs)} Harbor task directories in {args.output}")
    for task_dir in task_dirs:
        print(task_dir)


if __name__ == "__main__":
    main()
