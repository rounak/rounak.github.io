# PaperNight

PaperNight is a static, browser-only PDF dark-mode converter. It renders each
page locally, maps white paper and dark text into a dark reading palette, and
exports a new PDF.

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
- The exported PDF is rasterized, which keeps the dark-mode appearance stable
  across articles, papers, figures, and equations.
- Rasterized output does not preserve selectable/searchable text.
