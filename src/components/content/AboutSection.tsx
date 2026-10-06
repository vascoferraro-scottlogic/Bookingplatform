type AboutContent = {
  body?: string;
};

export default function AboutSection({ title, content }: { title: string; content: string }) {
  let data: AboutContent = {};
  try { data = JSON.parse(content); } catch {}

  return (
    <section className="py-16 px-6 max-w-3xl mx-auto">
      <h2 className="text-3xl font-bold text-green-700 mb-4">{title}</h2>
      {data.body && (
        <div className="prose prose-green max-w-none text-gray-700 whitespace-pre-wrap">
          {data.body}
        </div>
      )}
    </section>
  );
}
