import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SignOutButton from "./components/SignOutButton";
import WalletBanner from "./components/WalletBanner";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <main className="flex min-h-screen flex-col">
      {/* User bar */}
      <div className="bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <span className="text-sm font-semibold text-gray-700 truncate max-w-[200px]">
          {user.email}
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/history"
            className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors"
          >
            History
          </Link>
          <SignOutButton />
        </div>
      </div>

      {/* Wallet balance */}
      <WalletBanner />

      {/* Hero section */}
      <div className="bg-gradient-hero flex flex-1 flex-col items-center justify-center px-8 py-16 text-center relative overflow-hidden">
        {/* Subtle background circles */}
        <div className="absolute top-[-20%] right-[-10%] w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute bottom-[-15%] left-[-10%] w-80 h-80 rounded-full bg-white/5 blur-3xl" />

        {/* Shield icon */}
        <div className="animate-fadeIn mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm shadow-lg">
          <svg
            className="h-10 w-10 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
            />
          </svg>
        </div>

        {/* Branding */}
        <h1 className="animate-fadeIn text-4xl font-extrabold text-white tracking-tight mb-3">
          PaySecure
        </h1>
        <p className="animate-fadeIn text-lg text-white/70 max-w-xs mb-10 font-medium">
          Scan. Speak. Pay Securely.
        </p>

        {/* CTA Button */}
        <Link
          href="/scan"
          className="animate-fadeIn rounded-full bg-white px-12 py-4 text-lg font-bold text-brand-600 shadow-card-lg hover:shadow-xl hover:scale-[1.02] active:scale-95 transition-all duration-200"
        >
          Start Scanning
        </Link>
      </div>

      {/* Feature pills */}
      <div className="bg-white px-6 py-8 flex flex-col items-center gap-4">
        <div className="flex flex-wrap justify-center gap-2">
          {[
            { label: "QR Scan", icon: "M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5z" },
            { label: "Voice Pay", icon: "M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" },
            { label: "Wallet", icon: "M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" },
            { label: "Trust Check", icon: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" },
          ].map((f) => (
            <span
              key={f.label}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-4 py-2 text-xs font-semibold text-brand-700 border border-brand-100"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
              </svg>
              {f.label}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">Secure UPI payments powered by AI</p>
      </div>
    </main>
  );
}
