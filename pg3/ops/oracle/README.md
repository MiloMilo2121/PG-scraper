# 🐍 OMEGA PYTHON ORACLE

Questo microservizio FastAPI funge da "Sidecar" per il motore principale OMEGA (scritto in Node.js/TypeScript). 
Il suo unico scopo è usare l'infrastruttura Python nativa di **Crawl4AI** (con Undetected Browser Mode) per bypassare i firewall avanzati 2026 come Cloudflare Turnstile e DataDome a costo zero.

## 🚀 INSTALLAZIONE (Da eseguire sia in locale che sul server Hetzner)

Il server richiede Python 3.9 o superiore.

1. **Crea l'ambiente virtuale python e installa le dipendenze:**
   ```bash
   cd ops/oracle
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Installa i browser binari di sistema (Crawl4AI usa sotto il cofano Playwright patchato):**
   ```bash
   playwright install
   playwright install-deps 
   ```

## 🔄 AVVIO DEL MICROSERVIZIO

L'Oracle deve essere sempre acceso in background prima di lanciare `RunnerV6.ts`.

In fase di sviluppo:
```bash
python3 server.py
```

Sul server remoto (Hetzner), ti consiglio di metterlo in uno screen dedicato:
```bash
screen -d -m -S PYTHON_ORACLE bash -c 'cd /root/PG-scraper/pg3/ops/oracle && source venv/bin/activate && python3 server.py'
```

## 🔌 ARCHITETTURA DI RETE
Il server si mette in ascolto sulla porta locale `127.0.0.1:8000`. 
Non esporre questa porta su internet per motivi di sicurezza. OMEGA (Node.js) vi accederà solo tramite interfaccia di loopback sicura chiamando:
`POST http://127.0.0.1:8000/api/v1/extract`
