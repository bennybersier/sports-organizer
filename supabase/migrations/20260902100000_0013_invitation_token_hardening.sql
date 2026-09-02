-- =============================================================================
-- 0013 INVITATION TOKEN HARDENING
--
-- Two related weaknesses, found by testing what a member can actually read.
--
-- 1. `accept_invitation` took the token *hash* as its argument, so the stored
--    hash was itself the bearer credential. Hashing only protects anything if
--    knowing the stored value gets you nowhere — here it got you everything.
--    The function now takes the raw token and hashes it inside the database, so
--    a leaked table, backup or log gives an attacker nothing usable.
--
-- 2. `token_hash` was selectable by anyone with members.read. Even with (1)
--    fixed that is more than they need, so the column is revoked at the grant
--    level: RLS controls which rows are visible, column grants control which
--    fields, and an invitation's secret is nobody's business but the invitee's.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Accept by raw token; hash inside the database.
-- -----------------------------------------------------------------------------
drop function if exists public.accept_invitation(text);

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email   text;
  v_hash    text;
  v_inv     invitations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in to accept this invitation.'
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
  end if;

  -- Reject implausible tokens before touching the table, so this cannot be
  -- used to probe for rows with a trivial value.
  if p_token is null or length(p_token) < 20 then
    raise exception 'We couldn''t find that invitation. Check the link is complete.'
      using errcode = 'no_data_found', hint = 'SCO_USER_MESSAGE';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select email into v_email from profiles where id = v_user_id;
  select * into v_inv from invitations where token_hash = v_hash for update;

  if not found then
    raise exception 'We couldn''t find that invitation. Check the link is complete.'
      using errcode = 'no_data_found', hint = 'SCO_USER_MESSAGE';
  end if;

  if v_inv.status <> 'PENDING' then
    raise exception 'This invitation has already been used or withdrawn.'
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;

  if v_inv.expires_at <= now() then
    update invitations set status = 'EXPIRED' where id = v_inv.id;
    raise exception 'This invitation has expired. Ask for a new one.'
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;

  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'This invitation was sent to a different email address.'
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
  end if;

  insert into tenant_memberships (tenant_id, user_id, role_id, created_by)
  values (v_inv.tenant_id, v_user_id, v_inv.role_id, v_inv.invited_by)
  on conflict (tenant_id, user_id) do nothing;

  update invitations
     set status = 'ACCEPTED', accepted_by = v_user_id, accepted_at = now()
   where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. The secret column is not part of what members may read.
--
-- Column grants are independent of RLS: RLS decides which rows, this decides
-- which fields. `select *` from an authenticated client now fails rather than
-- quietly returning the hash, which is the loud failure we want.
-- -----------------------------------------------------------------------------
revoke select (token_hash) on public.invitations from authenticated, anon;

comment on column public.invitations.token_hash is
  'sha256 of the raw invitation token. Never selectable by client roles, and '
  'never accepted as an argument — accept_invitation takes the raw token and '
  'hashes it here, so this value alone is useless to an attacker.';
