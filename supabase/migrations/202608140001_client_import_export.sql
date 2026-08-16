create or replace function public.import_clients_batch(
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row jsonb;
  v_action text;
  v_name text;
  v_phone text;
  v_email text;
  v_notes text;
  v_birthday text;
  v_client_tag text;
  v_display_name text;
  v_merge_target_client_id uuid;
  v_target public.clients%rowtype;
  v_rebooking_weeks integer;
  v_is_pro boolean := false;
  v_active_client_count integer := 0;
  v_inserted integer := 0;
  v_merged integer := 0;
  v_skipped integer := 0;
  v_plan_limit_skipped integer := 0;
begin
  if v_user_id is null then
    raise exception 'Client import requires an authenticated account.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Client import requires a JSON array payload.';
  end if;

  for v_row in
    select value
    from jsonb_array_elements(p_rows)
  loop
    v_action := lower(trim(coalesce(v_row->>'action', '')));

    if v_action not in ('insert', 'keep_separate', 'merge', 'skip') then
      raise exception 'Unsupported client import action: %', v_action;
    end if;

    if v_action = 'skip' then
      continue;
    end if;

    v_name := regexp_replace(trim(coalesce(v_row->>'name', '')), '\s+', ' ', 'g');
    v_phone := trim(coalesce(v_row->>'phone', ''));
    v_email := lower(trim(coalesce(v_row->>'email', '')));
    v_display_name := coalesce(nullif(v_name, ''), nullif(v_phone, ''), nullif(v_email, ''));

    if v_display_name is null then
      raise exception 'Imported clients need at least a name, phone, or email.';
    end if;

    if v_email <> '' and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Imported client email addresses must be valid.';
    end if;

    if v_action = 'merge' then
      v_merge_target_client_id := nullif(trim(coalesce(v_row->>'merge_target_client_id', '')), '')::uuid;

      if v_merge_target_client_id is null then
        raise exception 'Merge rows must include merge_target_client_id.';
      end if;

      perform 1
      from public.clients
      where id = v_merge_target_client_id
        and user_id = v_user_id
        and archived_at is null;

      if not found then
        raise exception 'Merge target % is not available to this account.', v_merge_target_client_id;
      end if;
    end if;
  end loop;

  select exists (
    select 1
    from public.user_subscriptions
    where user_id = v_user_id
      and lower(trim(coalesce(status, ''))) = 'active'
      and (
        (
          (
            lower(trim(coalesce(plan, ''))) = 'lifetime'
            or lower(trim(coalesce(entitlement_source, ''))) in ('admin', 'manual')
          )
          and (
            entitlement_expires_at is null
            or entitlement_expires_at > now()
          )
        )
        or (
          lower(trim(coalesce(entitlement, ''))) = 'schedova_pro'
          and (
            entitlement_expires_at is null
            or entitlement_expires_at > now()
          )
        )
      )
  ) into v_is_pro;

  select count(*)
  into v_active_client_count
  from public.clients
  where user_id = v_user_id
    and archived_at is null;

  for v_row in
    select value
    from jsonb_array_elements(p_rows)
  loop
    v_action := lower(trim(coalesce(v_row->>'action', '')));

    if v_action = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_name := regexp_replace(trim(coalesce(v_row->>'name', '')), '\s+', ' ', 'g');
    v_phone := trim(coalesce(v_row->>'phone', ''));
    v_email := lower(trim(coalesce(v_row->>'email', '')));
    v_notes := trim(coalesce(v_row->>'notes', ''));
    v_birthday := trim(coalesce(v_row->>'birthday', ''));
    v_client_tag := case trim(coalesce(v_row->>'client_tag', ''))
      when 'Regular' then 'Regular'
      when 'VIP' then 'VIP'
      else 'New'
    end;
    v_display_name := coalesce(nullif(v_name, ''), nullif(v_phone, ''), nullif(v_email, ''));
    v_rebooking_weeks := case
      when nullif(trim(coalesce(v_row->>'rebooking_weeks', '')), '') is null then null
      when (v_row->>'rebooking_weeks')::integer > 0 then (v_row->>'rebooking_weeks')::integer
      else null
    end;

    if v_action = 'merge' then
      v_merge_target_client_id := nullif(trim(coalesce(v_row->>'merge_target_client_id', '')), '')::uuid;

      select *
      into v_target
      from public.clients
      where id = v_merge_target_client_id
        and user_id = v_user_id
      for update;

      update public.clients
      set
        name = v_display_name,
        phone = nullif(v_phone, ''),
        email = nullif(v_email, ''),
        notes = nullif(v_notes, ''),
        birthday = nullif(v_birthday, ''),
        client_tag = v_client_tag,
        rebooking_weeks = v_rebooking_weeks,
        sms_opt_in = coalesce(v_target.sms_opt_in, false) and nullif(v_phone, '') is not null,
        sms_opt_in_at = case
          when coalesce(v_target.sms_opt_in, false) and nullif(v_phone, '') is not null
            then v_target.sms_opt_in_at
          else null
        end,
        sms_opt_in_source = case
          when coalesce(v_target.sms_opt_in, false) and nullif(v_phone, '') is not null
            then v_target.sms_opt_in_source
          else null
        end,
        email_opt_in = coalesce(v_target.email_opt_in, false) and nullif(v_email, '') is not null,
        email_opt_in_at = case
          when coalesce(v_target.email_opt_in, false) and nullif(v_email, '') is not null
            then v_target.email_opt_in_at
          else null
        end,
        email_opt_in_source = case
          when coalesce(v_target.email_opt_in, false) and nullif(v_email, '') is not null
            then v_target.email_opt_in_source
          else null
        end
      where id = v_merge_target_client_id
        and user_id = v_user_id;

      v_merged := v_merged + 1;
      continue;
    end if;

    if not v_is_pro and v_active_client_count + v_inserted >= 25 then
      v_plan_limit_skipped := v_plan_limit_skipped + 1;
      continue;
    end if;

    insert into public.clients (
      user_id,
      name,
      phone,
      email,
      notes,
      birthday,
      rebooking_weeks,
      client_tag,
      sms_opt_in,
      sms_opt_in_at,
      sms_opt_in_source,
      email_opt_in,
      email_opt_in_at,
      email_opt_in_source
    )
    values (
      v_user_id,
      v_display_name,
      nullif(v_phone, ''),
      nullif(v_email, ''),
      nullif(v_notes, ''),
      nullif(v_birthday, ''),
      v_rebooking_weeks,
      v_client_tag,
      false,
      null,
      null,
      false,
      null,
      null
    );

    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'merged', v_merged,
    'planLimitSkipped', v_plan_limit_skipped,
    'skipped', v_skipped,
    'totalRows', jsonb_array_length(p_rows)
  );
