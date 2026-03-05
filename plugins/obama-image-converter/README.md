# Obama Image Converter Plugin

Transform any image into the iconic Barack Obama "Hope" poster style — the famous Shepard Fairey artwork that defined a generation.

## What It Does

Applies a 4-color posterization effect using the signature Obama Hope poster palette:

| Band       | Color        | Hex       |
|------------|--------------|-----------|
| Shadows    | Dark navy    | `#0A3161` |
| Mid-dark   | Obama red    | `#B9352C` |
| Mid-light  | Tan/beige    | `#D2AC73` |
| Highlights | Light blue   | `#73B2C8` |

## Quick Start

```bash
/obama photo.jpg
```

Output is saved as `photo_obama.png` in the same directory.

## Usage

```
/obama IMAGE_PATH [--output OUTPUT_PATH] [--style STYLE]
```

### Arguments

| Argument          | Description                                      |
|-------------------|--------------------------------------------------|
| `IMAGE_PATH`      | Path to the source image (JPEG, PNG, WebP, etc.) |
| `--output`, `-o`  | Custom output path (default: `<input>_obama.png`)|
| `--style`, `-s`   | Color style variant (see below)                  |

### Styles

| Style      | Description                          |
|------------|--------------------------------------|
| `hope`     | Classic blue/red/tan palette (default) |
| `progress` | Slightly warmer, softer tones        |
| `change`   | Deeper, moodier, higher contrast     |

## Examples

```bash
# Basic conversion
/obama selfie.jpg

# Custom output path
/obama selfie.jpg --output obama-selfie.png

# Use the "change" color style
/obama family-photo.png --style change

# Full options
/obama portrait.jpg --output result.png --style progress
```

## How It Works

1. **Load** the input image and convert to RGB
2. **Enhance** contrast and sharpness for better tone separation
3. **Grayscale** conversion to extract luminance values
4. **Posterize** into 4 luminance bands (0–63, 64–127, 128–191, 192–255)
5. **Map** each band to the iconic Obama Hope poster color
6. **Smooth** large images to reduce pixelation artifacts
7. **Save** the result as a PNG

## Requirements

- Python 3.x (pre-installed on most systems)
- [Pillow](https://pillow.readthedocs.io/) — auto-installed on first run if missing

## Tips

- Works best on **portrait photos** with clear lighting and contrast
- **High-resolution** images produce the most detailed posterization
- Crop tightly to the subject before converting for best results
- Try all three `--style` variants and pick your favorite

---

*Yes We Can. Yes We Did. Yes We Obamafy.*
