# Lulumi Tools Image Proxy

Small FastAPI service for T7 share-card character images.

The service only proxies this fixed upstream prefix:

```text
https://market-static.msu.io/msu/platform/charimages/
```

It does not accept arbitrary URLs.

## Local Run

```bash
cd server/img-proxy
python -m pip install -r requirements-dev.txt
python generate_placeholder.py
python -m pytest .
python -m uvicorn app:app --host 127.0.0.1 --port 8781
```

For VPS runtime installation, use `requirements.txt` instead of `requirements-dev.txt`.

## Environment

```text
IMG_PROXY_ALLOWED_ORIGINS=https://lulumi-tools.com
IMG_PROXY_CACHE_DIR=./.cache
IMG_PROXY_CACHE_TTL_SECONDS=604800
IMG_PROXY_CACHE_MAX_BYTES=524288000
IMG_PROXY_MAX_UPSTREAM_BYTES=1048576
IMG_PROXY_UPSTREAM_TIMEOUT_SECONDS=5
```

For local canvas testing from another localhost origin, temporarily set
`IMG_PROXY_ALLOWED_ORIGINS` to that origin and report the difference from the
production value.

## Paths

```text
GET /img/charimages/transient/example.png
HEAD /img/charimages/transient/example.png
```

Allowed path characters are alphanumeric, `_`, `-`, `=`, `/`, and the final
extension must be `.png`. Traversal (`..`) and other extensions are rejected
before any upstream request is made.

## Fallback

If the upstream request fails, times out, returns a non-PNG, or exceeds 1 MiB,
the service returns the bundled 180x180 placeholder PNG with:

```text
X-Img-Fallback: 1
```

Invalid local paths return `400` and are not converted to fallback.
