#!/usr/bin/env python3
"""
Obama Hope Poster Image Converter
Transforms any image into the iconic Shepard Fairey "Hope" poster style.
"""

import sys
import os
import argparse

def check_dependencies():
    try:
        from PIL import Image
        return True
    except ImportError:
        return False

def install_dependencies():
    import subprocess
    print("Installing Pillow...")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "Pillow", "--quiet"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Failed to install Pillow: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    print("Pillow installed successfully.")

def obama_posterize(image_path, output_path=None, style="hope"):
    """
    Convert an image to Obama Hope poster style.

    The iconic 4-color posterization uses:
      - Dark navy/black for deep shadows
      - Red/dark red for mid-dark tones
      - Tan/beige for mid-light tones
      - Light blue/cyan for highlights
    """
    from PIL import Image, ImageEnhance, ImageFilter

    # Color palettes
    palettes = {
        "hope": [
            (10,  49,  97),   # dark navy (shadows)
            (185, 53,  44),   # obama red (mid-dark)
            (210, 172, 115),  # tan/beige (mid-light)
            (115, 178, 200),  # light blue (highlights)
        ],
        "progress": [
            (10,  49,  97),   # dark navy
            (185, 53,  44),   # red
            (235, 200, 150),  # warm tan
            (200, 220, 240),  # pale blue
        ],
        "change": [
            (20,  40,  80),   # deep navy
            (160, 40,  40),   # deep red
            (200, 160, 100),  # warm beige
            (100, 160, 190),  # steel blue
        ],
    }

    colors = palettes.get(style, palettes["hope"])

    img = Image.open(image_path).convert("RGB")

    # Boost contrast before posterizing for cleaner separation
    img = ImageEnhance.Contrast(img).enhance(1.4)
    img = ImageEnhance.Sharpness(img).enhance(1.2)

    # Convert to grayscale for luminance-based mapping
    gray = img.convert("L")

    width, height = gray.size
    result = Image.new("RGB", (width, height))

    gray_pixels = gray.load()
    result_pixels = result.load()

    # Map 4 luminance bands to the poster colors
    thresholds = [64, 128, 192]  # splits: 0-63, 64-127, 128-191, 192-255

    for y in range(height):
        for x in range(width):
            lum = gray_pixels[x, y]
            if lum < thresholds[0]:
                result_pixels[x, y] = colors[0]  # darkest
            elif lum < thresholds[1]:
                result_pixels[x, y] = colors[1]  # mid-dark
            elif lum < thresholds[2]:
                result_pixels[x, y] = colors[2]  # mid-light
            else:
                result_pixels[x, y] = colors[3]  # lightest

    # Slight blur to smooth out pixelation on large images
    if width * height > 500_000:
        result = result.filter(ImageFilter.SMOOTH_MORE)

    # Determine output path
    if output_path is None:
        base, ext = os.path.splitext(image_path)
        output_path = f"{base}_obama.png"

    result.save(output_path)
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Convert any image to Obama Hope poster style",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python obama-convert.py photo.jpg
  python obama-convert.py photo.jpg --output result.png
  python obama-convert.py photo.jpg --style progress
  python obama-convert.py photo.jpg --style change

Styles:
  hope      Classic blue/red/tan (default)
  progress  Slightly warmer variant
  change    Deeper, moodier tones
        """
    )
    parser.add_argument("image", help="Path to input image")
    parser.add_argument("--output", "-o", help="Output file path (default: <input>_obama.png)")
    parser.add_argument("--style", "-s", choices=["hope", "progress", "change"],
                        default="hope", help="Color style (default: hope)")

    args = parser.parse_args()

    if not os.path.isfile(args.image):
        print(f"Error: File not found: {args.image}", file=sys.stderr)
        sys.exit(1)

    if not check_dependencies():
        install_dependencies()

    print(f"Converting '{args.image}' to Obama Hope poster style ({args.style})...")
    output = obama_posterize(args.image, args.output, args.style)
    print(f"Done! Saved to: {output}")


if __name__ == "__main__":
    main()
