# ScreenShare

Compartilhamento de tela P2P e watch party para Linux e Windows, construído com Tauri v2 + React + Tailwind CSS.

## Desenvolvimento

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build -- --target x86_64-unknown-linux-gnu   # AppImage + deb
npm run tauri build -- --target x86_64-pc-windows-msvc     # MSI + NSIS (.exe)
```

Veja `CLAUDE.md` para arquitetura e roadmap.
