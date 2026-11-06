"""Build a transparent Windows icon from the approved neon logo without a tile.
Run only when brand-source.png is updated: python assets/generate-icon.py
"""
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parent
source=Image.open(ROOT/'brand-source.png').convert('RGBA')
bbox=source.getchannel('A').getbbox()
if not bbox: raise ValueError('Source logo has no visible pixels')
logo=source.crop(bbox)
w,h=logo.size
# Preserve original artwork proportions with 4% padding on a true transparent canvas.
canvas=Image.new('RGBA',(512,512),(0,0,0,0))
scale=min(470/w,470/h)
logo=logo.resize((max(1,round(w*scale)),max(1,round(h*scale))),Image.Resampling.LANCZOS)
canvas.alpha_composite(logo,((512-logo.width)//2,(512-logo.height)//2))
canvas.save(ROOT/'icon.png',optimize=True)
canvas.save(ROOT/'icon.ico',format='ICO',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
canvas.resize((256,256),Image.Resampling.LANCZOS).save(ROOT/'logo-mark.png',optimize=True)
print('True-transparent icon.png/icon.ico/logo-mark.png generated.')