end;
$$;

create or replace function public.merge_client_records(
  p_primary_client_id uuid,
  p_duplicate_client_id uuid,
  p_name text default null,
  p_phone text default null,
  p_email text default null,
  p_notes text default null,
  p_birthday text default null,
  p_client_tag text default null,
  p_rebooking_weeks integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_primary public.clients%rowtype;
  v_duplicate public.clients%rowtype;
  v_primary_contact_id uuid;
  v_final_name text;
  v_final_phone text;
  v_final_email text;
  v_final_notes text;
  v_final_birthday text;
  v_final_client_tag text;
  v_final_rebooking_weeks integer;
  v_final_sms_opt_in boolean;
  v_final_email_opt_in boolean;
begin
  if v_user_id is null then
    raise exception 'Client merge requires an authenticated account.';
  end if;

  if p_primary_client_id is null or p_duplicate_client_id is null then
    raise exception 'Client merge requires both primary and duplicate client IDs.';
  end if;

  if p_primary_client_id = p_duplicate_client_id then
    raise exception 'Choose two different client records to merge.';
  end if;

  select *
  into v_primary
  from public.clients
  where id = p_primary_client_id
    and user_id = v_user_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Primary client % is not available to this account.', p_primary_client_id;
  end if;

  select *
  into v_duplicate
  from public.clients
  where id = p_duplicate_client_id
    and user_id = v_user_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Duplicate client % is not available to this account.', p_duplicate_client_id;
  end if;

  v_final_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_final_phone := trim(coalesce(p_phone, ''));
  v_final_email := lower(trim(coalesce(p_email, '')));
  v_final_notes := trim(coalesce(p_notes, ''));
  v_final_birthday := trim(coalesce(p_birthday, ''));
  v_final_client_tag := case trim(coalesce(p_client_tag, ''))
    when 'Regular' then 'Regular'
    when 'VIP' then 'VIP'
    else 'New'
  end;
  v_final_rebooking_weeks := case
    when p_rebooking_weeks is not null and p_rebooking_weeks > 0 then p_rebooking_weeks
    else null
  end;

  if v_final_email <> '' and v_final_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Merged client email addresses must be valid.';
  end if;

  if v_final_name = '' then
    v_final_name := coalesce(nullif(v_final_phone, ''), nullif(v_final_email, ''), 'Client');
  end if;

  v_final_sms_opt_in := coalesce(v_primary.sms_opt_in, false) and nullif(v_final_phone, '') is not null;
  v_final_email_opt_in := coalesce(v_primary.email_opt_in, false) and nullif(v_final_email, '') is not null;

  select id
  into v_primary_contact_id
  from public.client_contacts
  where user_id = v_user_id
    and client_id = p_primary_client_id
  order by is_primary desc, created_at asc
  limit 1
  for update;

  insert into public.smart_reminder_dismissals (
    user_id,
    client_id,
    service_id,
    due_on,
    action,
    remind_after,
    created_at,
    updated_at
  )
  select
    user_id,
    p_primary_client_id,
    service_id,
    due_on,
    action,
    remind_after,
    created_at,
    updated_at
  from public.smart_reminder_dismissals
  where user_id = v_user_id
    and client_id = p_duplicate_client_id
  on conflict (user_id, client_id, service_id, due_on) do update
  set
    action = case
      when excluded.updated_at >= public.smart_reminder_dismissals.updated_at
        then excluded.action
      else public.smart_reminder_dismissals.action
    end,
    remind_after = case
      when excluded.updated_at >= public.smart_reminder_dismissals.updated_at
        then excluded.remind_after
      else public.smart_reminder_dismissals.remind_after
    end,
    updated_at = greatest(public.smart_reminder_dismissals.updated_at, excluded.updated_at);

  delete from public.smart_reminder_dismissals
  where user_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.appointments
  set client_id = p_primary_client_id
  where user_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.appointment_message_recipients
  set client_id = p_primary_client_id
  where user_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.communication_consent_tokens
  set client_id = p_primary_client_id
  where user_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.message_conversations
  set client_id = p_primary_client_id
  where account_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.messages
  set client_id = p_primary_client_id
  where (account_id = v_user_id or user_id = v_user_id)
    and client_id = p_duplicate_client_id;

  update public.email_reply_tokens
  set client_id = p_primary_client_id
  where account_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.sms_message_logs
  set client_id = p_primary_client_id
  where user_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.message_credit_usage_events
  set client_id = p_primary_client_id
  where user_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.appointment_message_deliveries
  set client_id = p_primary_client_id
  where user_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.client_contacts
  set
    client_id = p_primary_client_id,
    is_primary = false
  where user_id = v_user_id
    and client_id = p_duplicate_client_id;

  update public.client_contacts
  set is_primary = false
  where user_id = v_user_id
    and client_id = p_primary_client_id;

  if v_primary_contact_id is not null then
    update public.client_contacts
    set
      contact_name = v_final_name,
      phone = nullif(v_final_phone, ''),
      email = nullif(v_final_email, ''),
      sms_enabled = v_final_sms_opt_in,
      email_enabled = v_final_email_opt_in,
      sms_consent_at = case
        when v_final_sms_opt_in then coalesce(sms_consent_at, v_primary.sms_opt_in_at, now())
        else null
      end,
      email_consent_at = case
        when v_final_email_opt_in then coalesce(email_consent_at, v_primary.email_opt_in_at, now())
        else null
      end,
      is_primary = true
    where id = v_primary_contact_id;
  else
    insert into public.client_contacts (
      user_id,
      client_id,
      contact_name,
      relationship,
      phone,
      email,
      sms_enabled,
      email_enabled,
      sms_consent_at,
      email_consent_at,
      is_primary
    )
    values (
      v_user_id,
      p_primary_client_id,
      v_final_name,
      null,
      nullif(v_final_phone, ''),
      nullif(v_final_email, ''),
      v_final_sms_opt_in,
      v_final_email_opt_in,
      case
        when v_final_sms_opt_in then coalesce(v_primary.sms_opt_in_at, now())
        else null
      end,
      case
        when v_final_email_opt_in then coalesce(v_primary.email_opt_in_at, now())
        else null
      end,
      true
    );
  end if;

  update public.clients
  set
    name = v_final_name,
    phone = nullif(v_final_phone, ''),
    email = nullif(v_final_email, ''),
    notes = nullif(v_final_notes, ''),
    birthday = nullif(v_final_birthday, ''),
    client_tag = v_final_client_tag,
    rebooking_weeks = v_final_rebooking_weeks,
    sms_opt_in = v_final_sms_opt_in,
    sms_opt_in_at = case
      when v_final_sms_opt_in then v_primary.sms_opt_in_at
      else null
    end,
    sms_opt_in_source = case
      when v_final_sms_opt_in then v_primary.sms_opt_in_source
      else null
    end,
    email_opt_in = v_final_email_opt_in,
    email_opt_in_at = case
      when v_final_email_opt_in then v_primary.email_opt_in_at
      else null
    end,
    email_opt_in_source = case
      when v_final_email_opt_in then v_primary.email_opt_in_source
      else null
    end
  where id = p_primary_client_id
    and user_id = v_user_id;

  update public.clients
  set archived_at = coalesce(archived_at, now())
  where id = p_duplicate_client_id
    and user_id = v_user_id;

  return jsonb_build_object(
    'ok', true,
    'primaryClientId', p_primary_client_id,
    'duplicateClientId', p_duplicate_client_id
  );
end;
$$;

revoke all on function public.import_clients_batch(jsonb) from public, anon;
grant execute on function public.import_clients_batch(jsonb) to authenticated;

revoke all on function public.merge_client_records(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) from public, anon;
grant execute on function public.merge_client_records(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) to authenticated;
