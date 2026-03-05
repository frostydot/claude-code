---
description: "Convert any image into the Obama Hope poster style"
argument-hint: "IMAGE_PATH [--output OUTPUT_PATH] [--style hope|progress|change]"
allowed-tools: ["Bash(python3 ${CLAUDE_PLUGIN_ROOT}/scripts/obama-convert.py:*)"]
---

# Obama Image Converter

Convert any image into the iconic Shepard Fairey "Hope" poster style using 4-color posterization with Obama's signature blue/red/tan palette.

Run the converter on the provided image:

```!
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/obama-convert.py" $ARGUMENTS
```

After conversion, tell the user where the output file was saved and suggest they open it to see their Obamafied image. If no output path was specified, the file is saved as `<original-name>_obama.png` next to the input file.
