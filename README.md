# PaySecure

Secure UPI payment app with QR scanning, voice commands, biometric authentication, and merchant trust verification.

## Features

- **QR Code Scanning** — Scan UPI QR codes using your device camera. Uses html5-qrcode on the client with OpenCV + pyzbar + LLM fallback on the backend.
- **Voice Payments** — Say the amount in Hindi or English (e.g. "paanch sau rupaye" or "send 500"). Audio is transcribed via Google Speech Recognition, then parsed with regex (LLM fallback for Hindi number words).
- **Merchant Trust Engine** — Every scanned UPI ID is checked against a Supabase database. Merchants are flagged as Verified, Blacklisted (payment blocked), or Unknown.
- **Biometric Authentication** — WebAuthn (fingerprint / FaceID) for payment confirmation. Credentials stored in Supabase.
- **Deep Links to UPI Apps** — After confirmation, open Google Pay, PhonePe, Paytm, or generic UPI with pre-filled payment details.

## Architecture

```
┌─────────────────────┐       ┌──────────────────────┐
│   Next.js Frontend  │──────▶│   FastAPI Backend     │
│   (Port 3000)       │  API  │   (Port 8000)         │
│                     │       │                       │
│  - QR scanning      │       │  - /api/scan          │
│  - Voice recording  │       │  - /api/transcribe    │
│  - WebAuthn client  │       │  - /api/extract-amount│
│  - UPI deep links   │       │  - /api/verify-merchant│
│                     │       │  - /api/webauthn/*    │
└─────────────────────┘       └───────┬───────────────┘
                                      │
                              ┌───────▼───────────────┐
                              │   Supabase             │
                              │  - merchants table     │
                              │  - webauthn_credentials│
                              └───────────────────────┘
                              ┌───────────────────────┐
                              │   Ollama (optional)    │
                              │  - moondream (QR)      │
                              │  - llama3.2 (amounts)  │
                              └───────────────────────┘
```

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20.x | Frontend |
| Python | 3.13 | Backend |
| Docker + Docker Compose | Latest | Containerized setup |
| Ollama (optional) | Latest | LLM fallback for QR/voice |

## Quick Start with Docker

The fastest way to run everything:

```bash
git clone https://github.com/Ayush1906saxena/PaySecure.git
cd PaySecure
```

### 1. Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and fill in your keys:

```env
# Required for Supabase features (trust engine + WebAuthn storage)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key

# Optional — Ollama URL for LLM fallback (defaults to http://localhost:11434)
OLLAMA_URL=http://host.docker.internal:11434

# CORS — comma-separated origins allowed to call the API
ALLOWED_ORIGINS=http://localhost:3000

# WebAuthn config
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGIN=http://localhost:3000
```

> **Note:** Supabase is optional. Without it, the trust engine returns "unknown" for all merchants and WebAuthn registration is disabled. The core QR scan and voice flows still work.

### 2. Build and run

```bash
docker compose up --build
```

