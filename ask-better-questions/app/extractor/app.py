from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple
from urllib.parse import urlparse, urljoin
import ipaddress
import socket

import os
import time
from typing import Dict, Optional
from fastapi import Request

import httpx  # type: ignore
import trafilatura  # type: ignore
from bs4 import BeautifulSoup  # type: ignore
from fastapi import FastAPI, HTTPException  # type: ignore
from pydantic import BaseModel, Field  # type: ignore


app = FastAPI(title="ask-better-questions-extractor")

# --- Security / performance knobs ---
MAX_BYTES = 2_000_000          # 2MB download cap
CACHE_TTL_SECONDS = 15 * 60    # 15 minutes
RATE_LIMIT_WINDOW = 60         # seconds
RATE_LIMIT_MAX = 30            # requests per window per IP

# --- Multi-story / hub detection knobs ---
MIN_ARTICLE_CHARS = 1600        # if extracted text is more, treat as article
SHORT_TEXT_CEILING = 800        # extraction under this is "suspicious"
MIN_CANDIDATES = 6              # need lots of story-like links
MIN_TOP_SCORE = 85              # top link must look strongly story-like
MIN_AVG_TOP5 = 70               # average of top 5 scores should be strong


# If set, require callers to send this in header "X-Extractor-Key"
EXTRACTOR_KEY = os.environ.get("EXTRACTOR_KEY")  # e.g. "dev-secret"

# url -> (expires_at_epoch, html_text)
_HTML_CACHE: Dict[str, tuple[float, str]] = {}

# ip -> (window_start_epoch, count)
_RATE: Dict[str, tuple[float, int]] = {}


class ExtractRequest(BaseModel):
    url: str = Field(..., min_length=8)
    # If true, return candidate links on “multi-story” pages
    include_candidates: bool = True
    # Safety controls
    max_chars: int = 40_000


class Candidate(BaseModel):
    title: str
    url: str
    score: int
    snippet: str


class ExtractResponse(BaseModel):
    url: str
    chosen_url: str
    title: str
    text: str
    is_multi: bool
    candidates: List[Candidate] = []


# -----------------------
# Security helpers (SSRF)
# -----------------------

def is_public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
        for family, _, _, _, sockaddr in infos:
            ip = sockaddr[0]
            addr = ipaddress.ip_address(ip)
            if (
                addr.is_private
                or addr.is_loopback
                or addr.is_link_local
                or addr.is_multicast
                or addr.is_reserved
            ):
                return False
        return True
    except Exception:
        return False


def _is_public_http_url(url: str) -> bool:
    try:
        p = urlparse(url)
        if p.scheme not in ("http", "https"):
            return False
        if not p.netloc:
            return False
        # VERY basic local-net guard.
        # For production, do DNS+IP resolution checks.
        host = p.hostname or ""
        if not is_public_host(host):
            return False
        if host in ("localhost", "127.0.0.1", "::1"):
            return False
        if host.endswith(".local"):
            return False
        return True
    except Exception:
        return False


def _check_extractor_key(req: Request) -> None:
    """If EXTRACTOR_KEY is set, require X-Extractor-Key header to match."""
    if not EXTRACTOR_KEY:
        return
    provided = req.headers.get("x-extractor-key")
    if not provided or provided != EXTRACTOR_KEY:
        raise HTTPException(status_code=401, detail="Missing or invalid "
                                                    "X-Extractor-Key.")


def _client_ip(req: Request) -> str:
    """
    Basic IP extraction. In production behind a proxy,
    you may rely on X-Forwarded-For,
    but only if you trust your proxy setup.
    """
    if req.client and req.client.host:
        return req.client.host
    return "unknown"


def _rate_limit(ip: str) -> None:
    now = time.time()
    window_start, count = _RATE.get(ip, (now, 0))

    # reset window
    if now - window_start >= RATE_LIMIT_WINDOW:
        window_start, count = now, 0

    count += 1
    _RATE[ip] = (window_start, count)

    if count > RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. "
                                                    "Try again soon.")


def _cache_get(url: str) -> Optional[str]:
    now = time.time()
    hit = _HTML_CACHE.get(url)
    if not hit:
        return None
    expires_at, html = hit
    if now >= expires_at:
        _HTML_CACHE.pop(url, None)
        return None
    return html


def _cache_set(url: str, html: str) -> None:
    _HTML_CACHE[url] = (time.time() + CACHE_TTL_SECONDS, html)


# -----------------------
# fetch + extraction
# -----------------------

# check if page is a hub
def looks_like_hub_text(text: str) -> bool:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 12:
        return False

    # Many hub extractions become lists of short lines/headlines
    short = sum(1 for ln in lines if len(ln) <= 90)
    ratio = short / max(1, len(lines))

    # If most lines are short and there are lots of lines, it's probably a hub
    return ratio >= 0.65 and len(lines) >= 20


# -----------------------
# hub helpers
# -----------------------

def looks_like_archive_path(url: str) -> bool:
    path = urlparse(url).path.lower()
    return ("/archive" in path) or ("/sections/" in path) or ("/tag/" in path)


def score_strength(links: List["LinkCandidate"]) -> Tuple[int, int]:
    """Return (top_score, avg_top5_score)."""
    if not links:
        return (0, 0)
    top = links[0].score
    top5 = links[:5]
    avg5 = int(sum(c.score for c in top5) / max(1, len(top5)))
    return (top, avg5)


