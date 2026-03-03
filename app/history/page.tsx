import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: transactions } = await supabase
    .from("transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="flex min-h-screen flex-col bg-gray-50/50">
      {/* Top Bar */}
      <div className="w-full bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Link
          href="/"
          className="flex items-center justify-center h-9 w-9 rounded-full hover:bg-gray-100 transition-colors"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
        </Link>
        <span className="text-base font-bold text-gradient-brand">
          Transaction History
        </span>
      </div>

      <div className="px-5 py-6 max-w-md mx-auto w-full space-y-3">
        {!transactions || transactions.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <svg
              className="h-12 w-12 mx-auto mb-4 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
              />
            </svg>
            <p className="font-semibold text-gray-500">No transactions yet</p>
            <p className="text-sm mt-1">
              Your payment history will appear here
            </p>
          </div>
        ) : (
          transactions.map((tx) => (
            <div
              key={tx.id}
              className="w-full rounded-2xl bg-white border border-gray-100 shadow-card px-5 py-4 flex items-center justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 truncate">
                  {tx.merchant_name || tx.upi_id}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(tx.created_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="text-right ml-3">
                <p
                  className={`font-bold text-lg ${
                    tx.direction === "debit"
                      ? "text-red-600"
                      : "text-emerald-600"
                  }`}
                >
                  {tx.direction === "debit" ? "-" : "+"}₹
                  {Number(tx.amount).toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-gray-400 capitalize">{tx.status}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
