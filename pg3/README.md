
# PG Scraper V3

## Overview
High-performance, agentic web scraper for finding B2B leads.

## Features
- **Discovery**: Google, DDG, Bing support with fallback and rate limiting.
- **Enrichment**: PIVA, Phone, Language detection, Deep scanning.
- **Stealth**: Browser fingerprinting evasion, Proxy rotation, Zombie cleanup.
- **Scalability**: Redis-backed queues, SQLite results, Docker support.
- **AI**: LLM-based validation and content filtering.

## Setup
1. `npm install`
2. `cp .env.example .env`
3. `docker-compose up -d` (Optional: Redis)
4. `npm start`

## Architecture
See `src/core` for functional modules.
- `browser`: Puppeteer factory
- `discovery`: Search strategies
- `data`: Quality & deduplication
- `ai`: LLM integration

## Dashboard
Open `src/dashboard/index.html` to view status.