def decide_is_multi(url: str, extracted_text: str,
                    links: List["LinkCandidate"]) -> bool:
    """
    Conservative hub detection:
    - If extracted text looks like a real article, do NOT mark multi.
    - If extraction is short, only mark multi when hub signals are strong.
    """
    text_len = len(extracted_text)

    # If we have a decent article extraction, treat as single.
    if text_len >= MIN_ARTICLE_CHARS:
        return False

    # We're in "suspicious extraction" territory.
    top_score, avg_top5 = score_strength(links)

    strong_link_signals = (
        len(links) >= MIN_CANDIDATES and
        top_score >= MIN_TOP_SCORE and
        avg_top5 >= MIN_AVG_TOP5
    )

    hubish_text = looks_like_hub_text(extracted_text)

    # Archive/section pages are likely hubs.
    if looks_like_archive_path(url):
        return (len(links) >= MIN_CANDIDATES) or hubish_text

    # Non-archive pages: require stronger signals
    return strong_link_signals and (text_len <= SHORT_TEXT_CEILING
                                    or hubish_text)


async def fetch_html(url: str) -> str:
    # Cache first
    cached = _cache_get(url)
    if cached is not None:
        return cached

    headers = {
        "User-Agent": "AskBetterQuestionsExtractor/1.0 (+local dev)",
        "Accept": "text/html,application/xhtml+xml",
    }
    timeout = httpx.Timeout(12.0, connect=6.0)

    async with httpx.AsyncClient(headers=headers, timeout=timeout,
                                 follow_redirects=True) as client:
        async with client.stream("GET", url) as r:
            r.raise_for_status()

            # Content-Type check (only after we have headers)
            ctype = r.headers.get("content-type", "")
            if ("text/html" not in ctype and
                    "application/xhtml+xml" not in ctype):
                raise HTTPException(status_code=415, detail=f"Unsupported \
                                    content-type: {ctype}")

            chunks: List[bytes] = []
            total = 0

            async for chunk in r.aiter_bytes():
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(status_code=413,
                                        detail="Page too large.")
                chunks.append(chunk)

            encoding = r.encoding or "utf-8"
            html = b"".join(chunks).decode(encoding, errors="replace")

    _cache_set(url, html)
    return html


def extract_main_text(html: str, url: str) -> Tuple[str, str]:
    """
    Returns (title, text). Uses trafilatura for main-content extraction.
    """
    downloaded = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=False,
        output_format="txt",
        favor_precision=True,
    )
    text = (downloaded or "").strip()

    soup = BeautifulSoup(html, "lxml")
    title = (soup.title.get_text(strip=True) if soup.title else "").strip()
    return title, text


@dataclass
class LinkCandidate:
    title: str
    url: str
    score: int
    snippet: str


def guess_story_links(html: str, base_url: str) -> List[LinkCandidate]:
    """
    Heuristic:
    - collect <a> that look like story links (reasonable text, not nav)
    - prefer links inside <main>, <article>, or large content blocks
    - score by text length + presence of common “story” signals
    """
    soup = BeautifulSoup(html, "lxml")

    # Prefer main content area if present
    root = soup.find("main") or soup.find("body") or soup

    links = []
    seen = set()

    for a in root.find_all("a", href=True):
        href = str(a.get("href", "")).strip()
        if not href:
            continue

        txt = a.get_text(" ", strip=True)

        if not txt or len(txt) < 18:
            continue
        if len(txt) > 140:
            continue
        if any(bad in txt.lower() for bad in ["sign in", "subscribe", "donate",
                                              "privacy", "terms", "contact"]):
            continue

        full = urljoin(base_url, href)
        p = urlparse(full)
        if p.scheme not in ("http", "https"):
            continue
        if p.netloc != urlparse(base_url).netloc:
            continue

        key = (p.netloc, p.path, p.query)
        if key in seen:
            continue
        seen.add(key)

        score = 0
        score += min(60, len(txt))
        path = p.path.lower()

        # crude “story-like” path hints
        if any(token in path for token in ["/news/", "/politics/", "/world/",
                                           "/story", "/article", "/202"]):
            score += 25
        if path.count("/") >= 3:
            score += 10
        if any(ch.isdigit() for ch in path):
            score += 10

        snippet = txt[:120]
        links.append(LinkCandidate(title=txt, url=full, score=score,
                                   snippet=snippet))

    links.sort(key=lambda x: x.score, reverse=True)
    return links[:8]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/extract", response_model=ExtractResponse)
async def extract(req: ExtractRequest, request: Request) -> ExtractResponse:

    url = req.url.strip()
    chosen_url = url  # for now, no separate chosen URL handling

    _check_extractor_key(request)
    ip = _client_ip(request)
    _rate_limit(ip)

    if not _is_public_http_url(url):
        raise HTTPException(status_code=400, detail="URL must be http(s) "
                                                    "and not local.")

    html = await fetch_html(url)
    title, text = extract_main_text(html, url)

    # Only guess story links if extraction looks suspicious
    links: List[LinkCandidate] = []
    if req.include_candidates and len(text) < MIN_ARTICLE_CHARS:
        links = guess_story_links(html, url)

    is_multi = decide_is_multi(url, text, links)

    # Only return candidates when multi (recommended)
    candidates: List[Candidate] = []
    if is_multi:
        candidates = [
            Candidate(title=c.title, url=c.url, score=c.score,
                      snippet=c.snippet)
            for c in links
        ]

    path = urlparse(url).path.lower()
    if "/archive" in path or "/sections/" in path:
        if len(links) >= 5:
            is_multi = True

    # Clamp returned text
    text = text[: req.max_chars].strip()

    if not text:
        raise HTTPException(status_code=422, detail="Could not extract "
                                                    "readable article text.")

    return ExtractResponse(
        url=url,
        chosen_url=chosen_url,
        title=title or "",
        text=text,
        is_multi=is_multi,
        candidates=candidates,
    )
