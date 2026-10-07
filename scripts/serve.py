#!/usr/bin/env python3
"""Tiny local static server (fixes JS MIME types on Windows). Usage: python scripts/serve.py [port]"""
import http.server, mimetypes, os, sys
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

http.server.test(HandlerClass=Handler, port=int(sys.argv[1]) if len(sys.argv) > 1 else 8080, bind="127.0.0.1")
