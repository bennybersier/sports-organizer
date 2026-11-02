-- -----------------------------------------------------------------------------
-- 0028 — a second model, for talking about a sheet rather than reading one
--
-- The two jobs have different stakes and different prices. Transcribing a
-- referto produces the numbers that go into a child's season and deserves the
-- best model a club will pay for; answering "is that a 1 or a 7?" is one
-- glance and three sentences, confirmed by the person who asked before it
-- changes anything, and a tenth of the price buys the same usefulness.
--
-- Nullable, and null means "use the application's default for this provider,
-- or failing that the reading model". A club that never opens the setting
-- gets the sensible pairing; one that wants a single model for everything can
-- say so.
-- -----------------------------------------------------------------------------
alter table public.ai_provider_configurations
  add column if not exists conversation_model text;

comment on column public.ai_provider_configurations.conversation_model is
  'Model for conversational questions about an uploaded document. Null falls back to the app default for the provider, then to `model`.';
