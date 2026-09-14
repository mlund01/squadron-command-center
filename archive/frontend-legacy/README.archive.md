# Legacy Command Center frontend

This directory preserves the complete frontend source, public assets, package
manifest and lockfile, and build configuration that existed before the 2026
frontend reset.

It is intentionally outside `web/`, so none of this code participates in the
active application build. Use it only for reference and behavioral comparison.
Generated `dist/` output and `node_modules/` are not archived because they can
be reproduced from the archived lockfile.
