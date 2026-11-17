import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { patientName } from "@/lib/data";
import { fmtDateTime } from "@/lib/opd-queries";
import { requireArea } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/opd/prescriptions")({
  beforeLoad: requireArea("opd"),
  head: () => ({ meta: [{ title: "Prescriptions — Two D Medium Clinic" }, { name: "description", content: "All OPD prescriptions: search, filter and print." }, { property: "og:title", content: "Prescriptions — Two D Medium Clinic" }, { property: "og:description", content: "All OPD prescriptions: search, filter and print." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => <RequireArea area="opd"><PrescriptionsPage /></RequireArea>,
});

const FILTERS = [["all", "All"], ["draft", "Drafts"], ["authorized", "Authorized"], ["cancelled", "Cancelled"]] as const;
const label = (s: string) => (s === "finalized" || s === "printed" ? "Authorized" : s === "draft" ? "Draft" : s === "cancelled" ? "Cancelled" : s);

function PrescriptionsPage() {
  const [q, setQ] = useState("");
  const [f, setF] = useState<string>("all");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["prescriptions_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("prescriptions")
        .select("id, prescription_number, status, created_at, visit_id, patients(mrn, first_name, middle_name, last_name), prescription_items(id)")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const all = data ?? [];
  const n = q.trim().toLowerCase();
  const rows = all.filter((r) =>
    (f === "all" || (f === "authorized" ? ["finalized", "printed"].includes(r.status) : r.status === f)) &&
    (!n || r.prescription_number.toLowerCase().includes(n) || r.patients?.mrn.toLowerCase().includes(n) || patientName(r.patients).toLowerCase().includes(n)));
  const count = (k: string) => all.filter((r) => k === "all" || (k === "authorized" ? ["finalized", "printed"].includes(r.status) : r.status === k)).length;

  return (
    <div>
      <PageHeader title="Prescriptions" subtitle="Every prescription written in OPD. New prescriptions are written from the patient's visit." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setF(k)} className="text-left">
            <Card className={f === k ? "border-primary ring-1 ring-primary" : ""}><CardContent className="p-3"><div className="text-2xl font-bold">{count(k)}</div><div className="text-xs text-muted-foreground">{l}</div></CardContent></Card>
          </button>
        ))}
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search patient name, patient ID (CL-...) or Rx number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search prescriptions" />
      </div>
      {isLoading ? <PageLoading /> : error ? <LoadError onRetry={() => refetch()} /> : (
        <Card><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Rx number</TableHead><TableHead>Patient ID</TableHead><TableHead>Patient</TableHead><TableHead>Medicines</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No prescriptions match.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id} className={r.status === "cancelled" ? "opacity-60" : ""}>
                <TableCell className="max-w-[160px] truncate font-mono text-xs">{r.prescription_number}</TableCell>
                <TableCell className="font-mono text-xs">{r.patients?.mrn}</TableCell>
                <TableCell className="font-medium">{patientName(r.patients)}</TableCell>
                <TableCell>{r.prescription_items.length}</TableCell>
                <TableCell className={r.status === "cancelled" ? "text-destructive" : r.status === "draft" ? "text-muted-foreground" : "font-semibold text-primary"}>{label(r.status)}</TableCell>
                <TableCell className="text-sm">{fmtDateTime(r.created_at)}</TableCell>
                <TableCell className="text-right"><div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" asChild><Link to="/opd/prescription/$prescriptionId" params={{ prescriptionId: r.id }}><Printer className="mr-1 h-4 w-4" />View / print</Link></Button>
                  <Button size="sm" variant="ghost" asChild><Link to="/opd/visit/$visitId" params={{ visitId: r.visit_id }}>Open visit</Link></Button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></div></Card>
      )}
    </div>
  );
}
