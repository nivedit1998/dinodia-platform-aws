# Label Registry (canonical)

## Status (as of 2026-03-17)
- ✅ Complete: Documents how to sync/check the canonical label registry across apps.

This is the single source of truth for dashboard labels and classification.

Usage (from `dinodia-platform/`):

```
node scripts/labelRegistry.js sync
node scripts/labelRegistry.js check
```

`sync` copies the canonical registry to:
- `dinodia-platform/src/config/labelRegistry.json`
- `dinodia-kiosk/src/config/labelRegistry.json`

`check` validates:
- Copies are in sync with the canonical registry.
- Registry structure is valid.
- Labels marked `custom` have visuals in both apps.
- Platform capabilities cover all group labels.
- Every declared command in capabilities is handled in the command executor(s).
