# PaperNight

PaperNight is a static, browser-only PDF dark-mode converter. Choose a PDF,
press Convert, and the dark-mode PDF downloads automatically.

## Run locally

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4173/
```

## Static hosting

Upload the whole directory, including `vendor/`, to any static host.

## Notes

- PDFs are processed in the browser.
- Exported PDFs are not rasterized.
- The output adds a white page base, preserves the original PDF page operators,
  and applies a vector blend-mode inversion.
- Figures and images invert along with text.
