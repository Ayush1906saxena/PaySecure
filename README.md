# PaySecure

Secure UPI payment app with QR scanning, voice commands, in-app wallet, biometric authentication, and merchant trust verification.

## Features

- **User Authentication** — Email/password login via Supabase Auth. Protected routes with Next.js middleware.
- **In-App Wallet** — Users start with ₹0 and add money via the "Add Money" top-up button (simulated). Payments ≤ ₹5,000 with sufficient balance are debited directly from the wallet (no UPI redirect needed). Amounts > ₹5,000 or insufficient balance redirect to UPI apps.
- **QR Code Scanning** — Scan UPI QR codes using your device camera. Uses html5-qrcode on the client with OpenCV + pyzbar + LLM fallback on the backend.
- **Voice Payments** — Say the amount in Hindi or English (e.g. "paanch sau rupaye" or "send 500"). Audio is transcribed via Google Speech Recognition, then parsed with regex (LLM fallback for Hindi number words).
- **Merchant Trust Engine** — Every scanned UPI ID is checked against a Supabase database. Merchants are flagged as Verified, Blacklisted (payment blocked), or Unknown.
- **Biometric Authentication** — WebAuthn (fingerprint / FaceID) for payment confirmation. Credentials stored in Supabase.
- **Transaction History** — View all past wallet payments with merchant names, amounts, and timestamps.
- **Deep Links to UPI Apps** — For high-amount or insufficient-balance payments, open Google Pay, PhonePe, Paytm, or generic UPI with pre-filled details.

## Architecture

```
┌─────────────────────┐       ┌──────────────────────┐
│   Next.js Frontend  │──────▶│   FastAPI Backend     │
│   (Port 3000)       │  API  │   (Port 8000)         │
│                     │       │                       │
│  - Auth (login)     │       │  - /api/scan          │
│  - QR scanning      │       │  - /api/transcribe    │
│  - Voice recording  │       │  - /api/extract-amount│
│  - Wallet display   │       │  - /api/verify-merchant│
│  - WebAuthn client  │       │  - /api/wallet/*      │
│  - UPI deep links   │       │  - /api/webauthn/*    │
└─────────────────────┘       └───────┬───────────────┘
                                      │
                              ┌───────▼───────────────┐
                              │   Supabase             │
                              │  - Auth (users)        │
                              │  - wallets table       │
                              │  - transactions table  │
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
# Required — Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# CORS — comma-separated origins allowed to call the API
ALLOWED_ORIGINS=http://localhost:3000

# WebAuthn config
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGIN=http://localhost:3000

# Optional — Ollama URL for LLM fallback (defaults to http://localhost:11434)
OLLAMA_URL=http://host.docker.internal:11434
```

Create `.env.local` in the project root for the frontend:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

> **Note:** Supabase is required for authentication and wallet features. The service role key is used by the backend for wallet operations.

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

### 1. Enable Email Auth

Go to Authentication → Email in your Supabase dashboard and **turn OFF "Confirm email"** for demo mode.

### 2. Run the SQL setup

Execute this in the Supabase SQL Editor:

```sql
-- Wallets table (auto-created per user via trigger)
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- Transactions ledger
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  upi_id TEXT,
  merchant_name TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own transactions"
  ON public.transactions FOR SELECT USING (auth.uid() = user_id);

-- Auto-create wallet on signup (₹0 balance)
CREATE OR REPLACE FUNCTION public.create_wallet_for_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.wallets (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.create_wallet_for_new_user();

-- Atomic wallet credit (top-up)
CREATE OR REPLACE FUNCTION public.credit_wallet(p_user_id UUID, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_balance NUMERIC;
BEGIN
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  UPDATE public.wallets SET balance = balance + p_amount, updated_at = now() WHERE user_id = p_user_id;
  v_balance := v_balance + p_amount;
  INSERT INTO public.transactions (user_id, amount, direction) VALUES (p_user_id, p_amount, 'credit');
  RETURN v_balance;
END; $$;

-- Atomic wallet debit (prevents race conditions)
CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_user_id UUID, p_amount NUMERIC, p_upi_id TEXT, p_merchant_name TEXT
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_balance NUMERIC;
BEGIN
  SELECT balance INTO v_balance FROM public.wallets
    WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance = balance - p_amount, updated_at = now()
    WHERE user_id = p_user_id;
  INSERT INTO public.transactions (user_id, amount, direction, upi_id, merchant_name)
    VALUES (p_user_id, p_amount, 'debit', p_upi_id, p_merchant_name);
  RETURN v_balance - p_amount;
END; $$;
```

### 3. Existing tables

These should already exist if you set up the app previously:

#### `merchants` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | int8 | Primary key, auto-increment |
| `upi_id` | text | UPI VPA (e.g. `merchant@upi`) |
| `status` | text | `verified`, `blacklisted`, or `unknown` |

#### `webauthn_credentials` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | int8 | Primary key, auto-increment |
| `user_handle` | text | Supabase Auth user ID |
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

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/scan` | No | Decode a UPI QR code from a base64 image |
| POST | `/api/transcribe` | No | Transcribe audio (webm) to text |
| POST | `/api/extract-amount` | No | Extract payment amount from text |
| POST | `/api/verify-merchant` | No | Check merchant trust status |
| GET | `/api/wallet/balance` | JWT | Get authenticated user's wallet balance |
| POST | `/api/wallet/topup` | JWT | Add money to wallet (simulated top-up) |
| POST | `/api/wallet/pay` | JWT | Debit wallet (≤ ₹5,000 only) |
| POST | `/api/webauthn/register/options` | JWT | Get WebAuthn registration challenge |
| POST | `/api/webauthn/register/verify` | JWT | Verify registration attestation |
| POST | `/api/webauthn/authenticate/options` | JWT | Get WebAuthn authentication challenge |
| POST | `/api/webauthn/authenticate/verify` | JWT | Verify authentication assertion |

## Project Structure

```
PaySecure/
├── app/
│   ├── page.tsx                 # Home page (wallet banner, user bar)
│   ├── layout.tsx               # Root layout (AuthProvider)
│   ├── globals.css              # Tailwind + custom styles
│   ├── login/
│   │   └── page.tsx             # Login / signup page
│   ├── history/
│   │   └── page.tsx             # Transaction history
│   ├── components/
│   │   ├── AuthProvider.tsx     # Auth context provider
│   │   ├── SignOutButton.tsx    # Sign out button
│   │   └── WalletBanner.tsx     # Wallet balance display
│   └── scan/
│       ├── page.tsx             # Scan + voice + wallet payment flow
│       ├── useAudioRecorder.ts  # Mic recording hook
│       └── useWebAuthn.ts       # Biometric auth hook
├── lib/
│   └── supabase/
│       ├── client.ts            # Browser Supabase client
│       └── server.ts            # Server Supabase client
├── middleware.ts                 # Auth guard (redirect to /login)
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

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, html5-qrcode, WebAuthn API, @supabase/ssr
- **Backend:** FastAPI, OpenCV, pyzbar, SpeechRecognition, pydub, py-webauthn, Supabase Python SDK, PyJWT
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
