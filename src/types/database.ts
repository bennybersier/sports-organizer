/**
 * Typed schema for the Supabase client.
 *
 * This mirrors supabase/migrations/*.sql exactly and is written in the same
 * shape `supabase gen types typescript` emits, so `pnpm db:types` can replace
 * it wholesale once that command can run.
 *
 * Note: `supabase gen types` runs postgres-meta in a container, so it needs
 * Docker (or OrbStack) installed. Without it, keep this file in step with the
 * migrations by hand — it is verified by `pnpm typecheck`.
 *
 * `Def<Row, RequiredOnInsert>` keeps the file readable: every column is
 * optional on insert except the ones the database has no default for.
 */

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/**
 * Flattens an interface into an anonymous object type.
 *
 * PostgREST's generics constrain every row to `Record<string, unknown>`, and
 * TypeScript does not give `interface` declarations an implicit index
 * signature — so passing them through unflattened makes every query resolve to
 * `never`. Mapping over the members produces an equivalent type alias that does
 * satisfy the constraint.
 */
type Plain<T> = { [K in keyof T]: T[K] };

type Def<Row, Required extends keyof Row = never> = {
  Row: Plain<Row>;
  Insert: Plain<Pick<Row, Required> & Partial<Omit<Row, Required>>>;
  Update: Plain<Partial<Row>>;
  Relationships: [];
};

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export type TenantStatus = "ACTIVE" | "SUSPENDED" | "DELETED";
export type MembershipStatus = "ACTIVE" | "SUSPENDED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
export type OverrideEffect = "ALLOW" | "DENY";
export type SeasonStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type EntityStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type GenderCategory = "MALE" | "FEMALE" | "MIXED" | "OTHER" | "UNSPECIFIED";
export type MembershipState = "ACTIVE" | "TRIAL" | "INACTIVE" | "SUSPENDED";
export type AvailabilityExceptionType = "UNAVAILABLE" | "AVAILABLE_OVERRIDE";
export type ScheduleVersionStatus =
  | "DRAFT" | "GENERATING" | "GENERATED" | "UNDER_REVIEW" | "PUBLISHED" | "ARCHIVED" | "FAILED";
export type ScheduleEntryStatus =
  | "PROPOSED" | "SCHEDULED" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
export type CalendarEventType =
  | "MATCH" | "TOURNAMENT" | "HOLIDAY" | "BLACKOUT" | "SPECIAL_EVENT" | "MEETING" | "TRAINING";
export type CalendarEventStatus = "SCHEDULED" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
export type ValidationState = "VALID" | "WARNING" | "CONFLICT" | "INVALID";
export type AiProvider = "GEMINI" | "ANTHROPIC" | "OPENAI";
export type IntegrationProvider = "GOOGLE_CALENDAR";
export type IntegrationStatus = "CONNECTED" | "DISCONNECTED" | "ERROR" | "EXPIRED";
export type NotificationChannel = "IN_APP" | "EMAIL";
export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

interface Timestamps {
  created_at: string;
  updated_at: string;
}

export interface ProfileRow extends Timestamps {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  locale: string;
  timezone: string;
}

export interface TenantRow extends Timestamps {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  week_start: number;
  logo_url: string | null;
  status: TenantStatus;
  settings: Json;
  plan: string;
  created_by: string | null;
  deleted_at: string | null;
}

export interface PermissionRow {
  key: string;
  resource: string;
  action: string;
  description: string;
  category: string;
  sort_order: number;
}

export interface RoleRow extends Timestamps {
  id: string;
  tenant_id: string | null;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  rank: number;
}

export interface RolePermissionRow {
  role_id: string;
  permission_key: string;
}

export interface TenantMembershipRow extends Timestamps {
  id: string;
  tenant_id: string;
  user_id: string;
  role_id: string;
  status: MembershipStatus;
  title: string | null;
  joined_at: string;
  created_by: string | null;
}

export interface UserPermissionOverrideRow extends Timestamps {
  id: string;
  tenant_id: string;
  user_id: string;
  permission_key: string;
  effect: OverrideEffect;
  reason: string | null;
  created_by: string | null;
}

