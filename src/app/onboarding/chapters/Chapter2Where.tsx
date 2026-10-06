"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChapterShell, Field, inputClass } from "./shared";
import type { ChapterProps } from "./shared";

export default function Chapter2Where({ tenantId, onAdvance }: ChapterProps) {
  const t = useTranslations("onboarding");
  const [latitude, setLatitude] = useState<string>("");
  const [longitude, setLongitude] = useState<string>("");
  const [locality, setLocality] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/admin/tenants/${tenantId}`)
      .then((r) => r.json())
      .then((t) => {
        setLatitude(t.latitude != null ? String(t.latitude) : "");
        setLongitude(t.longitude != null ? String(t.longitude) : "");
        if (t.locality) setLocality(t.locality);
        setLoaded(true);
      });
  }, [tenantId]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Your browser does not support location lookup.");
      return;
    }
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
      },
      () => setGeoError("Could not get your location. Enter manually below.")
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    const lat = latitude ? Number(latitude) : null;
    const lng = longitude ? Number(longitude) : null;
    await fetch(`/api/admin/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng, locality: locality.trim() || null }),
    });
    setBusy(false);
    await onAdvance();
  };

  if (!loaded) return <div className="text-gray-500">{t("loading")}</div>;

  return (
    <ChapterShell
      title={t("chapters.where")}
      intro="Used for weather forecasts, sunrise/sunset, and showing your club on a map."
      onSubmit={submit}
      busy={busy}
      canSkip
      onSkip={onAdvance}
    >
      <Field label="Town / city" hint="Shown alongside your club name so members can tell clubs apart.">
        <input
          className={inputClass}
          value={locality}
          onChange={(e) => setLocality(e.target.value)}
          placeholder="e.g. Edinburgh"
          maxLength={60}
          required
        />
      </Field>

      <button
        type="button"
        onClick={useMyLocation}
        className="px-4 py-2 rounded-md border border-emerald-600 text-emerald-700 hover:bg-emerald-50"
      >
        Use my current location
      </button>
      {geoError && <p className="text-sm text-red-600">{geoError}</p>}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Latitude" hint="Between -90 and 90">
          <input
            className={inputClass}
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="55.953"
            inputMode="decimal"
          />
        </Field>
        <Field label="Longitude" hint="Between -180 and 180">
          <input
            className={inputClass}
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="-3.188"
            inputMode="decimal"
          />
        </Field>
      </div>
      {latitude && longitude && (
        <p className="text-xs text-gray-500">
          Coordinates set: {latitude}, {longitude}.
        </p>
      )}
    </ChapterShell>
  );
}
