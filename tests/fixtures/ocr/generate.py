"""Generate synthetic OCR cases using installed real fonts, never user photos."""
import json
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, features

root=Path(__file__).parent
font=os.getenv('OCR_TEST_FONT', 'C:/Windows/Fonts/arial.ttf')
raqm=features.check_feature('raqm')
cases=[]
for lang,text in [('en','EXIT 24'),('fr','Sortie numéro 24'),('ar','الباب رقم ٢٤')]:
    for kind in ['clean','small','rotated','blurred','low_contrast']:
        image=Image.new('RGB',(900,180),'white')
        display=text
        if lang=='ar' and not raqm:
            import arabic_reshaper
            from bidi.algorithm import get_display
            display=get_display(arabic_reshaper.reshape(text))
        ImageDraw.Draw(image).text((450,90),display,font=ImageFont.truetype(font,14 if kind=='small' else 64),
            fill=(235,235,235) if kind=='low_contrast' else 'black',anchor='mm',
            **({'direction':'rtl' if lang=='ar' else 'ltr'} if raqm else {}))
        if kind=='rotated': image=image.rotate(12,resample=Image.Resampling.BICUBIC,fillcolor='white')
        if kind=='blurred': image=image.filter(ImageFilter.GaussianBlur(5))
        name=f'{lang}-{kind}.png';image.save(root/name)
        cases.append({'file':name,'lang':lang,'condition':kind,'text':text})
Image.new('RGB',(900,180),'white').save(root/'no-text.png')
cases.append({'file':'no-text.png','lang':'en','condition':'blank','text':''})
(root/'cases.json').write_text(json.dumps({'font':Path(font).name,'cases':cases},ensure_ascii=False,indent=2),encoding='utf-8')
