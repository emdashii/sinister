# Agent instructions

Finish line: once `bun test` and `bun run build` pass, commit, push to `main`, and
deploy without asking. Ask before making the repo public.

- Browser checks: `bun run build`, then `bun run e2e`. The offline test needs the
  production service worker, so it runs against `vite preview`.
- `data/build/` is generated and committed; Netlify never rebuilds it. After
  `bun run data`, synset indices can shift, so re-run `bun run data:latin`,
  `bun scripts/embed-synsets.ts` (delete `data/raw/vectors-hyper.f32` first) and
  `bun run data:vectors`, or the description filter scores the wrong meanings.
- Changing the description filter's text, model or phrasing: re-run `bun run eval`
  and update `docs/adr/0001-semantic-filter.md` and the About page figure.
