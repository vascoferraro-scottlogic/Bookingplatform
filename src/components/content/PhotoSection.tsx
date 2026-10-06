type PhotoImage = { url: string; alt?: string; caption?: string };
type PhotoContent = { images?: PhotoImage[] };

export default function PhotoSection({ title, content }: { title: string; content: string }) {
  let data: PhotoContent = {};
  try { data = JSON.parse(content); } catch {}

  const images = data.images ?? [];

  return (
    <section className="py-16 px-6">
      <h2 className="text-3xl font-bold text-green-700 mb-6 text-center">{title}</h2>
      {images.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {images.map((img, i) => (
            <figure key={i} className="rounded overflow-hidden shadow">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt ?? title} className="w-full h-48 object-cover" />
              {img.caption && <figcaption className="text-sm text-gray-500 p-2 text-center">{img.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
