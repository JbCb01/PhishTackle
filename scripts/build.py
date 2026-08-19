#!/usr/bin/env python3
"""
PhishTackle Build Script
Packages Firefox (.xpi) and Chrome (.zip / .crx) extensions into dist/ directory.
Usage:
    python3 scripts/build.py
    python3 scripts/build.py --target firefox
    python3 scripts/build.py --target chrome
"""

import os
import sys
import shutil
import zipfile
import argparse

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIREFOX_DIR = os.path.join(ROOT_DIR, "firefox")
CHROME_DIR = os.path.join(ROOT_DIR, "chrome")
DIST_DIR = os.path.join(ROOT_DIR, "dist")

def clean_dist():
    """Ensures dist directory is clean."""
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    os.makedirs(DIST_DIR, exist_ok=True)
    print(f"📁 Initialized clean output directory: {DIST_DIR}")

def build_firefox_xpi():
    """Packages firefox/ directory into dist/phishtackle-firefox.xpi."""
    if not os.path.exists(FIREFOX_DIR):
        print(f"❌ Error: {FIREFOX_DIR} directory does not exist.")
        return False

    output_xpi = os.path.join(DIST_DIR, "phishtackle-firefox.xpi")
    with zipfile.ZipFile(output_xpi, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(FIREFOX_DIR):
            for file in files:
                filepath = os.path.join(root, file)
                arcname = os.path.relpath(filepath, FIREFOX_DIR)
                z.write(filepath, arcname)

    size_kb = os.path.getsize(output_xpi) / 1024
    print(f"✅ Built Firefox package: dist/phishtackle-firefox.xpi ({size_kb:.1f} KB)")
    return True

def build_chrome_zip():
    """Packages chrome/ (or firefox/ fallback) into dist/phishtackle-chrome.zip."""
    source_dir = CHROME_DIR if (os.path.exists(CHROME_DIR) and len(os.listdir(CHROME_DIR)) > 1) else FIREFOX_DIR
    if not os.path.exists(source_dir):
        print(f"❌ Error: {source_dir} directory does not exist.")
        return False

    output_zip = os.path.join(DIST_DIR, "phishtackle-chrome.zip")
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                filepath = os.path.join(root, file)
                arcname = os.path.relpath(filepath, source_dir)
                z.write(filepath, arcname)

    size_kb = os.path.getsize(output_zip) / 1024
    print(f"✅ Built Chrome package: dist/phishtackle-chrome.zip ({size_kb:.1f} KB)")
    return True

def main():
    parser = argparse.ArgumentParser(description="PhishTackle Build Utility")
    parser.add_argument("--target", choices=["all", "firefox", "chrome"], default="all", help="Target browser build")
    args = parser.parse_args()

    clean_dist()

    if args.target in ["all", "firefox"]:
        build_firefox_xpi()

    if args.target in ["all", "chrome"]:
        build_chrome_zip()

    print("🎉 Build completed successfully.")

if __name__ == "__main__":
    main()