export interface InvitationRow extends Timestamps {
  id: string;
  tenant_id: string;
  email: string;
  role_id: string;
  token_hash: string;
  status: InvitationStatus;
  message: string | null;
  expires_at: string;
  invited_by: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface SeasonRow extends Timestamps {
  id: string;
  tenant_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: SeasonStatus;
  description: string | null;
  config: Json;
  copied_from_season_id: string | null;
  created_by: string | null;
  archived_at: string | null;
}

export interface GymRow extends Timestamps {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  capacity: number | null;
  /** How many sessions may run here at once. 1 is a normal hall. */
  max_concurrent_teams: number;
  /** Longest overlap allowed between any two of them, in minutes. */
  max_shared_overlap_minutes: number;
  sport_types: string[];
  equipment: string[];
  color: string | null;
  notes: string | null;
  status: EntityStatus;
  created_by: string | null;
  deleted_at: string | null;
}

export interface TrainerRow extends Timestamps {
  id: string;
  tenant_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  qualifications: string[];
  color: string | null;
  notes: string | null;
  status: EntityStatus;
  created_by: string | null;
  deleted_at: string | null;
}

export interface TeamRow extends Timestamps {
  id: string;
  tenant_id: string;
  season_id: string;
  name: string;
  sport: string;
  category: string | null;
  age_group: string | null;
  gender: GenderCategory;
  color: string;
  notes: string | null;
  status: EntityStatus;
  created_by: string | null;
  deleted_at: string | null;
}

export interface AthleteRow extends Timestamps {
  id: string;
  tenant_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: GenderCategory;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  membership_status: MembershipState;
  notes: string | null;
  metadata: Json;
  status: EntityStatus;
  created_by: string | null;
  deleted_at: string | null;
}

export interface AthleteTeamRow extends Timestamps {
  id: string;
  tenant_id: string;
  athlete_id: string;
  team_id: string;
  jersey_number: number | null;
  position: string | null;
  joined_at: string;
  left_at: string | null;
  created_by: string | null;
}

export interface TrainerTeamRow extends Timestamps {
  id: string;
  tenant_id: string;
  trainer_id: string;
  team_id: string;
  is_head_coach: boolean;
  assigned_at: string;
  unassigned_at: string | null;
  created_by: string | null;
}

/** Shared shape of the three recurring-availability tables. */
interface RecurringAvailability extends Timestamps {
  id: string;
  tenant_id: string;
  iso_weekday: IsoWeekday;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_until: string | null;
  note: string | null;
  created_by: string | null;
}

/** Shared shape of the three availability-exception tables. */
interface AvailabilityException extends Timestamps {
  id: string;
  tenant_id: string;
  exception_date: string;
  start_time: string | null;
  end_time: string | null;
  type: AvailabilityExceptionType;
  reason: string | null;
  created_by: string | null;
}

export interface GymAvailabilityRow extends RecurringAvailability {
  gym_id: string;
  season_id: string | null;
}
export interface GymAvailabilityExceptionRow extends AvailabilityException {
  gym_id: string;
}
export interface TrainerAvailabilityRow extends RecurringAvailability {
  trainer_id: string;
  season_id: string | null;
}
export interface TrainerAvailabilityExceptionRow extends AvailabilityException {
  trainer_id: string;
}
export interface TeamAvailabilityRow extends RecurringAvailability {
  team_id: string;
}
export interface TeamAvailabilityExceptionRow extends AvailabilityException {
  team_id: string;
}

export interface TeamTrainingRequirementRow extends Timestamps {
  id: string;
  tenant_id: string;
  team_id: string;
  season_id: string;
  sessions_per_week: number;
  duration_minutes: number;
  /** Booking priority, 1 (highest) to 5 (lowest). */
  priority: number;
  /** First date this team trains; null follows the schedule. */
  starts_on: string | null;
  allowed_weekdays: IsoWeekday[];
  earliest_start: string;
  latest_end: string;
  min_days_between: number;
  max_days_between: number | null;
  allowed_gym_ids: string[];
  preferred_weekdays: IsoWeekday[];
  preferred_start: string | null;
  preferred_end: string | null;
  preferred_gym_ids: string[];
  preference_weights: Json;
  notes: string | null;
  created_by: string | null;
}

export interface ScheduleVersionRow extends Timestamps {
  id: string;
  tenant_id: string;
  season_id: string;
  version_number: number;
  name: string | null;
  status: ScheduleVersionStatus;
  generation_config: Json;
  result_summary: Json;
  random_seed: number | null;
  error_message: string | null;
  applies_from: string;
  applies_until: string;
  based_on_version_id: string | null;
  generated_at: string | null;
  published_at: string | null;
  published_by: string | null;
  archived_at: string | null;
  created_by: string | null;
}

export interface ScheduleEntryRow extends Timestamps {
  id: string;
  tenant_id: string;
  season_id: string;
  schedule_version_id: string;
  /** Occurrences of one recurring weekly slot share this. */
  series_id: string;
  team_id: string;
  trainer_id: string | null;
  gym_id: string;
  start_at: string;
  end_at: string;
  status: ScheduleEntryStatus;
  explanation: Json;
  score: number | null;
  manually_adjusted: boolean;
  /**
   * Whether this entry's hall permits overlapping sessions, copied from the gym
   * by a trigger. Read by the exclusion constraint, which protects every
   * exclusive hall with an index and leaves the rest to a check trigger.
   */
  gym_shares: boolean;
  validation_state: ValidationState;
  validation_details: Json;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface CalendarEventRow extends Timestamps {
  id: string;
  tenant_id: string;
  season_id: string | null;
  type: CalendarEventType;
  status: CalendarEventStatus;
  title: string;
  description: string | null;
  location: string | null;
  gym_id: string | null;
  trainer_id: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  color: string | null;
  allows_gym_sharing: boolean;
  blocks_scheduling: boolean;
  external_id: string | null;
  metadata: Json;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface CalendarEventTeamRow {
  event_id: string;
  team_id: string;
  tenant_id: string;
}

export interface JobRow extends Timestamps {
  id: string;
  tenant_id: string;
  kind: string;
  status: JobStatus;
  idempotency_key: string | null;
  payload: Json;
  result: Json;
  progress: number;
  progress_message: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  requested_by: string | null;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AuditLogRow {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  old_value: Json | null;
  new_value: Json | null;
  reason: string | null;
  metadata: Json;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  tenant_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Json;
  dedupe_key: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreferenceRow extends Timestamps {
  id: string;
  tenant_id: string;
  user_id: string;
  type: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface EmailOutboxRow extends Timestamps {
  id: string;
  tenant_id: string | null;
  to_email: string;
  template: string;
  payload: Json;
  status: JobStatus;
  attempts: number;
  error_message: string | null;
  dedupe_key: string | null;
  sent_at: string | null;
}

export interface AiProviderConfigurationRow extends Timestamps {
  id: string;
  tenant_id: string;
  provider: AiProvider;
  model: string;
  api_key_ciphertext: string;
  api_key_hint: string;
  is_enabled: boolean;
  is_default: boolean;
  config: Json;
  last_verified_at: string | null;
  last_error: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface IntegrationRow extends Timestamps {
  id: string;
  tenant_id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  settings: Json;
  last_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_by: string | null;
}

export interface OauthConnectionRow extends Timestamps {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: IntegrationProvider;
  external_account_id: string;
  external_account_email: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  scopes: string[];
  status: IntegrationStatus;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface CalendarSyncLinkRow extends Timestamps {
  id: string;
  tenant_id: string;
  connection_id: string;
  schedule_entry_id: string | null;
  calendar_event_id: string | null;
  external_calendar_id: string;
  external_event_id: string;
  external_version: string | null;
  last_synced_at: string;
}

export interface McpApiKeyRow extends Timestamps {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  secret_hash: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  last_used_ip: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_by: string | null;
}

export interface PlatformAdminRow {
  user_id: string;
  note: string;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

export interface OnboardingProgressRow extends Timestamps {
  tenant_id: string;
  completed_steps: string[];
  skipped_steps: string[];
  dismissed_at: string | null;
}

/* -------------------------------------------------------------------------- */
/* Database                                                                   */
/* -------------------------------------------------------------------------- */

export type Database = {
  public: {
    Tables: {
      profiles: Def<ProfileRow, "id" | "email">;
      tenants: Def<TenantRow, "name" | "slug">;
      permissions: Def<PermissionRow, "key" | "resource" | "action" | "description" | "category">;
      roles: Def<RoleRow, "key" | "name" | "rank">;
      role_permissions: Def<RolePermissionRow, "role_id" | "permission_key">;
      tenant_memberships: Def<TenantMembershipRow, "tenant_id" | "user_id" | "role_id">;
      user_permission_overrides: Def<
        UserPermissionOverrideRow,
        "tenant_id" | "user_id" | "permission_key" | "effect"
      >;
      invitations: Def<InvitationRow, "tenant_id" | "email" | "role_id" | "token_hash" | "expires_at">;
      seasons: Def<SeasonRow, "tenant_id" | "name" | "start_date" | "end_date">;
      gyms: Def<GymRow, "tenant_id" | "name">;
      trainers: Def<TrainerRow, "tenant_id" | "first_name" | "last_name">;
      teams: Def<TeamRow, "tenant_id" | "season_id" | "name" | "sport">;
      athletes: Def<AthleteRow, "tenant_id" | "first_name" | "last_name">;
      athlete_teams: Def<AthleteTeamRow, "tenant_id" | "athlete_id" | "team_id">;
      trainer_teams: Def<TrainerTeamRow, "tenant_id" | "trainer_id" | "team_id">;
      gym_availability: Def<
        GymAvailabilityRow,
        "tenant_id" | "gym_id" | "iso_weekday" | "start_time" | "end_time"
      >;
      gym_availability_exceptions: Def<
        GymAvailabilityExceptionRow,
        "tenant_id" | "gym_id" | "exception_date" | "type"
      >;
      trainer_availability: Def<
        TrainerAvailabilityRow,
        "tenant_id" | "trainer_id" | "iso_weekday" | "start_time" | "end_time"
      >;
      trainer_availability_exceptions: Def<
        TrainerAvailabilityExceptionRow,
        "tenant_id" | "trainer_id" | "exception_date" | "type"
      >;
      team_availability: Def<
        TeamAvailabilityRow,
        "tenant_id" | "team_id" | "iso_weekday" | "start_time" | "end_time"
      >;
      team_availability_exceptions: Def<
        TeamAvailabilityExceptionRow,
        "tenant_id" | "team_id" | "exception_date" | "type"
      >;
      team_training_requirements: Def<
        TeamTrainingRequirementRow,
        "tenant_id" | "team_id" | "season_id"
      >;
      schedule_versions: Def<
        ScheduleVersionRow,
        "tenant_id" | "season_id" | "applies_from" | "applies_until"
      >;
      schedule_entries: Def<
        ScheduleEntryRow,
        | "tenant_id" | "season_id" | "schedule_version_id"
        | "team_id" | "gym_id" | "start_at" | "end_at"
      >;
      calendar_events: Def<
        CalendarEventRow,
        "tenant_id" | "type" | "title" | "start_at" | "end_at"
      >;
      calendar_event_teams: Def<CalendarEventTeamRow, "event_id" | "team_id" | "tenant_id">;
      jobs: Def<JobRow, "tenant_id" | "kind">;
      audit_logs: Def<AuditLogRow, "tenant_id" | "action" | "resource_type">;
      notifications: Def<NotificationRow, "tenant_id" | "user_id" | "type" | "title">;
      notification_preferences: Def<
        NotificationPreferenceRow,
        "tenant_id" | "user_id" | "type" | "channel"
      >;
      email_outbox: Def<EmailOutboxRow, "to_email" | "template">;
      ai_provider_configurations: Def<
        AiProviderConfigurationRow,
        "tenant_id" | "provider" | "model" | "api_key_ciphertext" | "api_key_hint"
      >;
      integrations: Def<IntegrationRow, "tenant_id" | "provider">;
      oauth_connections: Def<
        OauthConnectionRow,
        "tenant_id" | "user_id" | "provider" | "external_account_id"
      >;
      calendar_sync_links: Def<
        CalendarSyncLinkRow,
        "tenant_id" | "connection_id" | "external_calendar_id" | "external_event_id"
      >;
      mcp_api_keys: Def<
        McpApiKeyRow,
        "tenant_id" | "user_id" | "name" | "secret_hash" | "key_prefix"
      >;
      onboarding_progress: Def<OnboardingProgressRow, "tenant_id">;
      platform_admins: Def<PlatformAdminRow, "user_id" | "note">;
    };
    Views: Record<never, never>;
    Functions: {
      my_memberships: {
        Args: Record<never, never>;
        Returns: {
          tenant_id: string;
          tenant_name: string;
          tenant_slug: string;
          tenant_timezone: string;
          role_key: string;
          role_name: string;
          role_rank: number;
          status: MembershipStatus;
        }[];
      };
      my_permissions: {
        Args: { p_tenant: string };
        Returns: string[];
      };
      accept_invitation: {
        Args: { p_token: string };
        Returns: string;
      };
      publish_schedule_version: {
        Args: { p_version_id: string };
        Returns: string;
      };
      internal_publish_schedule_version: {
        Args: { p_version_id: string; p_user_id: string };
        Returns: string;
      };
      am_i_platform_admin: {
        Args: Record<never, never>;
        Returns: boolean;
      };
      admin_list_tenants: {
        Args: Record<never, never>;
        Returns: {
          id: string;
          name: string;
          slug: string;
          timezone: string;
          status: TenantStatus;
          created_at: string;
          deleted_at: string | null;
          member_count: number;
          team_count: number;
          athlete_count: number;
          season_count: number;
        }[];
      };
      admin_create_tenant: {
        Args: {
          p_name: string;
          p_slug: string;
          p_owner_email: string;
          p_timezone?: string;
          p_locale?: string;
          p_week_start?: number;
        };
        Returns: string;
      };
    };
    Enums: {
      tenant_status: TenantStatus;
      membership_status: MembershipStatus;
      invitation_status: InvitationStatus;
      override_effect: OverrideEffect;
      season_status: SeasonStatus;
      entity_status: EntityStatus;
      gender_category: GenderCategory;
      membership_state: MembershipState;
      availability_exception_type: AvailabilityExceptionType;
      schedule_version_status: ScheduleVersionStatus;
      schedule_entry_status: ScheduleEntryStatus;
      calendar_event_type: CalendarEventType;
      calendar_event_status: CalendarEventStatus;
      validation_state: ValidationState;
      ai_provider: AiProvider;
      integration_provider: IntegrationProvider;
      integration_status: IntegrationStatus;
      notification_channel: NotificationChannel;
      job_status: JobStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
