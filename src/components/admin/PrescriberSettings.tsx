import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { F } from "@/components/opd/Field";
import { LoadError, PageLoading } from "@/components/AppShell";

export function PrescriberSettings() {
  const rows = useQuery({ queryKey: ["prescriber-settings"], queryFn: async () => {
    const { data: roles, error: roleError } = await supabase.from("user_roles").select("user_id").eq("role", "clinician");
    if (roleError) throw roleError;
    if (!roles.length) return [];
    const { data, error } = await supabase.from("profiles").select("id, full_name, qualification, professional_registration").in("id", roles.map(r => r.user_id));
    if (error) throw error;
    return data ?? [];
  } });
  const [edit, setEdit] = useState<{ id: string; full_name: string; qualification: string; professional_registration: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!edit) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ qualification: edit.qualification.trim() || null, professional_registration: edit.professional_registration.trim() || null }).eq("id", edit.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setEdit(null); rows.refetch(); toast.success("Prescriber credentials saved");
  }
  return <section className="mt-6 border-t pt-5"><h2 className="mb-3 text-lg font-semibold">Prescriber credentials</h2>{rows.isLoading && <PageLoading />}{rows.error && <LoadError onRetry={() => rows.refetch()} />}{rows.data?.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3"><div><p className="font-medium">{p.full_name}</p><p className="text-sm text-muted-foreground">{p.qualification || "Qualification not confirmed"} · {p.professional_registration || "Registration not confirmed"}</p></div><Button variant="outline" onClick={() => setEdit({ ...p, qualification: p.qualification ?? "", professional_registration: p.professional_registration ?? "" })}>Review credentials</Button></div>)}<Dialog open={!!edit} onOpenChange={o => !busy && !o && setEdit(null)}><DialogContent><DialogHeader><DialogTitle>Prescriber: {edit?.full_name}</DialogTitle></DialogHeader>{edit && <><F label="Verified qualification"><Input value={edit.qualification} maxLength={200} onChange={e => setEdit({ ...edit, qualification: e.target.value })} /></F><F label="Professional registration number"><Input value={edit.professional_registration} maxLength={100} onChange={e => setEdit({ ...edit, professional_registration: e.target.value })} /></F><Button disabled={busy} onClick={save}>Save verified credentials</Button></>}</DialogContent></Dialog></section>;
}