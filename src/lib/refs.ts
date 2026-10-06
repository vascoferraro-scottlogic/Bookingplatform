export function formatShortRef(id?: string | null): string {
  if (!id) return "";
  const clean = String(id).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
