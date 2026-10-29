from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / 'dist' / 'icons'
out.mkdir(parents=True, exist_ok=True)
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('maskable-512.png', 512), ('apple-touch-icon.png', 180)]:
    scale = 4
    image = Image.new('RGB', (size * scale, size * scale), '#000000')
    d = ImageDraw.Draw(image)
    s = size * scale
    d.ellipse((s*.29, s*.27, s*.71, s*.69), fill='#53655a')
    d.ellipse((s*.41, s*.20, s*.78, s*.57), fill='#000000')
    d.arc((s*.30, s*.65, s*.70, s*.80), 185, 355, fill='#2a3a30', width=max(1, int(s*.016)))
    image.resize((size,size), Image.Resampling.LANCZOS).save(out / name)
print('Wrote 4 PWA icons.')
