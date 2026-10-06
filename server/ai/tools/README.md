# Book tools (Т3.6, ТЗ-H §7)

`createBookToolRuntime` is a server-only entry point, not a public tool endpoint.
The caller must derive `scope` from the authenticated request and server run, and
provide `authorize` that rechecks the principal's access. Model output must never
create a scope or an authorization callback. Magic Scene does this in its route
adapter; trusted core service callers supply their own server grant.

Every call checks project, actor, character, scene and simulation. Snake-case
and camel-case context arguments must match the bound scope. Unknown fields,
including `confirm`, `status`, `actor`, nested scope and arbitrary paths, fail.
Arguments are cloned before asynchronous authorization. The runtime enforces
agent allowlists, call limits and timeout; a completed context cannot call tools.

| Tool | Behavior |
| --- | --- |
| get-character-snapshot | Existing temporal snapshot, only this character's knowledge. |
| get-scene-context | Director situation and observable events; no source prose or private thoughts. |
| search-character-mentions | Search only evidence already included in the authorized snapshot. |
| evaluate-character-options | Bound server adapter and a subset of allowed actions; validate its result. |
| read-authorized-secret | Denied until T4.1 supplies encrypted Vault and disclosure grants. No plaintext fallback. |
| write-simulation-event | Append an actor-only note to the current active run. Does not advance a scene turn or touch canon. |
| propose-canon-change | Pending memory, fact, fragment or tag, with observed event IDs. Tag requires this character's pending fragment. |

Notes are visible to their own character's tools and to the authorized author.
They do not become observable actions for other characters. Magic Scene's main
turn events remain validated and saved atomically by its orchestrator.
Canon changes use the existing separate author confirmation flow; no acceptance
or arbitrary repository mutation tool is registered. Filesystem, shell and
network calls are absent from the model-visible registry.

The seven adjacent `../skills/*/SKILL.md` assets are trusted server instructions.
The fixed loader reads only known IDs. `npm run build` copies them into
`dist/ai-skills`, included by the existing Docker `COPY dist`. This asset loader
is not an agent tool and does not accept file paths.

Verify with `npm run test:book-tools`; add the dedicated test database through
`CORE_TEST_DATABASE_URL` to run the same cases on PostgreSQL. Magic Scene browser
regression: `npm run test:magic-scene -- --browser` (build CSS first). Tests use
controlled model answers, not paid providers. Real Harness remains unconfigured
by the existing MVP decision; the in-process adapter executes these tools.
