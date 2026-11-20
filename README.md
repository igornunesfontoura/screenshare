# ScreenShare

Compartilhamento de tela P2P e watch party para Linux e Windows, construído com Electron + React + Tailwind CSS e WebRTC.

## Desenvolvimento

Requer Node 24.2+. No Linux, o áudio do sistema usa `pactl` (pacote `pipewire-pulse` ou `libpulse`); a escolha de quais apps entram no áudio usa `pw-link`/`pw-dump` (PipeWire). No Windows, essa escolha usa o helper `native/win-audio` (Rust, Windows 10 2004+), compilado com `npm run build:win-audio`.

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
npm run test:win-audio # lógica do helper de áudio do Windows (cargo)
npm run smoke:linux    # abre o app empacotado e confere ponte, versão e tela inicial
```

## Pacotes

```bash
npm run dist:linux   # AppImage em release/<versão>/
npm run dist:win     # instalador NSIS + .exe portátil (precisa de Windows ou wine)
```

O CI (`.github/workflows/build.yml`) roda typecheck e testes, empacota no Linux e no Windows, executa o smoke test em cada um e publica os pacotes como artefatos.

## Servidor de signaling

O servidor só troca as mensagens de conexão; vídeo e áudio vão direto entre os participantes. Os builds de release apontam para o servidor publicado no Cloudflare Workers (`.env.production`), então basta o código da sala. Na sala, **Copiar convite** gera um link (`https://<servidor>/j/<código>`): quem recebe cola o link no campo do código, ou abre no navegador para ver o código.

### Cloudflare Workers (padrão)

`server/worker.ts` roda o mesmo protocolo num Durable Object (plano grátis basta):

```bash
cd server
npx wrangler login   # uma vez
npm run deploy       # publica em wss://screenshare-signal.<sua-conta>.workers.dev
npm run test:worker  # testes do servidor contra o wrangler dev
```

### Node / Docker (auto-hospedado)

O app não tem campo de servidor: para usar um servidor próprio, gere o build com `VITE_SIGNALING_URL=wss://seu-servidor` (todos na sala precisam do mesmo build).

```bash
docker build -f server/Dockerfile -t screenshare-signaling .
docker run -p 8787:8787 -e TRUST_PROXY=1 screenshare-signaling
```

Use `wss://` atrás de um proxy com TLS (Fly.io, Render, Caddy, nginx). `TRUST_PROXY=1` faz o limite de tentativas usar o IP real do cliente. Para redes com NAT simétrico, configure um servidor TURN (veja `.env.example`).

Veja `CLAUDE.md` para arquitetura e roadmap.
