"use client";

import { useCallback, useEffect, useState } from "react";

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ── Base64url <-> ArrayBuffer helpers ──

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── LocalStorage keys ──

const LS_USER_HANDLE = "paysecure_user_handle";
const LS_REGISTERED = "paysecure_webauthn_registered";

function getUserHandle(): string {
  if (typeof window === "undefined") return "";
  let handle = localStorage.getItem(LS_USER_HANDLE);
  if (!handle) {
    handle = crypto.randomUUID();
    localStorage.setItem(LS_USER_HANDLE, handle);
  }
  return handle;
}

// ── Hook ──

export interface UseWebAuthnReturn {
  isSupported: boolean;
  isRegistered: boolean;
  isAuthenticating: boolean;
  register: () => Promise<boolean>;
  authenticate: () => Promise<boolean>;
  error: string | null;
}

export function useWebAuthn(): UseWebAuthnReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      if (
        typeof window !== "undefined" &&
        window.PublicKeyCredential !== undefined &&
        typeof navigator.credentials?.create === "function"
      ) {
        // Works with Touch ID, Face ID, Windows Hello, or browser-managed passkeys
        setIsSupported(true);
      }
      setIsRegistered(localStorage.getItem(LS_REGISTERED) === "true");
    };
    check();
  }, []);

  const register = useCallback(async (): Promise<boolean> => {
    setError(null);
    const userHandle = getUserHandle();

    try {
      // 1. Get registration options from backend
      const optionsRes = await fetch(`${BACKEND}/api/webauthn/register/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_handle: userHandle }),
      });
      if (!optionsRes.ok) throw new Error("Failed to get registration options");
      const options = await optionsRes.json();

      // 2. Convert base64url fields to ArrayBuffers
      const publicKey: PublicKeyCredentialCreationOptions = {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        user: {
          ...options.user,
          id: base64urlToBuffer(options.user.id),
        },
        excludeCredentials: (options.excludeCredentials || []).map(
          (c: { id: string; type: string; transports?: string[] }) => ({
            ...c,
            id: base64urlToBuffer(c.id),
          })
        ),
      };

      // 3. Create credential (triggers biometric prompt)
      const credential = (await navigator.credentials.create({
        publicKey,
      })) as PublicKeyCredential | null;

      if (!credential) throw new Error("Registration cancelled");

      const response = credential.response as AuthenticatorAttestationResponse;

      // 4. Serialize and send to backend for verification
      const verifyRes = await fetch(`${BACKEND}/api/webauthn/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_handle: userHandle,
          credential: {
            id: credential.id,
            rawId: bufferToBase64url(credential.rawId),
            type: credential.type,
            response: {
              attestationObject: bufferToBase64url(response.attestationObject),
              clientDataJSON: bufferToBase64url(response.clientDataJSON),
            },
          },
        }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => null);
        throw new Error(err?.detail || "Registration verification failed");
      }

      localStorage.setItem(LS_REGISTERED, "true");
      setIsRegistered(true);
      return true;
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Biometric registration was cancelled or denied."
          : err instanceof Error
            ? err.message
            : "Biometric registration failed";
      setError(msg);
      return false;
    }
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsAuthenticating(true);
    const userHandle = getUserHandle();

    try {
      // 1. Get authentication options from backend
      const optionsRes = await fetch(
        `${BACKEND}/api/webauthn/authenticate/options`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_handle: userHandle }),
        }
      );
      if (!optionsRes.ok) throw new Error("Failed to get authentication options");
      const options = await optionsRes.json();

      // 2. Convert base64url fields to ArrayBuffers
      const publicKey: PublicKeyCredentialRequestOptions = {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        allowCredentials: (options.allowCredentials || []).map(
          (c: { id: string; type: string; transports?: string[] }) => ({
            ...c,
            id: base64urlToBuffer(c.id),
          })
        ),
      };

      // 3. Get credential (triggers biometric prompt)
      const credential = (await navigator.credentials.get({
        publicKey,
      })) as PublicKeyCredential | null;

      if (!credential) throw new Error("Authentication cancelled");

      const response = credential.response as AuthenticatorAssertionResponse;

      // 4. Serialize and send to backend for verification
      const verifyRes = await fetch(
        `${BACKEND}/api/webauthn/authenticate/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_handle: userHandle,
            credential: {
              id: credential.id,
              rawId: bufferToBase64url(credential.rawId),
              type: credential.type,
              response: {
                authenticatorData: bufferToBase64url(response.authenticatorData),
                clientDataJSON: bufferToBase64url(response.clientDataJSON),
                signature: bufferToBase64url(response.signature),
                userHandle: response.userHandle
                  ? bufferToBase64url(response.userHandle)
                  : null,
              },
            },
          }),
        }
      );

      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => null);
        throw new Error(err?.detail || "Biometric verification failed");
      }

      return true;
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Biometric authentication was cancelled or denied."
          : err instanceof Error
            ? err.message
            : "Biometric authentication failed";
      setError(msg);
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  return { isSupported, isRegistered, isAuthenticating, register, authenticate, error };
}
