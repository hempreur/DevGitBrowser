"""Reconstruct the DevGitBrowser icon from the supplied visual mockup.
Run only when updating artwork; the output PNG/ICO are bundled in the project.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
# Source artwork is kept in the project as brand-source.png
image = Image.open(ROOT / 'brand-source.png').convert('RGBA')
# Image is the cropped neon code/browser symbol from the approved visual.
base = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
rounded = Image.new('L', (512, 512), 0)
d = ImageDraw.Draw(rounded)
d.rounded_rectangle((9, 9, 502, 502), radius=112, fill=255)

# An inky gradient makes the light colored rings legible as a 16px taskbar icon.
gradient = Image.new('RGBA', (512, 512))
pix = gradient.load()
for y in range(512):
    for x in range(512):
        t = min(1, max(0, (x + y)/1024))
        pix[x,y] = (int(4+10*t),int(11+9*t),int(35+23*t),255)
gradient.putalpha(rounded)
base.alpha_composite(gradient)

# Soft electric-blue aura behind the artwork.
glow = Image.new('RGBA', (512,512))
gd = ImageDraw.Draw(glow)
gd.ellipse((72,137,440,373), fill=(16,102,250,65))
glow = glow.filter(ImageFilter.GaussianBlur(46))
base.alpha_composite(glow)

# The artwork's dark outer edges are feathered to avoid a pasted-in rectangle.
art = image.resize((476,288), Image.Resampling.LANCZOS)
mask = Image.new('L',art.size,0)
mp = mask.load()
w,h=art.size
for y in range(h):
    for x in range(w):
        d = min(x,w-1-x,y,h-1-y)
        mp[x,y] = min(255,max(0,int(d/34*255)))
art.putalpha(mask)
base.alpha_composite(art,(18,114))
# Mask any out-of-round spill.
final_alpha=Image.new('L',base.size)
from PIL import ImageChops
final_alpha = ImageChops.multiply(base.getchannel('A'),rounded)
base.putalpha(final_alpha)
base.save(ROOT/'icon.png', optimize=True)
base.save(ROOT/'icon.ico', format='ICO', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
# App UI also uses a separate medium size image for the visual identity.
base.resize((256,256),Image.Resampling.LANCZOS).save(ROOT/'logo-mark.png', optimize=True)
print('Generated icon.png / icon.ico / logo-mark.png')
