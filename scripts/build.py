#!/usr/bin/env python3
"""
PhishTackle Build Script
Packages Firefox (.xpi & .zip) and Chrome (.zip & .crx) extensions into organized dist/ directory.
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
import subprocess

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIREFOX_DIR = os.path.join(ROOT_DIR, "firefox")
CHROME_DIR = os.path.join(ROOT_DIR, "chrome")
DIST_DIR = os.path.join(ROOT_DIR, "dist")
DIST_FIREFOX_DIR = os.path.join(DIST_DIR, "firefox")
DIST_CHROME_DIR = os.path.join(DIST_DIR, "chrome")

SHARED_FOLDERS = ["background", "features", "utils", "views", "icons", "config.yaml"]

def clean_dist():
    """Ensures dist directory structure is clean and organized."""
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    os.makedirs(DIST_FIREFOX_DIR, exist_ok=True)
    os.makedirs(DIST_CHROME_DIR, exist_ok=True)
    print(f"📁 Initialized clean output directory: {DIST_DIR}")

def zip_folder(source_folder, target_zip_path):
    """Zips a folder into a target zip file."""
    with zipfile.ZipFile(target_zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(source_folder):
            for file in files:
                filepath = os.path.join(root, file)
                arcname = os.path.relpath(filepath, source_folder)
                z.write(filepath, arcname)

def build_firefox():
    """Packages firefox/ directory into dist/firefox/phishtackle-firefox.xpi and .zip."""
    if not os.path.exists(FIREFOX_DIR):
        print(f"❌ Error: {FIREFOX_DIR} directory does not exist.")
        return False

    out_xpi = os.path.join(DIST_FIREFOX_DIR, "phishtackle-firefox.xpi")
    out_zip = os.path.join(DIST_FIREFOX_DIR, "phishtackle-firefox.zip")

    zip_folder(FIREFOX_DIR, out_xpi)
    shutil.copyfile(out_xpi, out_zip)

    size_xpi = os.path.getsize(out_xpi) / 1024
    print(f"✅ Built Firefox XPI: dist/firefox/phishtackle-firefox.xpi ({size_xpi:.1f} KB)")
    print(f"✅ Built Firefox ZIP: dist/firefox/phishtackle-firefox.zip ({size_xpi:.1f} KB)")
    return True

def build_chrome():
    """Assembles Chrome extension using shared core code and chrome/manifest.json."""
    chrome_stage_dir = os.path.join(DIST_DIR, ".stage_chrome")
    if os.path.exists(chrome_stage_dir):
        shutil.rmtree(chrome_stage_dir)
    os.makedirs(chrome_stage_dir, exist_ok=True)

    # 1. Copy shared code/features from firefox directory
    for item in SHARED_FOLDERS:
        src_path = os.path.join(FIREFOX_DIR, item)
        dst_path = os.path.join(chrome_stage_dir, item)
        if os.path.isdir(src_path):
            shutil.copytree(src_path, dst_path)
        elif os.path.isfile(src_path):
            shutil.copyfile(src_path, dst_path)

    # 2. Copy Chrome-specific manifest.json
    chrome_manifest = os.path.join(CHROME_DIR, "manifest.json")
    if os.path.exists(chrome_manifest):
        shutil.copyfile(chrome_manifest, os.path.join(chrome_stage_dir, "manifest.json"))
    else:
        print(f"⚠️ Warning: {chrome_manifest} not found, falling back to firefox/manifest.json")
        shutil.copyfile(os.path.join(FIREFOX_DIR, "manifest.json"), os.path.join(chrome_stage_dir, "manifest.json"))

    out_zip = os.path.join(DIST_CHROME_DIR, "phishtackle-chrome.zip")
    zip_folder(chrome_stage_dir, out_zip)
    size_zip = os.path.getsize(out_zip) / 1024
    print(f"✅ Built Chrome ZIP: dist/chrome/phishtackle-chrome.zip ({size_zip:.1f} KB)")

    # 3. Check if chrome.pem exists to automatically pack .crx via google-chrome CLI
    key_pem = os.path.join(ROOT_DIR, "chrome.pem")
    if not os.path.exists(key_pem):
        key_pem = os.path.join(ROOT_DIR, "key.pem")

    if os.path.exists(key_pem):
        out_crx = os.path.join(DIST_CHROME_DIR, "phishtackle-chrome.crx")
        try:
            cmd = ["google-chrome", f"--pack-extension={chrome_stage_dir}", f"--pack-extension-key={key_pem}"]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            produced_crx = f"{chrome_stage_dir}.crx"
            if os.path.exists(produced_crx):
                shutil.move(produced_crx, out_crx)
                size_crx = os.path.getsize(out_crx) / 1024
                print(f"✅ Built Chrome CRX: dist/chrome/phishtackle-chrome.crx ({size_crx:.1f} KB)")
            else:
                print(f"ℹ️ Chrome CLI packing output: {res.stderr.strip() or res.stdout.strip()}")
        except Exception as e:
            print(f"⚠️ Could not generate CRX automatically: {e}")

    # Cleanup staging directory
    if os.path.exists(chrome_stage_dir):
        shutil.rmtree(chrome_stage_dir)

    return True

def main():
    parser = argparse.ArgumentParser(description="PhishTackle Build Utility")
    parser.add_argument("--target", choices=["all", "firefox", "chrome"], default="all", help="Target browser build")
    args = parser.parse_args()

    clean_dist()

    if args.target in ["all", "firefox"]:
        build_firefox()

    if args.target in ["all", "chrome"]:
        build_chrome()

    print("🎉 Build completed successfully.")

if __name__ == "__main__":
    main()
