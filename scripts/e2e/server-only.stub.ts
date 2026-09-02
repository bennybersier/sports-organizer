/*
  `server-only` throws on import outside a React Server Component. These suites
  drive real server services from a plain Node process on purpose — that is the
  point of an end-to-end check — so the guard is aliased away here and nowhere
  near the application build.
*/
export {};
