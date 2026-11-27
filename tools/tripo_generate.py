#!/usr/bin/env python3
"""Generate the GLB files listed in assets/assets.manifest.json using Tripo.

Set TRIPO_API_KEY in the environment. The key is never read from or written to
the manifest. Generated outputs are skipped on reruns; failed assets can be
retried by removing only their incomplete output files.
"""
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

API = "https://openapi.tripo3d.ai/v3"
KEY = os.environ.get("TRIPO_API_KEY")
if not KEY:
    raise SystemExit("Defina TRIPO_API_KEY no ambiente; não coloque a chave no arquivo.")
HEADERS = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
_last_request = 0.0


def request_json(path, method="GET", body=None):
    global _last_request
    wait = 1.05 - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(f"{API}{path}", data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read())
            _last_request = time.monotonic()
            return result
    except urllib.error.HTTPError as error:
        _last_request = time.monotonic()
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Tripo HTTP {error.code}: {detail}") from error


def post(path, body):
    payload = request_json(path, "POST", body)
    if payload.get("code") != 0:
        raise RuntimeError(f"Tripo retornou erro: {payload}")
    return payload["data"]["task_id"]


def poll(task_id):
    for _ in range(300):
        task = request_json(f"/tasks/{task_id}")["data"]
        status = task.get("status")
        if status == "success":
            return task
        if status in {"failed", "cancelled", "banned", "expired"}:
            raise RuntimeError(f"Tarefa Tripo {task_id} terminou em {status}: {task}")
        time.sleep(2)
    raise TimeoutError(f"Tempo limite para tarefa Tripo {task_id}")


def download(url, output):
    path = pathlib.Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url)
    with urllib.request.urlopen(request, timeout=120) as response:
        path.write_bytes(response.read())
    if path.stat().st_size < 1024:
        path.unlink(missing_ok=True)
        raise RuntimeError(f"Arquivo GLB inválido ou incompleto: {path}")
    print(f"OK {path}", flush=True)


def main():
    manifest_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "assets/assets.manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for asset in manifest["assets"]:
        output = pathlib.Path(asset["out"])
        if output.exists() and output.stat().st_size > 1024:
            print(f"skip {asset['id']}", flush=True)
            continue
        prompt = asset["prompt"]
        if manifest["style_suffix"] not in prompt:
            prompt = f"{prompt}, {manifest['style_suffix']}"
        task_id = post("/generation/text-to-model", {
            "prompt": prompt,
            "model": asset["model"],
            "face_limit": asset["face_limit"],
            "texture": asset["texture"],
        })
        result = poll(task_id)
        if not asset.get("rig"):
            download(result["output"]["model_url"], output)
            time.sleep(1)
            continue

        check_id = post("/animations/rig-check", {"input": task_id})
        check = poll(check_id)["output"]
        if not check.get("riggable") or check.get("rig_type") != "biped":
            print(f"SKIP rig não compatível: {asset['id']}", flush=True)
            time.sleep(1)
            continue
        rig_id = post("/animations/rig", {
            "input": task_id, "model": "v3.0-20260909",
            "rig_type": "biped", "spec": "mixamo",
        })
        rigged = poll(rig_id)
        download(rigged["output"]["model_url"], output)
        time.sleep(1)
        for animation in asset.get("animations", []):
            anim_id = post("/animations/retarget", {"input": rig_id, "animation": animation})
            animated = poll(anim_id)
            name = animation.split(":", 1)[-1]
            download(animated["output"]["model_url"], output.with_name(f"{output.stem}@{name}.glb"))
            time.sleep(1)


if __name__ == "__main__":
    main()
