"use client";

import usePrivacyStore from "@/store/privacyStore";

export default function PrivacyToggle() {
  const { privacy, togglePrivacy } = usePrivacyStore();
  const label = privacy ? "Show account emails" : "Hide account emails";

  return (
    <button
      onClick={togglePrivacy}
      className="flex items-center justify-center size-10 rounded-full text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
      aria-label={label}
      aria-pressed={privacy}
      title={label}
    >
      <span className="material-symbols-outlined text-[22px]">{privacy ? "visibility_off" : "visibility"}</span>
    </button>
  );
}
