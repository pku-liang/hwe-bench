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

import logging
from pathlib import Path
from typing import Optional, Union

import docker
import requests


DEFAULT_DOCKER_TIMEOUT_SECONDS = 60
RUN_CLIENT_TIMEOUT_BUFFER_SECONDS = 60
MIN_RUN_CLIENT_TIMEOUT_SECONDS = 600


def _create_client(timeout_seconds: int = DEFAULT_DOCKER_TIMEOUT_SECONDS):
    return docker.from_env(timeout=timeout_seconds)


def _resolve_run_client_timeout(timeout_seconds: int) -> int:
    return max(
        MIN_RUN_CLIENT_TIMEOUT_SECONDS,
        timeout_seconds + RUN_CLIENT_TIMEOUT_BUFFER_SECONDS,
    )


def exists(image_name: str) -> bool:
    docker_client = _create_client()
    try:
        docker_client.images.get(image_name)
        return True
    except docker.errors.ImageNotFound:
        return False
    finally:
        docker_client.close()


def build(
    workdir: Path, dockerfile_name: str, image_full_name: str, logger: logging.Logger
):
    workdir = str(workdir)
    docker_client = _create_client(timeout_seconds=MIN_RUN_CLIENT_TIMEOUT_SECONDS)
    logger.info(
        f"Start building image `{image_full_name}`, working directory is `{workdir}`"
    )
    try:
        build_logs = docker_client.api.build(
            path=workdir,
            dockerfile=dockerfile_name,
            tag=image_full_name,
            rm=True,
            forcerm=True,
            decode=True,
            encoding="utf-8",
        )

        for log in build_logs:
            if "stream" in log:
                logger.info(log["stream"].strip())
            elif "error" in log:
                error_message = log["error"].strip()
                logger.error(f"Docker build error: {error_message}")
                raise RuntimeError(f"Docker build failed: {error_message}")
            elif "status" in log:
                logger.info(log["status"].strip())
            elif "aux" in log:
                logger.info(log["aux"].get("ID", "").strip())

        logger.info(f"image({workdir}) build success: {image_full_name}")
    except docker.errors.BuildError as e:
        logger.error(f"build error: {e}")
        raise e
    except Exception as e:
        logger.error(f"Unknown build error occurred: {e}")
        raise e
    finally:
        docker_client.close()


def run(
    image_full_name: str,
    run_command: str,
    output_path: Optional[Path] = None,
    global_env: Optional[list[str]] = None,
    volumes: Optional[Union[dict[str, str], list[str]]] = None,
    timeout_seconds: int = 1800,
) -> str:
    container = None
    client_timeout_seconds = _resolve_run_client_timeout(timeout_seconds)
    docker_client = _create_client(timeout_seconds=client_timeout_seconds)
    try:
        container = docker_client.containers.run(
            image=image_full_name,
            command=run_command,
            remove=False,
            detach=True,
            stdout=True,
            stderr=True,
            environment=global_env,
            volumes=volumes,
        )

        timed_out = False
        try:
            container.wait(timeout=timeout_seconds)
        except (
            requests.exceptions.ReadTimeout,
            requests.exceptions.ConnectionError,
        ):
            timed_out = True
            try:
                container.stop(timeout=10)
            except Exception:
                try:
                    container.kill()
                except Exception:
                    pass

        # Container.logs() uses the client's default request timeout.
        # Keep it aligned with the per-run timeout instead of falling back to 60s.
        docker_client.api.timeout = client_timeout_seconds
        output = container.logs().decode("utf-8", errors="replace")
        if timed_out:
            output += (
                f"\n[TIMEOUT] Container exceeded {timeout_seconds}s "
                "and was terminated.\n"
            )

        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(output)

        return output
    finally:
        if container:
            try:
                container.remove(force=True)
            except Exception as e:
                print(f"Warning: Failed to remove container: {e}")
        docker_client.close()
