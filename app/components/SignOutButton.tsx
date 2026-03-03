"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

export default function SignOutButton() {
  const { signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <button
      onClick={handleSignOut}
      className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors"
    >
      Sign Out
    </button>
  );
}
