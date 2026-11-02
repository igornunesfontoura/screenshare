# ScreenShare

Compartilhamento de tela P2P e watch party para Linux e Windows, construído com Electron + React + Tailwind CSS e WebRTC.

## Desenvolvimento

Requer Node 24.2+. No Linux, o áudio do sistema usa `pactl` (pacote `pipewire-pulse` ou `libpulse`).

```bash
npm install
npm --prefix server install

npm run signal   # servidor de signaling em ws://localhost:8787
npm run dev      # app Electron com HMR
```

## Testes

```bash
npm run typecheck
npm test               # SDP + servidor de signaling
npm run smoke:linux    # abre o app empacotado e confere ponte, versão e tela inicial
```

## Pacotes

```bash
npm run dist:linux   # AppImage em release/<versão>/
npm run dist:win     # instalador NSIS + .exe portátil (precisa de Windows ou wine)
```

O CI (`.github/workflows/build.yml`) roda typecheck e testes, empacota no Linux e no Windows, executa o smoke test em cada um e publica os pacotes como artefatos.

## Servidor de signaling

O servidor só troca as mensagens de conexão; vídeo e áudio vão direto entre os participantes. Para usar fora da rede local, publique o servidor e configure o endereço em **Servidor de conexão** na tela inicial do app (todos na sala precisam usar o mesmo).

```bash
docker build -f server/Dockerfile -t screenshare-signaling .
docker run -p 8787:8787 -e TRUST_PROXY=1 screenshare-signaling
```

Use `wss://` atrás de um proxy com TLS (Fly.io, Render, Caddy, nginx). `TRUST_PROXY=1` faz o limite de tentativas usar o IP real do cliente. Para redes com NAT simétrico, configure um servidor TURN (veja `.env.example`).

Veja `CLAUDE.md` para arquitetura e roadmap.
