# Third-party notices

The release includes the MIT-licensed WABS plugin SDK and Zod, each with its original license in `node_modules`. Exact versions and integrity are recorded in `package-lock.json` and SDK provenance in `provenance.json`.

The unmodified geocoder service contract is MIT licensed. Its license, upstream commit and checksum are retained in `contracts/`. It contains no provider implementation or geographic data.

Tide observations are retrieved from Instituto Hidrográfico under CC BY-NC 4.0. Portuguese harmonic predictions are retrieved from FCUL for scientific and informational use. Open-Meteo marine forecasts are CC BY 4.0 and include Copernicus Marine and Météo-France data. These sources remain remote data providers and are not redistributed in the package.

## Natural Earth boundaries

The bundled Portugal land/coast geometry and adjacent Spanish land are derived from Natural Earth 5.1.2, Admin 0 Countries at 1:10m, public domain. Source revision and SHA-256 are recorded in `dist/data/portugal-boundaries.json`; `scripts/generate-portugal-boundaries.py` records the extraction. The Portugal/Spain land border is removed from the coast geometry.

https://www.naturalearthdata.com/about/terms-of-use/
