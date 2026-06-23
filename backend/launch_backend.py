from __future__ import annotations

import argparse
from collections.abc import Sequence

import uvicorn

from main import app


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the LuminaMind packaged backend.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--log-level", default="info")
    parser.add_argument("--no-access-log", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        access_log=not args.no_access_log,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
