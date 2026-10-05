"""FastAPI 入口：提供裁决 API 与静态页面。"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .adjudication import AdjudicationError, adjudicate
from .alternatives import diagnose

app = FastAPI(title="本地赛道计次裁决台", version="1.0.0")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@app.post("/api/adjudicate")
async def api_adjudicate(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse(
            status_code=400, content={"ok": False, "error": "请求体不是合法的 JSON"}
        )
    try:
        result = adjudicate(payload)
    except AdjudicationError as exc:
        # 非法输入：返回错误，不展示任何部分结果。
        return JSONResponse(status_code=422, content={"ok": False, "error": str(exc)})
    return JSONResponse(content={"ok": True, "result": result})


@app.post("/api/diagnose")
async def api_diagnose(request: Request) -> JSONResponse:
    """未采纳记录替代性诊断：只读分析，不产生、不改变任何裁决结果。

    与 /api/adjudicate 使用同一份请求体和同一套输入校验：
    - 合法：200 {"ok": true, "diagnosis": {...}}
    - 非法输入：422 {"ok": false, "error": "中文原因"}
    - 请求体不是 JSON：400
    """
    try:
        payload = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse(
            status_code=400, content={"ok": False, "error": "请求体不是合法的 JSON"}
        )
    try:
        diagnosis = diagnose(payload)
    except AdjudicationError as exc:
        return JSONResponse(status_code=422, content={"ok": False, "error": str(exc)})
    return JSONResponse(content={"ok": True, "diagnosis": diagnosis})


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
