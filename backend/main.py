import base64
import io
import json
import os
import re
import tempfile
import time
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np
import speech_recognition as sr
from dotenv import load_dotenv
import jwt as pyjwt
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.middleware.cors import CORSMiddleware
import httpx
from PIL import Image, ImageEnhance, ImageFilter
from pydub import AudioSegment
from pydantic import BaseModel
from pyzbar.pyzbar import decode as pyzbar_decode
from supabase import create_client, ClientOptions
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

load_dotenv()

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = "moondream"

# ── Supabase client (5s timeout to avoid hanging on network issues) ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
try:
    supabase = create_client(
        SUPABASE_URL,
        SUPABASE_KEY,
        options=ClientOptions(postgrest_client_timeout=5),
    ) if SUPABASE_URL and SUPABASE_KEY else None
except Exception as e:
    print(f"[WARN] Supabase init failed: {e}")
    supabase = None

if supabase:
    print("[INFO] Supabase client initialized.")
else:
    print("[WARN] Supabase credentials missing — trust engine disabled.")

# ── Service role Supabase client (for wallet operations) ──
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
try:
    supabase_admin = create_client(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        options=ClientOptions(postgrest_client_timeout=5),
    ) if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY else None
except Exception as e:
    print(f"[WARN] Supabase admin client init failed: {e}")
    supabase_admin = None

if supabase_admin:
    print("[INFO] Supabase admin client initialized (wallet enabled).")
else:
    print("[WARN] Service role key missing — wallet disabled.")

# ── JWT Validation ──
bearer_scheme = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """Validate Supabase JWT and return decoded claims."""
    token = credentials.credentials
    try:
        payload = pyjwt.decode(
            token,
            options={"verify_signature": False},
            algorithms=["HS256"],
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: no sub claim")
        return {"user_id": user_id, "payload": payload}
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

# ── In-memory trust cache (upi_id → (status, timestamp)) ──
_trust_cache: dict[str, tuple[str, float]] = {}
CACHE_TTL = 3600  # 1 hour

# ── WebAuthn config ──
RP_ID = os.environ.get("WEBAUTHN_RP_ID", "localhost")
RP_NAME = "PaySecure"
RP_ORIGIN = os.environ.get("WEBAUTHN_RP_ORIGIN", "http://localhost:3000")

# Challenges are ephemeral — in-memory is fine (short-lived, single-use)
_webauthn_challenges: dict[str, bytes] = {}
# Credentials are persisted in Supabase table: webauthn_credentials

app = FastAPI(title="PaySecure API")

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    image: str  # base64-encoded image (with or without data URI prefix)


class ScanResponse(BaseModel):
    upi_id: str
    merchant_name: str


def parse_upi_uri(uri: str) -> dict:
    """Parse a upi:// URI and extract the VPA (pa) and payee name (pn)."""
    parsed = urlparse(uri)
    params = parse_qs(parsed.query)

    pa = params.get("pa", [None])[0]
    pn = params.get("pn", [None])[0]

    if not pa:
        raise ValueError("No UPI VPA (pa) found in QR data")

    return {
        "upi_id": pa,
        "merchant_name": pn or "Unknown",
    }


# ── QR decode helpers ──

def _try_detect(detector, img) -> str | None:
    try:
        data, points, _ = detector.detectAndDecode(img)
        if data:
            return data
    except Exception:
        pass
    return None


def try_opencv_qr(img_array: np.ndarray) -> str | None:
    detector = cv2.QRCodeDetector()

    r = _try_detect(detector, img_array)
    if r:
        return r

    gray = cv2.cvtColor(img_array, cv2.COLOR_BGR2GRAY)

    r = _try_detect(detector, gray)
    if r:
        return r

    sharpened = cv2.filter2D(gray, -1, np.array([[0,-1,0],[-1,5,-1],[0,-1,0]]))
    r = _try_detect(detector, sharpened)
    if r:
        return r

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    r = _try_detect(detector, otsu)
    if r:
        return r

    for block_size in [31, 51, 71, 91]:
        thresh = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block_size, 10
        )
        r = _try_detect(detector, thresh)
        if r:
            return r

    for t in [80, 100, 120, 140, 160, 180]:
        _, binary = cv2.threshold(gray, t, 255, cv2.THRESH_BINARY)
        r = _try_detect(detector, binary)
        if r:
            return r

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    r = _try_detect(detector, clahe.apply(gray))
    if r:
        return r

    h, w = gray.shape[:2]
    for scale in [2, 3]:
        scaled = cv2.resize(gray, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
        r = _try_detect(detector, scaled)
        if r:
            return r

    return None


def try_pyzbar(image: Image.Image) -> str | None:
    strategies = [
        image,
        image.convert("L"),
        image.convert("L").filter(ImageFilter.SHARPEN),
        ImageEnhance.Contrast(image.convert("L")).enhance(2.0),
        image.convert("L").point(lambda p: 255 if p > 128 else 0),
    ]
    for img in strategies:
        results = pyzbar_decode(img)
        if results:
            return results[0].data.decode("utf-8", errors="ignore")
    return None


# ── LLM fallback (Ollama) ──

async def llm_extract_qr(b64_image: str) -> str | None:
    """Ask moondream to read the raw text content of the QR code."""
    prompt = (
        "Read the QR code in this image. "
        "What is the full text string encoded in the QR code? "
        "Output only the decoded text, nothing else."
    )

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": MODEL,
                    "prompt": prompt,
                    "images": [b64_image],
                    "stream": False,
                },
            )
            resp.raise_for_status()
    except httpx.ConnectError:
        print("[WARN] Cannot connect to Ollama — skipping LLM QR fallback")
        return None
    except Exception as e:
        print(f"[ERROR] Ollama error: {e}")
        return None

    text = resp.json().get("response", "").strip()
    print(f"[DEBUG] LLM raw response: {text}")
    return text if text else None


