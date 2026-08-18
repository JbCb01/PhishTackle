#!/usr/bin/env bash
set -e

python3 -c "
import json, os, zipfile

with open('chrome/manifest.json') as f:
    manifest = json.load(f)
version = manifest.get('version', '1.0')

dist_dir = 'dist'
os.makedirs(dist_dir, exist_ok=True)

def zip_folder(folder_path, output_zip):
    if os.path.exists(output_zip):
        os.remove(output_zip)
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as ziph:
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                if file.startswith('.') or file.endswith('.pyc') or '__MACOSX' in root:
                    continue
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, folder_path)
                ziph.write(file_path, arcname)

chrome_zip = os.path.join(dist_dir, f'phishtackle-chrome-v{version}.zip')
firefox_zip = os.path.join(dist_dir, f'phishtackle-firefox-v{version}.zip')

print('==========================================')
print(f' Building PhishTackle Release Packages (v{version})')
print('==========================================')

print('--> Packaging Chrome extension...')
zip_folder('chrome', chrome_zip)
sz_c = os.path.getsize(chrome_zip) / (1024 * 1024)
print(f'  [OK] Created {chrome_zip} ({sz_c:.2f} MB)')

print('--> Packaging Firefox extension...')
zip_folder('firefox', firefox_zip)
sz_f = os.path.getsize(firefox_zip) / (1024 * 1024)
print(f'  [OK] Created {firefox_zip} ({sz_f:.2f} MB)')

print('==========================================')
print(' Build successful! Zip packages ready in dist/:')
print(f'   - {chrome_zip}')
print(f'   - {firefox_zip}')
print('==========================================')
"
