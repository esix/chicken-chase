"""Extract reusable CSS chrome from the original art; never change app/images.

StdDialog resources: FUN_00421251 (rwg:40838), resource loads rwg:31352-31372.
Crop bounds are measured in app/images/dialog.png and screenshots/04.png, 06.png.
Run from any directory with: python3 js/tools/prepare_dialog_art.py (Pillow).
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'js/styles/assets'
OUT.mkdir(exist_ok=True)


def screenshot_palette(art):
    # Screenshots 04/06/15 match RGB565 channel truncation + bit replication:
    # dialog fill (231,172,63) -> (231,174,57), plate (202,143,52)
    # -> (206,142,49). Preserve the native alpha mask for browser compositing.
    channels = list(art.split())
    for channel, bits in enumerate((5, 6, 5)):
        shift = 8 - bits
        channels[channel] = channels[channel].point([
            ((value >> shift) << shift) | ((value >> shift) >> (bits - shift))
            for value in range(256)
        ])
    return Image.merge('RGBA', channels)


def rgba(name):
    art = Image.open(ROOT / f'app/images/{name}.png').convert('RGBA')
    # Same separate grayscale alpha mask used by Res / SexyApp.Image.
    art.putalpha(Image.open(ROOT / f'app/images/{name}_.png').convert('L'))
    return screenshot_palette(art)


dialog = rgba('dialog')
# Keep the frame, corner rivets and original shadow. The separate title plate
# must not be repeated in the frame's top border or stretched vertically.
frame = dialog.copy()
frame.paste(dialog.getpixel((125, 100)), (40, 16, 210, 72))
frame.save(OUT / 'dialog-frame.png')
dialog.crop((45, 18, 205, 68)).save(OUT / 'dialog-plate.png')
for name in ('dialog_btn', 'dialog_btn_over', 'dialog_btn_highlight', 'dialog_btn_highlight_over'):
    rgba(name).save(OUT / f'{name}.png')

# Shared native controls: slider 191x28, thumb 35x35, checkbox 80x40.
# Options resize FUN_0040fbff (rwg:19453-19462); checkbox has no sidecar mask.
for name in ('slider', 'slider_thumb'):
    rgba(name).save(OUT / f'{name}.png')
checkbox = screenshot_palette(Image.open(ROOT / 'app/images/checkbox.png').convert('RGBA'))
checkbox.crop((0, 0, 40, 40)).save(OUT / 'checkbox-off.png')
checkbox.crop((40, 0, 80, 40)).save(OUT / 'checkbox-on.png')

# SelectLevel controls, FUN_0041c860 rwg:34941-34948. Over states use the
# same native mask. Legend art/coin values are visible in screenshots 12/18.
for name in ('button_prev', 'button_next'):
    rgba(name).save(OUT / f'{name}.png')
    over = Image.open(ROOT / f'app/images/{name}_over.png').convert('RGBA')
    over.putalpha(Image.open(ROOT / f'app/images/{name}_.png').convert('L'))
    screenshot_palette(over).save(OUT / f'{name}_over.png')

# Introduction letter transparency (FUN_0040d9ef:16891; screenshot 10).
letter = Image.open(ROOT / 'app/images/letter.jpg').convert('RGBA')
letter.putalpha(Image.open(ROOT / 'app/images/letter_.jpg').convert('L'))
screenshot_palette(letter).save(OUT / 'letter.png')
