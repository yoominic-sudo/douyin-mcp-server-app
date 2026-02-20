#!/usr/bin/env python3
"""
抖音视频文案提取器 WebUI

启动方式:
    cd douyin-mcp-server
    export API_KEY="sk-xxx"
    python web/app.py
    # 访问 http://localhost:8080
"""

import hashlib
import hmac
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent / "douyin-video" / "scripts"))

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import uvicorn
import requests

# 导入抖音处理模块
from douyin_downloader import get_video_info, extract_text, HEADERS

app = FastAPI(title="抖音文案提取器", version="1.0.0")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")
DB_PATH = Path(__file__).parent / "stats.db"
XHS_QUEUE_PATH = Path(__file__).parent / "xhs_posts.json"
XHS_ENV_PATH = Path(__file__).parent.parent / ".env.xhs.local"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_stats_db() -> None:
    with _get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS metrics (
                key TEXT PRIMARY KEY,
                value INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            "INSERT OR IGNORE INTO metrics(key, value) VALUES('page_views', 0)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_quota (
                device_id TEXT NOT NULL,
                app_key TEXT NOT NULL,
                free_used INTEGER NOT NULL DEFAULT 0,
                ad_credits INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (device_id, app_key)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ad_tickets (
                ticket_id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                app_key TEXT NOT NULL,
                signature TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                app_key TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                free_limit INTEGER NOT NULL DEFAULT 1,
                enabled INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.executemany(
            "INSERT OR IGNORE INTO app_settings(app_key, category, title, free_limit, enabled) VALUES(?, ?, ?, ?, 1)",
            [
                ("douyin_tool", "实用工具", "抖音无水印下载助手", 1),
                ("content_idea", "实用工具", "爆款选题生成器", 1),
                ("chuangye", "人格测评", "2026 打工型还是创业型", 1),
                ("city_persona", "人格测评", "你的城市人格", 1),
            ],
        )
        conn.commit()


def increment_page_views() -> int:
    with _get_conn() as conn:
        conn.execute("UPDATE metrics SET value = value + 1 WHERE key = 'page_views'")
        row = conn.execute("SELECT value FROM metrics WHERE key = 'page_views'").fetchone()
        conn.commit()
        return int(row["value"]) if row else 0


def get_page_views() -> int:
    with _get_conn() as conn:
        row = conn.execute("SELECT value FROM metrics WHERE key = 'page_views'").fetchone()
        return int(row["value"]) if row else 0


def load_xhs_posts() -> list[dict]:
    if not XHS_QUEUE_PATH.exists():
        return []
    try:
        return json.loads(XHS_QUEUE_PATH.read_text())
    except Exception:
        return []


def save_xhs_posts(posts: list[dict]) -> None:
    XHS_QUEUE_PATH.write_text(json.dumps(posts, ensure_ascii=False, indent=2))


def xhs_cookie_configured() -> bool:
    if not XHS_ENV_PATH.exists():
        return False
    raw = XHS_ENV_PATH.read_text().strip()
    return "XHS_COOKIE=" in raw and len(raw.split("XHS_COOKIE=", 1)[1].strip()) > 20


def _ensure_quiz_row(conn: sqlite3.Connection, device_id: str, app_key: str) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO app_quota(device_id, app_key, free_used, ad_credits, updated_at)
        VALUES(?, ?, 0, 0, ?)
        """,
        (device_id, app_key, datetime.now(timezone.utc).isoformat()),
    )


def get_app_settings() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT app_key, category, title, free_limit, enabled FROM app_settings ORDER BY category, app_key"
        ).fetchall()
        return [dict(r) for r in rows]


def get_app_free_limit(conn: sqlite3.Connection, app_key: str) -> int:
    row = conn.execute("SELECT free_limit FROM app_settings WHERE app_key = ?", (app_key,)).fetchone()
    return int(row["free_limit"]) if row else 1


def get_quiz_quota(device_id: str, app_key: str = "chuangye") -> dict:
    with _get_conn() as conn:
        _ensure_quiz_row(conn, device_id, app_key)
        free_limit = get_app_free_limit(conn, app_key)
        row = conn.execute(
            "SELECT free_used, ad_credits FROM app_quota WHERE device_id = ? AND app_key = ?",
            (device_id, app_key),
        ).fetchone()
        free_used = int(row["free_used"]) if row else 0
        ad_credits = int(row["ad_credits"]) if row else 0
        free_remaining = max(0, free_limit - free_used)
        can_play = (free_remaining + ad_credits) > 0
        return {
            "device_id": device_id,
            "app_key": app_key,
            "free_limit": free_limit,
            "free_remaining": free_remaining,
            "ad_credits": ad_credits,
            "can_play": can_play,
        }


def unlock_quiz_by_ad(device_id: str, app_key: str = "chuangye") -> dict:
    with _get_conn() as conn:
        _ensure_quiz_row(conn, device_id, app_key)
        conn.execute(
            "UPDATE app_quota SET ad_credits = ad_credits + 1, updated_at = ? WHERE device_id = ? AND app_key = ?",
            (datetime.now(timezone.utc).isoformat(), device_id, app_key),
        )
        conn.commit()
    return get_quiz_quota(device_id, app_key)


def _ad_unlock_secret() -> str:
    return os.getenv("QUIZ_AD_UNLOCK_SECRET", "")


def _sign_ad_ticket(device_id: str, app_key: str, ticket_id: str) -> str:
    secret = _ad_unlock_secret().encode("utf-8")
    payload = f"{device_id}:{app_key}:{ticket_id}".encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def create_ad_ticket(device_id: str, app_key: str = "chuangye") -> dict:
    if not _ad_unlock_secret():
        raise HTTPException(status_code=400, detail="QUIZ_AD_UNLOCK_SECRET 未配置")
    ticket_id = str(uuid4())
    signature = _sign_ad_ticket(device_id, app_key, ticket_id)
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO ad_tickets(ticket_id, device_id, app_key, signature, used, created_at) VALUES(?, ?, ?, ?, 0, ?)",
            (ticket_id, device_id, app_key, signature, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    return {"ticket_id": ticket_id, "signature": signature}


def verify_and_consume_ad_ticket(device_id: str, app_key: str, ticket_id: str, signature: str) -> bool:
    expected = _sign_ad_ticket(device_id, app_key, ticket_id)
    if not hmac.compare_digest(expected, signature):
        return False
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT used FROM ad_tickets WHERE ticket_id = ? AND device_id = ? AND app_key = ?",
            (ticket_id, device_id, app_key),
        ).fetchone()
        if not row or int(row["used"]) == 1:
            return False
        conn.execute("UPDATE ad_tickets SET used = 1 WHERE ticket_id = ?", (ticket_id,))
        conn.commit()
    return True


def consume_quiz_attempt(device_id: str, app_key: str = "chuangye") -> tuple[bool, dict]:
    with _get_conn() as conn:
        _ensure_quiz_row(conn, device_id, app_key)
        row = conn.execute(
            "SELECT free_used, ad_credits FROM app_quota WHERE device_id = ? AND app_key = ?",
            (device_id, app_key),
        ).fetchone()
        free_limit = get_app_free_limit(conn, app_key)
        free_used = int(row["free_used"]) if row else 0
        ad_credits = int(row["ad_credits"]) if row else 0

        if free_used < free_limit:
            conn.execute(
                "UPDATE app_quota SET free_used = free_used + 1, updated_at = ? WHERE device_id = ? AND app_key = ?",
                (datetime.now(timezone.utc).isoformat(), device_id, app_key),
            )
            conn.commit()
            return True, get_quiz_quota(device_id, app_key)

        if ad_credits > 0:
            conn.execute(
                "UPDATE app_quota SET ad_credits = ad_credits - 1, updated_at = ? WHERE device_id = ? AND app_key = ?",
                (datetime.now(timezone.utc).isoformat(), device_id, app_key),
            )
            conn.commit()
            return True, get_quiz_quota(device_id, app_key)

    return False, get_quiz_quota(device_id, app_key)


class VideoRequest(BaseModel):
    """视频请求模型"""
    url: str
    api_key: str = ""  # 可选，从前端传入


class VideoInfoResponse(BaseModel):
    """视频信息响应"""
    success: bool
    video_id: str = ""
    title: str = ""
    download_url: str = ""
    error: str = ""


class ExtractResponse(BaseModel):
    """文案提取响应"""
    success: bool
    video_id: str = ""
    title: str = ""
    text: str = ""
    download_url: str = ""
    error: str = ""


class XHSPostRequest(BaseModel):
    title: str
    content: str
    cover_url: str = ""


class QuizDeviceRequest(BaseModel):
    device_id: str
    app_key: str = "chuangye"


class QuizAdVerifyRequest(BaseModel):
    device_id: str
    app_key: str = "chuangye"
    ticket_id: str
    signature: str


class AppSettingPatchRequest(BaseModel):
    app_key: str
    free_limit: int
    enabled: bool = True


@app.on_event("startup")
async def startup_event():
    init_stats_db()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """主页面"""
    page_views = increment_page_views()
    return templates.TemplateResponse("index.html", {"request": request, "page_views": page_views})


@app.get("/xiaohongshu/chuangye", response_class=HTMLResponse)
@app.get("/chuangye", response_class=HTMLResponse)
async def xiaohongshu_chuangye(request: Request):
    """小红书创业倾向测评页面"""
    return templates.TemplateResponse("xiaohongshu_chuangye.html", {"request": request})


@app.get("/xiaohongshu/ops", response_class=HTMLResponse)
@app.get("/ops", response_class=HTMLResponse)
async def xiaohongshu_ops(request: Request):
    """小红书运营台"""
    return templates.TemplateResponse("xiaohongshu_ops.html", {"request": request})


@app.get("/api/health")
async def health_check():
    """健康检查"""
    api_key = os.getenv("API_KEY", "")
    return {
        "status": "ok",
        "api_key_configured": bool(api_key)
    }


@app.get("/api/stats")
async def stats():
    """站点统计"""
    return {
        "page_views": get_page_views()
    }


@app.get("/api/quiz/apps")
async def quiz_apps():
    return {"items": get_app_settings()}


@app.post("/api/quiz/apps/setting")
async def quiz_apps_setting(req: AppSettingPatchRequest):
    with _get_conn() as conn:
        conn.execute(
            "UPDATE app_settings SET free_limit = ?, enabled = ? WHERE app_key = ?",
            (max(0, req.free_limit), 1 if req.enabled else 0, req.app_key.strip()),
        )
        conn.commit()
    return {"success": True}


@app.get("/api/quiz/ad-config")
async def quiz_ad_config():
    return {
        "enabled": bool(os.getenv("WEAPP_REWARDED_AD_UNIT_ID", "")),
        "ad_unit_id": os.getenv("WEAPP_REWARDED_AD_UNIT_ID", ""),
        "demo_mode": os.getenv("QUIZ_AD_DEMO", "false").lower() == "true",
    }


@app.get("/api/quiz/quota/{app_key}/{device_id}")
async def quiz_quota(app_key: str, device_id: str):
    return get_quiz_quota(device_id, app_key)


@app.post("/api/quiz/ad-ticket")
async def quiz_ad_ticket(req: QuizDeviceRequest):
    ticket = create_ad_ticket(req.device_id.strip(), req.app_key.strip())
    return {"success": True, **ticket}


@app.post("/api/quiz/unlock-ad")
async def quiz_unlock_ad(req: QuizDeviceRequest):
    return unlock_quiz_by_ad(req.device_id.strip(), req.app_key.strip())


@app.post("/api/quiz/unlock-ad-verify")
async def quiz_unlock_ad_verify(req: QuizAdVerifyRequest):
    ok = verify_and_consume_ad_ticket(req.device_id.strip(), req.app_key.strip(), req.ticket_id.strip(), req.signature.strip())
    if not ok:
        return {"success": False, "error": "广告票据校验失败"}
    quota = unlock_quiz_by_ad(req.device_id.strip(), req.app_key.strip())
    return {"success": True, "quota": quota}


@app.post("/api/quiz/consume")
async def quiz_consume(req: QuizDeviceRequest):
    consumed, quota = consume_quiz_attempt(req.device_id.strip(), req.app_key.strip())
    return {"success": consumed, "quota": quota}


@app.get("/api/xhs/status")
async def xhs_status():
    posts = load_xhs_posts()
    queued = len([p for p in posts if p.get("status") == "queued"])
    published = len([p for p in posts if p.get("status") == "published"])
    return {
        "cookie_configured": xhs_cookie_configured(),
        "queued": queued,
        "published": published,
        "total": len(posts)
    }


@app.get("/api/xhs/posts")
async def xhs_posts():
    posts = load_xhs_posts()
    return {"items": sorted(posts, key=lambda p: p.get("created_at", ""), reverse=True)}


@app.post("/api/xhs/posts")
async def create_xhs_post(req: XHSPostRequest):
    posts = load_xhs_posts()
    now = datetime.now(timezone.utc).isoformat()
    post = {
        "id": str(uuid4()),
        "title": req.title.strip(),
        "content": req.content.strip(),
        "cover_url": req.cover_url.strip(),
        "status": "queued",
        "created_at": now,
        "published_at": ""
    }
    posts.append(post)
    save_xhs_posts(posts)
    return {"success": True, "item": post}


@app.post("/api/xhs/publish/{post_id}")
async def publish_xhs_post(post_id: str):
    posts = load_xhs_posts()
    idx = next((i for i, p in enumerate(posts) if p.get("id") == post_id), -1)
    if idx < 0:
        raise HTTPException(status_code=404, detail="未找到稿件")

    if not xhs_cookie_configured():
        posts[idx]["status"] = "failed"
        save_xhs_posts(posts)
        return {"success": False, "error": "XHS_COOKIE 未配置"}

    posts[idx]["status"] = "published"
    posts[idx]["published_at"] = datetime.now(timezone.utc).isoformat()
    save_xhs_posts(posts)
    return {"success": True, "item": posts[idx]}


@app.post("/api/video/info", response_model=VideoInfoResponse)
async def get_info(req: VideoRequest):
    """获取视频信息（无需 API_KEY）"""
    try:
        info = get_video_info(req.url)
        return VideoInfoResponse(
            success=True,
            video_id=info["video_id"],
            title=info["title"],
            download_url=info["url"]
        )
    except Exception as e:
        return VideoInfoResponse(success=False, error=str(e))


@app.post("/api/video/extract", response_model=ExtractResponse)
async def extract_transcript(req: VideoRequest):
    """提取视频文案（需要 API_KEY）"""
    # 优先使用请求中的 API Key，其次使用环境变量
    api_key = req.api_key or os.getenv("API_KEY", "")
    if not api_key:
        return ExtractResponse(
            success=False,
            error="请先配置 API Key"
        )

    try:
        result = extract_text(req.url, api_key=api_key, show_progress=False)
        return ExtractResponse(
            success=True,
            video_id=result["video_info"]["video_id"],
            title=result["video_info"]["title"],
            text=result["text"],
            download_url=result["video_info"]["url"]
        )
    except Exception as e:
        return ExtractResponse(success=False, error=str(e))


@app.get("/api/video/download")
async def download_video(url: str, filename: str = "video.mp4"):
    """代理下载视频（解决跨域和请求头问题）"""
    print(f"[Download] URL: {url}")
    print(f"[Download] Filename: {filename}")
    try:
        # 完整的请求头，模拟浏览器访问
        download_headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1',
            'Referer': 'https://www.douyin.com/',
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'identity',
            'Connection': 'keep-alive',
        }

        response = requests.get(url, headers=download_headers, stream=True, allow_redirects=True)
        print(f"[Download] Response status: {response.status_code}")
        print(f"[Download] Final URL: {response.url}")
        response.raise_for_status()

        content_length = response.headers.get("content-length", "")

        def iter_content():
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk

        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
        }
        if content_length:
            headers["Content-Length"] = content_length

        return StreamingResponse(
            iter_content(),
            media_type="video/mp4",
            headers=headers
        )
    except requests.exceptions.HTTPError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"下载失败: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def main():
    """启动服务"""
    port = int(os.getenv("PORT", "8080"))
    print(f"🚀 启动文案提取器 WebUI: http://localhost:{port}")
    print(f"📝 API_KEY 配置状态: {'已配置' if os.getenv('API_KEY') else '未配置'}")
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
