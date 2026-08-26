# Auth email templates (branded)

The Supabase **Auth** emails are dashboard-side config and do **not** migrate
with the database (lesson from the Frankfurt move). The branded set lives as
plain HTML files in **supabase/templates/auth/** - one file per template, no
markdown around them, so a full-select copy is always exactly the body.

## How to apply

Supabase dashboard (Abniyah EU) -> **Authentication -> Email Templates**, then
for each row below:

1. Open the `.html` file in VS Code -> **Ctrl+A -> Ctrl+C** -> paste into the
   template's **Message body** (source view).
2. Type the subject into the **Subject** field. Plain text only - never HTML,
   never a `**Subject:**` line, never anything from the file.

| Template | Subject | Body file |
|---|---|---|
| Invite user | You have been invited to Abniyah | `supabase/templates/auth/invite.html` |
| Confirm signup | Confirm your email for Abniyah | `supabase/templates/auth/confirm-signup.html` |
| Reset password | Reset your Abniyah password | `supabase/templates/auth/reset-password.html` |
| Magic link | Your Abniyah sign-in link | `supabase/templates/auth/magic-link.html` |
| Change email address | Confirm your new email for Abniyah | `supabase/templates/auth/change-email.html` |

Notes:
- The invite body renders context sent by the `invite-user` function
  (`invited_role` / `invited_place` / `invited_by`) and degrades gracefully
  when absent. Its button lands on `/set-password`.
- Alternative to hand-pasting: give Claude a 7-day PAT and all five are pushed
  via the Management API in one shot.
