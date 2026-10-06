"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import HeroSection from "@/components/content/HeroSection";
import AboutSection from "@/components/content/AboutSection";
import PhotoSection from "@/components/content/PhotoSection";
import MapSection from "@/components/content/MapSection";
import ContactSection from "@/components/content/ContactSection";

type ContentSection = {
  id: string;
  type: string;
  status: string;
  enabled: boolean;
  order: number;
  title: string;
  content: string;
};

const SECTION_COMPONENTS: Record<string, React.ComponentType<{ title: string; content: string }>> = {
  HERO: HeroSection,
  ABOUT: AboutSection,
  PHOTO: PhotoSection,
  MAP: MapSection,
  CONTACT: ContactSection,
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-500",
  REVIEW: "bg-yellow-500",
  PUBLISHED: "bg-green-500",
  ARCHIVED: "bg-red-500",
};

type Tenant = { id: string; name: string; slug: string };

export default function ContentPreviewPage() {
  const [sections, setSections] = useState<ContentSection[]>([]);
  const t = useTranslations("settings");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [showDisabled, setShowDisabled] = useState(true);
  const [showOverlays, setShowOverlays] = useState(true);

  useEffect(() => {
    fetch("/api/admin/tenants")
      .then((r) => { if (r.ok) { setIsPlatformAdmin(true); return r.json(); } return null; })
      .then((data) => { if (Array.isArray(data)) setTenants(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    fetch(`/api/content${qs}`)
      .then((r) => r.json())
      .then((d) => setSections(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [selectedTenant]);

  const visible = sections
    .filter((s) => s.status !== "ARCHIVED")
    .filter((s) => showDisabled || s.enabled)
    .sort((a, b) => a.order - b.order);

  return (
    <div>
      {/* Toolbar */}
      <div className="sticky top-0 z-50 bg-white border-b shadow-sm px-6 py-3 flex items-center gap-4">
        <Link href="/dashboard/content" className="text-green-700 hover:underline font-medium text-sm">
          {t("content.preview.backToManager")}
        </Link>
        <span className="text-lg font-bold">{t("content.preview.title")}</span>

        {isPlatformAdmin && (
          <select value={selectedTenant} onChange={(e) => setSelectedTenant(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="">{t("content.preview.tenantLabel")}</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}

        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
          {t("content.preview.showDisabled")}
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={showOverlays} onChange={(e) => setShowOverlays(e.target.checked)} />
          {t("content.preview.statusBadges")}
        </label>

        <span className="ml-auto text-xs text-gray-400">{t("content.preview.sectionCount", { count: visible.length })}</span>
      </div>

      {/* Rendered preview */}
      {visible.length === 0 ? (
        <div className="flex items-center justify-center min-h-[60vh] text-gray-400">
          {t("content.preview.noSections")}
        </div>
      ) : (
        <div className="min-h-screen">
          {visible.map((s) => {
            const Component = SECTION_COMPONENTS[s.type];
            if (!Component) return null;
            return (
              <div key={s.id} className="relative">
                {showOverlays && (
                  <div className="absolute top-2 right-2 z-40 flex items-center gap-1">
                    <span className={`text-xs text-white px-2 py-0.5 rounded ${STATUS_COLORS[s.status] ?? "bg-gray-400"}`}>
                      {s.status}
                    </span>
                    {!s.enabled && (
                      <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded">HIDDEN</span>
                    )}
                    <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded">{s.type}</span>
                  </div>
                )}
                <Component title={s.title} content={s.content} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
