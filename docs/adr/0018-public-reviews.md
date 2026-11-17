# ADR 0018 — Public reviews from the survey, approved by an admin

- **Status:** Accepted
- **Date:** 2026-11-17

## Context
The post-session survey (ADR 0017) collects private answers. The owner wants
clients to be able to leave a public comment with a star rating, show those
comments on the home page, reach the survey from any past turno, and export the
answers.

## Decision
1. **The review is the survey's optional last step,** not a separate feature.
   - `session_surveys` gains `rating` (1–5), `public_comment` (up to 600
     characters), `review_status` and `review_published_at`.
   - A comment needs its stars. Stars alone are stored but never published.
   - `submit_session_survey` stores them with the rest; a comment starts as
     `pending`.
2. **Nothing is public until an admin approves it.** `admin_set_review_status`
   moves a comment to `approved` or `hidden`, either way, at any time.
   - The admin notice (`survey_submitted`) says when a comment is waiting.
   - Métricas › Encuestas shows the count waiting and a filter for them; the
     approval queue ignores the period.
3. **The public reads through one RPC, `public_reviews`,** granted to `anon`.
   - It returns the first name, stars, comment, plan name and an avatar seed.
     `session_surveys` and `profiles` stay closed to the public.
   - The avatar seed is the profile id, so the public avatar is the one the
     client sees in their account. The id grants nothing by itself (RLS).
   - Paging is by keyset on `(review_published_at, id)`, newest first.
     `review_published_at` is the first approval, so re-approving a hidden
     comment does not move it to the front.
4. **The home section is fetched in the browser** (`components/landing/reviews.tsx`),
   like the plans, so the page stays static and an approval needs no deploy. It
   renders nothing while there are no approved comments.
5. **Every past turno offers its survey.** Mis turnos shows "Completar encuesta"
   under each eligible past turno and the turno page has the same link. The
   server never had a time limit; the 30-day limit now applies to the banner
   only.
6. **Answers export as CSV** from Métricas › Encuestas
   (`/admin/metricas/encuestas.csv`), with the list's filters.
   - `;` separator and a BOM, which is what Excel in es-AR opens correctly.
   - Cells that start like a formula get a leading apostrophe, since clients
     type the text.

## Consequences
- A client cannot add a review to a survey they already sent, or edit one. An
  admin can hide a comment on request.
- Reviews follow the sector's `survey_enabled` switch, since they are part of
  the survey.
- The home section is not in the static HTML, so search engines may not index
  the comments.

## Alternatives rejected
- **Publish at once, hide afterwards:** an unreviewed comment would sit on the
  home page until someone noticed.
- **A public view on `session_surveys`:** it would need a join to `profiles`
  that anon cannot read; an RPC keeps the exposed columns explicit.
