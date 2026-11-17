CREATE OR REPLACE FUNCTION public.save_prescription(_visit_id uuid, _diagnosis_id uuid DEFAULT NULL, _items jsonb DEFAULT '[]'::jsonb, _prescription_id uuid DEFAULT NULL, _replaces_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
REVOKE ALL ON FUNCTION public.save_prescription(uuid,uuid,jsonb,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_prescription(uuid,uuid,jsonb,uuid,uuid) TO authenticated;