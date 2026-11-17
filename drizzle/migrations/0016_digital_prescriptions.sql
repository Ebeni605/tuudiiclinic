ALTER TABLE public.profiles ADD COLUMN qualification text, ADD COLUMN professional_registration text;
CREATE TABLE public.prescription_settings (id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1), phones text NOT NULL DEFAULT '0992540474 / 0913591670' CHECK(length(phones)<=200), address text NOT NULL DEFAULT '' CHECK(length(address)<=500));
GRANT SELECT ON public.prescription_settings TO authenticated;
GRANT INSERT, UPDATE ON public.prescription_settings TO authenticated;
GRANT ALL ON public.prescription_settings TO service_role;
ALTER TABLE public.prescription_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_read ON public.prescription_settings FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['admin','clinician']::public.app_role[]));
CREATE POLICY settings_insert ON public.prescription_settings FOR INSERT TO authenticated WITH CHECK(public.has_role(auth.uid(),'admin'));
CREATE POLICY settings_update ON public.prescription_settings FOR UPDATE TO authenticated USING(public.has_role(auth.uid(),'admin')) WITH CHECK(public.has_role(auth.uid(),'admin'));
CREATE TABLE public.prescriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prescription_number text UNIQUE NOT NULL DEFAULT ('RX-' || upper(replace(gen_random_uuid()::text,'-',''))), patient_id uuid NOT NULL REFERENCES public.patients(id), visit_id uuid NOT NULL REFERENCES public.visits(id), consultation_id uuid NOT NULL REFERENCES public.consultations(id), clinician_id uuid NOT NULL REFERENCES public.profiles(id), diagnosis_id uuid REFERENCES public.diagnoses(id), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized','printed','cancelled')), snapshot jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz, cancelled_at timestamptz, cancel_reason text, print_count integer NOT NULL DEFAULT 0, replaces_id uuid REFERENCES public.prescriptions(id));
GRANT SELECT ON public.prescriptions TO authenticated;
GRANT ALL ON public.prescriptions TO service_role;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY prescriptions_read ON public.prescriptions FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['admin','clinician']::public.app_role[]));
CREATE TABLE public.prescription_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prescription_id uuid NOT NULL REFERENCES public.prescriptions(id), position integer NOT NULL, drug_name text NOT NULL CHECK(length(btrim(drug_name)) BETWEEN 1 AND 200), brand_name text NOT NULL DEFAULT '' CHECK(length(brand_name)<=200), strength text NOT NULL DEFAULT '' CHECK(length(strength)<=100), dosage_form text NOT NULL DEFAULT '' CHECK(length(dosage_form)<=100), dose text NOT NULL DEFAULT '' CHECK(length(dose)<=100), route text NOT NULL DEFAULT '' CHECK(length(route)<=100), frequency text NOT NULL DEFAULT '' CHECK(length(frequency)<=100), duration text NOT NULL DEFAULT '' CHECK(length(duration)<=100), quantity text NOT NULL DEFAULT '' CHECK(length(quantity)<=100), instructions text NOT NULL DEFAULT '' CHECK(length(instructions)<=2000), other_information text NOT NULL DEFAULT '' CHECK(length(other_information)<=2000), UNIQUE(prescription_id,position));
GRANT SELECT ON public.prescription_items TO authenticated;
GRANT ALL ON public.prescription_items TO service_role;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_read ON public.prescription_items FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['admin','clinician']::public.app_role[]));
CREATE TABLE public.prescription_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prescription_id uuid NOT NULL REFERENCES public.prescriptions(id), actor_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('draft_saved','finalized','print_requested','pdf_download_requested','cancelled','reissued')), reason text, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.prescription_events TO authenticated;
GRANT ALL ON public.prescription_events TO service_role;
ALTER TABLE public.prescription_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_read ON public.prescription_events FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['admin','clinician']::public.app_role[]));
CREATE INDEX prescriptions_visit ON public.prescriptions(visit_id,created_at);
CREATE TRIGGER prescription_audit AFTER INSERT OR UPDATE OR DELETE ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER prescription_item_audit AFTER INSERT OR UPDATE OR DELETE ON public.prescription_items FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER prescription_event_audit AFTER INSERT ON public.prescription_events FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER prescription_settings_audit AFTER INSERT OR UPDATE ON public.prescription_settings FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE FUNCTION public.prescription_snapshot(_visit uuid,_dx uuid,_clinician uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object('patient',to_jsonb(p),'visit_date',v.queue_date,'age',CASE WHEN p.date_of_birth IS NOT NULL THEN extract(year FROM age(v.queue_date,p.date_of_birth))::text || ' years' ELSE NULL END,'weight_kg',(SELECT weight_kg FROM vital_signs WHERE visit_id=v.id AND weight_kg IS NOT NULL ORDER BY recorded_at DESC LIMIT 1),'diagnosis',(SELECT to_jsonb(d) FROM diagnoses d WHERE d.id=_dx),'prescriber',jsonb_build_object('full_name',s.full_name,'qualification',s.qualification,'professional_registration',s.professional_registration),'phones',coalesce((SELECT phones FROM prescription_settings WHERE id=1),'0992540474 / 0913591670'),'clinic_address',coalesce((SELECT address FROM prescription_settings WHERE id=1),''),'care_type','Outpatient') INTO result FROM visits v JOIN patients p ON p.id=v.patient_id JOIN profiles s ON s.id=_clinician WHERE v.id=_visit;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.prescription_snapshot(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_prescription(_visit_id uuid,_diagnosis_id uuid,_items jsonb,_prescription_id uuid DEFAULT NULL,_replaces_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c consultations; v visits; r prescriptions; rid uuid; item jsonb; n integer:=0;
BEGIN
 IF NOT public.has_role(auth.uid(),'clinician') THEN RAISE EXCEPTION 'Only an approved OPD clinician can prescribe'; END IF;
 SELECT * INTO v FROM visits WHERE id=_visit_id FOR UPDATE;
 SELECT * INTO c FROM consultations WHERE visit_id=_visit_id;
 IF c.id IS NULL OR c.clinician_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the encounter clinician can prescribe'; END IF;
 IF v.status IN ('waiting','cancelled','no_show') THEN RAISE EXCEPTION 'Start a valid consultation first'; END IF;
 IF (SELECT archived FROM patients WHERE id=v.patient_id) THEN RAISE EXCEPTION 'This patient is archived'; END IF;
 IF _diagnosis_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM diagnoses WHERE id=_diagnosis_id AND visit_id=_visit_id AND consultation_id=c.id) THEN RAISE EXCEPTION 'Select a diagnosis documented in this encounter'; END IF;
 IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Medicine items must be a list'; END IF;
 IF jsonb_array_length(_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Enter between 1 and 50 medicines'; END IF;
 IF _prescription_id IS NOT NULL THEN
 SELECT * INTO r FROM prescriptions WHERE id=_prescription_id FOR UPDATE;
 IF r.id IS NULL OR r.clinician_id IS DISTINCT FROM auth.uid() OR r.visit_id<>_visit_id OR r.status<>'draft' THEN RAISE EXCEPTION 'Only your own draft can be edited'; END IF;
 rid:=r.id;
 UPDATE prescriptions SET diagnosis_id=_diagnosis_id,snapshot=public.prescription_snapshot(_visit_id,_diagnosis_id,auth.uid()),updated_at=now() WHERE id=rid;
 DELETE FROM prescription_items WHERE prescription_id=rid;
 ELSE
 IF _replaces_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM prescriptions WHERE id=_replaces_id AND visit_id=_visit_id AND clinician_id=auth.uid() AND status='cancelled') THEN RAISE EXCEPTION 'Reissue must reference your cancelled prescription for this visit'; END IF;
 INSERT INTO prescriptions(patient_id,visit_id,consultation_id,clinician_id,diagnosis_id,snapshot,replaces_id) VALUES(v.patient_id,v.id,c.id,auth.uid(),_diagnosis_id,public.prescription_snapshot(_visit_id,_diagnosis_id,auth.uid()),_replaces_id) RETURNING id INTO rid;
 IF _replaces_id IS NOT NULL THEN INSERT INTO prescription_events(prescription_id,actor_id,action,reason) VALUES(rid,auth.uid(),'reissued',_replaces_id::text); END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_items) LOOP
 n:=n+1;
 INSERT INTO prescription_items(prescription_id,position,drug_name,brand_name,strength,dosage_form,dose,route,frequency,duration,quantity,instructions,other_information) VALUES(rid,n,btrim(coalesce(item->>'drug_name','')),coalesce(item->>'brand_name',''),coalesce(item->>'strength',''),coalesce(item->>'dosage_form',''),coalesce(item->>'dose',''),coalesce(item->>'route',''),coalesce(item->>'frequency',''),coalesce(item->>'duration',''),coalesce(item->>'quantity',''),coalesce(item->>'instructions',''),coalesce(item->>'other_information',''));
 END LOOP;
 INSERT INTO prescription_events(prescription_id,actor_id,action) VALUES(rid,auth.uid(),'draft_saved');
 RETURN rid;
END $$;
CREATE FUNCTION public.prescription_action(_id uuid,_action text,_reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r prescriptions; s profiles;
BEGIN
 IF NOT public.has_role(auth.uid(),'clinician') THEN RAISE EXCEPTION 'Only an approved OPD clinician can authorize prescriptions'; END IF;
 SELECT * INTO r FROM prescriptions WHERE id=_id FOR UPDATE;
 IF r.id IS NULL OR r.clinician_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the prescribing clinician can authorize this prescription'; END IF;
 IF _action='finalized' THEN
 IF r.status<>'draft' THEN RAISE EXCEPTION 'Only drafts can be finalized'; END IF;
 SELECT * INTO s FROM profiles WHERE id=auth.uid();
 IF nullif(btrim(s.qualification),'') IS NULL OR nullif(btrim(s.professional_registration),'') IS NULL THEN RAISE EXCEPTION 'Ask the administrator to confirm your qualification and professional registration'; END IF;
 IF r.diagnosis_id IS NULL OR NOT EXISTS(SELECT 1 FROM diagnoses WHERE id=r.diagnosis_id AND consultation_id=r.consultation_id) THEN RAISE EXCEPTION 'Select a documented encounter diagnosis'; END IF;
 IF NOT EXISTS(SELECT 1 FROM prescription_items WHERE prescription_id=r.id) OR EXISTS(SELECT 1 FROM prescription_items WHERE prescription_id=r.id AND (btrim(dose)='' OR btrim(route)='' OR btrim(frequency)='' OR btrim(duration)='' OR btrim(quantity)='')) THEN RAISE EXCEPTION 'Enter dose, route, frequency, duration and quantity for every medicine'; END IF;
 IF EXISTS(SELECT 1 FROM visits v JOIN patients p ON p.id=v.patient_id WHERE v.id=r.visit_id AND (v.status IN ('waiting','cancelled','no_show') OR p.archived)) THEN RAISE EXCEPTION 'This encounter is not valid for prescribing'; END IF;
 UPDATE prescriptions SET status='finalized',finalized_at=now(),updated_at=now(),snapshot=public.prescription_snapshot(r.visit_id,r.diagnosis_id,r.clinician_id) WHERE id=r.id;
 ELSIF _action='cancelled' THEN
 IF r.status='cancelled' OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Enter a cancellation or correction reason (3–2000 characters)'; END IF;
 UPDATE prescriptions SET status='cancelled',cancel_reason=btrim(_reason),cancelled_at=now(),updated_at=now() WHERE id=r.id;
 ELSIF _action IN ('print_requested','pdf_download_requested') THEN
 IF r.status NOT IN ('finalized','printed') THEN RAISE EXCEPTION 'Only authorized prescriptions can be printed or downloaded'; END IF;
 UPDATE prescriptions SET status='printed',print_count=print_count+1,updated_at=now() WHERE id=r.id;
 ELSE RAISE EXCEPTION 'Invalid prescription action'; END IF;
 INSERT INTO prescription_events(prescription_id,actor_id,action,reason) VALUES(r.id,auth.uid(),_action,_reason);
END $$;
REVOKE ALL ON FUNCTION public.save_prescription(uuid,uuid,jsonb,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.prescription_action(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_prescription(uuid,uuid,jsonb,uuid,uuid),public.prescription_action(uuid,text,text) TO authenticated;
CREATE FUNCTION public.prescriber_credentials_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF (TG_OP='INSERT' AND (NEW.qualification IS NOT NULL OR NEW.professional_registration IS NOT NULL)) OR (TG_OP='UPDATE' AND (NEW.qualification IS DISTINCT FROM OLD.qualification OR NEW.professional_registration IS DISTINCT FROM OLD.professional_registration)) THEN
 IF NOT coalesce(public.has_role(auth.uid(),'admin'),false) THEN RAISE EXCEPTION 'Only administrators can approve prescriber credentials'; END IF;
 IF length(coalesce(NEW.qualification,''))>200 OR length(coalesce(NEW.professional_registration,''))>100 THEN RAISE EXCEPTION 'Professional details are too long'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER prescriber_credentials_before BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prescriber_credentials_guard();