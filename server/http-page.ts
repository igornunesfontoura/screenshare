import { parseInvite } from "../shared/invite.ts";

// Resposta a GETs comuns (fora do upgrade de WebSocket), igual no Node e no Workers:
// o link de convite aberto no navegador mostra o código e como entrar.

export interface HttpPage {
  type: string;
  body: string;
}

export function httpPage(requestUrl: string): HttpPage {
  const invite = parseInvite(requestUrl);
  if (invite) return { type: "text/html; charset=utf-8", body: invitePage(invite.code) };
  return { type: "text/plain; charset=utf-8", body: "ScreenShare signaling\n" };
}

// O código só tem dígitos (validado por parseInvite), então pode ir direto no HTML.
function invitePage(code: string): string {
  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Convite ScreenShare</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #090d16;
         color: #e2e8f0; font: 16px/1.5 system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 26rem; text-align: center; }
  .code { font: 600 2.5rem ui-monospace, monospace; letter-spacing: .3em; color: #34d399; margin: .5rem 0 1rem; }
  p { color: #94a3b8; }
</style>
</head>
<body>
<main>
  <h1>Convite para assistir</h1>
  <div class="code">${code}</div>
  <p>Abra o ScreenShare e, em <strong>Assistir</strong>, cole o link desta página
     (ou digite o código acima).</p>
</main>
</body>
</html>
`;
}
