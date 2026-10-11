"""Package deterministic public release assets from the tracked source tree."""
from pathlib import Path
import hashlib, shutil, subprocess, zipfile
root=Path(__file__).resolve().parents[1]
out=root/'release-assets';out.mkdir(exist_ok=True)
files=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
with zipfile.ZipFile(out/'SuperiorPoint_v0.0.1_Source.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name in sorted(filter(None,files)):
        info=zipfile.ZipInfo('SuperiorPoint_v0.0.1/'+name,date_time=(2026,10,11,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
        z.writestr(info,(root/name).read_bytes())
shutil.copyfile(root/'dist/SuperiorPoint_v0.0.1.html',out/'SuperiorPoint_v0.0.1.html')
shutil.copyfile(root/'examples/five-slides.html',out/'SuperiorPoint_v0.0.1_Demo.html')
shutil.copyfile(root/'vendor/REVEAL-LICENSE',out/'REVEAL-LICENSE.txt')
shutil.copyfile(root/'RELEASE_NOTES.md',out/'RELEASE_NOTES.md')
(out/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(out.iterdir()) if p.is_file() and p.name!='SHA256SUMS.txt'))
print('Release assets:', ', '.join(p.name for p in sorted(out.iterdir())))
