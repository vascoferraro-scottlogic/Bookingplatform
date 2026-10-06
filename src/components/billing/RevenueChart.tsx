"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslations } from "next-intl";

interface RevenueChartProps {
  data: { month: string; revenue: number }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  const t = useTranslations("billing");
  const formatted = data.map((d) => ({
    month: d.month,
    revenue: d.revenue / 100,
  }));

  return (
    <div className="rounded-xl bg-white p-6 shadow">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("charts.revenueTrend")}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
          <Tooltip formatter={(v) => `£${Number(v).toFixed(2)}`} />
          <Line type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