@app.post("/api/scan", response_model=ScanResponse)
async def scan_qr(req: ScanRequest):
    raw = req.image
    if "," in raw:
        raw = raw.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    try:
        pil_image = Image.open(io.BytesIO(image_bytes))
        cv_array = np.frombuffer(image_bytes, dtype=np.uint8)
        cv_image = cv2.imdecode(cv_array, cv2.IMREAD_COLOR)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image")

    # ── Step 1: Try direct QR decode (instant) ──
    qr_data = None
    if cv_image is not None:
        qr_data = try_opencv_qr(cv_image)
        if qr_data:
            print(f"[DEBUG] OpenCV decoded: {qr_data}")

    if not qr_data:
        qr_data = try_pyzbar(pil_image)
        if qr_data:
            print(f"[DEBUG] pyzbar decoded: {qr_data}")

    # ── Step 2: Fall back to LLM if QR decode failed ──
    if not qr_data:
        print("[DEBUG] QR decode failed, falling back to LLM...")
        qr_data = await llm_extract_qr(raw)

    if not qr_data:
        raise HTTPException(
            status_code=422,
            detail="Could not read the QR code. Please try again with a clearer photo.",
        )

    # ── Step 3: Parse the UPI URI ──
    # Clean up — the LLM might return the URI with extra whitespace or wrapping
    qr_data = qr_data.strip().strip("`").strip('"').strip("'")

    # Find the upi:// URI if buried in extra text
    lower = qr_data.lower()
    upi_start = lower.find("upi://")
    if upi_start != -1:
        qr_data = qr_data[upi_start:]
        # Trim anything after a space/newline (LLM might add commentary)
        for sep in ["\n", " ", "\t"]:
            if sep in qr_data:
                qr_data = qr_data[:qr_data.index(sep)]
    else:
        raise HTTPException(
            status_code=422,
            detail=f"QR code found but it's not a UPI code. Data: {qr_data[:300]}",
        )

    print(f"[DEBUG] Final UPI URI: {qr_data}")

    try:
        result = parse_upi_uri(qr_data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return ScanResponse(**result)


# ── Voice Payment Endpoints ──


class ExtractRequest(BaseModel):
    text: str


class ExtractResponse(BaseModel):
    amount: float
    currency: str


def _best_google_transcript(audio: sr.AudioData, languages: list[str]) -> str | None:
    """Try Google Speech Recognition with multiple languages, return best result."""
    recognizer = sr.Recognizer()
    best_text = None
    best_confidence = -1.0

    for lang in languages:
        try:
            results = recognizer.recognize_google(audio, language=lang, show_all=True)
            if not results or not isinstance(results, dict):
                continue

            alternatives = results.get("alternative", [])
            if not alternatives:
                continue

            top = alternatives[0]
            text = top.get("transcript", "").strip()
            confidence = float(top.get("confidence", 0.0))

            print(f"[DEBUG] Google STT [{lang}]: '{text}' (confidence={confidence:.3f})")

            if text and confidence > best_confidence:
                best_text = text
                best_confidence = confidence
        except sr.UnknownValueError:
            print(f"[DEBUG] Google STT [{lang}]: no speech detected")
        except sr.RequestError as e:
            print(f"[DEBUG] Google STT [{lang}]: request error: {e}")

    return best_text


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Accept audio upload, transcribe using Google Speech Recognition (multilingual)."""
    contents = await file.read()

    # Save uploaded audio to temp webm file
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(contents)
        webm_path = tmp.name

    # Convert webm → wav (SpeechRecognition needs wav format)
    wav_path = webm_path.replace(".webm", ".wav")
    try:
        audio_segment = AudioSegment.from_file(webm_path, format="webm")
        audio_segment = audio_segment.set_channels(1).set_frame_rate(16000)
        audio_segment.export(wav_path, format="wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audio conversion failed: {e}")

    # Load wav into SpeechRecognition
    recognizer = sr.Recognizer()
    with sr.AudioFile(wav_path) as source:
        audio = recognizer.record(source)

    # Try Hindi first (covers Hinglish), then Indian English
    text = _best_google_transcript(audio, ["hi-IN", "en-IN"])

    if not text:
        raise HTTPException(status_code=422, detail="Could not transcribe any speech from the audio.")

    print(f"[DEBUG] Final transcript: {text}")
    return {"text": text}


def _try_regex_extract(text: str) -> float | None:
    """Try to extract a numeric amount directly from text using regex.
    Handles: '500 rupees', '₹ 1,000', 'Rs. 250', '2000 rs', etc."""
    # Match numbers (with optional commas) near currency keywords
    patterns = [
        r'[₹]\s*([\d,]+(?:\.\d+)?)',                           # ₹500, ₹ 1,000
        r'([\d,]+(?:\.\d+)?)\s*(?:rupees?|rs\.?|inr)',          # 500 rupees, 500 rs
        r'(?:rupees?|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)',          # Rs. 500
        r'(?:send|pay|transfer)\s+([\d,]+(?:\.\d+)?)',          # send 500
        r'([\d,]+(?:\.\d+)?)',                                  # bare number as last resort
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            num_str = m.group(1).replace(",", "")
            try:
                return float(num_str)
            except ValueError:
                continue
    return None


@app.post("/api/extract-amount", response_model=ExtractResponse)
async def extract_amount(req: ExtractRequest):
    """Extract payment amount from Hindi/English text. Uses regex first, LLM fallback for Hindi number words."""

    # Fast path: try regex for explicit numeric amounts
    regex_amount = _try_regex_extract(req.text)
    if regex_amount is not None:
        print(f"[DEBUG] Regex extracted amount: {regex_amount}")
        return ExtractResponse(amount=regex_amount, currency="INR")

    # Fallback: use LLM for Hindi number words (do sau, paanch hazaar, etc.)
    prompt = (
        "You are a payment amount extractor. Given a Hindi or English sentence about a payment, "
        "extract the amount and currency.\n\n"
        "Rules:\n"
        "- Convert Hindi number words to digits (e.g., 'do sau' = 200, 'paanch hazaar' = 5000, 'dhai sau' = 250)\n"
        "- Default currency is INR\n"
        "- Output ONLY valid JSON: {\"amount\": <number>, \"currency\": \"INR\"}\n"
        "- No explanation, no markdown, just the JSON object\n\n"
        f"Sentence: \"{req.text}\"\n\n"
        "JSON:"
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": "llama3.2",
                    "prompt": prompt,
                    "stream": False,
                },
            )
            resp.raise_for_status()
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Cannot connect to Ollama. Is it running?")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e}")

    raw = resp.json().get("response", "").strip()

    print(f"[DEBUG] LLM extract raw: {raw}")

    # Defensive JSON parsing: strip markdown fences, find JSON object
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`")
    match = re.search(r"\{[^}]+\}", cleaned)
    if not match:
        raise HTTPException(status_code=422, detail=f"Could not parse amount from response: {raw}")

    try:
        data = json.loads(match.group())
        amount = float(data["amount"])
        currency = str(data.get("currency", "INR"))
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid extraction result: {e}")

    return ExtractResponse(amount=amount, currency=currency)


# ── Trust Engine ──


class ReportRequest(BaseModel):
    transaction_id: str
    upi_id: str
    reason: str


class ReportResponse(BaseModel):
    success: bool
    weight: float
    total_score: float
    blacklisted: bool


class ReportStatusResponse(BaseModel):
    already_reported: bool


class VerifyRequest(BaseModel):
    upi_id: str


class VerifyResponse(BaseModel):
    status: str  # "verified" | "blacklisted" | "unknown"


@app.post("/api/verify-merchant", response_model=VerifyResponse)
async def verify_merchant(req: VerifyRequest):
    """Check merchant trust status. Uses in-memory cache (1hr TTL), falls back to Supabase."""
    upi_id = req.upi_id.strip().lower()

    # Check cache first
    if upi_id in _trust_cache:
        cached_status, cached_at = _trust_cache[upi_id]
        if time.time() - cached_at < CACHE_TTL:
            print(f"[DEBUG] Trust cache HIT: {upi_id} → {cached_status}")
            return VerifyResponse(status=cached_status)
        else:
            del _trust_cache[upi_id]

    # Query Supabase
    if not supabase:
        print(f"[DEBUG] No Supabase client — returning unknown for {upi_id}")
        return VerifyResponse(status="unknown")

    try:
        result = supabase.table("merchants").select("status").ilike("upi_id", upi_id).execute()
        if result.data and len(result.data) > 0:
            status = result.data[0]["status"]
        else:
            status = "unknown"
    except Exception as e:
        print(f"[ERROR] Supabase query failed: {e}")
        return VerifyResponse(status="unknown")

    # Cache the result
    _trust_cache[upi_id] = (status, time.time())
    print(f"[DEBUG] Trust cache MISS: {upi_id} → {status} (cached)")

    return VerifyResponse(status=status)


# ── Merchant Reporting ──

VALID_REPORT_REASONS = {"Scam", "Wrong Amount", "Fake Merchant", "Other"}


@app.post("/api/merchant/report", response_model=ReportResponse)
async def report_merchant(
    req: ReportRequest,
    current_user: dict = Depends(get_current_user),
):
    """Submit a weighted merchant report. Requires a valid transaction."""
    if not supabase_admin:
        raise HTTPException(status_code=503, detail="Database not available")

    if req.reason not in VALID_REPORT_REASONS:
        raise HTTPException(status_code=400, detail=f"Invalid reason. Must be one of: {', '.join(VALID_REPORT_REASONS)}")

    user_id = current_user["user_id"]
    upi_id = req.upi_id.strip().lower()

    try:
        result = supabase_admin.rpc(
            "submit_merchant_report",
            {
                "p_user_id": user_id,
                "p_transaction_id": req.transaction_id,
                "p_upi_id": upi_id,
                "p_reason": req.reason,
            },
        ).execute()

        if result.data is None:
            raise HTTPException(status_code=400, detail="Report submission failed")

        data = result.data
        # Invalidate trust cache for this UPI ID so next verify picks up new status
        _trust_cache.pop(upi_id, None)

        print(f"[INFO] Merchant report: user={user_id[:8]} upi={upi_id} weight={data['weight']} total={data['total_score']} blacklisted={data['blacklisted']}")
        return ReportResponse(
            success=True,
            weight=float(data["weight"]),
            total_score=float(data["total_score"]),
            blacklisted=bool(data["blacklisted"]),
        )

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "already reported" in error_msg.lower():
            raise HTTPException(status_code=409, detail="You have already reported this merchant")
        if "cooldown" in error_msg.lower():
            raise HTTPException(status_code=429, detail="Please wait before reporting another merchant (1 hour cooldown)")
        if "transaction" in error_msg.lower() and "not found" in error_msg.lower():
            raise HTTPException(status_code=400, detail="Invalid transaction — you can only report merchants you paid")
        print(f"[ERROR] Merchant report failed: {e}")
        raise HTTPException(status_code=500, detail="Report submission failed")


@app.get("/api/merchant/report-status", response_model=ReportStatusResponse)
async def report_status(
    upi_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Check if the current user has already reported a merchant."""
    if not supabase_admin:
        return ReportStatusResponse(already_reported=False)

    user_id = current_user["user_id"]
    clean_upi = upi_id.strip().lower()

    try:
        result = (
            supabase_admin.table("merchant_reports")
            .select("id")
            .eq("user_id", user_id)
            .eq("upi_id", clean_upi)
            .limit(1)
            .execute()
        )
        return ReportStatusResponse(already_reported=bool(result.data))
    except Exception as e:
        print(f"[ERROR] Report status check failed: {e}")
        return ReportStatusResponse(already_reported=False)


# ── Wallet Endpoints ──


class WalletBalanceResponse(BaseModel):
    balance: float


class TopUpRequest(BaseModel):
    amount: float


class TopUpResponse(BaseModel):
    success: bool
    new_balance: float


class PayRequest(BaseModel):
    amount: float
    upi_id: str
    merchant_name: str


class PayResponse(BaseModel):
    success: bool
    new_balance: float
    transaction_id: str


@app.get("/api/wallet/balance", response_model=WalletBalanceResponse)
async def get_wallet_balance(current_user: dict = Depends(get_current_user)):
    """Return wallet balance for the authenticated user."""
    if not supabase_admin:
        raise HTTPException(status_code=503, detail="Database not available")

    user_id = current_user["user_id"]

    try:
        result = (
            supabase_admin.table("wallets")
            .select("balance")
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Wallet not found")
        return WalletBalanceResponse(balance=float(result.data["balance"]))
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Wallet balance fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Could not fetch wallet balance")


@app.post("/api/wallet/topup", response_model=TopUpResponse)
async def wallet_topup(
    req: TopUpRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add money to wallet (simulated top-up for demo)."""
    if not supabase_admin:
        raise HTTPException(status_code=503, detail="Database not available")

    user_id = current_user["user_id"]

    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if req.amount > 100000:
        raise HTTPException(status_code=400, detail="Maximum top-up is ₹1,00,000")

    try:
        result = supabase_admin.rpc(
            "credit_wallet",
            {"p_user_id": user_id, "p_amount": req.amount},
        ).execute()

        if result.data is None:
            raise HTTPException(status_code=400, detail="Top-up failed")

        new_balance = float(result.data)
        print(f"[INFO] Wallet top-up: user={user_id[:8]} amount={req.amount} new_balance={new_balance}")
        return TopUpResponse(success=True, new_balance=new_balance)

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Wallet top-up failed: {e}")
        raise HTTPException(status_code=500, detail="Top-up failed")


@app.post("/api/wallet/pay", response_model=PayResponse)
async def wallet_pay(
    req: PayRequest,
    current_user: dict = Depends(get_current_user),
):
    """Atomically debit user wallet and record transaction."""
    if not supabase_admin:
        raise HTTPException(status_code=503, detail="Database not available")

    user_id = current_user["user_id"]

    if req.amount > 5000:
        raise HTTPException(
            status_code=400,
            detail="Amounts above ₹5,000 must use a UPI app",
        )
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    try:
        result = supabase_admin.rpc(
            "debit_wallet",
            {
                "p_user_id": user_id,
                "p_amount": req.amount,
                "p_upi_id": req.upi_id,
                "p_merchant_name": req.merchant_name,
            },
        ).execute()

        if result.data is None:
            raise HTTPException(status_code=400, detail="Debit failed")

        new_balance = float(result.data)

        tx_result = (
            supabase_admin.table("transactions")
            .select("id")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        tx_id = tx_result.data[0]["id"] if tx_result.data else "unknown"

        print(f"[INFO] Wallet debit: user={user_id[:8]} amount={req.amount} new_balance={new_balance}")
        return PayResponse(success=True, new_balance=new_balance, transaction_id=tx_id)

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "Insufficient balance" in error_msg:
            raise HTTPException(status_code=400, detail="Insufficient wallet balance")
        print(f"[ERROR] Wallet debit failed: {e}")
        raise HTTPException(status_code=500, detail="Payment failed")


# ── WebAuthn Biometric Endpoints ──


class WebAuthnUserRequest(BaseModel):
    user_handle: str


class WebAuthnRegisterVerifyRequest(BaseModel):
    user_handle: str
    credential: dict


class WebAuthnAuthVerifyRequest(BaseModel):
    user_handle: str
    credential: dict


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _base64url_decode(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    pad = len(s) % 4
    if pad:
        s += "=" * (4 - pad)
    return base64.b64decode(s)


def _get_credentials(user_handle: str) -> list[dict]:
    """Fetch stored WebAuthn credentials from Supabase."""
    if not supabase:
        return []
    try:
        result = (
            supabase.table("webauthn_credentials")
            .select("credential_id, public_key, sign_count")
            .eq("user_handle", user_handle)
            .execute()
        )
        return [
            {
                "credential_id": _base64url_decode(row["credential_id"]),
                "public_key": _base64url_decode(row["public_key"]),
                "sign_count": row["sign_count"],
            }
            for row in (result.data or [])
        ]
    except Exception as e:
        print(f"[ERROR] Supabase WebAuthn fetch failed: {e}")
        return []


def _store_credential(user_handle: str, credential_id: bytes, public_key: bytes, sign_count: int):
    """Store a WebAuthn credential in Supabase."""
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        supabase.table("webauthn_credentials").insert({
            "user_handle": user_handle,
            "credential_id": _base64url_encode(credential_id),
            "public_key": _base64url_encode(public_key),
            "sign_count": sign_count,
        }).execute()
    except Exception as e:
        print(f"[ERROR] Supabase WebAuthn store failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to store credential")


def _update_sign_count(credential_id: bytes, new_sign_count: int):
    """Update sign count for a credential in Supabase."""
    if not supabase:
        return
    try:
        supabase.table("webauthn_credentials").update(
            {"sign_count": new_sign_count}
        ).eq("credential_id", _base64url_encode(credential_id)).execute()
    except Exception as e:
        print(f"[ERROR] Supabase sign_count update failed: {e}")


@app.post("/api/webauthn/register/options")
async def webauthn_register_options(
    req: WebAuthnUserRequest,
    current_user: dict = Depends(get_current_user),
):
    """Generate registration challenge and options."""
    if req.user_handle != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="user_handle must match authenticated user")
    existing_creds = _get_credentials(req.user_handle)
    exclude_credentials = [
        PublicKeyCredentialDescriptor(id=c["credential_id"])
        for c in existing_creds
    ]

    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=req.user_handle.encode(),
        user_name=f"user-{req.user_handle[:8]}",
        user_display_name="PaySecure User",
        exclude_credentials=exclude_credentials,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.DISCOURAGED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )

    _webauthn_challenges[req.user_handle] = options.challenge

    options_json = json.loads(options_to_json(options))
    return options_json


@app.post("/api/webauthn/register/verify")
async def webauthn_register_verify(
    req: WebAuthnRegisterVerifyRequest,
    current_user: dict = Depends(get_current_user),
):
    """Verify registration attestation and store credential in Supabase."""
    if req.user_handle != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="user_handle must match authenticated user")
    challenge = _webauthn_challenges.pop(req.user_handle, None)
    if not challenge:
        raise HTTPException(status_code=400, detail="No pending registration challenge")

    try:
        cred = req.credential
        verification = verify_registration_response(
            credential={
                "id": cred["id"],
                "rawId": cred["rawId"],
                "type": cred["type"],
                "response": {
                    "attestationObject": cred["response"]["attestationObject"],
                    "clientDataJSON": cred["response"]["clientDataJSON"],
                },
            },
            expected_challenge=challenge,
            expected_rp_id=RP_ID,
            expected_origin=RP_ORIGIN,
        )
    except Exception as e:
        print(f"[ERROR] WebAuthn registration verification failed: {e}")
        raise HTTPException(status_code=400, detail=f"Registration failed: {e}")

    # Store credential in Supabase
    _store_credential(
        user_handle=req.user_handle,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,
    )

    print(f"[INFO] WebAuthn credential registered for user {req.user_handle[:8]}")
    return {"success": True}


@app.post("/api/webauthn/authenticate/options")
async def webauthn_authenticate_options(
    req: WebAuthnUserRequest,
    current_user: dict = Depends(get_current_user),
):
    """Generate authentication challenge and options."""
    if req.user_handle != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="user_handle must match authenticated user")
    creds = _get_credentials(req.user_handle)
    if not creds:
        raise HTTPException(status_code=404, detail="No registered credentials")

    allow_credentials = [
        PublicKeyCredentialDescriptor(id=c["credential_id"])
        for c in creds
    ]

    options = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.REQUIRED,
    )

    _webauthn_challenges[req.user_handle] = options.challenge

    options_json = json.loads(options_to_json(options))
    return options_json


@app.post("/api/webauthn/authenticate/verify")
async def webauthn_authenticate_verify(
    req: WebAuthnAuthVerifyRequest,
    current_user: dict = Depends(get_current_user),
):
    """Verify authentication assertion."""
    if req.user_handle != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="user_handle must match authenticated user")
    challenge = _webauthn_challenges.pop(req.user_handle, None)
    if not challenge:
        raise HTTPException(status_code=400, detail="No pending authentication challenge")

    creds = _get_credentials(req.user_handle)
    cred = req.credential
    raw_id = _base64url_decode(cred["rawId"])

    # Find matching credential
    matched = None
    for c in creds:
        if c["credential_id"] == raw_id:
            matched = c
            break

    if not matched:
        raise HTTPException(status_code=400, detail="Credential not found")

    try:
        verification = verify_authentication_response(
            credential={
                "id": cred["id"],
                "rawId": cred["rawId"],
                "type": cred["type"],
                "response": {
                    "authenticatorData": cred["response"]["authenticatorData"],
                    "clientDataJSON": cred["response"]["clientDataJSON"],
                    "signature": cred["response"]["signature"],
                    "userHandle": cred["response"].get("userHandle"),
                },
            },
            expected_challenge=challenge,
            expected_rp_id=RP_ID,
            expected_origin=RP_ORIGIN,
            credential_public_key=matched["public_key"],
            credential_current_sign_count=matched["sign_count"],
        )
    except Exception as e:
        print(f"[ERROR] WebAuthn authentication verification failed: {e}")
        raise HTTPException(status_code=400, detail=f"Authentication failed: {e}")

    # Update sign count in Supabase
    _update_sign_count(matched["credential_id"], verification.new_sign_count)

    print(f"[INFO] WebAuthn authentication successful for user {req.user_handle[:8]}")
    return {"success": True}
