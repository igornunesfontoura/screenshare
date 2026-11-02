# ScreenShare

Compartilhamento de tela P2P e watch party para Linux e Windows, construído com Electron + React + Tailwind CSS e WebRTC.

## Desenvolvimento

Requer Node 24.2+.

```bash
npm install
npm --prefix server install

npm run signal   # servidor de signaling em ws://localhost:8787
npm run dev      # app Electron com HMR
```

Para apontar para outro servidor de signaling ou usar TURN, copie `.env.example` para `.env`.

## Testes e checagens

```bash
npm run typecheck
npm run test:server
```

## Build

```bash
npm run dist:linux   # AppImage + deb
npm run dist:win     # instalador NSIS + .exe portátil
```

Veja `CLAUDE.md` para arquitetura e roadmap.
