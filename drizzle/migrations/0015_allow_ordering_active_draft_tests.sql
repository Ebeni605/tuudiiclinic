CREATE OR REPLACE FUNCTION public.create_lab_order(_visit_id uuid, _test_ids uuid[], _priority text DEFAULT 'routine'::text, _notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_status text; v_patient uuid; req_id uuid; req_no text; dup text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'clinician') THEN RAISE EXCEPTION 'Only an OPD clinician can request laboratory tests'; END IF;
  IF _test_ids IS NULL OR cardinality(_test_ids) = 0 THEN RAISE EXCEPTION 'Tick at least one test'; END IF;
  IF cardinality(_test_ids) > 60 THEN RAISE EXCEPTION 'Too many tests in one request'; END IF;
  IF _priority NOT IN ('routine','urgent') THEN RAISE EXCEPTION 'Priority must be routine or urgent'; END IF;
  IF length(COALESCE(_notes,'')) > 2000 THEN RAISE EXCEPTION 'Clinical notes are too long (max 2000 characters)'; END IF;
  SELECT status, patient_id INTO v_status, v_patient FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF v_status NOT IN ('in_consultation','awaiting_lab','ready_for_review') THEN RAISE EXCEPTION 'Start the consultation first'; END IF;
  -- Active tests can be ordered; only unconfirmed abbreviations (needs_confirmation) are blocked.
  IF EXISTS (SELECT 1 FROM unnest(_test_ids) t(tid) LEFT JOIN public.lab_tests l ON l.id = t.tid
             WHERE l.id IS NULL OR NOT l.active OR l.approval_status = 'needs_confirmation') THEN
    RAISE EXCEPTION 'One of the selected tests is switched off or still needs laboratory confirmation';
  END IF;
  SELECT string_agg(DISTINCT lt.name, ', ') INTO dup
    FROM public.lab_request_items i
    JOIN public.lab_requests r ON r.id = i.lab_request_id
    JOIN public.lab_tests lt ON lt.id = i.lab_test_id
   WHERE r.visit_id = _visit_id AND i.lab_test_id = ANY(_test_ids) AND i.status NOT IN ('verified','cancelled');
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Already requested for this visit and not finished yet: %', dup USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.lab_requests (visit_id, patient_id, priority, clinical_notes)
    VALUES (_visit_id, v_patient, _priority, NULLIF(btrim(COALESCE(_notes,'')), ''))
    RETURNING id, request_number INTO req_id, req_no;
  INSERT INTO public.lab_request_items (lab_request_id, lab_test_id)
    SELECT req_id, tid FROM (SELECT DISTINCT unnest(_test_ids) AS tid) s;
  IF v_status <> 'awaiting_lab' THEN
    UPDATE public.visits SET status = 'awaiting_lab' WHERE id = _visit_id;
  END IF;
  RETURN jsonb_build_object('id', req_id, 'request_number', req_no);
END $function$;