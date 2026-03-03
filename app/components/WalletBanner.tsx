"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export default function WalletBanner() {
  const { session } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Top-up state
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!session?.access_token) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${BACKEND}/api/wallet/balance`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchBalance();
  }, [session]);

  const handleTopUp = async (amount: number) => {
    if (!session?.access_token || amount <= 0) return;

    setTopUpLoading(true);
    setTopUpError(null);

    try {
      const res = await fetch(`${BACKEND}/api/wallet/topup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amount }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Top-up failed");
      }

      const data = await res.json();
      setBalance(data.new_balance);
      setShowTopUp(false);
      setTopUpAmount("");
    } catch (err) {
      setTopUpError(err instanceof Error ? err.message : "Top-up failed");
    } finally {
      setTopUpLoading(false);
    }
  };

  return (
    <div className="bg-white border-b border-gray-100">
      {/* Balance row */}
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Wallet Balance
          </p>
          <p className="text-2xl font-extrabold text-gray-900">
            {loading ? (
              <span className="text-gray-300">Loading...</span>
            ) : balance !== null ? (
              `₹${balance.toLocaleString("en-IN")}`
            ) : (
              <span className="text-gray-400">Unavailable</span>
            )}
          </p>
        </div>
        <button
          onClick={() => {
            setShowTopUp(!showTopUp);
            setTopUpError(null);
            setTopUpAmount("");
          }}
          className="flex items-center gap-1.5 rounded-full bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-600 active:scale-95 transition-all"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Money
        </button>
      </div>

      {/* Top-up panel */}
      {showTopUp && (
        <div className="px-6 pb-4 space-y-3">
          {/* Quick amount buttons */}
          <div className="flex gap-2">
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                disabled={topUpLoading}
                onClick={() => handleTopUp(amt)}
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50 py-2 text-sm font-semibold text-gray-700 active:scale-95 transition-all disabled:opacity-50"
              >
                ₹{amt.toLocaleString("en-IN")}
              </button>
            ))}
          </div>

          {/* Custom amount */}
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={100000}
              placeholder="Enter amount"
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
              className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            />
            <button
              disabled={topUpLoading || !topUpAmount || Number(topUpAmount) <= 0}
              onClick={() => handleTopUp(Number(topUpAmount))}
              className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 py-2.5 text-sm font-bold text-white active:scale-95 transition-all disabled:opacity-50"
            >
              {topUpLoading ? "..." : "Add"}
            </button>
          </div>

          {topUpError && (
            <p className="text-sm text-red-600">{topUpError}</p>
          )}
        </div>
      )}
    </div>
  );
}
