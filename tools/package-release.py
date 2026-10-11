"""Package deterministic public release assets from the tracked source tree."""
from pathlib import Path
import hashlib, json, shutil, subprocess, zipfile
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version']
artifact=f'SuperiorPoint_v{version}'
out=root/'release-assets';out.mkdir(exist_ok=True)
files=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
current_bundle=f'dist/{artifact}.html'
if (root/current_bundle).is_file() and current_bundle not in files: files.append(current_bundle)
excluded={'node_modules','work','output','.sp-secrets','.sp-backups','.sp-assets','.sp-projects','.playwright-cli','data','backups'}
def include(name):
    path=Path(name)
    return not any(part in excluded for part in path.parts) and not any(part.startswith('.env') and part != '.env.example' for part in path.parts)
with zipfile.ZipFile(out/f'{artifact}_Source.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name in sorted(filter(include,filter(None,files))):
        info=zipfile.ZipInfo(f'{artifact}/'+name,date_time=(2026,10,11,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
        z.writestr(info,(root/name).read_bytes())
shutil.copyfile(root/f'dist/{artifact}.html',out/f'{artifact}.html')
shutil.copyfile(root/'examples/five-slides.html',out/f'{artifact}_Demo.html')
shutil.copyfile(root/'vendor/REVEAL-LICENSE',out/'REVEAL-LICENSE.txt')
shutil.copyfile(root/'RELEASE_NOTES.md',out/'RELEASE_NOTES.md')
(out/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(out.iterdir()) if p.is_file() and p.name!='SHA256SUMS.txt'))
print('Release assets:', ', '.join(p.name for p in sorted(out.iterdir())))
