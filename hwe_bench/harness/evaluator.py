# Copyright (c) 2024 Bytedance Ltd. and/or its affiliates

#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at

#      http://www.apache.org/licenses/LICENSE-2.0

#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.

import glob
import logging
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Dict, Optional

from dataclasses_json import dataclass_json

from hwe_bench.harness.base import (
    EVALUATION_WORKDIR,
    FIX_PATCH_RUN_LOG_FILE,
    REPORT_FILE,
    RUN_EVALUATION_LOG_FILE,
    Config,
    Instance,
    PullRequestBase,
)
from hwe_bench.harness.docker_runner import (
    build_images_for_instances,
    list_to_dict,
    run_instances,
)
from hwe_bench.harness.reporting import CliArgs as ReportBuilder, EvaluationRecord
from hwe_bench.utils import docker_util
from hwe_bench.utils.args_util import ArgumentParser
from hwe_bench.utils.logger import setup_logger

# Scoring container limit for tasks whose test needs more than docker_util.run's default 1800 s: five
# rocket-chip scripts give sbt 3600 s to fetch dependencies before the test runs, and rocket-chip 2036 and
# opentitan 14681 carry their own 3600 s limits.
SCORING_TIMEOUT_SECONDS = dict.fromkeys(
    [
        "chipsalliance/rocket-chip:pr-177",
        "chipsalliance/rocket-chip:pr-387",
        "chipsalliance/rocket-chip:pr-1493",
        "chipsalliance/rocket-chip:pr-1761",
        "chipsalliance/rocket-chip:pr-2036",
        "chipsalliance/rocket-chip:pr-2167",
        "lowRISC/opentitan:pr-14681",
    ],
    4500,
)


def get_parser() -> ArgumentParser:
    parser = ArgumentParser(
        description="Run offline evaluation for agent-generated fix patches."
    )
    parser.add_argument(
        "--workdir",
        type=Path,
        required=False,
        help="The path to the workdir.",
    )
    parser.add_argument(
        "--patch_files",
        type=str,
        nargs="*",
        required=False,
        help="The paths to the patch files. Supports glob patterns.",
    )
    parser.add_argument(
        "--dataset_files",
        type=str,
        nargs="*",
        required=False,
        help="The paths to the dataset files. Supports glob patterns.",
    )
    parser.add_argument(
        "--force_build",
        type=parser.bool,
        required=False,
        default=False,
        help="Whether to force build the images.",
    )
    parser.add_argument(
        "--output_dir",
        type=Path,
        required=False,
        default=None,
        help="The path to the output directory.",
    )
    parser.add_argument(
        "--specifics",
        type=str,
        nargs="*",
        required=False,
    )
    parser.add_argument(
        "--skips",
        type=str,
        nargs="*",
        required=False,
    )
    parser.add_argument(
        "--global_env",
        type=str,
        nargs="*",
        required=False,
        help="The global environment variables.",
    )
    parser.add_argument(
        "--clear_env",
        type=parser.bool,
        required=False,
        default=True,
        help="Whether to clear the environment variables.",
    )
    parser.add_argument(
        "--stop_on_error",
        type=parser.bool,
        required=False,
        default=True,
        help="Whether to stop on error.",
    )
    parser.add_argument(
        "--max_workers",
        type=int,
        required=False,
        default=8,
        help="The maximum number of workers to use.",
    )
    parser.add_argument(
        "--max_workers_build_image",
        type=int,
        required=False,
        default=8,
        help="The maximum number of workers to use for building the image.",
    )
    parser.add_argument(
        "--max_workers_run_instance",
        type=int,
        required=False,
        default=8,
        help="The maximum number of workers to use for running the instance.",
    )
    parser.add_argument(
        "--fix_patch_run_cmd",
        type=str,
        required=False,
        default="",
        help="The command to run the fix patch.",
    )
    parser.add_argument(
        "--log_dir",
        type=Path,
        required=False,
        default=None,
        help="The path to the log directory.",
    )
    parser.add_argument(
        "--log_level",
        type=str,
        required=False,
        default="INFO",
        help="The log level to use.",
    )
    parser.add_argument(
        "--log_to_console",
        type=parser.bool,
        required=False,
        default=True,
        help="Whether to log to the console.",
    )
    return parser


@dataclass_json
@dataclass
class Patch(PullRequestBase):
    fix_patch: str

    def __post_init__(self):
        if not isinstance(self.fix_patch, str):
            raise ValueError(f"Invalid patch: {self.fix_patch}")


