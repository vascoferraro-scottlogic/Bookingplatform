type HeroContent = {
  subheading?: string;
  backgroundImageUrl?: string;
  ctaText?: string;
  ctaLink?: string;
};

export default function HeroSection({ title, content }: { title: string; content: string }) {
  let data: HeroContent = {};
  try { data = JSON.parse(content); } catch {}

  return (
    <section
      className="relative flex flex-col items-center justify-center text-center py-24 px-6 bg-green-700 text-white"
      style={data.backgroundImageUrl ? { backgroundImage: `url(${data.backgroundImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {data.backgroundImageUrl && <div className="absolute inset-0 bg-black/40" />}
      <div className="relative z-10">
        <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
        {data.subheading && <p className="mt-4 text-lg max-w-2xl">{data.subheading}</p>}
        {data.ctaText && data.ctaLink && (
          <a href={data.ctaLink} className="mt-6 inline-block rounded-lg bg-white text-green-700 px-6 py-3 font-medium hover:bg-gray-100">
            {data.ctaText}
          </a>
        )}
      </div>
    </section>
  );
}
