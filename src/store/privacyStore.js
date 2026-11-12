"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

const usePrivacyStore = create(
  persist(
    (set) => ({
      privacy: false,
      togglePrivacy: () => set((s) => ({ privacy: !s.privacy })),
    }),
    { name: "9router-privacy" }
  )
);

const EMAIL_RE = /[^\s@()<>"',;]+@[^\s@()<>"',;]+\.[a-z]{2,}/gi;

// Stable short tag so redacted accounts stay distinguishable.
function tag(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).slice(-4).padStart(4, "0");
}

export function redactEmails(text) {
  return typeof text === "string" ? text.replace(EMAIL_RE, (m) => `Account #${tag(m.toLowerCase())}`) : text;
}

// Returns a display filter: identity when privacy mode is off.
export function usePrivate() {
  const privacy = usePrivacyStore((s) => s.privacy);
  return privacy ? redactEmails : (text) => text;
}

export default usePrivacyStore;
