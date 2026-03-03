"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Html5Qrcode } from "html5-qrcode";
import { useAudioRecorder } from "./useAudioRecorder";
import { useWebAuthn } from "./useWebAuthn";
import { useAuth } from "../components/AuthProvider";

type ScanState =
  | "idle"
  | "processing"
  | "result"
  | "recording"
  | "transcribing"
  | "extracting"
  | "payment-ready"
  | "paying"
  | "wallet-success";

type TrustStatus = "checking" | "verified" | "blacklisted" | "unknown";

interface ScanResult {
  upi_id: string;
  merchant_name: string;
  trust_status: TrustStatus;
}

interface VoiceResult {
  transcript: string;
  amount: number;
  currency: string;
}

interface WalletSuccessData {
  newBalance: number;
  amount: number;
  merchant: string;
}

/* ── Icons ── */

const Spinner = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg
    className={`animate-spin ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
);

const MicIcon = ({ className = "h-6 w-6" }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
    />
  </svg>
);

const BackArrow = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

const CameraIcon = () => (
  <svg className="h-12 w-12 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
  </svg>
);

/* ── Animated dots for loading states ── */
const AnimatedDots = () => (
  <span className="inline-flex gap-1 ml-1">
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
  </span>
);

/* ── Trust Badge ── */

const TrustBadge = ({ status }: { status: TrustStatus }) => {
  if (status === "checking") {
    return (
      <div className="flex items-center gap-1.5 text-gray-400 text-xs">
        <Spinner className="h-3.5 w-3.5" />
        <span>Checking merchant<AnimatedDots /></span>
      </div>
    );
  }

  if (status === "verified") {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5">
        <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
        <span className="text-xs font-semibold text-emerald-700">Verified Merchant</span>
      </div>
    );
  }

  if (status === "blacklisted") {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-3 py-1.5">
        <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <span className="text-xs font-semibold text-red-700">Blacklisted - Do Not Pay</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-3 py-1.5">
      <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
      </svg>
      <span className="text-xs font-semibold text-gray-500">Unverified Merchant</span>
    </div>
  );
};

/* ── Merchant Card ── */

const trustAccentColor: Record<TrustStatus, string> = {
  checking: "border-l-gray-300",
  verified: "border-l-emerald-500",
  blacklisted: "border-l-red-500",
  unknown: "border-l-gray-300",
};

const MerchantCard = ({
  result,
  compact,
}: {
  result: ScanResult;
  compact?: boolean;
}) => (
  <div
    className={`w-full rounded-2xl bg-white border border-gray-100 shadow-card ${compact ? "p-4" : "p-6"} border-l-4 ${trustAccentColor[result.trust_status]} animate-fadeIn`}
  >
    <div className="flex items-start justify-between mb-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Merchant
        </p>
        <p
          className={`font-bold text-gray-900 ${compact ? "text-lg" : "text-xl"}`}
        >
          {result.merchant_name}
        </p>
      </div>
    </div>

    <div className={compact ? "mb-2" : "mb-4"}>
      <TrustBadge status={result.trust_status} />
    </div>

    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
      UPI ID
    </p>
    <p className="text-sm font-mono text-gray-600 break-all bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      {result.upi_id}
    </p>
  </div>
);

/* ── Top Bar ── */

const TopBar = () => (
  <div className="w-full bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
    <Link href="/" className="flex items-center justify-center h-9 w-9 rounded-full hover:bg-gray-100 transition-colors">
      <BackArrow />
    </Link>
    <span className="text-base font-bold text-gradient-brand">PaySecure</span>
  </div>
);

/* ── Step Indicator ── */

const StepIndicator = ({
  step,
  total,
  label,
}: {
  step: number;
  total: number;
  label: string;
}) => (
  <div className="flex flex-col items-center gap-3 animate-fadeIn">
    <div className="relative h-12 w-12 flex items-center justify-center">
      <svg className="absolute inset-0 h-12 w-12 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="none" stroke="#e5e7eb" strokeWidth="3" />
        <circle
          cx="24" cy="24" r="20" fill="none" stroke="#6366f1" strokeWidth="3"
          strokeDasharray={`${(step / total) * 125.6} 125.6`}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <Spinner className="h-5 w-5 text-brand-500" />
    </div>
    <div className="text-center">
      <p className="text-sm font-semibold text-gray-700">{label}</p>
      <p className="text-xs text-gray-400">Step {step} of {total}</p>
    </div>
  </div>
);

/* ── UPI App Configs ── */

const upiAppConfig = [
  { name: "Google Pay", prefix: "gpay", gradient: "from-blue-500 to-blue-600", letter: "G" },
  { name: "PhonePe", prefix: "phonepe", gradient: "from-purple-500 to-purple-600", letter: "P" },
  { name: "Paytm", prefix: "paytm", gradient: "from-sky-400 to-sky-500", letter: "Py" },
  { name: "UPI", prefix: "upi", gradient: "from-gray-600 to-gray-700", letter: "U" },
];

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function ScanPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ScanState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [voiceResult, setVoiceResult] = useState<VoiceResult | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletSuccess, setWalletSuccess] = useState<WalletSuccessData | null>(null);

  const { user, session } = useAuth();
  const recorder = useAudioRecorder();
  const webauthn = useWebAuthn(user?.id ?? null, session?.access_token ?? null);
  const [highAmountAcknowledged, setHighAmountAcknowledged] = useState(false);
  const [biometricVerified, setBiometricVerified] = useState(false);

  // Fetch wallet balance on mount
  useEffect(() => {
    const fetchBalance = async () => {
      if (!session?.access_token) return;
      try {
        const res = await fetch(`${BACKEND}/api/wallet/balance`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setWalletBalance(data.balance);
        }
      } catch { /* ignore */ }
    };
    fetchBalance();
  }, [session]);

  // ── Trust verification ──

  const verifyMerchant = async (upiId: string) => {
    try {
      const res = await fetch(`${BACKEND}/api/verify-merchant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upi_id: upiId }),
      });
      if (!res.ok) return "unknown" as TrustStatus;
      const { status } = await res.json();
      return status as TrustStatus;
    } catch {
      return "unknown" as TrustStatus;
    }
  };

  // ── QR scanning ──

  const processImage = async (file: File) => {
    setError(null);
    setState("processing");

    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = (e) => resolve(e.target?.result as string);
      r.readAsDataURL(file);
    });
    setPreview(dataUrl);

    try {
      const tempDiv = document.createElement("div");
      tempDiv.id = "html5-qr-temp-" + Date.now();
      tempDiv.style.display = "none";
      document.body.appendChild(tempDiv);

      let qrData: string | null = null;
      try {
        const scanner = new Html5Qrcode(tempDiv.id, false);
        const qrResult = await scanner.scanFileV2(file, false);
        qrData = qrResult.decodedText;
        scanner.clear();
      } catch {
        // scan failed
      } finally {
        tempDiv.remove();
      }

      if (!qrData) {
        setError("No QR code found. Try taking a closer, clearer photo.");
        setState("idle");
        return;
      }

      if (!qrData.toLowerCase().startsWith("upi://")) {
        setError("Found a QR code but it's not a UPI code.");
        setState("idle");
        return;
      }

      const url = new URL(qrData);
      const pa = url.searchParams.get("pa");
      const pn = url.searchParams.get("pn");
      if (!pa) {
        setError("Could not parse UPI data from the QR code.");
        setState("idle");
        return;
      }

      const scanResult: ScanResult = { upi_id: pa, merchant_name: pn || "Unknown", trust_status: "checking" };
      setResult(scanResult);
      setState("result");

      verifyMerchant(pa).then((trustStatus) => {
        setResult((prev) =>
          prev ? { ...prev, trust_status: trustStatus } : prev
        );
      });
    } catch {
      setError("No QR code found. Try taking a closer, clearer photo.");
      setState("idle");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImage(file);
    e.target.value = "";
  };

  const handleScanClick = () => {
    fileInputRef.current?.click();
  };

  const handleReset = () => {
    setResult(null);
    setVoiceResult(null);
    setError(null);
    setPreview(null);
    setHighAmountAcknowledged(false);
    setBiometricVerified(false);
    setWalletSuccess(null);
    recorder.reset();
    setState("idle");
  };

  // ── Voice flow ──

  const handleVoiceStart = async () => {
    setError(null);
    setVoiceResult(null);
    recorder.reset();
    setState("recording");
    await recorder.start();
  };

  const handleVoiceStop = () => {
    recorder.stop();
  };

  const processVoice = async (audioBlob: Blob) => {
    setState("transcribing");
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");

      const transcribeRes = await fetch(`${BACKEND}/api/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!transcribeRes.ok) {
        const err = await transcribeRes.json().catch(() => null);
        throw new Error(err?.detail || "Transcription failed");
      }

      const { text } = await transcribeRes.json();

      setState("extracting");
      const extractRes = await fetch(`${BACKEND}/api/extract-amount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!extractRes.ok) {
        const err = await extractRes.json().catch(() => null);
        throw new Error(err?.detail || "Amount extraction failed");
      }

      const { amount, currency } = await extractRes.json();

      setVoiceResult({ transcript: text, amount, currency });
      setState("payment-ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice processing failed");
      setState("result");
    }
  };

  const processedBlobRef = useRef<Blob | null>(null);
  if (
    recorder.status === "stopped" &&
    recorder.blob &&
    recorder.blob !== processedBlobRef.current &&
    state === "recording"
  ) {
    processedBlobRef.current = recorder.blob;
    processVoice(recorder.blob);
  }

  if (recorder.error && !error) {
    setError(recorder.error);
    if (state === "recording") setState("result");
  }

  // ── Wallet payment ──

  const handleWalletPayment = async () => {
    if (!result || !voiceResult || !session?.access_token) return;
    setState("paying");

    try {
      const res = await fetch(`${BACKEND}/api/wallet/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount: voiceResult.amount,
          upi_id: result.upi_id,
          merchant_name: result.merchant_name,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || "Payment failed");
      }

      const { new_balance } = await res.json();
      setWalletBalance(new_balance);
      setWalletSuccess({
        newBalance: new_balance,
        amount: voiceResult.amount,
        merchant: result.merchant_name,
      });
      setState("wallet-success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setState("payment-ready");
      setBiometricVerified(false);
    }
  };

  // ── Confirm payment ──

  const handleConfirmPayment = async () => {
    if (!result || !voiceResult || isBlacklisted) return;

    // Step 1: Biometric check
    if (webauthn.isSupported && webauthn.isRegistered) {
      const success = await webauthn.authenticate();
      if (!success) return;
    }

    // Step 2: Decide wallet vs UPI
    const canUseWallet =
      !isHighAmount &&
      walletBalance !== null &&
      walletBalance >= voiceResult.amount;

    if (canUseWallet) {
      await handleWalletPayment();
    } else {
      setBiometricVerified(true);
    }
  };

  const isBlacklisted = result?.trust_status === "blacklisted";
  const isHighAmount = voiceResult ? voiceResult.amount > 5000 : false;
  const paymentBlocked =
    isBlacklisted || (isHighAmount && !highAmountAcknowledged);
  const upiParams =
    result && voiceResult
      ? `pa=${encodeURIComponent(result.upi_id)}&pn=${encodeURIComponent(result.merchant_name)}&am=${voiceResult.amount}&cu=${voiceResult.currency}`
      : "";

  // Can we use wallet for this payment?
  const canPayWithWallet =
    voiceResult &&
    !isHighAmount &&
    walletBalance !== null &&
    walletBalance >= voiceResult.amount;

  return (
    <main className="flex min-h-screen flex-col bg-gray-50/50">
      <TopBar />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex flex-1 flex-col items-center px-5 py-8 max-w-md mx-auto w-full">

        {/* ── IDLE ── */}
        {state === "idle" && (
          <div className="flex flex-col items-center gap-5 w-full animate-fadeIn">
            {error && (
              <div className="w-full rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
                <svg className="h-5 w-5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Last capture"
                className="w-full max-w-[280px] rounded-2xl shadow-card opacity-50"
              />
            ) : (
              <div className="flex flex-col h-52 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-blue-50 border border-brand-100 gap-4">
                <CameraIcon />
                <p className="text-sm text-brand-600/70 font-medium px-6 text-center">
                  Scan a UPI QR code to get started
                </p>
              </div>
            )}

            <button
              onClick={handleScanClick}
              className="w-full rounded-full bg-gradient-to-r from-brand-600 to-brand-500 px-10 py-4 text-lg font-bold text-white shadow-card-lg hover:shadow-xl active:scale-95 transition-all duration-200"
            >
              {preview ? "Try Again" : "Scan QR Code"}
            </button>
          </div>
        )}

        {/* ── PROCESSING (QR) ── */}
        {state === "processing" && (
          <div className="flex flex-col items-center gap-5 w-full animate-fadeIn">
            {preview && (
              <div className="relative w-full max-w-[280px] rounded-2xl overflow-hidden shadow-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt="Processing"
                  className="w-full opacity-60"
                />
                <div className="absolute inset-0 bg-white/40 flex items-center justify-center">
                  <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-5 py-3 flex items-center gap-3 shadow-card">
                    <Spinner className="h-5 w-5 text-brand-500" />
                    <span className="text-sm font-semibold text-gray-700">Reading QR code<AnimatedDots /></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── QR RESULT ── */}
        {state === "result" && result && (
          <div className="flex flex-col items-center gap-4 w-full animate-fadeIn">
            {error && (
              <div className="w-full rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
                <svg className="h-5 w-5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <MerchantCard result={result} />

            {isBlacklisted && (
              <div className="w-full rounded-xl bg-red-100 border border-red-300 px-4 py-3 text-center flex items-center justify-center gap-2">
                <svg className="h-5 w-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <span className="text-sm text-red-800 font-semibold">This merchant has been flagged. Payment is blocked.</span>
              </div>
            )}

            <div className="flex gap-3 w-full">
              {!isBlacklisted && (
                <button
                  onClick={handleVoiceStart}
                  className="flex-1 rounded-full bg-gradient-to-r from-purple-600 to-brand-500 px-6 py-3.5 font-semibold text-white shadow-card hover:shadow-card-lg active:scale-95 transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <MicIcon className="h-5 w-5" />
                  Pay with Voice
                </button>
              )}
              <button
                onClick={handleScanClick}
                className="rounded-full border border-gray-200 bg-white px-6 py-3.5 font-semibold text-gray-600 shadow-card hover:bg-gray-50 active:scale-95 transition-all duration-200"
              >
                Rescan
              </button>
            </div>
          </div>
        )}

        {/* ── RECORDING ── */}
        {state === "recording" && result && (
          <div className="flex flex-col items-center gap-5 w-full animate-fadeIn">
            <MerchantCard result={result} compact />

            <div className="flex flex-col items-center gap-4 py-4">
              <div className="relative flex h-36 w-36 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-20" />
                <span className="absolute inline-flex h-28 w-28 animate-pulse rounded-full bg-red-400 opacity-15" />
                <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-600 shadow-lg">
                  <MicIcon className="h-10 w-10 text-white" />
                </span>
              </div>
              <p className="text-sm font-semibold text-red-600">Listening...</p>
            </div>

            <button
              onClick={handleVoiceStop}
              className="w-full rounded-full bg-gray-900 px-10 py-3.5 font-semibold text-white shadow-card hover:bg-gray-800 active:scale-95 transition-all duration-200"
            >
              Stop Recording
            </button>
          </div>
        )}

        {/* ── TRANSCRIBING ── */}
        {state === "transcribing" && result && (
          <div className="flex flex-col items-center gap-6 w-full animate-fadeIn">
            <MerchantCard result={result} compact />
            <StepIndicator step={1} total={2} label="Transcribing audio" />
          </div>
        )}

        {/* ── EXTRACTING ── */}
        {state === "extracting" && result && (
          <div className="flex flex-col items-center gap-6 w-full animate-fadeIn">
            <MerchantCard result={result} compact />
            <StepIndicator step={2} total={2} label="Extracting amount" />
          </div>
        )}

        {/* ── PAYMENT READY ── */}
        {state === "payment-ready" && result && voiceResult && (
          <div className="flex flex-col items-center gap-4 w-full animate-fadeIn">
            {/* Biometric registration banner */}
            {webauthn.isSupported && !webauthn.isRegistered && (
              <div className="w-full rounded-2xl bg-gradient-to-r from-brand-50 to-blue-50 border border-brand-100 px-5 py-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg className="h-5 w-5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
                  </svg>
                  <p className="text-sm font-semibold text-brand-700">
                    Enable biometric security
                  </p>
                </div>
                <p className="text-xs text-brand-600/70 mb-3">Set up fingerprint or FaceID for secure payments</p>
                <button
                  onClick={() => webauthn.register()}
                  className="rounded-full bg-brand-600 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-700 active:scale-95 transition-all"
                >
                  Enable Biometric
                </button>
              </div>
            )}

            {webauthn.error && (
              <div className="w-full rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
                <svg className="h-5 w-5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-red-700">{webauthn.error}</p>
              </div>
            )}

            {/* Wallet balance indicator */}
            {walletBalance !== null && (
              <div className="w-full rounded-xl bg-brand-50 border border-brand-100 px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-brand-700">Wallet Balance</span>
                <span className="text-sm font-bold text-brand-700">
                  ₹{walletBalance.toLocaleString("en-IN")}
                </span>
              </div>
            )}

            {/* Payment summary card */}
            <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-card p-6 space-y-0 animate-fadeIn">
              <div className="pb-4 border-b border-gray-100">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Paying
                </p>
                <p className="text-xl font-bold text-gray-900">
                  {result.merchant_name}
                </p>
                <p className="text-sm font-mono text-gray-500 break-all bg-gray-50 rounded-lg px-3 py-1.5 mt-2 border border-gray-100">
                  {result.upi_id}
                </p>
                <div className="mt-3">
                  <TrustBadge status={result.trust_status} />
                </div>
              </div>

              <div className="py-4 border-b border-gray-100">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  You said
                </p>
                <p className="text-base text-gray-700 italic leading-relaxed">
                  &ldquo;{voiceResult.transcript}&rdquo;
                </p>
              </div>

              <div className="pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Amount
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-semibold text-gray-400">
                    {voiceResult.currency === "INR" ? "\u20B9" : voiceResult.currency}
                  </span>
                  <span className="text-4xl font-extrabold text-gray-900">
                    {voiceResult.amount.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment method indicator */}
            {!isBlacklisted && (
              <div className={`w-full rounded-xl px-4 py-2.5 flex items-center gap-2 ${
                canPayWithWallet
                  ? "bg-emerald-50 border border-emerald-100"
                  : "bg-amber-50 border border-amber-100"
              }`}>
                <svg className={`h-4 w-4 ${canPayWithWallet ? "text-emerald-500" : "text-amber-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={canPayWithWallet
                    ? "M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
                    : "M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                  } />
                </svg>
                <span className={`text-xs font-bold ${canPayWithWallet ? "text-emerald-700" : "text-amber-700"}`}>
                  {canPayWithWallet
                    ? "Payment via PaySecure Wallet"
                    : isHighAmount
                      ? "High amount — will redirect to UPI app"
                      : "Insufficient wallet balance — will redirect to UPI app"}
                </span>
              </div>
            )}

            {isBlacklisted && (
              <div className="w-full rounded-xl bg-red-100 border border-red-300 px-4 py-3 text-center flex items-center justify-center gap-2">
                <svg className="h-5 w-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <span className="text-sm text-red-800 font-semibold">Payment blocked — this merchant is blacklisted.</span>
              </div>
            )}

            {/* High amount warning */}
            {isHighAmount && !highAmountAcknowledged && !isBlacklisted && (
              <div className="w-full rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm font-semibold text-amber-800">High amount detected</p>
                </div>
                <p className="text-xs text-amber-700/80 mb-3">
                  Please enter your UPI PIN in the next screen for safety.
                </p>
                <button
                  onClick={() => setHighAmountAcknowledged(true)}
                  className="rounded-full bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 active:scale-95 transition-all"
                >
                  I Understand
                </button>
              </div>
            )}

            {error && (
              <div className="w-full rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
                <svg className="h-5 w-5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex flex-col gap-3 w-full">
              {biometricVerified ? (
                <div className="flex flex-col gap-3 w-full animate-fadeIn">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-center mb-1">
                    Pay with
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {upiAppConfig.map((app) => (
                      <a
                        key={app.name}
                        href={`${app.prefix}://upi/pay?${upiParams}`}
                        className={`flex items-center gap-3 rounded-2xl bg-gradient-to-r ${app.gradient} px-4 py-3.5 text-sm font-semibold text-white shadow-card active:scale-95 transition-all duration-200`}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                          {app.letter}
                        </span>
                        {app.name}
                      </a>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleConfirmPayment}
                  disabled={paymentBlocked || webauthn.isAuthenticating}
                  className={`w-full rounded-full px-8 py-4 text-lg font-bold text-white shadow-card-lg active:scale-95 transition-all duration-200 ${
                    paymentBlocked
                      ? "bg-gray-300 cursor-not-allowed"
                      : "bg-gradient-to-r from-emerald-500 to-emerald-600 hover:shadow-xl"
                  }`}
                >
                  {webauthn.isAuthenticating ? (
                    <span className="flex items-center justify-center gap-2">
                      <Spinner /> Verifying...
                    </span>
                  ) : (
                    "Confirm Payment"
                  )}
                </button>
              )}
              <div className="flex gap-2.5">
                <button
                  onClick={handleVoiceStart}
                  className="flex-1 rounded-full border border-gray-200 bg-white px-4 py-3 font-semibold text-gray-600 shadow-card hover:bg-gray-50 active:scale-95 transition-all duration-200 text-sm"
                >
                  Re-speak
                </button>
                <button
                  onClick={handleReset}
                  className="flex-1 rounded-full border border-gray-200 bg-white px-4 py-3 font-semibold text-gray-600 shadow-card hover:bg-gray-50 active:scale-95 transition-all duration-200 text-sm"
                >
                  Start Over
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── PAYING (wallet debit in progress) ── */}
        {state === "paying" && result && (
          <div className="flex flex-col items-center gap-6 w-full animate-fadeIn">
            <MerchantCard result={result} compact />
            <div className="flex flex-col items-center gap-3">
              <Spinner className="h-10 w-10 text-brand-500" />
              <p className="text-sm font-semibold text-gray-700">Processing payment<AnimatedDots /></p>
            </div>
          </div>
        )}

        {/* ── WALLET SUCCESS ── */}
        {state === "wallet-success" && walletSuccess && (
          <div className="flex flex-col items-center gap-5 w-full animate-fadeIn">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-10 w-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-card p-6 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 mb-1">
                Payment Successful
              </p>
              <p className="text-4xl font-extrabold text-gray-900 mt-2">
                ₹{walletSuccess.amount.toLocaleString("en-IN")}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Paid to <span className="font-semibold text-gray-700">{walletSuccess.merchant}</span>
              </p>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400">Remaining wallet balance</p>
                <p className="text-xl font-bold text-brand-600">
                  ₹{walletSuccess.newBalance.toLocaleString("en-IN")}
                </p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="w-full rounded-full bg-gradient-to-r from-brand-600 to-brand-500 px-10 py-4 text-lg font-bold text-white shadow-card-lg active:scale-95 transition-all"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