@dataclass
class CliArgs:
    workdir: Path
    patch_files: Optional[list[str]]
    dataset_files: Optional[list[str]]
    force_build: bool
    output_dir: Optional[Path]
    specifics: Optional[set[str]]
    skips: Optional[set[str]]
    global_env: Optional[list[str]]
    clear_env: bool
    stop_on_error: bool
    max_workers: int
    max_workers_build_image: int
    max_workers_run_instance: int
    fix_patch_run_cmd: str
    log_dir: Path
    log_level: str
    log_to_console: bool

    def __post_init__(self):
        self._check_workdir()
        self._check_patch_files()
        self._check_dataset_files()
        self._check_output_dir()
        self._check_log_dir()
        self._check_log_level()
        self._check_log_to_console()
        self._check_max_workers()

    def _check_workdir(self):
        if not self.workdir:
            raise ValueError(f"Invalid workdir: {self.workdir}")
        if isinstance(self.workdir, str):
            self.workdir = Path(self.workdir)
        if not isinstance(self.workdir, Path):
            raise ValueError(f"Invalid workdir: {self.workdir}")
        if not self.workdir.exists():
            self.workdir.mkdir(parents=True, exist_ok=True)

    def _check_patch_files(self):
        if not self.patch_files:
            raise ValueError(f"Invalid patch_files: {self.patch_files}")

        self._patch_files: list[Path] = []
        for file_pattern in self.patch_files:
            matched_files = glob.glob(file_pattern)
            if not matched_files:
                raise ValueError(f"No files found matching pattern: {file_pattern}")
            self._patch_files.extend([Path(f) for f in matched_files])

        if not self._patch_files:
            raise ValueError("No patch files found after expanding patterns")

        for file_path in self._patch_files:
            if not file_path.exists():
                raise ValueError(f"Patch file not found: {file_path}")

    def _check_dataset_files(self):
        if not self.dataset_files:
            raise ValueError(f"Invalid dataset_files: {self.dataset_files}")

        self._dataset_files: list[Path] = []
        for file_pattern in self.dataset_files:
            matched_files = glob.glob(file_pattern)
            if not matched_files:
                raise ValueError(f"No files found matching pattern: {file_pattern}")
            self._dataset_files.extend([Path(f) for f in matched_files])

        if not self._dataset_files:
            raise ValueError("No dataset files found after expanding patterns")

        for file_path in self._dataset_files:
            if not file_path.exists():
                raise ValueError(f"Dataset file not found: {file_path}")

    def _check_output_dir(self):
        if not self.output_dir:
            raise ValueError(f"Invalid output_dir: {self.output_dir}")
        if isinstance(self.output_dir, str):
            self.output_dir = Path(self.output_dir)
        if not isinstance(self.output_dir, Path):
            raise ValueError(f"Invalid output_dir: {self.output_dir}")
        if not self.output_dir.exists():
            self.output_dir.mkdir(parents=True, exist_ok=True)

    def _check_log_dir(self):
        if not self.log_dir:
            raise ValueError(f"Invalid log_dir: {self.log_dir}")
        if isinstance(self.log_dir, str):
            self.log_dir = Path(self.log_dir)
        if not isinstance(self.log_dir, Path):
            raise ValueError(f"Invalid log_dir: {self.log_dir}")
        if not self.log_dir.exists():
            self.log_dir.mkdir(parents=True, exist_ok=True)

    def _check_log_level(self):
        self.log_level = self.log_level.upper()
        if self.log_level not in ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]:
            raise ValueError(f"Invalid log_level: {self.log_level}")

    def _check_log_to_console(self):
        if not isinstance(self.log_to_console, bool):
            raise ValueError(f"Invalid log_to_console: {self.log_to_console}")

    def _check_max_workers(self):
        if self.max_workers <= 0:
            raise ValueError(f"Invalid max_workers: {self.max_workers}")
        if self.max_workers_build_image <= 0:
            raise ValueError(
                f"Invalid max_workers_build_image: {self.max_workers_build_image}"
            )
        if self.max_workers_run_instance <= 0:
            raise ValueError(
                f"Invalid max_workers_run_instance: {self.max_workers_run_instance}"
            )

    @property
    def logger(self) -> logging.Logger:
        if not hasattr(self, "_logger"):
            self._logger = setup_logger(
                self.log_dir,
                RUN_EVALUATION_LOG_FILE,
                self.log_level,
                self.log_to_console,
            )
            self._logger.info("Initialize logger successfully.")
        return self._logger

    @property
    def patches(self) -> dict[str, Patch]:
        if not self.patch_files:
            raise ValueError(f"Invalid patch_files: {self.patch_files}")

        if not hasattr(self, "_patches"):
            self._patches: dict[str, Patch] = {}

            for file_path in self._patch_files:
                with open(file_path, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip() == "":
                            continue

                        patch = Patch.from_json(line)
                        self._patches[patch.id] = patch

        return self._patches

    @property
    def patch_ids(self) -> set[str]:
        if not hasattr(self, "_patch_ids"):
            self._patch_ids: set[str] = set(self.patches.keys())
        return self._patch_ids

    @property
    def dataset(self) -> Dict[str, EvaluationRecord]:
        if not self.dataset_files:
            raise ValueError(f"Invalid dataset_files: {self.dataset_files}")

        if not hasattr(self, "_dataset"):
            self.logger.info("Loading datasets...")
            self._dataset: dict[str, EvaluationRecord] = {}

            for file_path in self._dataset_files:
                with open(file_path, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip() == "":
                            continue

                        dataset = EvaluationRecord.from_json(line)
                        if not self.check_specific(dataset.id):
                            continue
                        if self.check_skip(dataset.id):
                            continue
                        self._dataset[dataset.id] = dataset

            self.logger.info(
                f"Successfully loaded {len(self._dataset)} valid datasets from {self.dataset_files}"
            )

        return self._dataset

    @property
    def instances(self) -> list[Instance]:
        if not hasattr(self, "_instances"):
            self.logger.info("Creating instances...")
            instances: list[Instance] = []
            config = Config(
                global_env=list_to_dict(self.global_env),
                clear_env=self.clear_env,
            )

            for pr in self.dataset.values():
                try:
                    instance = Instance.create(pr, config)
                    if not self.check_specific(instance.pr.id):
                        continue
                    if self.check_skip(instance.pr.id):
                        continue
                    instances.append(instance)
                except Exception as e:
                    self.logger.error(f"Error creating instance for {pr.id}: {e}")

            self._instances = [
                instance
                for instance in instances
                if instance.pr.id in self.patch_ids
            ]

            self.logger.info(
                f"Successfully loaded {len(self._instances)} valid instances."
            )

        return self._instances

    @classmethod
    def from_dict(cls, d: dict) -> "CliArgs":
        valid_fields = {field.name for field in fields(cls)}
        return cls(**{key: value for key, value in d.items() if key in valid_fields})

    def check_specific(self, name: str) -> bool:
        if self.specifics and not any(
            name in specific or specific in name for specific in self.specifics
        ):
            return False
        return True

    def check_skip(self, name: str) -> bool:
        if self.skips and any(name in skip or skip in name for skip in self.skips):
            return True
        return False

    def run_instance(self, instance: Instance):
        instance_dir = (
            self.workdir
            / instance.pr.org
            / instance.pr.repo
            / EVALUATION_WORKDIR
            / instance.dependency().workdir()
        )
        instance_dir.mkdir(parents=True, exist_ok=True)

        fix_patch_path = instance_dir.absolute() / "fix.patch"
        with open(fix_patch_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(self.patches[instance.pr.id].fix_patch)

        volumes = {
            str(fix_patch_path): {
                "bind": instance.dependency().fix_patch_path(),
                "mode": "ro",
            }
        }

        if instance.runtime_files():
            runtime_dir = instance_dir / "runtime_mount"
            runtime_dir.mkdir(parents=True, exist_ok=True)

            def write_mount_file(name: str, content: str) -> Path:
                path = runtime_dir / name
                with open(path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(content or "")
                return path

            mount_files: list[tuple[Path, str]] = []
            for file in instance.runtime_files():
                host_path = write_mount_file(file.name, file.content)
                mount_files.append((host_path, f"/home/{file.name}"))

            mount_files.append(
                (
                    write_mount_file("test.patch", instance.pr.test_patch),
                    "/home/test.patch",
                )
            )

            for host, container in mount_files:
                volumes[str(host)] = {"bind": container, "mode": "ro"}

        report_path = instance_dir / REPORT_FILE
        if report_path.exists():
            self.logger.info(
                f"Report already exists for {instance.name()}, skipping..."
            )
            return

        def run_and_save_output(
            image_full_name: str, run_command: str, output_path: Path
        ) -> str:
            self.logger.info(
                f"Running {image_full_name} with command: {run_command}..."
            )
            return docker_util.run(
                image_full_name,
                run_command,
                output_path,
                self.global_env,
                volumes=volumes,
                timeout_seconds=SCORING_TIMEOUT_SECONDS.get(instance.pr.id, 1800),
            )

        run_and_save_output(
            instance.name(),
            instance.fix_patch_run(self.fix_patch_run_cmd),
            instance_dir / FIX_PATCH_RUN_LOG_FILE,
        )

    def run_mode_evaluation(self):
        build_images_for_instances(
            self.instances,
            workdir=self.workdir,
            force_build=self.force_build,
            max_workers_build_image=self.max_workers_build_image,
            stop_on_error=self.stop_on_error,
            log_level=self.log_level,
            logger=self.logger,
        )
        run_instances(
            self.instances,
            run_instance_fn=self.run_instance,
            max_workers_run_instance=self.max_workers_run_instance,
            stop_on_error=self.stop_on_error,
            logger=self.logger,
        )
        self.logger.info("Running evaluation...")
        ReportBuilder(
            mode="evaluation",
            workdir=self.workdir,
            output_dir=self.output_dir,
            specifics=self.specifics,
            skips=self.skips,
            raw_dataset_files=None,
            dataset_files=self.dataset_files,
            max_workers=self.max_workers,
            log_dir=self.log_dir,
            log_level=self.log_level,
            log_to_console=self.log_to_console,
        ).run()

    def run(self):
        self.run_mode_evaluation()


if __name__ == "__main__":
    parser = get_parser()
    args = parser.parse_args()
    cli = CliArgs.from_dict(vars(args))
    cli.run()
