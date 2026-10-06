type MapContent = {
  latitude?: number;
  longitude?: number;
  zoom?: number;
  address?: string;
};

export default function MapSection({ title, content }: { title: string; content: string }) {
  let data: MapContent = {};
  try { data = JSON.parse(content); } catch {}

  const hasCoords = data.latitude !== undefined && data.longitude !== undefined;
  const mapSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${(data.longitude! - 0.01).toFixed(4)},${(data.latitude! - 0.01).toFixed(4)},${(data.longitude! + 0.01).toFixed(4)},${(data.latitude! + 0.01).toFixed(4)}&layer=mapnik&marker=${data.latitude},${data.longitude}`
    : null;

  return (
    <section className="py-16 px-6">
      <h2 className="text-3xl font-bold text-green-700 mb-4 text-center">{title}</h2>
      {data.address && <p className="text-center text-gray-600 mb-6">{data.address}</p>}
      {mapSrc && (
        <div className="max-w-3xl mx-auto rounded overflow-hidden shadow">
          <iframe src={mapSrc} width="100%" height="350" className="border-0" title={title} />
        </div>
      )}
    </section>
  );
}
