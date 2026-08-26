# Auth email templates (branded)

The Supabase **Auth** emails (invite, confirm, reset, magic link, email change)
are dashboard-side config and did **not** migrate from Seoul — Frankfurt fell
back to GoTrue's unstyled defaults (discovered 2026-08-26 via a naked
"You've been invited" email). This file is the canonical branded set, matching
`dynamic-action`'s `emailHtml` look (teal `#0F4A3F` header, ABNIYAH wordmark,
white card).

**To apply:** Supabase dashboard (Abniyah EU) → **Authentication → Email
Templates** → for each template below, set the Subject and paste the HTML.
(Or hand Claude a 7-day PAT and it pushes all five via the Management API.)

The invite template renders context passed by the `invite-user` function
(`{{ .Data.invite_line }}` = "You have been invited as ROLE to PLACE by
INVITER."). If the metadata is absent (old invites), it degrades gracefully.

---

## 1. Invite user

**Subject:** `You have been invited to Abniyah`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
      <tr><td style="background:#0F4A3F;padding:18px 32px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;padding-right:10px;"><img src="https://abniyah.com/email-logo.png" width="26" height="26" alt="" style="display:block;border:0;" /></td>
          <td style="vertical-align:middle;"><p style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:0.12em;">ABNIYAH</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;">
        <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;font-weight:600;">{{ if .Data.full_name }}Welcome, {{ .Data.full_name }}{{ else }}You have been invited{{ end }}</h2>
        <p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.6;">{{ if .Data.invite_line }}{{ .Data.invite_line }}{{ else }}You have been invited to join Abniyah, the building management platform.{{ end }}</p>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Accept the invitation below to create your password and activate your account.</p>
        <div style="margin-top:28px;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0F4A3F;color:#fff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;">Accept invitation</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">If you were not expecting this invitation, you can safely ignore this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
```

## 2. Confirm signup

**Subject:** `Confirm your email for Abniyah`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
      <tr><td style="background:#0F4A3F;padding:18px 32px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;padding-right:10px;"><img src="https://abniyah.com/email-logo.png" width="26" height="26" alt="" style="display:block;border:0;" /></td>
          <td style="vertical-align:middle;"><p style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:0.12em;">ABNIYAH</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;">
        <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;font-weight:600;">Confirm your email</h2>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">One click and your Abniyah account is ready.</p>
        <div style="margin-top:28px;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0F4A3F;color:#fff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;">Confirm email</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">If you did not create an Abniyah account, you can safely ignore this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
```

## 3. Reset password

**Subject:** `Reset your Abniyah password`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
      <tr><td style="background:#0F4A3F;padding:18px 32px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;padding-right:10px;"><img src="https://abniyah.com/email-logo.png" width="26" height="26" alt="" style="display:block;border:0;" /></td>
          <td style="vertical-align:middle;"><p style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:0.12em;">ABNIYAH</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;">
        <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;font-weight:600;">Reset your password</h2>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Someone requested a password reset for this account. If it was you, set a new password below.</p>
        <div style="margin-top:28px;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0F4A3F;color:#fff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;">Set a new password</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">If this was not you, ignore this email - your password stays unchanged.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
```

## 4. Magic link

**Subject:** `Your Abniyah sign-in link`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
      <tr><td style="background:#0F4A3F;padding:18px 32px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;padding-right:10px;"><img src="https://abniyah.com/email-logo.png" width="26" height="26" alt="" style="display:block;border:0;" /></td>
          <td style="vertical-align:middle;"><p style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:0.12em;">ABNIYAH</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;">
        <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;font-weight:600;">Sign in to Abniyah</h2>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Use the button below to sign in. The link works once and expires shortly.</p>
        <div style="margin-top:28px;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0F4A3F;color:#fff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;">Sign in</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">If you did not request this link, you can safely ignore this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
```

## 5. Change email address

**Subject:** `Confirm your new email for Abniyah`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
      <tr><td style="background:#0F4A3F;padding:18px 32px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;padding-right:10px;"><img src="https://abniyah.com/email-logo.png" width="26" height="26" alt="" style="display:block;border:0;" /></td>
          <td style="vertical-align:middle;"><p style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:0.12em;">ABNIYAH</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;">
        <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;font-weight:600;">Confirm your new email</h2>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">You asked to change your sign-in email to {{ .NewEmail }}. Confirm below to make it official.</p>
        <div style="margin-top:28px;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0F4A3F;color:#fff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;">Confirm change</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">If this was not you, ignore this email and consider changing your password.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
```