This starts:
- **Frontend** at [http://localhost:3000](http://localhost:3000)
- **Backend** at [http://localhost:8000](http://localhost:8000)

### 3. Stop

```bash
docker compose down
```

## Manual Setup (without Docker)

### Frontend

```bash
# Install Node.js 20 (via nvm recommended)
nvm install 20
nvm use 20

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend runs at [http://localhost:3000](http://localhost:3000).

### Backend

```bash
cd backend

# Create and activate virtual environment
python3.13 -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate

# Install system dependencies (macOS)
brew install zbar ffmpeg

# Install system dependencies (Ubuntu/Debian)
# sudo apt-get install libzbar0 ffmpeg

# Install Python packages
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your keys (see section above)

# Start server
uvicorn main:app --reload
```

Backend runs at [http://localhost:8000](http://localhost:8000).

### Ollama (optional — LLM fallback)

If QR decoding or Hindi number-word extraction fails, the backend falls back to local LLMs via Ollama:

```bash
# Install Ollama — https://ollama.com
curl -fsSL https://ollama.com/install.sh | sh

# Pull required models
ollama pull moondream    # QR code reading
ollama pull llama3.2     # Hindi amount extraction
```

If Ollama is not running, these fallbacks are silently skipped and the app still works for clear QR codes and numeric amounts.

## Supabase Setup

If you want the trust engine and biometric features, create these tables in your Supabase project:

### `merchants` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | int8 | Primary key, auto-increment |
| `upi_id` | text | UPI VPA (e.g. `merchant@upi`) |
| `status` | text | `verified`, `blacklisted`, or `unknown` |

### `webauthn_credentials` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | int8 | Primary key, auto-increment |
| `user_handle` | text | Unique user identifier |
| `credential_id` | text | Base64url-encoded credential ID |
| `public_key` | text | Base64url-encoded public key |
| `sign_count` | int4 | Signature counter |

## Docker Images

Pre-built images are available on Docker Hub:

```bash
docker pull ayushsaxena1906/paysecure-frontend:latest
docker pull ayushsaxena1906/paysecure-backend:latest
```

Run them directly:

```bash
# Backend
docker run -d -p 8000:8000 --env-file backend/.env ayushsaxena1906/paysecure-backend:latest

# Frontend
docker run -d -p 3000:3000 -e NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 ayushsaxena1906/paysecure-frontend:latest
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/scan` | Decode a UPI QR code from a base64 image |
| POST | `/api/transcribe` | Transcribe audio (webm) to text |
| POST | `/api/extract-amount` | Extract payment amount from text |
| POST | `/api/verify-merchant` | Check merchant trust status |
| POST | `/api/webauthn/register/options` | Get WebAuthn registration challenge |
| POST | `/api/webauthn/register/verify` | Verify registration attestation |
| POST | `/api/webauthn/authenticate/options` | Get WebAuthn authentication challenge |
| POST | `/api/webauthn/authenticate/verify` | Verify authentication assertion |

## Project Structure

```
PaySecure/
├── app/
│   ├── page.tsx                 # Home page
│   ├── layout.tsx               # Root layout
│   ├── globals.css              # Tailwind + custom styles
│   └── scan/
│       ├── page.tsx             # Scan + voice + payment flow
│       ├── useAudioRecorder.ts  # Mic recording hook
│       └── useWebAuthn.ts       # Biometric auth hook
├── backend/
│   ├── main.py                  # FastAPI server (all endpoints)
│   ├── requirements.txt         # Python dependencies
│   └── .env.example             # Environment template
├── public/
│   ├── manifest.json            # PWA manifest
│   ├── sw.js                    # Service worker
│   └── icon-*.png               # App icons
├── Dockerfile.frontend          # Multi-stage Next.js build
├── Dockerfile.backend           # Python backend image
├── docker-compose.yml           # Run both services
├── next.config.ts               # Next.js config (standalone output)
├── tailwind.config.ts           # Tailwind configuration
└── render.yaml                  # Render.com deployment config
```

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, html5-qrcode, WebAuthn API
- **Backend:** FastAPI, OpenCV, pyzbar, SpeechRecognition, pydub, py-webauthn, Supabase Python SDK
- **Infrastructure:** Docker, Docker Compose, Render (optional)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Camera not working | Use HTTPS or localhost. Browsers block camera on plain HTTP. |
| "Could not read QR code" | Ensure the QR code is well-lit, not blurry, and fully visible in frame. |
| Voice transcription fails | Check microphone permissions. Ensure audio is loud and clear. |
| Trust engine returns "unknown" for everything | Configure `SUPABASE_URL` and `SUPABASE_KEY` in `backend/.env`. |
| Backend can't connect to Supabase | Verify your Supabase credentials and that the tables exist. |
| Docker build fails on ARM Mac | The images are built for `linux/arm64`. On x86, rebuild locally with `docker compose build`. |
| CORS errors in browser console | Add your frontend URL to `ALLOWED_ORIGINS` in `backend/.env`. |

## License

MIT
