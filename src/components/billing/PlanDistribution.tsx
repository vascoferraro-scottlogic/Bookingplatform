"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useTranslations } from "next-intl";

const COLOURS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#64748b"];

interface PlanDistributionProps {
  data: { planId: string; planName: string; tenants: number; mrr: number }[];
}

export function PlanDistribution({ data }: PlanDistributionProps) {
  const t = useTranslations("billing");
  const formatted = data.map((d) => ({
    name: d.planName,
    mrr: d.mrr / 100,
    tenants: d.tenants,
  }));

  return (
    <div className="rounded-xl bg-white p-6 shadow">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("charts.mrrByPlan")}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
          <Tooltip formatter={(v) => `£${Number(v).toFixed(2)}`} />
          <Bar dataKey="mrr" radius={[4, 4, 0, 0]}>
            {formatted.map((_, i) => (
              <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
