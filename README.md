# Painel de Sensores

Painel estático (HTML/CSS/JS puro) com leituras **reais** de microfone, câmera (luminosidade), GPS,
aceleração, orientação e magnetômetro (quando suportado). Sem backend, sem envio de dados.

## Rodar localmente
    python3 -m http.server 8000   # abra http://localhost:8000

(`localhost` conta como contexto seguro; em outro dispositivo use HTTPS, p.ex. o GitHub Pages.)

## Publicar no GitHub Pages
Repositório → **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main`, pasta `/ (root)` → Save**. URL: `https://<usuario>.github.io/<repo>/`.

## Notas
- Permissões só são pedidas ao clicar em "Ativar".
- iOS: movimento/orientação usam `requestPermission()` no clique (detectado automaticamente).
- Magnetometer exige Chrome Android, HTTPS e possivelmente flag; caso contrário o cartão mostra "indisponível".
- Variações nas leituras têm causas físicas comuns; não indicam fenômenos paranormais.
