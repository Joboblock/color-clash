# Color Clash

Modular menu pages have been introduced under `src/pages`.

## Menu Page Modules
Each page exports a lightweight object consumed by the registry (`src/pages/registry.js`):

```
{
  id: 'first' | 'local' | 'online' | 'host' | 'practice',
  selector: '#domElementId',
  init(ctx) { /* optional one-time setup */ },
  show(ctx) { /* optional when page becomes active */ },
  hide(ctx) { /* optional when page hides */ }
}
```

Shared context (`ctx`) currently provides:
- `onlineConnection`
- `showConnBanner`, `hideConnBanner`
- `updateStartButtonState`
- `setMainMenuMode`
- `aiStrengthTile`
- `playerColors`, `startingColorIndex`

## Registry Usage
Pages are registered and initialized inside `script.js`:

```js
pageRegistry.register([firstPage, localPage, onlinePage, hostPage, practicePage]);
pageRegistry.initAll(sharedCtx);
```

Navigation now delegates to the registry via `showMenuFor(menuKey)` -> `pageRegistry.open(menuKey, ctx)`.

## Adding a New Page
1. Create `src/pages/yourPage.js` exporting the object above.
2. Import it in `script.js` and add to the `pageRegistry.register([...])` array.
3. Reference with `navigateToMenu('yourPageId')`.

## Legacy Logic
Existing menu DOM manipulation remains for compatibility. The registry hides non-active pages (skipping duplicate selectors) and runs lifecycle hooks.

## Future Improvements
- Move remaining menu-specific logic from `script.js` into individual page modules.
- Add unit tests for page transitions.
- Consolidate duplicate selector pages (local/host/practice) into a single dynamic module if useful.
