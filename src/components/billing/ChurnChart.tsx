"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslations } from "next-intl";

interface ChurnChartProps {
  data: { month: string; count: number }[];
}

export function ChurnChart({ data }: ChurnChartProps) {
  const t = useTranslations("billing");
  return (
    <div className="rounded-xl bg-white p-6 shadow">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("charts.monthlyChurn")}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Line type="monotone" dataKey="count" stroke="#dc2626" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
