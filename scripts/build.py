#!/usr/bin/env python3
"""
PhishTackle Build Script & Version Manager
Packages Firefox (.zip source for AMO) and Chrome (.zip & .crx) extensions into organized dist/ directory.
Usage:
    python3 scripts/build.py
    python3 scripts/build.py --set-version 1.1.0
    python3 scripts/build.py --release
    python3 scripts/build.py --set-version 1.1.0 --release
"""

import os
import sys
import json
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

def get_current_version():
    """Reads current version from firefox/manifest.json."""
    ff_manifest_path = os.path.join(FIREFOX_DIR, "manifest.json")
    if os.path.exists(ff_manifest_path):
        with open(ff_manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("version", "1.0.0")
    return "1.0.0"

def set_version(version):
    """Updates version number across all manifest and update files automatically."""
    print(f"🏷️ Bumping version to: {version}")

    # 1. Update firefox/manifest.json
    ff_manifest_path = os.path.join(FIREFOX_DIR, "manifest.json")
    if os.path.exists(ff_manifest_path):
        with open(ff_manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["version"] = version
        with open(ff_manifest_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        print(f"  ✏️ Updated firefox/manifest.json -> {version}")

    # 2. Update chrome/manifest.json
    cr_manifest_path = os.path.join(CHROME_DIR, "manifest.json")
    if os.path.exists(cr_manifest_path):
        with open(cr_manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["version"] = version
        with open(cr_manifest_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        print(f"  ✏️ Updated chrome/manifest.json -> {version}")

    # 3. Update updates/updates-firefox.json
    ff_update_path = os.path.join(ROOT_DIR, "updates", "updates-firefox.json")
    if os.path.exists(ff_update_path):
        addon_id = "phishtackle@jbcb01.github.io"
        update_data = {
            "addons": {
                addon_id: {
                    "updates": [
                        {
                            "version": version,
                            "update_link": f"https://github.com/JbCb01/PhishTackle/releases/download/v{version}/phishtackle-firefox-{version}.xpi"
                        }
                    ]
                }
            }
        }
        with open(ff_update_path, "w", encoding="utf-8") as f:
            json.dump(update_data, f, indent=2)
            f.write("\n")
        print(f"  ✏️ Updated updates/updates-firefox.json -> {version}")

    # 4. Update updates/updates-chrome.xml
    cr_update_path = os.path.join(ROOT_DIR, "updates", "updates-chrome.xml")
    if os.path.exists(cr_update_path):
        xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appId="YOUR_CHROME_EXTENSION_ID">
    <updatecheck codebase="https://github.com/JbCb01/PhishTackle/releases/download/v{version}/phishtackle-chrome-{version}.crx" version="{version}" />
  </app>
</gupdate>
"""
        with open(cr_update_path, "w", encoding="utf-8") as f:
            f.write(xml_content)
        print(f"  ✏️ Updated updates/updates-chrome.xml -> {version}")

def trigger_release(version):
    """Commits version bump, creates git tag, and pushes to GitHub to trigger CI/CD workflow."""
    tag_name = f"v{version}"
    print(f"🚀 Triggering automated release for version: {version} (tag: {tag_name})...")
    
    try:
        subprocess.run(["git", "commit", "-am", f"release: {tag_name}"], check=False)
        subprocess.run(["git", "tag", "-d", tag_name], check=False)
        subprocess.run(["git", "tag", tag_name], check=True)
        subprocess.run(["git", "push", "origin", "main", "--tags", "--force"], check=True)
        print(f"✅ Pushed tag {tag_name} to GitHub. GitHub Actions release started!")
    except Exception as e:
        print(f"❌ Error triggering release: {e}")

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
    """Packages firefox/ directory into dist/firefox/phishtackle-firefox.zip for AMO validation."""
    if not os.path.exists(FIREFOX_DIR):
        print(f"❌ Error: {FIREFOX_DIR} directory does not exist.")
        return False

    out_zip = os.path.join(DIST_FIREFOX_DIR, "phishtackle-firefox.zip")
    zip_folder(FIREFOX_DIR, out_zip)

    size_zip = os.path.getsize(out_zip) / 1024
    print(f"✅ Built Firefox package (for Mozilla AMO upload): dist/firefox/phishtackle-firefox.zip ({size_zip:.1f} KB)")
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
    parser = argparse.ArgumentParser(description="PhishTackle Build & Release Utility")
    parser.add_argument("--target", choices=["all", "firefox", "chrome"], default="all", help="Target browser build")
    parser.add_argument("--set-version", type=str, help="Update version across all manifests automatically (e.g., 1.1.0)")
    parser.add_argument("--release", action="store_true", help="Automatically commit, tag, and push release to GitHub Actions")
    args = parser.parse_args()

    if args.set_version:
        set_version(args.set_version)

    clean_dist()

    if args.target in ["all", "firefox"]:
        build_firefox()

    if args.target in ["all", "chrome"]:
        build_chrome()

    if args.release:
        target_version = args.set_version or get_current_version()
        trigger_release(target_version)

    print("🎉 Done.")

if __name__ == "__main__":
    main()
